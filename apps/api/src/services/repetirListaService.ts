/**
 * "Repetir lista": prepara uma lista nova a partir de uma lista anterior (ex.: a última lista de
 * compras concluída). A anterior fica como está, com as marcas ✓/✗ e a data dela; a nova é a cópia
 * dela com a data de hoje: mesmos campos, mesmos itens sem as marcas (os cancelados ficam de fora)
 * e a situação aberta. Nada é gravado aqui: devolve o cartão de registro novo, que o usuário confere e salva.
 */
import type { ComandoCriacao, EstadoItemLista, MemoContextCategory } from "@mymemory/shared";
import { estadoDaSituacao, lerItensLista, lerValoresStatus, valorDaSituacao } from "@mymemory/shared";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Categorias com campo do tipo lista. */
function categoriasDeLista(categories: MemoContextCategory[]): MemoContextCategory[] {
  return categories.filter((c) => c.isActive === 1 && (c.campos ?? []).some((f) => f.isActive === 1 && f.tipo === "lista"));
}

/**
 * estados: quais itens da lista anterior entram ("com os itens concluídos e cancelados" → ✓ e ✗).
 * Ausente = todos menos os cancelados.
 */
export type PedidoRepetirLista = { memoId: number | null; categoria: MemoContextCategory | null; estados?: EstadoItemLista[] };

const NOME_ESTADO: Record<EstadoItemLista, [string, string]> = {
  pendente: ["não concluído", "não concluídos"],
  concluido: ["concluído", "concluídos"],
  cancelado: ["cancelado", "cancelados"],
};

/**
 * "Repete a última lista de compras", "repetir a lista #8446", "nova lista igual à anterior",
 * "copiar a lista do mercado". Null quando não é esse pedido.
 */
export function detectarRepetirLista(texto: string, categories: MemoContextCategory[]): PedidoRepetirLista | null {
  const t = semAcento(texto);
  if (!t || t.length > 140) return null;
  const pedido =
    /\b(repet\w*|refaz\w*|refazer|copi\w*|duplic\w*|reaproveit\w*|reus\w*)\b.*\blistas?\b/.test(t) ||
    /\bnova lista\b.*\b(igual|mesma|mesmos|como a|como na|da ultima|da anterior|a partir)\b/.test(t) ||
    /\b(mesma lista|lista igual)\b/.test(t) ||
    /\b(ger\w*|cri\w*|faz\w*|faca|mont\w*|abr\w*)\b.*\blistas?\b.*\b(ultima|anterior|passada)\b/.test(t);
  if (!pedido) return null;
  const listas = categoriasDeLista(categories);
  if (!listas.length) return null;
  const id = /#\s*(\d+)/.exec(t);
  const citada = listas.find((c) => t.includes(semAcento(c.name)));
  // Quais itens: "todos os itens" = todos; senão os estados citados (concluídos, cancelados, pendentes)
  let estados: EstadoItemLista[] | undefined;
  if (/\btodos (os )?(itens|itens da lista)\b|\bcom tudo\b|\binclusive (os )?cancelad/.test(t)) {
    estados = ["pendente", "concluido", "cancelado"];
  } else {
    const citados = new Set<EstadoItemLista>();
    if (/\b(concluid|comprad|feit|marcad|ticad)\w*/.test(t) || /\bo que (eu )?(comprei|conclui|fiz)\b/.test(t)) citados.add("concluido");
    if (/\bcancelad\w*|\briscad\w*/.test(t)) citados.add("cancelado");
    if (/\bpendent\w*|\bnao (comprad|concluid|feit)\w*|\bfalt(ou|aram|ando)\b|\bsem marca\b/.test(t)) citados.add("pendente");
    // "lista concluída" fala da lista, não dos itens: só conta quando a frase cita itens ou diz o que comprou
    const falaDeItens = /\bitens?\b|\bo que (eu )?(comprei|conclui|fiz)\b|\b(so|somente|apenas) (os )?(concluid|comprad|cancelad|pendent)/.test(t);
    if (citados.size && falaDeItens) estados = [...citados];
  }
  return {
    memoId: id ? Number(id[1]) : null,
    categoria: citada ?? (listas.length === 1 ? listas[0]! : null),
    ...(estados ? { estados } : {}),
  };
}

function lerDados(json: unknown): Record<string, string> {
  try {
    const o = typeof json === "string" ? JSON.parse(json) : json;
    if (!o || typeof o !== "object") return {};
    return Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, v]) => [k, v == null ? "" : String(v)]));
  } catch {
    return {};
  }
}

/** Hoje (horário de Brasília) em AAAA-MM-DD. */
const hojeIso = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

const dataBr = (d: unknown) => {
  const x = new Date(String(d));
  return Number.isNaN(x.getTime()) ? "" : x.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
};

