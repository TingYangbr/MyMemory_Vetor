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

/** O item da linha corresponde ao nome dito? (sem acento, sem maiúsculas, plural simples) */
function linhaCasa(linha: string, termo: string): boolean {
  const t = norm(termo);
  if (!t) return false;
  const l = norm(linha);
  return l.includes(t) || (t.endsWith("s") && t.length > 3 && l.includes(t.slice(0, -1)));
}

/**
 * Aplica as operações de um comando sobre um campo do tipo lista (um item por linha):
 * remover tira as linhas do item; trocar substitui a linha do item (ou acrescenta, se não houver);
 * acrescentar põe no fim, sem repetir uma linha igual. Os outros itens ficam como estão.
 */
export function aplicarOperacoesLista(atual: string, ops: Record<string, unknown>): string {
  const lista = (x: unknown): unknown[] => (Array.isArray(x) ? x : x == null ? [] : [x]);
  let linhas = atual
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const r of lista(ops.remover)) {
    const termo = String(r ?? "");
    linhas = linhas.filter((l) => !linhaCasa(l, termo));
  }
  for (const tr of lista(ops.trocar)) {
    if (!tr || typeof tr !== "object") continue;
    const de = String((tr as Record<string, unknown>).de ?? "");
    const para = String((tr as Record<string, unknown>).para ?? "").trim();
    if (!de || !para) continue;
    const i = linhas.findIndex((l) => linhaCasa(l, de));
    if (i >= 0) linhas[i] = para;
    else linhas.push(para);
  }
  for (const a of lista(ops.acrescentar)) {
    const item = String(a ?? "").trim();
    if (item && !linhas.some((l) => norm(l) === norm(item))) linhas.push(item);
  }
  return linhas.join("\n");
}

/**
 * A mudança dita para a pessoa. Em campo do tipo lista não repete a lista inteira (antes → depois
 * ficava parecendo itens repetidos): diz só o que entrou e o que saiu.
 */
function textoMudanca(campo: string, antes: string, depois: string, tipo: string): string {
  if (tipo !== "lista") return `${campo}: ${antes || "(vazio)"} → ${depois || "(vazio)"}`;
  const linhas = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const a = linhas(antes);
  const d = linhas(depois);
  const entrou = d.filter((x) => !a.some((y) => norm(y) === norm(x)));
  const saiu = a.filter((x) => !d.some((y) => norm(y) === norm(x)));
  const partes = [
    ...(entrou.length ? [`entra ${entrou.join(", ")}`] : []),
    ...(saiu.length ? [`sai ${saiu.join(", ")}`] : []),
  ];
  return `${campo}: ${partes.join("; ") || "ordem dos itens"}`;
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
  '- Campos do tipo lista: NÃO devolva a lista inteira. Devolva um objeto só com as operações pedidas: {"acrescentar":["item com quantidade"],"remover":["nome do item"],"trocar":[{"de":"nome do item","para":"item novo com quantidade"}]}. Em "remover" e em "de", use só o nome do item (ex.: "banana"). Para mudar a quantidade de um item que já existe, use "trocar". Inclua só as chaves necessárias.',
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
    const msg = "Não encontrei um registro ativo que você possa alterar para esse pedido. Se é um registro novo (por exemplo, a primeira lista), crie pelo Catalogar.";
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
    const mudancas: { campo: string; antes: string; depois: string; texto: string }[] = [];
    for (const [nome, valorBruto] of Object.entries(campos)) {
      const def = cat.campos.find((f) => f.isActive === 1 && norm(f.name) === norm(nome));
      if (!def || valorBruto == null) continue;
      const antes = valorAtual(cand.dados, def.name);
      // Lista: a IA devolve operações (acrescentar, remover, trocar), aplicadas aqui por regra,
      // para os itens que o comando não menciona nunca serem perdidos ou duplicados
      const novo =
        def.tipo === "lista" && typeof valorBruto === "object" && !Array.isArray(valorBruto)
          ? aplicarOperacoesLista(antes, valorBruto as Record<string, unknown>)
          : comoGravado(String(valorBruto), def.tipo);
      if (norm(novo) === norm(antes)) continue;
      propostos[def.name] = novo;
      mudancas.push({ campo: def.name, antes, depois: novo, texto: textoMudanca(def.name, antes, novo, def.tipo) });
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
    p.mudancas.map((m) => m.texto ?? `${m.campo}: ${m.antes || "(vazio)"} → ${m.depois || "(vazio)"}`).join("; ");
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
  const feitas = r.mudancas.length ? descreve(unica) : "nada mudou";
  const msg = `Alterei ${unica.categoria} #${unica.memoId}: ${feitas}.`;
  return {
    resposta: resposta(msg, usados),
    comando: { status: "alterado", mensagem: msg, lote: r.lote, memoId: unica.memoId, candidatos: [unica] },
    costUsd,
  };
}
