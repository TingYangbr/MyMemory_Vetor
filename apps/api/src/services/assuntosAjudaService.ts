/**
 * Perguntas sobre os próprios assuntos (categorias), respondidas por regra, antes da classificação:
 *  - "Quais assuntos posso usar?" / "que categorias existem?" → lista das categorias com uma linha cada;
 *  - "Como uso o assunto Agenda?" / "para que serve a Agenda?" → para que serve, o que guardar,
 *    situação e exemplos de uso.
 * "Assunto", "tema" e "tipo de registro" valem como sinônimos de categoria.
 * Os exemplos vêm do modelo do catálogo de onde a categoria foi copiada; sem modelo, a IA gera
 * uma vez por versão da categoria (cache em memória).
 */
import type { MemoContextCategory, MemoContextCampo } from "@mymemory/shared";
import { lerValoresStatus, rotulosSituacao } from "@mymemory/shared";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";
import { invokeLLM } from "../lib/invokeLlm.js";
import { MARCA_CONHECIMENTO_LIKE } from "../lib/openaiEmbedding.js";

/** Minúsculas, sem acento, sem pontuação, espaços simples. */
export function normalizarTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_]/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NOME_ASSUNTO = "(?:categorias?|assuntos?|temas?|tipos? de registros?)";

/** "Quais assuntos posso usar?" e variações. Estrito de propósito: "quais categorias de despesa tive" NÃO entra. */
const PADROES_LISTA: RegExp[] = [
  new RegExp(
    `^(?:quais|que|qual|quantos|quantas)(?: sao)?(?: os| as)? ${NOME_ASSUNTO}(?: (?:eu|que|que eu|nos|a gente))?(?: (?:posso|podemos|consigo|devo|vou|da para|da pra|tem como))?(?: (?:usar|utilizar|registrar|escolher|perguntar|usar aqui))?(?: (?:existem|existe|tenho|temos|tem|ha|estao disponiveis|disponiveis|estao|uso|usamos|cadastrados|cadastradas|configurados|configuradas))?(?: (?:aqui|no grupo|neste grupo|nesse grupo|no sistema|no mymemory|no promemory))?$`
  ),
  new RegExp(`^(?:lista|listar|liste|mostra|mostrar|mostre|ver|me mostra|me mostre|me diga|me fala)(?: (?:os|as|meus|minhas|todos os|todas as))? ${NOME_ASSUNTO}(?: (?:disponiveis|que posso usar|que existem|do grupo|deste grupo))?$`),
  new RegExp(`^${NOME_ASSUNTO}(?: disponiveis)?$`),
  /^o que (?:eu )?(?:posso|consigo|da para|da pra) (?:registrar|guardar|anotar|perguntar)(?: aqui| no sistema)?$/,
];

const INICIO_COMO_USAR =
  "(?:como (?:eu )?(?:uso|usar|utilizo|utilizar|funciona|registro|registrar|pergunto|perguntar|preencho|preencher)|para que serve|pra que serve|para que server|o que (?:e|significa)|me explica|explica|explique|ajuda com|ajuda)";

export type PerguntaSobreAssuntos = { tipo: "lista" } | { tipo: "como_usar"; categoria: MemoContextCategory };

/** Reconhece pergunta sobre os assuntos. Retorna null quando é uma pergunta normal. */
export function detectarPerguntaSobreAssuntos(
  pergunta: string,
  categories: MemoContextCategory[]
): PerguntaSobreAssuntos | null {
  const t = normalizarTexto(pergunta);
  if (!t || t.length > 120) return null;
  if (PADROES_LISTA.some((re) => re.test(t))) return { tipo: "lista" };

  // "Como uso o assunto Agenda?" — a pergunta inteira tem de ser início + (artigo) + (assunto) + nome
  const m = new RegExp(
    `^${INICIO_COMO_USAR}(?: (?:o|a|os|as|um|uma|do|da|de|no|na))?(?: ${NOME_ASSUNTO})?(?: (?:o|a|do|da|de|chamado|chamada))?(?: (?:o|a))? (.+)$`
  ).exec(t);
  if (!m) return null;
  const alvo = m[1].trim();
  // "o que é" sem dizer "assunto/categoria" é pergunta comum ("o que é o dentista?") — só aceita com o nome exato
  const ativas = categories.filter((c) => c.isActive === 1);
  const cat = ativas.find((c) => normalizarTexto(c.name) === alvo)
    ?? ativas.find((c) => normalizarTexto(c.name).replace(/s$/, "") === alvo.replace(/s$/, ""));
  return cat ? { tipo: "como_usar", categoria: cat } : null;
}

/** Primeira frase (ou até ~160 caracteres) de um texto. */
function primeiraFrase(s: string | null | undefined, max = 160): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const ponto = t.search(/[.!?](\s|$)/);
  const frase = ponto > 0 ? t.slice(0, ponto + 1) : t;
  return frase.length > max ? `${frase.slice(0, max - 1).trimEnd()}…` : frase;
}

export function respostaListaAssuntos(categories: MemoContextCategory[]): string {
  const ativas = categories.filter((c) => c.isActive === 1).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  if (!ativas.length) {
    return "Ainda não há assuntos (categorias) neste grupo. O dono do grupo pode criar um ou habilitar um modelo pronto em Categorias → Modelos prontos.";
  }
  const linhas = ativas.map((c) => {
    const d = primeiraFrase(c.description);
    return d ? `• ${c.name}: ${d}` : `• ${c.name}`;
  });
  return [
    `Você pode usar ${ativas.length === 1 ? "este assunto (categoria)" : `estes ${ativas.length} assuntos (categorias)`}:`,
    "",
    ...linhas,
    "",
    `Para saber como usar um deles, pergunte: "Como uso o assunto ${ativas[0].name}?"`,
  ].join("\n");
}