export async function prepararRepeticaoLista(input: {
  userId: number;
  groupId: number | null;
  categories: MemoContextCategory[];
  pedido: PedidoRepetirLista;
}): Promise<{ criacao: ComandoCriacao } | { erro: string }> {
  const listas = categoriasDeLista(input.categories);
  const escopo = input.groupId != null ? `m.groupid = ?` : `m.groupid IS NULL AND m.userid = ?`;
  const escopoVal = input.groupId != null ? input.groupId : input.userId;

  let rows: RowDataPacket[];
  if (input.pedido.memoId != null) {
    [rows] = await pool.query<RowDataPacket[]>(
      `SELECT m.id, m.mediatext, m.keywords, m.category, m.dadosespecificosjson, m.createdat
       FROM memos m WHERE m.id = ? AND m.isactive = 1 AND ${escopo} LIMIT 1`,
      [input.pedido.memoId, escopoVal]
    );
  } else {
    const nomes = (input.pedido.categoria ? [input.pedido.categoria] : listas).map((c) => c.name);
    if (!nomes.length) return { erro: "Não há categoria com lista neste grupo." };
    [rows] = await pool.query<RowDataPacket[]>(
      `SELECT m.id, m.mediatext, m.keywords, m.category, m.dadosespecificosjson, m.createdat
       FROM memos m WHERE m.isactive = 1 AND ${escopo} AND m.category IN (${nomes.map(() => "?").join(",")})
       ORDER BY m.createdat DESC LIMIT 30`,
      [escopoVal, ...nomes]
    );
  }
  if (!rows.length) {
    return {
      erro: input.pedido.memoId != null
        ? `Não achei a lista #${input.pedido.memoId} neste grupo.`
        : `Não achei nenhuma lista${input.pedido.categoria ? ` em ${input.pedido.categoria.name}` : ""} para repetir.`,
    };
  }

  // Sem número: a última lista CONCLUÍDA (a que já foi usada); se nenhuma foi concluída, a mais recente
  const catDe = (nome: unknown) => listas.find((c) => semAcento(c.name) === semAcento(String(nome ?? "")));
  const concluida = (r: RowDataPacket) => {
    const cat = catDe(r.category);
    if (!cat?.campoSituacao) return false;
    const d = lerDados(r.dadosespecificosjson);
    const k = Object.keys(d).find((x) => semAcento(x) === semAcento(cat.campoSituacao!));
    return k != null && estadoDaSituacao(d[k]) === "concluido";
  };
  const origem = input.pedido.memoId != null ? rows[0]! : rows.find(concluida) ?? rows[0]!;
  const cat = catDe(origem.category);
  if (!cat) return { erro: `O memo #${origem.id} não é de uma categoria com lista.` };

  const campoSituacao = cat.atualizavel && cat.campoSituacao ? cat.campoSituacao : null;
  const ativos = (cat.campos ?? []).filter((f) => f.isActive === 1);
  const antigos = lerDados(origem.dadosespecificosjson);
  const dados: Record<string, string> = {};
  let itensNovos = 0;
  // Sem escolha: todos menos os cancelados
  const entram = new Set<EstadoItemLista>(input.pedido.estados ?? ["pendente", "concluido"]);
  const fora: Record<EstadoItemLista, number> = { pendente: 0, concluido: 0, cancelado: 0 };
  for (const f of ativos) {
    if (campoSituacao && semAcento(f.name) === semAcento(campoSituacao)) continue; // o cartão põe a situação aberta
    const k = Object.keys(antigos).find((x) => semAcento(x) === semAcento(f.name));
    const v = k != null ? antigos[k] ?? "" : "";
    if (f.tipo === "lista") {
      const itens = lerItensLista(v);
      for (const it of itens) if (!entram.has(it.estado)) fora[it.estado]++;
      const novos = itens.filter((it) => entram.has(it.estado)).map((it) => it.texto);
      itensNovos += novos.length;
      dados[f.name] = novos.join("\n");
    } else if (f.tipo === "date") {
      dados[f.name] = hojeIso(); // a lista nova é a cópia da anterior com a data de hoje
    } else {
      dados[f.name] = v;
    }
  }

  const quando = dataBr(origem.createdat);
  const campos = ativos
    .filter((f) => !campoSituacao || semAcento(f.name) !== semAcento(campoSituacao))
    .map((f) => ({
      nome: f.name,
      tipo: f.tipo,
      descricao: f.description ?? null,
      ...(f.tipo === "status" ? { valores: lerValoresStatus(f.normalizedTerms) } : {}),
    }));
  const resumo = String(origem.mediatext ?? "").trim() || `${cat.name} (repetida da lista #${origem.id})`;
  return {
    criacao: {
      mensagem:
        `Preparei uma lista nova a partir da lista #${origem.id}${quando ? ` de ${quando}` : ""}: ` +
        `cópia com a data de hoje, ${itensNovos === 1 ? "1 item" : `${itensNovos} itens`}` +
        `${input.pedido.estados && input.pedido.estados.length < 3
          ? `, só os ${input.pedido.estados.map((e) => NOME_ESTADO[e][1]).join(" e ")}`
          : ""}` +
        `${(() => {
          const partes = (Object.keys(fora) as EstadoItemLista[])
            .filter((e) => fora[e] > 0)
            .map((e) => `${fora[e]} ${NOME_ESTADO[e][fora[e] === 1 ? 0 : 1]}`);
          return partes.length ? ` (${partes.join(" e ")} de fora)` : "";
        })()}. ` +
        `A lista anterior continua como está. Confira no cartão e toque em Salvar registro.`,
      groupId: input.groupId,
      categoria: cat.name,
      campos,
      campoSituacao,
      situacaoAberta: valorDaSituacao("aberto", cat.situacaoTipo),
      processado: {
        originalText: `Lista repetida da lista #${origem.id}${quando ? ` de ${quando}` : ""}.`,
        suggestedMediaText: resumo,
        suggestedKeywords: String(origem.keywords ?? ""),
        maxSummaryChars: Math.max(resumo.length, 500),
        apiCost: 0,
        iaLevel: "semIA",
        dadosEspecificosJson: JSON.stringify(dados),
        dadosEspecificosOriginaisJson: null,
        matchedCategoryId: cat.id,
        category: cat.name,
      },
    },
  };
}
