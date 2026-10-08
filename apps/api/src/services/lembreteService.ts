/**
 * Lembretes de memos (docs/Desenho_Lembretes_myMemory_v2.docx).
 * Para cada regra ativa: lê os memos da categoria, calcula data+hora do compromisso (fuso de São Paulo),
 * e envia e-mail quando "momento − antecedência" já chegou e o compromisso ainda não aconteceu.
 * lembretes_enviados garante um envio por regra + memo + momento + antecedência.
 * Sem IA: custo zero e texto previsível.
 */
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";
import { config } from "../config.js";
import { sendLembreteEmail } from "../lib/mail.js";
import {
  formatarAntecedencia,
  type LembreteDestinatarioTipo,
  type LembretePreviaItem,
  type LembretePreviaResponse,
  type LembreteRegra,
  type LembreteRegraInput,
} from "@mymemory/shared";

/** Brasil sem horário de verão desde 2019: São Paulo = UTC−3 fixo. */
const OFFSET_SP = "-03:00";
/** Janela de leitura dos memos: compromissos de ontem até daqui a 60 dias. */
const JANELA_DIAS = 60;

// ── Interpretação dos campos do memo ────────────────────────────────────────

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().trim();
}

const NUMEROS_EXTENSO: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  quinze: 15, vinte: 20, trinta: 30, quarenta: 40, quarenta_e_cinco: 45,
};

/** "30 min antes", "1 hora e meia", "2 dias", "uma semana", "meia hora" → minutos (null se não entender). */
export function parseAntecedenciaMin(valor: string | null | undefined): number | null {
  if (!valor) return null;
  let t = semAcento(valor);
  if (!t) return null;
  t = t.replace(/\bmeia hora\b/g, "30 min").replace(/\be meia\b/g, "e 30 min");
  t = t.replace(/(\d+)\s*h\s*(\d{1,2})\b/g, "$1 h $2 min"); // "1h30" → 1 h 30 min
  t = t.replace(/\b(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|quinze|vinte|trinta|quarenta)\b/g,
    (w) => String(NUMEROS_EXTENSO[w]));
  let total = 0;
  let achou = false;
  const re = /(\d+(?:[.,]\d+)?)\s*(semanas?|dias?|d\b|horas?|hrs?|h\b|minutos?|mins?|m\b)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const n = Number(m[1].replace(",", "."));
    const u = m[2];
    if (!Number.isFinite(n)) continue;
    achou = true;
    if (u.startsWith("semana")) total += n * 10080;
    else if (u.startsWith("d")) total += n * 1440;
    else if (u.startsWith("h")) total += n * 60;
    else total += n;
  }
  return achou && total > 0 ? Math.round(total) : null;
}

/** "14:30", "14h", "9h30", "14.30" → { hh, mm } (null se não houver horário válido). */
export function parseHorario(valor: string | null | undefined): { hh: number; mm: number } | null {
  if (!valor) return null;
  const m = /(\d{1,2})\s*(?:[:hH.]\s*(\d{2}))?/.exec(valor);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  if (hh > 23 || mm > 59) return null;
  return { hh, mm };
}

/** Campo "Lembrete" do memo: false quando o memo pede para não lembrar; null quando não diz nada. */
export function querLembrete(valor: string | null | undefined): boolean | null {
  if (!valor) return null;
  const t = semAcento(valor);
  if (!t) return null;
  if (/\b(nao|sem lembrete|dispensa|desnecessario|false|0)\b/.test(t)) return false;
  if (/\b(sim|lembrar|lembre|true|1)\b/.test(t)) return true;
  return null;
}

const dois = (n: number) => String(n).padStart(2, "0");

function momentoSP(dataIso: string, h: { hh: number; mm: number }): Date {
  return new Date(`${dataIso}T${dois(h.hh)}:${dois(h.mm)}:00${OFFSET_SP}`);
}

function dataBR(dataIso: string): string {
  const [a, m, d] = dataIso.split("-");
  return `${d}/${m}/${a}`;
}

