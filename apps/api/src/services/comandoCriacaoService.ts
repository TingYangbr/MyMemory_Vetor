/**
 * Pedido de criação no Perguntar ("criar reunião interna Softing dia 10/12 às 10h").
 *
 * Não grava nada: passa o texto pelo mesmo processamento do Catalogar (processTextMemoForReview),
 * com a categoria indicada pela classificação, e devolve a proposta. O cartão de memo novo, na tela
 * do Perguntar, mostra os campos e grava pelo mesmo caminho do Catalogar (POST /api/memos/text/confirm).
 * Da voz, guarda-se só o texto (a transcrição já chega aqui como texto).
 */
import type { ComandoCriacao, MemoContextCategory, PerguntaClassificacao } from "@mymemory/shared";
import { lerValoresStatus, valorDaSituacao } from "@mymemory/shared";
import { getUserIaUseTexto, processTextMemoForReview } from "./textMemoProcessService.js";

const norm = (s: string) => s.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().trim();

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
  const campos = (cat?.campos ?? [])
    .filter((f) => f.isActive === 1 && (!campoSituacao || norm(f.name) !== norm(campoSituacao)))
    .map((f) => ({
      nome: f.name,
      tipo: f.tipo,
      descricao: f.description ?? null,
      ...(f.tipo === "status" ? { valores: lerValoresStatus(f.normalizedTerms) } : {}),
    }));

  return {
    mensagem: cat
      ? `Preparei um registro novo em ${cat.name}: confira no cartão e toque em Salvar registro.`
      : "Preparei um registro novo: confira no cartão e toque em Salvar registro.",
    groupId: input.groupId,
    categoria: cat?.name ?? processado.category ?? null,
    campos,
    campoSituacao,
    situacaoAberta: valorDaSituacao("aberto", cat?.situacaoTipo),
    processado,
  };
}