type Exemplos = { registrar: string[]; perguntar: string[]; alterar: string[] };

const cacheExemplos = new Map<string, Exemplos>();

/** Exemplos do modelo do catálogo de onde a categoria veio (ou dela mesma, se for um modelo). */
async function exemplosDoModelo(categoryId: number): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(trim(o.modelo_exemplos), ''), NULLIF(trim(c.modelo_exemplos), '')) AS "ex"
     FROM categories c LEFT JOIN categories o ON o.id = c.origem_categoria_id
     WHERE c.id = ? LIMIT 1`,
    [categoryId]
  );
  return String(rows[0]?.ex ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
}

function camposVisiveis(cat: MemoContextCategory): MemoContextCampo[] {
  const sit = (cat.campoSituacao ?? "").toLowerCase();
  return (cat.campos ?? []).filter((f) => f.isActive === 1 && f.name.toLowerCase() !== sit);
}

/** A IA gera exemplos curtos a partir da configuração; uma vez por versão da categoria. */
async function exemplosGerados(cat: MemoContextCategory): Promise<{ ex: Exemplos; costUsd: number }> {
  const chave = `${cat.id}:${cat.updatedAt}`;
  const guardado = cacheExemplos.get(chave);
  if (guardado) return { ex: guardado, costUsd: 0 };
  const config = {
    nome: cat.name,
    descricao: cat.description,
    campos: camposVisiveis(cat).map((f) => ({ nome: f.name, tipo: f.tipo, descricao: f.description })),
    atualizavel: Boolean(cat.atualizavel),
  };
  const system =
    "Você escreve exemplos curtos e realistas, em português do Brasil, de frases que um usuário comum diria a um assistente de anotações para usar uma categoria. Linguagem do dia a dia, sem citar nomes de campos técnicos. Responda só JSON.";
  const user = `Categoria:\n${JSON.stringify(config, null, 2)}\n\nRetorne {"registrar":["2 frases que criam um registro novo"],"perguntar":["2 perguntas sobre os registros"],"alterar":${
    cat.atualizavel ? '["2 comandos que alteram, concluem ou cancelam um registro"]' : "[]"
  }}`;
  try {
    const { text, costUsd } = await invokeLLM({ system, user, jsonObject: true, temperature: 0.3, source: "assuntos_exemplos" });
    const j = JSON.parse(text) as Partial<Record<keyof Exemplos, unknown>>;
    const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 3) : []);
    const ex: Exemplos = { registrar: arr(j.registrar), perguntar: arr(j.perguntar), alterar: cat.atualizavel ? arr(j.alterar) : [] };
    cacheExemplos.set(chave, ex);
    return { ex, costUsd };
  } catch {
    return { ex: { registrar: [], perguntar: [], alterar: [] }, costUsd: 0 };
  }
}

/** O grupo tem conhecimento importado (manuais em trechos)? */
export async function grupoTemConhecimento(groupId: number | null): Promise<boolean> {
  if (groupId == null) return false;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 AS ok FROM memos WHERE groupid = ? AND isactive = 1 AND mediametadata LIKE ? LIMIT 1`,
    [groupId, MARCA_CONHECIMENTO_LIKE]
  );
  return rows.length > 0;
}

/** Configuração da categoria em texto (sem exemplos, sem IA): vai junto com os trechos do manual. */
export function descricaoConfiguracao(cat: MemoContextCategory): string {
  return linhasConfiguracao(cat).join("\n");
}

function linhasConfiguracao(cat: MemoContextCategory): string[] {
  const partes: string[] = [`Assunto ${cat.name}`];
  const desc = String(cat.description ?? "").replace(/\s+/g, " ").trim();
  partes.push("", `Para que serve: ${desc || "(sem descrição — o dono do grupo pode escrever uma em Categorias)."}`);

  const campos = camposVisiveis(cat);
  if (campos.length) {
    partes.push("", "O que guardar:");
    for (const f of campos) {
      const valores = f.tipo === "status" ? lerValoresStatus(f.normalizedTerms) : [];
      const d = valores.length ? `um destes: ${valores.join(", ")}` : primeiraFrase(f.description, 120);
      partes.push(d ? `• ${f.name}: ${d}` : `• ${f.name}`);
    }
  }

  if (cat.atualizavel) {
    const rot = rotulosSituacao(cat.situacaoTipo, cat.rotuloConcluido);
    const estados = rot.opcoes.map((e) => rot[e]).join(", ");
    partes.push(
      "",
      `Situação: cada registro começa ${rot.aberto} e pode passar a ${rot.opcoes.filter((e) => e !== "aberto").map((e) => rot[e]).join(" ou ")} (${estados}). É só dizer, por exemplo, que concluiu, cancelou ou mudou algo.`
    );
  }
  return partes;
}

export async function respostaComoUsar(cat: MemoContextCategory): Promise<{ texto: string; costUsd: number }> {
  const partes = linhasConfiguracao(cat);
  let costUsd = 0;
  const doModelo = await exemplosDoModelo(cat.id);
  if (doModelo.length) {
    partes.push("", "Exemplos:", ...doModelo.slice(0, 8).map((l) => `• ${l}`));
  } else {
    const r = await exemplosGerados(cat);
    costUsd = r.costUsd;
    const { registrar, perguntar, alterar } = r.ex;
    if (registrar.length || perguntar.length || alterar.length) {
      partes.push("", "Exemplos:");
      for (const l of registrar) partes.push(`• Registrar: "${l}"`);
      for (const l of perguntar) partes.push(`• Perguntar: "${l}"`);
      for (const l of alterar) partes.push(`• Alterar: "${l}"`);
    }
  }
  return { texto: partes.join("\n"), costUsd };
}