function lerJson(texto: unknown): Record<string, unknown> {
  if (typeof texto !== "string" || !texto.trim()) return {};
  try {
    const v = JSON.parse(texto);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function campoTexto(dados: Record<string, unknown>, nome: string | null): string {
  if (!nome) return "";
  const v = dados[nome];
  return v == null ? "" : String(v).trim();
}

// ── Regras: leitura e gravação ──────────────────────────────────────────────

function mapRegra(r: RowDataPacket): LembreteRegra {
  const ts = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
  return {
    id: r.id as number,
    categoryId: r.categoryId as number,
    origem: r.origem as LembreteRegra["origem"],
    ativo: Number(r.ativo) === 1,
    campoData: r.campo_data as string,
    campoHorario: (r.campo_horario as string) ?? null,
    antecedenciasMin: ((r.antecedencias_min as number[]) ?? []).map(Number),
    destinatarioTipo: r.destinatario_tipo as LembreteDestinatarioTipo,
    destinatarioValor: (r.destinatario_valor as string) ?? null,
    campoAntecedencia: (r.campo_antecedencia as string) ?? null,
    campoDestinatario: (r.campo_destinatario as string) ?? null,
    campoLembrete: (r.campo_lembrete as string) ?? null,
    modeloTexto: (r.modelo_texto as string) ?? null,
    horarioPadrao: (r.horario_padrao as string) ?? "08:00",
    lembrarImportados: Number(r.lembrar_importados) === 1,
    intervaloMin: Number(r.intervalo_min),
    ultimaExecucao: ts(r.ultima_execucao),
    createdAt: ts(r.createdAt) ?? "",
    updatedAt: ts(r.updatedAt) ?? "",
  };
}

export async function listarRegras(categoryId: number): Promise<LembreteRegra[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM lembrete_regras WHERE categoryid = ? ORDER BY id ASC`,
    [categoryId]
  );
  return rows.map(mapRegra);
}

export async function obterRegra(regraId: number): Promise<LembreteRegra | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT * FROM lembrete_regras WHERE id = ? LIMIT 1`, [regraId]);
  return rows[0] ? mapRegra(rows[0]) : null;
}

function valoresRegra(i: LembreteRegraInput): unknown[] {
  return [
    i.ativo ? 1 : 0,
    i.campoData.trim(),
    i.campoHorario?.trim() || null,
    [...new Set(i.antecedenciasMin)].sort((a, b) => b - a),
    i.destinatarioTipo,
    i.destinatarioValor?.trim() || null,
    i.campoAntecedencia?.trim() || null,
    i.campoDestinatario?.trim() || null,
    i.campoLembrete?.trim() || null,
    i.modeloTexto?.trim() || null,
    i.horarioPadrao,
    i.lembrarImportados ? 1 : 0,
    i.intervaloMin,
  ];
}

export async function criarRegra(categoryId: number, input: LembreteRegraInput): Promise<number> {
  const [rows] = await pool.query<{ id: number }[]>(
    `INSERT INTO lembrete_regras (ativo, campo_data, campo_horario, antecedencias_min, destinatario_tipo,
       destinatario_valor, campo_antecedencia, campo_destinatario, campo_lembrete, modelo_texto, horario_padrao,
       lembrar_importados, intervalo_min, categoryid, origem)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'memos') RETURNING id`,
    [...valoresRegra(input), categoryId]
  );
  return rows[0].id;
}

export async function atualizarRegra(regraId: number, input: LembreteRegraInput): Promise<void> {
  await pool.query(
    `UPDATE lembrete_regras SET ativo = ?, campo_data = ?, campo_horario = ?, antecedencias_min = ?,
       destinatario_tipo = ?, destinatario_valor = ?, campo_antecedencia = ?, campo_destinatario = ?,
       campo_lembrete = ?, modelo_texto = ?, horario_padrao = ?, lembrar_importados = ?, intervalo_min = ?,
       updatedat = NOW()
     WHERE id = ?`,
    [...valoresRegra(input), regraId]
  );
}

export async function excluirRegra(regraId: number): Promise<void> {
  await pool.query(`DELETE FROM lembrete_regras WHERE id = ?`, [regraId]);
}

// ── Cálculo do que está na hora ─────────────────────────────────────────────

interface Membro { id: number; nome: string; email: string | null; role: string }

interface Calculado {
  memoId: number;
  momento: Date;
  dataIso: string;
  hora: string;
  antecedenciaMin: number;
  enviarEm: Date;
  situacao: "agendado" | "enviado" | "ignorado";
  /** true = deve ser enviado agora */
  devido: boolean;
  /** true = já vencido mas substituído por um lembrete mais próximo do compromisso */
  substituido: boolean;
  destinatarios: string[];
  observacao: string | null;
  dados: Record<string, unknown>;
  resumo: string;
}

interface Contexto {
  regra: LembreteRegra;
  categoria: string;
  groupId: number;
  membros: Membro[];
}

async function carregarContexto(regra: LembreteRegra): Promise<Contexto | null> {
  const [catRows] = await pool.query<RowDataPacket[]>(
    `SELECT name, groupid, isactive FROM categories WHERE id = ? LIMIT 1`,
    [regra.categoryId]
  );
  const cat = catRows[0];
  if (!cat || Number(cat.isActive) !== 1 || cat.groupId == null) return null;
  const [mRows] = await pool.query<RowDataPacket[]>(
    `SELECT u.id, u.name, u.email, gm.role FROM group_members gm JOIN users u ON u.id = gm.userid WHERE gm.groupid = ?`,
    [cat.groupId]
  );
  return {
    regra,
    categoria: String(cat.name),
    groupId: cat.groupId as number,
    membros: mRows.map((r) => ({ id: r.id as number, nome: String(r.name ?? ""), email: (r.email as string) ?? null, role: String(r.role) })),
  };
}

const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Destinatários: campo do memo (grupo, nome de membro ou e-mail) → senão o padrão da regra → senão o autor. */
function resolverDestinatarios(
  ctx: Contexto,
  autorId: number,
  valorCampo: string
): { emails: string[]; observacao: string | null } {
  const emailDe = (id: number) => ctx.membros.find((m) => m.id === id)?.email ?? null;
  const autor = emailDe(autorId);
  const lista = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x).map((x) => x.toLowerCase()))];

  if (valorCampo) {
    const t = semAcento(valorCampo);
    if (/\b(grupo|todos|todas|equipe|time)\b/.test(t)) {
      return { emails: lista(ctx.membros.map((m) => m.email)), observacao: null };
    }
    const emails = valorCampo.match(RE_EMAIL);
    if (emails?.length) return { emails: lista([...emails, autor]), observacao: null };
    // Nome de membro: "Dr. João" → membro cujo nome contém "joao" (ou o nome inteiro está no texto)
    const alvo = t.replace(/\b(dr|dra|sr|sra|prof|profa|doutor|doutora|senhor|senhora)\.?\s*/g, "").trim();
    const candidatos = alvo
      ? ctx.membros.filter((m) => {
          const nome = semAcento(m.nome);
          return !!nome && (nome.includes(alvo) || alvo.includes(nome) || nome.split(/\s+/)[0] === alvo.split(/\s+/)[0]);
        })
      : [];
    if (candidatos.length === 1 && candidatos[0].email) {
      return { emails: lista([candidatos[0].email, autor]), observacao: null };
    }
    return {
      emails: lista([autor]),
      observacao: `Destinatário "${valorCampo}" não encontrado entre os membros do grupo${candidatos.length > 1 ? " (mais de um nome parecido)" : ""} — enviado para quem registrou.`,
    };
  }

  switch (ctx.regra.destinatarioTipo) {
    case "grupo":
      return { emails: lista(ctx.membros.map((m) => m.email)), observacao: null };
    case "owner":
      return { emails: lista(ctx.membros.filter((m) => m.role === "owner").map((m) => m.email)), observacao: null };
    case "email": {
      const fixos = (ctx.regra.destinatarioValor ?? "").match(RE_EMAIL) ?? [];
      return fixos.length ? { emails: lista(fixos), observacao: null } : { emails: lista([autor]), observacao: null };
    }
    default:
      return { emails: lista([autor]), observacao: null };
  }
}

