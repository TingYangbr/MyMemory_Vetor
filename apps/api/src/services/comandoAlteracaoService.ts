/**
 * Comando de alteração no Perguntar ("adiar a reunião interna para 14h", "tirar banana da lista").
 *
 * A classificação da pergunta já disse que o texto é um comando ("alterar"). Aqui:
 *  1. separa as categorias atualizáveis do contexto (as indicadas pela classificação, se houver);
 *  2. carrega os memos ativos dessas categorias que o usuário pode alterar (os mais recentes);
 *  3. uma chamada de IA escolhe o(s) alvo(s) e devolve os valores novos de cada campo;
 *  4. decide: nenhum alvo → avisa; vários (ou lote) → o usuário escolhe; um, com a categoria pedindo
 *     confirmação → o cartão abre com os valores propostos; um, sem confirmação → grava com
 *     `alterarMemo` (mesmo histórico e Desfazer da tela).
 *
 * O servidor não guarda nada pendente: a proposta volta na resposta e os botões da tela chamam as
 * rotas de alteração que já existem.
 */
import type {
  ComandoAlteracao,
  ComandoAlteracaoCandidato,
  MemoContextCategory,
  PerguntaClassificacao,
  PerguntaResposta,
} from "@mymemory/shared";
import { normalizarDataParaIso } from "@mymemory/shared";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";
import { invokeLLM } from "../lib/invokeLlm.js";
import { alterarMemo, filtrarMemosAlteraveis } from "./memoAlteracaoService.js";

/** Quantos memos recentes entram como candidatos (por categoria somada). */
const MAX_CANDIDATOS = 40;
const RESUMO_MAX = 220;

const semAcento = (s: string) => s.normalize("NFD").replace(/\p{Mn}/gu, "");
const norm = (s: string) => semAcento(s).toLowerCase().trim();

const DIAS_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

interface Candidato {
  id: number;
  categoria: string;
  resumo: string;
  dados: Record<string, string>;
}

function lerDados(texto: unknown): Record<string, string> {
  if (typeof texto !== "string" || !texto.trim()) return {};
  try {
    const v = JSON.parse(texto) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = val == null ? "" : String(val);
    return out;
  } catch {
    return {};
  }
}

function valorAtual(dados: Record<string, string>, campo: string): string {
  const alvo = norm(campo);
  const k = Object.keys(dados).find((x) => norm(x) === alvo);
  return k != null ? dados[k] ?? "" : "";
}

/** Valor proposto pela IA já no formato gravado, para comparar com o atual (data em AAAA-MM-DD). */
function comoGravado(valor: string, tipo: string): string {
  const v = valor.trim();
  if (tipo === "date") return normalizarDataParaIso(v) ?? v;
  if (tipo === "lista") {
    return v
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n");
  }
  return v;
}

function hojeTexto(): string {
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${iso} (${DIAS_SEMANA[d.getDay()]})`;
}

async function carregarCandidatos(
  cats: MemoContextCategory[],
  userId: number,
  isAdmin: boolean,
  groupId: number | null
): Promise<Candidato[]> {
  if (!cats.length) return [];
  // Por categoria: memo ativo (situação vazia conta como Ativo) daquela categoria
  const partes: string[] = [];
  const params: unknown[] = [];
  for (const c of cats) {
    partes.push(
      `(m.category = ? AND NOT (lower(unaccent(COALESCE(m.dadosespecificosjson::jsonb->>(?::text), ''))) LIKE 'conclu%'
        OR lower(unaccent(COALESCE(m.dadosespecificosjson::jsonb->>(?::text), ''))) LIKE 'cancel%'))`
    );
    params.push(c.name, c.campoSituacao, c.campoSituacao);
  }
  const escopo = groupId != null ? "m.groupid = ?" : "(m.groupid IS NULL AND m.userid = ?)";
  params.push(groupId != null ? groupId : userId);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT m.id, m.category, m.mediatext, m.dadosespecificosjson
     FROM memos m
     WHERE m.isactive = 1 AND (${partes.join(" OR ")}) AND ${escopo}
     ORDER BY m.createdat DESC
     LIMIT ${MAX_CANDIDATOS}`,
    params
  );
  const ids = rows.map((r) => Number(r.id));
  const permitidos = new Set(await filtrarMemosAlteraveis(ids, userId, isAdmin));
  return rows
    .filter((r) => permitidos.has(Number(r.id)))
    .map((r) => ({
      id: Number(r.id),
      categoria: String(r.category ?? ""),
      resumo: String(r.mediaText ?? r.mediatext ?? "").replace(/\s+/g, " ").trim().slice(0, RESUMO_MAX),
      dados: lerDados(r.dadosEspecificosJson ?? r.dadosespecificosjson),
    }));
}

