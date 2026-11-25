/**
 * Conflito de horário em categorias de compromisso (Agenda): categoria com um campo de data e um de hora
 * (nome começando por "hor"). Dois registros ativos conflitam quando caem no mesmo dia e os intervalos se cruzam:
 * início = hora; fim = hora + duração (campo cujo nome começa por "dura": "2 horas", "1h30", "90 min";
 * vazia ou ilegível = padrão pelo tipo: ligação 15 min, o resto 1 hora). Mesmo horário de início sempre conflita
 * (4 ligações às 8h não cabem). Na categoria Pessoal (com campo dono), só compara compromissos do mesmo dono.
 */
import { normalizarDataParaIso } from "@mymemory/shared";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";

const norm = (s: string) => s.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().trim();

/** Duração padrão quando o registro não diz (minutos): ligação é curta; reunião, visita etc., 1 hora. */
export function duracaoPadrao(texto: string): number {
  const t = norm(texto ?? "");
  return /\b(liga(r|cao|coes)|ligue|telefon\w*|whats\w*|zap|call|retornar)\b/.test(t) ? 15 : 60;
}

/** "16h", "16:00", "9:5", "16 hrs" → minutos do dia; outra coisa → null. */
export function horaEmMinutos(v: string): number | null {
  const m = /^\s*(?:[àa]s?\s+)?(\d{1,2})\s*(?:[:h]\s*(\d{1,2})?)?\s*(?:hs?|hrs?|horas?)?\s*$/i.exec(v ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  return h <= 23 && mi <= 59 ? h * 60 + mi : null;
}

/** "2 horas", "2h", "1h30", "1:30", "90 min", "meia hora" → minutos; vazio/ilegível → null. */
export function duracaoEmMinutos(v: string): number | null {
  const t = norm(v ?? "");
  if (!t) return null;
  if (/meia\s*hora/.test(t)) return 30;
  if (/^uma\s*hora$/.test(t)) return 60;
  const hm = /^(\d{1,2})\s*(?:hs?|:|horas?|hrs?)\s*(\d{1,2})?\s*(?:min(?:utos?)?|m)?$/.exec(t);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2] ?? 0);
  const min = /^(\d{1,4})\s*(?:min(?:utos?)?|m)$/.exec(t);
  if (min) return Number(min[1]);
  const dec = /^(\d+(?:[.,]\d+)?)\s*(?:hs?|horas?|hrs?)?$/.exec(t);
  if (dec) return Math.round(Number(dec[1].replace(",", ".")) * 60);
  return null;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export interface CamposCompromisso {
  data: string;
  hora: string;
  duracao: string | null;
  dono: string | null;
  situacao: string | null;
}

/** Nomes dos campos de compromisso da categoria (null se a categoria não é de compromisso). */
export async function camposDeCompromisso(categoria: string, groupId: number | null): Promise<CamposCompromisso | null> {
  const [cats] = await pool.query<RowDataPacket[]>(
    `SELECT id, campo_situacao AS "situacao", campo_dono AS "dono" FROM categories
     WHERE name = ? AND isactive = 1 AND (groupid = ? OR groupid IS NULL)
     ORDER BY (groupid IS NULL) ASC LIMIT 1`,
    [categoria, groupId]
  );
  const cat = cats[0];
  if (!cat) return null;
  const [campos] = await pool.query<RowDataPacket[]>(
    `SELECT name, tipo FROM categorycampos WHERE categoryid = ? AND isactive = 1 ORDER BY id`,
    [cat.id]
  );
  const data = campos.find((c) => c.tipo === "date");
  const hora = campos.find((c) => c.tipo !== "date" && /^hor/.test(norm(String(c.name))));
  if (!data || !hora) return null;
  const dur = campos.find((c) => /^dura/.test(norm(String(c.name))));
  return {
    data: String(data.name),
    hora: String(hora.name),
    duracao: dur ? String(dur.name) : null,
    dono: (cat.dono as string | null) ?? null,
    situacao: (cat.situacao as string | null) ?? null,
  };
}

const valor = (dados: Record<string, unknown>, campo: string | null): string => {
  if (!campo) return "";
  const k = Object.keys(dados).find((x) => norm(x) === norm(campo));
  return k != null && dados[k] != null ? String(dados[k]) : "";
};

export interface ConflitoCompromisso {
  id: number;
  resumo: string;
  inicio: string;
  fim: string;
}

/**
 * Compromissos ativos da categoria que cruzam com o horário dado (mesmo escopo: grupo, ou memos pessoais do usuário).
 * `dados` = os campos do registro novo ou do registro já alterado. Sem data ou hora legível, não há conflito.
 */
export async function conflitosDeCompromisso(input: {
  categoria: string;
  groupId: number | null;
  userId: number;
  dados: Record<string, unknown>;
  excluirId?: number | null;
  /** Resumo do registro (ajuda a saber se é ligação, para a duração padrão). */
  resumo?: string | null;
}): Promise<ConflitoCompromisso[]> {
  const cc = await camposDeCompromisso(input.categoria, input.groupId);
  if (!cc) return [];
  const data = normalizarDataParaIso(valor(input.dados, cc.data));
  const ini = horaEmMinutos(valor(input.dados, cc.hora));
  if (!data || ini == null) return [];
  const textoDe = (resumo: string, d: Record<string, unknown>) => `${resumo} ${Object.values(d).map((x) => (x == null ? "" : String(x))).join(" ")}`;
  const fim = ini + (duracaoEmMinutos(valor(input.dados, cc.duracao)) ?? duracaoPadrao(textoDe(input.resumo ?? "", input.dados)));
  const dono = norm(valor(input.dados, cc.dono));

  const escopo = input.groupId != null ? "m.groupid = ?" : "(m.groupid IS NULL AND m.userid = ?)";
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT m.id, m.mediatext, m.dadosespecificosjson FROM memos m
     WHERE m.isactive = 1 AND m.category = ? AND ${escopo} AND m.id <> ?
     ORDER BY m.createdat DESC LIMIT 3000`,
    [input.categoria, input.groupId ?? input.userId, input.excluirId ?? 0]
  );
  const out: ConflitoCompromisso[] = [];
  for (const r of rows) {
    let d: Record<string, unknown> = {};
    try {
      const raw = r.dadosEspecificosJson ?? r.dadosespecificosjson;
      d = (typeof raw === "string" ? JSON.parse(raw) : raw) ?? {};
    } catch {
      continue;
    }
    if (normalizarDataParaIso(valor(d, cc.data)) !== data) continue;
    const sit = norm(valor(d, cc.situacao));
    if (sit.startsWith("conclu") || sit.startsWith("cancel")) continue;
    if (cc.dono && dono && norm(valor(d, cc.dono)) && norm(valor(d, cc.dono)) !== dono) continue;
    const oi = horaEmMinutos(valor(d, cc.hora));
    if (oi == null) continue;
    const resumo = String(r.mediaText ?? r.mediatext ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    const of = oi + (duracaoEmMinutos(valor(d, cc.duracao)) ?? duracaoPadrao(textoDe(resumo, d)));
    if (oi < fim && ini < of) {
      out.push({ id: Number(r.id), resumo, inicio: hhmm(oi), fim: hhmm(of) });
    }
  }
  return out.sort((a, b) => a.inicio.localeCompare(b.inicio));
}

/** "Reunião com Carlos (16:00–17:00)" para a mensagem de dúvida. */
export const descreverConflitos = (cs: ConflitoCompromisso[]): string =>
  cs.slice(0, 3).map((c) => `${c.resumo || "outro compromisso"} (${c.inicio}–${c.fim})`).join("; ");