async function calcular(ctx: Contexto, agora: Date): Promise<{ itens: Calculado[]; semData: number }> {
  const { regra } = ctx;
  const [memoRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, userid, mediatext, dadosespecificosjson, mediametadata, createdat, data_alvo
     FROM (
       SELECT m.id, m.userid, m.mediatext, m.dadosespecificosjson, m.mediametadata, m.createdat,
              to_char(mymemory_parse_date(NULLIF(m.dadosespecificosjson, '')::jsonb->>?), 'YYYY-MM-DD') AS data_alvo
       FROM memos m
       WHERE m.isactive = 1 AND m.category = ? AND m.groupid = ?
         AND NULLIF(m.dadosespecificosjson, '') IS NOT NULL
     ) x`,
    [regra.campoData, ctx.categoria, ctx.groupId]
  );

  const [envRows] = await pool.query<RowDataPacket[]>(
    `SELECT chave_item, (EXTRACT(EPOCH FROM momento_alvo) * 1000)::bigint AS ms, antecedencia_min, situacao
     FROM lembretes_enviados WHERE regraid = ? AND momento_alvo > NOW() - INTERVAL '1 day'`,
    [regra.id]
  );
  const jaRegistrado = new Map<string, string>();
  for (const e of envRows) jaRegistrado.set(`${e.chave_item}|${Number(e.ms)}|${Number(e.antecedencia_min)}`, String(e.situacao));

  const regraCriada = new Date(regra.createdAt).getTime();
  const horarioPadrao = parseHorario(regra.horarioPadrao) ?? { hh: 8, mm: 0 };
  const limiteJanela = agora.getTime() + JANELA_DIAS * 86_400_000;
  const itens: Calculado[] = [];
  let semData = 0;

  for (const r of memoRows) {
    const dataIso = r.data_alvo as string | null;
    if (!dataIso) { semData++; continue; }
    const dados = lerJson(r.dadosEspecificosJson);
    const horario = parseHorario(campoTexto(dados, regra.campoHorario)) ?? horarioPadrao;
    const momento = momentoSP(dataIso, horario);
    if (momento.getTime() <= agora.getTime() || momento.getTime() > limiteJanela) continue;

    const memoId = r.id as number;
    const resumo = String(r.mediaText ?? "").replace(/\s+/g, " ").slice(0, 160);
    const hora = `${dois(horario.hh)}:${dois(horario.mm)}`;
    const base = { memoId, momento, dataIso, hora, dados, resumo };

    // Memo pede (ou não) lembrete; sem indicação, importados em lote seguem a regra
    let ignorarMotivo: string | null = null;
    const pede = querLembrete(campoTexto(dados, regra.campoLembrete));
    if (pede === false) ignorarMotivo = "O memo pede para não lembrar.";
    else if (pede === null && !regra.lembrarImportados && lerJson(r.mediaMetadata).reviewFlow === "batch_v1") {
      ignorarMotivo = "Memo da importação em lote (regra: não lembrar importados).";
    }

    const antMemo = parseAntecedenciaMin(campoTexto(dados, regra.campoAntecedencia));
    const antecedencias = antMemo ? [antMemo] : regra.antecedenciasMin;
    const dest = resolverDestinatarios(ctx, r.userId as number, campoTexto(dados, regra.campoDestinatario));
    // Lembrete cuja hora de envio já tinha passado quando o memo (ou a regra) foi criado não é enviado
    const limiar = Math.max(new Date(r.createdAt as Date).getTime(), regraCriada);

    const doMemo: Calculado[] = antecedencias.map((ant) => {
      const enviarEm = new Date(momento.getTime() - ant * 60_000);
      const registrado = jaRegistrado.get(`${memoId}|${momento.getTime()}|${ant}`);
      let situacao: Calculado["situacao"] = "agendado";
      let observacao: string | null = dest.observacao;
      if (registrado) situacao = registrado === "enviado" ? "enviado" : "ignorado";
      else if (ignorarMotivo) { situacao = "ignorado"; observacao = ignorarMotivo; }
      else if (enviarEm.getTime() < limiar) {
        situacao = "ignorado";
        observacao = "Horário de envio já tinha passado quando o memo/regra foi criado.";
      }
      if (!dest.emails.length && situacao === "agendado") {
        situacao = "ignorado";
        observacao = "Nenhum destinatário com e-mail.";
      }
      const devido = situacao === "agendado" && enviarEm.getTime() <= agora.getTime();
      return { ...base, antecedenciaMin: ant, enviarEm, situacao, devido, substituido: false, destinatarios: dest.emails, observacao };
    });

    // Vários vencidos de uma vez (ex.: robô parado): envia só o mais próximo do compromisso
    const devidos = doMemo.filter((c) => c.devido).sort((a, b) => a.antecedenciaMin - b.antecedenciaMin);
    for (const c of devidos.slice(1)) { c.devido = false; c.substituido = true; }
    itens.push(...doMemo);
  }
  return { itens, semData };
}

// ── Envio ───────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function montarMensagem(ctx: Contexto, c: Calculado): { assunto: string; html: string; texto: string } {
  const antecedencia = formatarAntecedencia(c.antecedenciaMin);
  const campos = Object.entries(c.dados)
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([k, v]) => [k, String(v).trim()] as const);

  const substituir = (modelo: string) =>
    modelo.replace(/\{([^{}]+)\}/g, (_m, nome: string) => {
      const n = nome.trim();
      const chave = semAcento(n);
      if (chave === "categoria") return ctx.categoria;
      if (chave === "data") return dataBR(c.dataIso);
      if (chave === "hora") return c.hora;
      if (chave === "antecedencia") return antecedencia;
      const achado = campos.find(([k]) => semAcento(k) === chave);
      return achado ? achado[1] : "";
    });

  const linhaPrincipal = ctx.regra.modeloTexto
    ? substituir(ctx.regra.modeloTexto)
    : `Lembrete: ${ctx.categoria} em ${dataBR(c.dataIso)} às ${c.hora} (em ${antecedencia}).`;
  const assunto = `Lembrete: ${ctx.categoria} — ${dataBR(c.dataIso)} às ${c.hora}`;
  const link = `${config.publicWebUrl}/memo/${c.memoId}/editar`;

  const linhasHtml = campos
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6B7280;vertical-align:top">${escapeHtml(k)}</td><td style="padding:4px 0;color:#111827">${escapeHtml(v)}</td></tr>`)
    .join("");
  const html = `
    <p style="margin:0 0 12px;color:#111827;font-size:15px;font-weight:600">${escapeHtml(linhaPrincipal)}</p>
    ${linhasHtml ? `<table style="border-collapse:collapse;font-size:14px;margin:0 0 12px">${linhasHtml}</table>` : ""}
    ${c.resumo ? `<p style="margin:0 0 12px;color:#374151;font-size:13px">${escapeHtml(c.resumo)}</p>` : ""}
    ${c.observacao ? `<p style="margin:0 0 12px;color:#B45309;font-size:13px">${escapeHtml(c.observacao)}</p>` : ""}
    <p style="margin:16px 0"><a href="${link}" style="display:inline-block;background:#0D9488;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:9px 18px;border-radius:6px">Ver no myMemory →</a></p>
    <p style="font-size:12px;color:#9CA3AF;margin-top:20px">Lembrete automático da categoria "${escapeHtml(ctx.categoria)}" (${escapeHtml(antecedencia)} antes).</p>
  `;
  const texto = [
    linhaPrincipal,
    "",
    ...campos.map(([k, v]) => `${k}: ${v}`),
    c.resumo ? `\n${c.resumo}` : "",
    c.observacao ? `\n${c.observacao}` : "",
    `\nVer no myMemory: ${link}`,
  ].join("\n");
  return { assunto, html, texto };
}