const SYSTEM = [
  "Você interpreta COMANDOS de alteração de registros (memos) de um usuário: adiar, remarcar, mudar, cancelar, concluir, reativar, acrescentar ou tirar itens.",
  "Recebe o comando, a data de hoje, as categorias (com seus campos) e os registros candidatos com os valores atuais.",
  "Responda SOMENTE JSON neste formato:",
  '{"alvos":[<ids>],"lote":false,"mudancas":{"<id>":{"<nome do campo>":"<valor novo>"}},"motivo":""}',
  "Regras:",
  "- alvos: os ids dos registros a que o comando se refere. Se mais de um registro pode ser o certo e o comando não diz que são vários, devolva todos os possíveis (o usuário escolhe). Se nenhum corresponde, devolva [].",
  '- lote = true só quando o comando pede explicitamente vários registros ("todas as reuniões de amanhã", "tudo").',
  "- Use somente nomes de campos que existem na categoria do registro, escritos exatamente como na lista. Não invente campos.",
  "- Inclua só os campos que mudam. Não altere o que o comando não menciona.",
  "- Datas: formato AAAA-MM-DD. Datas relativas (amanhã, quinta, semana que vem) contam a partir da data de hoje. Horas: HH:MM.",
  "- Adiar ou remarcar muda a data e/ou a hora; mantenha o resto.",
  "- Cancelar, concluir ou reativar: use o campo de situação da categoria com o valor Cancelado, Concluído ou Ativo.",
  "- Campos do tipo lista: devolva a lista inteira atualizada, um item por linha. Para acrescentar, mantenha os itens que já existem e inclua os novos; para tirar, remova a linha do item.",
  "- motivo: uma frase curta explicando a escolha.",
].join("\n");

export interface ResultadoComando {
  resposta: PerguntaResposta;
  comando: ComandoAlteracao;
  costUsd: number;
}

/**
 * Trata o texto como comando de alteração. Devolve null quando não há categoria atualizável no
 * contexto (aí a pergunta segue o fluxo normal de consulta).
 */
