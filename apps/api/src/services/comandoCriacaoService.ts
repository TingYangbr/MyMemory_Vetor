/**
 * Pedido de criação no Perguntar ("criar reunião interna Softing dia 10/12 às 10h").
 *
 * Não grava nada: passa o texto pelo mesmo processamento do Catalogar (processTextMemoForReview),
 * com a categoria indicada pela classificação, e devolve a proposta. O cartão de memo novo, na tela
 * do Perguntar, mostra os campos e grava pelo mesmo caminho do Catalogar (POST /api/memos/text/confirm).
 * Da voz, guarda-se só o texto (a transcrição já chega aqui como texto).
 */
import type { ComandoCriacao, MemoContextCategory, PerguntaClassificacao, PerguntaPlanoCriacao, TextMemoProcessResponse } from "@mymemory/shared";
import { lerValoresStatus, textoDeCriacao, valorDaSituacao } from "@mymemory/shared";
import { getUserIaUseTexto, processTextMemoForReview } from "./textMemoProcessService.js";

const norm = (s: string) => s.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().trim();

/** Campos que o cartão de memo novo mostra (a situação da categoria atualizável fica de fora). */
function camposDoCartao(cat: MemoContextCategory | null, campoSituacao: string | null): ComandoCriacao["campos"] {
  return (cat?.campos ?? [])
    .filter((f) => f.isActive === 1 && (!campoSituacao || norm(f.name) !== norm(campoSituacao)))
    .map((f) => ({
      nome: f.name,
      tipo: f.tipo,
      descricao: f.description ?? null,
      ...(f.tipo === "status" ? { valores: lerValoresStatus(f.normalizedTerms) } : {}),
    }));
}

export async function prepararCriacao(input: {
  texto: string;
  userId: number;
  isAdmin: boolean;
  groupId: number | null;
  categories: MemoContextCategory[];
  classificacao: PerguntaClassificacao;
}): Promise<ComandoCriacao> {
  const ativas = input.categories.filter((c) => c.isActive === 1);
  const indicadas = new Set(input.classificacao.categorias.map(norm));
  const indicada = ativas.find((c) => indicadas.has(norm(c.name))) ?? null;

  const nivel = await getUserIaUseTexto(input.userId);
  const iaUseTexto = nivel === "semIA" ? "basico" : nivel;

  let processado;
  try {
    processado = await processTextMemoForReview({
      userId: input.userId,
      groupId: input.groupId,
      isAdmin: input.isAdmin,
      rawText: input.texto,
      iaUseTexto,
      categoriaForcadaId: indicada?.id ?? null,
    });
  } catch (e) {
    // Categoria indicada não vale neste grupo: deixa a IA escolher, como no Catalogar
    if (!(e instanceof Error && e.message === "categoria_invalida")) throw e;
    processado = await processTextMemoForReview({
      userId: input.userId,
      groupId: input.groupId,
      isAdmin: input.isAdmin,
      rawText: input.texto,
      iaUseTexto,
    });
  }

  const cat =
    ativas.find((c) => processado.matchedCategoryId != null && c.id === processado.matchedCategoryId) ??
    (processado.category ? ativas.find((c) => norm(c.name) === norm(processado.category ?? "")) : undefined) ??
    indicada ??
    null;
  const campoSituacao = cat?.atualizavel && cat.campoSituacao ? cat.campoSituacao : null;
  const campos = camposDoCartao(cat, campoSituacao);

  return {
    mensagem: cat
      ? `Preparei um registro novo em ${cat.name}: confira no cartão e toque em Salvar registro.`
      : "Preparei um registro novo: confira no cartão e toque em Salvar registro.",
    groupId: input.groupId,
    categoria: cat?.name ?? processado.category ?? null,
    campos,
    campoSituacao,
    campoDono: cat?.campoDono ?? null,
    situacaoAberta: valorDaSituacao("aberto", cat?.situacaoTipo),
    processado,
  };
}

// ── Modelo de registro: cartão montado direto dos chips, sem IA ───────────────

export type CriacaoDeModelo =
  | { ok: true; criacao: ComandoCriacao; texto: string }
  | {
      ok: false;
      /** sem_valores / valor_invalido: erro para a pessoa corrigir. categoria_indisponivel / campo_alterado: segue pelo caminho com IA. */
      motivo: "sem_valores" | "valor_invalido" | "categoria_indisponivel" | "campo_alterado";
      mensagem: string;
      texto: string;
    };