async function registrar(regraId: number, c: Calculado, situacao: "enviado" | "ignorado", observacao: string | null): Promise<boolean> {
  const [rows] = await pool.query<{ id: number }[]>(
    `INSERT INTO lembretes_enviados (regraid, chave_item, momento_alvo, antecedencia_min, situacao, destino, observacao)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (regraid, chave_item, momento_alvo, antecedencia_min) DO NOTHING
     RETURNING id`,
    [regraId, String(c.memoId), c.momento, c.antecedenciaMin, situacao, c.destinatarios.join(", ") || null, observacao]
  );
  return rows.length > 0;
}

/** Executa uma regra: envia o que está na hora. Retorna quantos lembretes foram enviados. */
export async function executarRegra(regraId: number, agora = new Date()): Promise<number> {
  const regra = await obterRegra(regraId);
  if (!regra || !regra.ativo || regra.origem !== "memos") return 0;
  const ctx = await carregarContexto(regra);
  if (!ctx) return 0;
  const { itens } = await calcular(ctx, agora);
  let enviados = 0;

  for (const c of itens) {
    if (c.substituido) {
      await registrar(regra.id, c, "ignorado", "Substituído por um lembrete mais próximo do compromisso.");
      continue;
    }
    if (!c.devido) continue;
    // Reserva antes de enviar: dois robôs ao mesmo tempo não mandam em dobro
    if (!(await registrar(regra.id, c, "enviado", c.observacao))) continue;
    const msg = montarMensagem(ctx, c);
    let algum = false;
    for (const to of c.destinatarios) {
      try {
        await sendLembreteEmail({ to, subject: msg.assunto, html: msg.html, text: msg.texto });
        algum = true;
      } catch (err) {
        console.error(`[lembretes] regra #${regra.id} memo #${c.memoId} → ${to}:`, err instanceof Error ? err.message : err);
      }
    }
    if (algum) enviados++;
    else {
      // Nenhum e-mail saiu: libera a reserva para tentar de novo no próximo ciclo
      await pool.query(
        `DELETE FROM lembretes_enviados WHERE regraid = ? AND chave_item = ? AND momento_alvo = ? AND antecedencia_min = ?`,
        [regra.id, String(c.memoId), c.momento, c.antecedenciaMin]
      );
    }
  }
  await pool.query(`UPDATE lembrete_regras SET ultima_execucao = NOW() WHERE id = ?`, [regra.id]);
  return enviados;
}