export async function executarComandoAlteracao(input: {
  texto: string;
  userId: number;
  isAdmin: boolean;
  groupId: number | null;
  categories: MemoContextCategory[];
  classificacao: PerguntaClassificacao;
}): Promise<ResultadoComando | null> {
  const atualizaveis = input.categories.filter((c) => c.isActive === 1 && c.atualizavel && c.campoSituacao);
  if (!atualizaveis.length) return null;
  const indicadas = new Set(input.classificacao.categorias.map(norm));
  const alvoCats = atualizaveis.some((c) => indicadas.has(norm(c.name)))
    ? atualizaveis.filter((c) => indicadas.has(norm(c.name)))
    : atualizaveis;

  const candidatos = await carregarCandidatos(alvoCats, input.userId, input.isAdmin, input.groupId);
  const resposta = (texto: string, usados: Candidato[] = []): PerguntaResposta => ({
    resposta: texto,
    tipo_resposta: "estruturada",
    dados_usados: usados.map((c) => ({ memo_id: c.id, trecho_usado: c.resumo, mediatext: c.resumo })),
    limitacoes: [],
    confianca_estimada: usados.length ? 0.8 : 0,
  });
  if (!candidatos.length) {
    const msg = "Não encontrei um registro ativo que você possa alterar para esse pedido.";
    return { resposta: resposta(msg), comando: { status: "nao_encontrado", mensagem: msg }, costUsd: 0 };
  }

  const catPorNome = new Map(alvoCats.map((c) => [c.name, c]));
  const user = JSON.stringify(
    {
      comando: input.texto,
      hoje: hojeTexto(),
      categorias: alvoCats.map((c) => ({
        nome: c.name,
        campo_situacao: c.campoSituacao,
        campos: c.campos
          .filter((f) => f.isActive === 1)
          .map((f) => ({ nome: f.name, tipo: f.tipo, descricao: f.description ?? null })),
      })),
      candidatos: candidatos.map((c) => ({ id: c.id, categoria: c.categoria, resumo: c.resumo, campos: c.dados })),
    },
    null,
    2
  );
  const { text, costUsd } = await invokeLLM({ system: SYSTEM, user, jsonObject: true, temperature: 0, source: "comando_alteracao" });

  let parsed: { alvos?: unknown; lote?: unknown; mudancas?: unknown } = {};
  try {
    const t = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    const i = t.indexOf("{");
    const k = t.lastIndexOf("}");
    parsed = i >= 0 && k > i ? (JSON.parse(t.slice(i, k + 1)) as typeof parsed) : {};
  } catch {
    parsed = {};
  }

  const porId = new Map(candidatos.map((c) => [c.id, c]));
  const alvosIds = (Array.isArray(parsed.alvos) ? parsed.alvos : [])
    .map((x) => Number(x))
    .filter((n, i, arr) => porId.has(n) && arr.indexOf(n) === i);
  const lote = parsed.lote === true;
  const mudancasIa =
    parsed.mudancas && typeof parsed.mudancas === "object" ? (parsed.mudancas as Record<string, unknown>) : {};

  // Monta, para cada alvo, só os campos que existem na categoria e que de fato mudam
  const propostas: ComandoAlteracaoCandidato[] = [];
  for (const id of alvosIds) {
    const cand = porId.get(id)!;
    const cat = catPorNome.get(cand.categoria);
    if (!cat) continue;
    const brutos = mudancasIa[String(id)];
    const campos = brutos && typeof brutos === "object" ? (brutos as Record<string, unknown>) : {};
    const propostos: Record<string, string> = {};
    const mudancas: { campo: string; antes: string; depois: string }[] = [];
    for (const [nome, valorBruto] of Object.entries(campos)) {
      const def = cat.campos.find((f) => f.isActive === 1 && norm(f.name) === norm(nome));
      if (!def || valorBruto == null) continue;
      const novo = comoGravado(String(valorBruto), def.tipo);
      const antes = valorAtual(cand.dados, def.name);
      if (norm(novo) === norm(antes)) continue;
      propostos[def.name] = novo;
      mudancas.push({ campo: def.name, antes, depois: novo });
    }
    if (mudancas.length) {
      propostas.push({ memoId: id, categoria: cand.categoria, resumo: cand.resumo, propostos, mudancas });
    }
  }

  if (!alvosIds.length) {
    const msg = "Não encontrei o registro desse pedido. Tente dizer mais detalhes (data, com quem, nome da lista).";
    return { resposta: resposta(msg), comando: { status: "nao_encontrado", mensagem: msg }, costUsd };
  }
  if (!propostas.length) {
    const usados = alvosIds.map((id) => porId.get(id)!);
    const msg = "Achei o registro, mas não entendi o que mudar nele. Tente dizer o valor novo.";
    return { resposta: resposta(msg, usados), comando: { status: "nao_encontrado", mensagem: msg }, costUsd };
  }

  const descreve = (p: ComandoAlteracaoCandidato) =>
    p.mudancas.map((m) => `${m.campo}: ${m.antes || "(vazio)"} → ${m.depois || "(vazio)"}`).join("; ");
  const usados = propostas.map((p) => porId.get(p.memoId)!);

  // Vários alvos, ou ação em lote: sempre o usuário escolhe ou confirma cada um
  if (propostas.length > 1 || lote) {
    const msg = lote
      ? `Este pedido altera ${propostas.length} registro(s). Confirme cada um.`
      : `Encontrei ${propostas.length} registros que podem ser o certo. Qual alterar?`;
    return {
      resposta: resposta(msg, usados),
      comando: { status: "escolher", mensagem: msg, candidatos: propostas },
      costUsd,
    };
  }

  const unica = propostas[0]!;
  const cat = catPorNome.get(unica.categoria)!;
  // Enquanto os comandos não forem validados com frases reais, todo comando pede confirmação,
  // mesmo com o marcador desligado (decisão de 17/11). Para liberar a gravação direta nas
  // categorias sem "Confirmar antes de alterar", trocar para true.
  const GRAVAR_DIRETO_LIBERADO = false;
  if (cat.confirmarAlteracao || !GRAVAR_DIRETO_LIBERADO) {
    const msg = `Confirme a alteração em ${unica.categoria} #${unica.memoId}: ${descreve(unica)}.`;
    return {
      resposta: resposta(msg, usados),
      comando: { status: "confirmar", mensagem: msg, memoId: unica.memoId, candidatos: [unica] },
      costUsd,
    };
  }

  let r;
  try {
    r = await alterarMemo({
      memoId: unica.memoId,
      userId: input.userId,
      isAdmin: input.isAdmin,
      campos: unica.propostos,
      origem: "comando",
    });
  } catch (e) {
    // Gravação recusada (permissão, categoria mudou): devolve a proposta para o usuário revisar no cartão
    console.warn("[comandoAlteracao] gravar:", e instanceof Error ? e.message : e);
    const msg = `Não consegui gravar direto em ${unica.categoria} #${unica.memoId}. Confira e salve: ${descreve(unica)}.`;
    return {
      resposta: resposta(msg, usados),
      comando: { status: "confirmar", mensagem: msg, memoId: unica.memoId, candidatos: [unica] },
      costUsd,
    };
  }
  const feitas = r.mudancas.length
    ? r.mudancas.map((m) => `${m.campo}: ${m.antes || "(vazio)"} → ${m.depois || "(vazio)"}`).join("; ")
    : "nada mudou";
  const msg = `Alterei ${unica.categoria} #${unica.memoId}: ${feitas}.`;
  return {
    resposta: resposta(msg, usados),
    comando: { status: "alterado", mensagem: msg, lote: r.lote, memoId: unica.memoId, candidatos: [unica] },
    costUsd,
  };
}
