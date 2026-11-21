/**
 * Lista aberta única (categories.lista_aberta_por): ao registrar itens numa categoria de lista, se já existe
 * uma lista ABERTA (nem concluída nem cancelada) com o mesmo valor do campo-chave (ex.: Tipo = Mercado), os
 * itens entram nela direto (com Desfazer), em vez de nascer outra lista. Campo-chave não dito = o primeiro
 * valor padronizado do campo (ex.: Mercado); sem lista aberta, o registro novo já sai com esse valor.
 * Sem data na chave: a lista continua a mesma até ser concluída ou cancelada.
 */
import type { ComandoAlteracao, ComandoCriacao, MemoContextCategory } from "@mymemory/shared";
import { estadoDaSituacao, lerItensLista } from "@mymemory/shared";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";
import { aplicarOperacoesLista, textoMudanca } from "./comandoAlteracaoService.js";
import { alterarMemo, filtrarMemosAlteraveis } from "./memoAlteracaoService.js";

const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

function lerDados(json: unknown): Record<string, string> {
  try {
    const o = typeof json === "string" ? JSON.parse(json) : json;
    if (!o || typeof o !== "object") return {};
    return Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, v]) => [k, v == null ? "" : String(v)]));
  } catch {
    return {};
  }
}

const valorCampo = (dados: Record<string, string>, campo: string) => {
  const k = Object.keys(dados).find((x) => norm(x) === norm(campo));
  return k != null ? dados[k] ?? "" : "";
};

/**
 * Se o registro novo deve entrar numa lista aberta, devolve o comando de alteração (para confirmar) e a
 * mensagem; senão null (segue o registro novo de sempre).
 */
export async function juntarEmListaAberta(input: {
  criacao: ComandoCriacao;
  categories: MemoContextCategory[];
  userId: number;
  isAdmin: boolean;
  groupId: number | null;
}): Promise<{ comando: ComandoAlteracao; mensagem: string; memoId: number; resumo: string } | null> {
  const cat = input.categories.find((c) => c.isActive === 1 && norm(c.name) === norm(input.criacao.categoria));
  const chave = cat?.listaAbertaPor?.trim();
  if (!cat || !chave || !cat.campoSituacao) return null;
  const camposLista = (cat.campos ?? []).filter((f) => f.isActive === 1 && f.tipo === "lista");
  if (!camposLista.length) return null;

  const novos = lerDados(input.criacao.processado.dadosEspecificosJson);
  const itensNovos: Record<string, string[]> = {};
  for (const f of camposLista) {
    const itens = lerItensLista(valorCampo(novos, f.name)).map((it) => it.texto).filter(Boolean);
    if (itens.length) itensNovos[f.name] = itens;
  }
  if (!Object.keys(itensNovos).length) return null; // sem itens: é outro tipo de registro, segue normal

  // Campo-chave não dito ("comprar leite") = o primeiro valor padronizado do campo (ex.: Mercado);
  // o registro novo (se não houver lista aberta) também sai com ele
  if (chave !== "*" && !valorCampo(novos, chave).trim()) {
    const def = (cat.campos ?? []).find((f) => f.isActive === 1 && norm(f.name) === norm(chave));
    const padrao = String(def?.normalizedTerms ?? "")
      .split(/[,\n]/)
      .map((t) => t.split(":")[0]!.trim())
      .find(Boolean);
    if (padrao) {
      const k = Object.keys(novos).find((x) => norm(x) === norm(chave)) ?? def?.name ?? chave;
      novos[k] = padrao;
      input.criacao.processado.dadosEspecificosJson = JSON.stringify(novos);
    }
  }
  const valorChave = chave === "*" ? "" : norm(valorCampo(novos, chave));
  const escopo = input.groupId != null ? `m.groupid = ?` : `m.groupid IS NULL AND m.userid = ?`;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT m.id, m.mediatext AS "texto", m.dadosespecificosjson AS "dados"
     FROM memos m
     WHERE m.isactive = 1 AND ${escopo} AND m.category = ?
     ORDER BY m.createdat DESC LIMIT 50`,
    [input.groupId ?? input.userId, cat.name]
  );
  const abertas = rows.filter((r) => {
    const d = lerDados(r.dados);
    if (estadoDaSituacao(valorCampo(d, cat.campoSituacao!)) !== "aberto") return false;
    // Chave vazia no registro novo casa com lista de chave vazia; "uma só" ('*') casa com qualquer aberta
    return chave === "*" || norm(valorCampo(d, chave)) === valorChave;
  });
  if (!abertas.length) return null;
  const permitidas = new Set(await filtrarMemosAlteraveis(abertas.map((r) => Number(r.id)), input.userId, input.isAdmin));
  const alvo = abertas.find((r) => permitidas.has(Number(r.id)));
  if (!alvo) return null;

  const atuais = lerDados(alvo.dados);
  const propostos: Record<string, string> = {};
  const mudancas: { campo: string; antes: string; depois: string; texto: string }[] = [];
  for (const [campo, itens] of Object.entries(itensNovos)) {
    const antes = valorCampo(atuais, campo);
    const depois = aplicarOperacoesLista(antes, { acrescentar: itens });
    if (norm(depois) === norm(antes)) continue;
    propostos[campo] = depois;
    mudancas.push({ campo, antes, depois, texto: textoMudanca(campo, antes, depois, "lista") });
  }
  const id = Number(alvo.id);
  const resumo = String(alvo.texto ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const qual = chave === "*" ? "aberta" : `aberta de ${valorCampo(atuais, chave) || valorCampo(novos, chave) || "—"}`;
  if (!mudancas.length) {
    const msg = `Esses itens já estão na lista ${qual} (${cat.name} #${id}).`;
    return { comando: { status: "nao_encontrado", mensagem: msg }, mensagem: msg, memoId: id, resumo };
  }
  // Grava direto na lista aberta (a alteração fica no histórico, com Desfazer)
  let r;
  try {
    r = await alterarMemo({ memoId: id, userId: input.userId, isAdmin: input.isAdmin, campos: propostos, origem: "comando" });
  } catch (e) {
    // Gravação recusada: devolve a proposta para a pessoa confirmar no cartão
    console.warn("[listaAberta] gravar:", e instanceof Error ? e.message : e);
    const msgConf = `Não consegui gravar direto na lista ${qual} (${cat.name} #${id}). Confira e salve: ${mudancas.map((m) => m.texto).join("; ")}.`;
    return {
      comando: { status: "confirmar", mensagem: msgConf, memoId: id, candidatos: [{ memoId: id, categoria: cat.name, resumo, propostos, mudancas }] },
      mensagem: msgConf,
      memoId: id,
      resumo,
    };
  }
  const msg = `Acrescentei na lista ${qual} (${cat.name} #${id}): ${mudancas.map((m) => m.texto).join("; ")}.`;
  return {
    comando: {
      status: "alterado",
      mensagem: msg,
      lote: r.lote,
      memoId: id,
      candidatos: [{ memoId: id, categoria: cat.name, resumo, propostos, mudancas }],
    },
    mensagem: msg,
    memoId: id,
    resumo,
  };
}
