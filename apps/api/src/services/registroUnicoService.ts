/**
 * Registro único (categories.registro_unico_por): ao registrar pelo Fale comigo, se já existe um memo da categoria
 * com os mesmos valores nos campos da chave (ex.: Antropometria: Dono + Data + Período), esse memo é ATUALIZADO
 * com os valores ditos agora (com Desfazer) em vez de nascer outro. Valor não dito agora não apaga o que já estava.
 * Chave incompleta (algum campo vazio mesmo depois dos padrões) = registro novo, como antes.
 * Padrões da chave: data não dita = hoje; dono não dito (categoria Pessoal) = quem registra; status = o primeiro valor.
 */
import type { ComandoAlteracao, ComandoCriacao, MemoContextCategory } from "@mymemory/shared";
import { lerValoresStatus, normalizarDataParaIso } from "@mymemory/shared";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";
import { alterarMemo, filtrarMemosAlteraveis } from "./memoAlteracaoService.js";
import { listarMembrosDoGrupo, nomeCurtoDoMembro, resolverMembro } from "./donoMemoService.js";

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

const chaveDe = (dados: Record<string, string>, campo: string) => Object.keys(dados).find((x) => norm(x) === norm(campo));
const valorCampo = (dados: Record<string, string>, campo: string) => {
  const k = chaveDe(dados, campo);
  return k != null ? dados[k] ?? "" : "";
};

const hojeIso = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

export async function atualizarRegistroUnico(input: {
  criacao: ComandoCriacao;
  categories: MemoContextCategory[];
  userId: number;
  isAdmin: boolean;
  groupId: number | null;
}): Promise<{ comando: ComandoAlteracao; mensagem: string; memoId: number; resumo: string } | null> {
  const cat = input.categories.find((c) => c.isActive === 1 && norm(c.name) === norm(input.criacao.categoria));
  const chaves = (cat?.registroUnicoPor ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!cat || !chaves.length) return null;
  const campos = (cat.campos ?? []).filter((f) => f.isActive === 1);
  const novos = lerDados(input.criacao.processado.dadosEspecificosJson);

  // Padrões da chave, também gravados no registro novo (se ele for criado)
  for (const nome of chaves) {
    const def = campos.find((f) => norm(f.name) === norm(nome));
    if (!def || valorCampo(novos, def.name).trim()) continue;
    let padrao = "";
    if (def.tipo === "date") padrao = hojeIso();
    else if (cat.campoDono && norm(cat.campoDono) === norm(def.name)) padrao = await nomeCurtoDoMembro(input.userId, input.groupId);
    else if (def.tipo === "status") padrao = lerValoresStatus(def.normalizedTerms)[0] ?? "";
    if (padrao) novos[chaveDe(novos, def.name) ?? def.name] = padrao;
  }
  input.criacao.processado.dadosEspecificosJson = JSON.stringify(novos);

  // Dono: compara pela pessoa ("Tereza" = "Tereza Clotilde Nogueira Ting"), não pelo texto
  const membros = input.groupId != null && cat.campoDono ? await listarMembrosDoGrupo(input.groupId) : [];
  const comparavel = (nome: string, v: string) => {
    const def = campos.find((f) => norm(f.name) === norm(nome));
    if (def?.tipo === "date") return normalizarDataParaIso(v) ?? norm(v);
    if (cat.campoDono && norm(cat.campoDono) === norm(nome) && membros.length) {
      const r = resolverMembro(v, membros);
      if ("userId" in r) return `membro:${r.userId}`;
    }
    return norm(v);
  };
  const alvo: Record<string, string> = {};
  for (const nome of chaves) {
    const v = valorCampo(novos, nome).trim();
    if (!v) return null; // chave incompleta: registro novo
    alvo[nome] = comparavel(nome, v);
  }

  const escopo = input.groupId != null ? `m.groupid = ?` : `m.groupid IS NULL AND m.userid = ?`;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT m.id, m.mediatext AS "texto", m.dadosespecificosjson AS "dados"
     FROM memos m
     WHERE m.isactive = 1 AND ${escopo} AND m.category = ?
     ORDER BY m.createdat DESC LIMIT 500`,
    [input.groupId ?? input.userId, cat.name]
  );
  const iguais = rows.filter((r) => {
    const d = lerDados(r.dados);
    return chaves.every((nome) => comparavel(nome, valorCampo(d, nome).trim()) === alvo[nome]);
  });
  if (!iguais.length) return null;
  const permitidas = new Set(await filtrarMemosAlteraveis(iguais.map((r) => Number(r.id)), input.userId, input.isAdmin));
  const existente = iguais.find((r) => permitidas.has(Number(r.id)));
  if (!existente) return null;

  // Só os campos ditos agora (não vazios), fora da chave e da situação; o que não foi dito fica como estava
  const atuais = lerDados(existente.dados);
  const propostos: Record<string, string> = {};
  const mudancas: { campo: string; antes: string; depois: string; texto: string }[] = [];
  for (const def of campos) {
    if (chaves.some((c) => norm(c) === norm(def.name))) continue;
    if (cat.campoSituacao && norm(cat.campoSituacao) === norm(def.name)) continue;
    const depois = valorCampo(novos, def.name).trim();
    if (!depois) continue;
    const antes = valorCampo(atuais, def.name);
    if (norm(antes) === norm(depois)) continue;
    propostos[def.name] = depois;
    mudancas.push({ campo: def.name, antes, depois, texto: `${def.name}: ${antes || "(vazio)"} → ${depois}` });
  }
  const id = Number(existente.id);
  const resumo = String(existente.texto ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const qual = chaves.map((c) => valorCampo(novos, c)).join(" · ");
  if (!mudancas.length) {
    const msg = `Já existe ${cat.name} #${id} (${qual}) com esses valores; nada mudou.`;
    return { comando: { status: "nao_encontrado", mensagem: msg }, mensagem: msg, memoId: id, resumo };
  }
  const candidato = { memoId: id, categoria: cat.name, resumo, propostos, mudancas };
  try {
    const r = await alterarMemo({ memoId: id, userId: input.userId, isAdmin: input.isAdmin, campos: propostos, origem: "comando" });
    const msg = `Atualizei ${cat.name} #${id} (${qual}): ${mudancas.map((m) => m.texto).join("; ")}.`;
    return { comando: { status: "alterado", mensagem: msg, lote: r.lote, memoId: id, candidatos: [candidato] }, mensagem: msg, memoId: id, resumo };
  } catch (e) {
    console.warn("[registroUnico] gravar:", e instanceof Error ? e.message : e);
    const msg = `Já existe ${cat.name} #${id} (${qual}). Confira e salve: ${mudancas.map((m) => m.texto).join("; ")}.`;
    return { comando: { status: "confirmar", mensagem: msg, memoId: id, candidatos: [candidato] }, mensagem: msg, memoId: id, resumo };
  }
}