const dataBr = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Monta o mesmo `ComandoCriacao` que `prepararCriacao` devolve, mas só com os valores preenchidos nos chips:
 * campo vazio fica nulo, nada do dia em que o modelo foi salvo é reaproveitado, e os campos de data marcados
 * como "hoje" recebem a data de hoje. Resumo e palavras-chave são texto fixo (sem IA). Nada é gravado aqui:
 * o cartão grava pelo caminho de sempre (POST /api/memos/text/confirm), depois do "Salvar registro".
 */
export function montarCriacaoDeModelo(input: {
  plano: PerguntaPlanoCriacao;
  /** Valor digitado em cada chip (chave = nome do campo no plano). */
  valores: Record<string, string>;
  categories: MemoContextCategory[];
  groupId: number | null;
  /** Hoje (AAAA-MM-DD, fuso de São Paulo). */
  hojeIso: string;
}): CriacaoDeModelo {
  const { plano, categories } = input;
  const texto = textoDeCriacao(plano, input.valores);

  const cat = categories.find((c) => c.isActive === 1 && norm(c.name) === norm(plano.categoria)) ?? null;
  if (!cat) {
    return { ok: false, motivo: "categoria_indisponivel", texto, mensagem: `A categoria "${plano.categoria}" não está disponível.` };
  }
  const ativos = cat.campos.filter((f) => f.isActive === 1);
  const doCampo = (nome: string) => ativos.find((f) => norm(f.name) === norm(nome));

  // Todo campo do modelo precisa continuar existindo e com o mesmo tipo; senão a IA refaz o caminho
  for (const c of plano.campos) {
    const f = doCampo(c.nome);
    const tipoOk = f != null && (c.tipo === "numero" ? f.tipo === "number" : f.tipo === "text");
    if (!tipoOk) {
      return { ok: false, motivo: "campo_alterado", texto, mensagem: `O campo "${c.nome}" mudou na categoria.` };
    }
  }

  const dados: Record<string, string> = {};
  const preenchidos: { nome: string; valor: string }[] = [];
  for (const c of plano.campos) {
    const f = doCampo(c.nome)!;
    const valor = (input.valores[c.nome] ?? "").trim();
    if (!valor) continue;
    if (c.tipo === "numero" && !/\d/.test(valor)) {
      return { ok: false, motivo: "valor_invalido", texto, mensagem: `${c.nome}: "${valor}" não parece um número.` };
    }
    dados[f.name] = valor;
    preenchidos.push({ nome: f.name, valor });
  }
  if (!preenchidos.length) {
    return { ok: false, motivo: "sem_valores", texto, mensagem: "Preencha ao menos um valor." };
  }

  let comData = false;
  for (const nome of plano.hoje ?? []) {
    const f = doCampo(nome);
    if (f && f.tipo === "date") {
      dados[f.name] = input.hojeIso;
      comData = true;
    }
  }

  const resumo = `${cat.name}${comData ? ` de ${dataBr(input.hojeIso)}` : ""} — ${preenchidos.map((p) => `${p.nome} ${p.valor}`).join("; ")}`;
  const processado: TextMemoProcessResponse = {
    originalText: texto,
    suggestedMediaText: resumo,
    suggestedKeywords: [cat.name, ...preenchidos.map((p) => p.nome)].join(", "),
    maxSummaryChars: Math.max(resumo.length, 4000),
    apiCost: 0,
    iaLevel: "semIA",
    processingWarning: "Registro montado direto dos campos que você preencheu, sem IA. Confira e salve.",
    dadosEspecificosJson: JSON.stringify(dados),
    dadosEspecificosOriginaisJson: null,
    matchedCategoryId: cat.id,
    category: cat.name,
  };

  const campoSituacao = cat.atualizavel && cat.campoSituacao ? cat.campoSituacao : null;
  return {
    ok: true,
    texto,
    criacao: {
      mensagem: `Preparei um registro novo em ${cat.name}: confira no cartão e toque em Salvar registro.`,
      groupId: input.groupId,
      categoria: cat.name,
      campos: camposDoCartao(cat, campoSituacao),
      campoSituacao,
      campoDono: cat.campoDono ?? null,
      situacaoAberta: valorDaSituacao("aberto", cat.situacaoTipo),
      processado,
    },
  };
}