/** Chamado pelo robô: executa as regras ativas cujo intervalo já passou. */
export async function executarLembretesPendentes(): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM lembrete_regras
     WHERE ativo = 1 AND origem = 'memos'
       AND (ultima_execucao IS NULL OR ultima_execucao <= NOW() - ((intervalo_min - 1) * INTERVAL '1 minute'))
     ORDER BY id ASC`
  );
  for (const { id } of rows as { id: number }[]) {
    try {
      const n = await executarRegra(id);
      if (n) console.info(`[lembretes] regra #${id}: ${n} lembrete(s) enviado(s)`);
    } catch (err) {
      console.error(`[lembretes] erro na regra #${id}:`, err instanceof Error ? err.message : err);
    }
  }
}

/** Prévia: o que esta regra vai enviar (sem enviar nada). */
export async function previaRegra(regraId: number, agora = new Date()): Promise<LembretePreviaResponse> {
  const regra = await obterRegra(regraId);
  if (!regra) throw new Error("not_found");
  const ctx = await carregarContexto(regra);
  if (!ctx) return { itens: [], semDataReconhecida: 0 };
  const { itens, semData } = await calcular(ctx, agora);
  const lista: LembretePreviaItem[] = itens
    .map((c) => ({
      memoId: c.memoId,
      momentoAlvo: c.momento.toISOString(),
      antecedenciaMin: c.antecedenciaMin,
      enviarEm: c.enviarEm.toISOString(),
      destinatarios: c.destinatarios,
      situacao: c.substituido ? ("ignorado" as const) : c.situacao,
      observacao: c.substituido
        ? "Substituído por um lembrete mais próximo do compromisso."
        : c.devido
          ? `Sai na próxima execução do robô.${c.observacao ? ` ${c.observacao}` : ""}`
          : c.observacao,
      resumo: c.resumo,
    }))
    .sort((a, b) => a.enviarEm.localeCompare(b.enviarEm));
  return { itens: lista, semDataReconhecida: semData };
}
