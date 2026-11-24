/**
 * Lembrete de vencimento do financeiro: contas a pagar e a receber (títulos, recorrentes previstas e faturas de cartão),
 * as mesmas da aba Previstos. No sino do usuário (atrasadas + as que vencem nos próximos dias) e, uma vez por dia de
 * manhã, um e-mail por espaço com o que vence hoje, nos dias configurados e o que atrasou ontem. Sem IA.
 */
import type { FinItemAgenda } from "@mymemory/shared";
import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { config } from "../config.js";
import { sendLembreteEmail } from "../lib/mail.js";
import { agenda, hojeSaoPaulo, resolverEspaco, type Espaco } from "./financeiroService.js";
import { chaveEspaco, membrosDoGrupo, obterFinConfig } from "./finConfigService.js";
import type { FinConfig } from "@mymemory/shared";

const somarDias = (d: string, n: number): string => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Contas em aberto de um espaço: atrasadas e as que vencem de hoje até hoje + dias. */
export async function vencimentosDoEspaco(e: Espaco, hoje: string, ateDias: number): Promise<FinItemAgenda[]> {
  const ag = await agenda(e, hoje, somarDias(hoje, ateDias));
  return ag.itens.filter((i) => i.situacao !== "pago");
}

export interface LembreteFinSino {
  id: string;
  titulo: string;
  texto: string;
  vencimento: string;
  atrasado: boolean;
}

const RE_EMAIL = /[^\s,;<>"']+@[^\s,;<>"']+\.[^\s,;<>"']+/g;

/** Ids dos membros que recebem o lembrete do grupo (dono, todos ou escolhidos). */
async function idsDestinatariosGrupo(groupId: number, cfg: FinConfig): Promise<{ ids: Set<number>; emails: Map<number, string | null> }> {
  const membros = await membrosDoGrupo(groupId);
  const emails = new Map(membros.map((m) => [m.id, m.email]));
  const ids =
    cfg.lembreteQuem === "membros" ? membros.map((m) => m.id)
    : cfg.lembreteQuem === "escolhidos" ? membros.filter((m) => cfg.lembreteMembros.includes(m.id)).map((m) => m.id)
    : membros.filter((m) => m.dono).map((m) => m.id);
  return { ids: new Set(ids), emails };
}

/** E-mails que recebem o lembrete do espaço: pessoal = o próprio; grupo = conforme "quem recebe"; mais os e-mails a mais. */
async function emailsDestinatarios(e: Espaco, cfg: FinConfig): Promise<string[]> {
  const lista: (string | null)[] = [];
  if (e.groupId == null) {
    const [u] = await pool.query<RowDataPacket[]>(`SELECT email FROM users WHERE id = ?`, [e.userId]);
    lista.push(u[0]?.email ?? null);
  } else {
    const { ids, emails } = await idsDestinatariosGrupo(e.groupId, cfg);
    for (const id of ids) lista.push(emails.get(id) ?? null);
  }
  lista.push(...(cfg.lembreteEmails.match(RE_EMAIL) ?? []));
  const vistos = new Set<string>();
  return lista
    .filter((x): x is string => !!x && x.includes("@"))
    .map((x) => x.trim())
    .filter((x) => (vistos.has(x.toLowerCase()) ? false : (vistos.add(x.toLowerCase()), true)));
}

/** Sino: do espaço pessoal e do grupo em que o usuário está, com o lembrete ligado e ele entre os destinatários. */
export async function lembretesFinanceiroDoUsuario(userId: number): Promise<LembreteFinSino[]> {
  const hoje = hojeSaoPaulo();
  const espacos: Espaco[] = [{ groupId: null, userId }];
  const atual = await resolverEspaco(userId);
  if (atual.groupId != null) espacos.push(atual);
  const out: LembreteFinSino[] = [];
  for (const e of espacos) {
    const cfg = await obterFinConfig(e);
    if (!cfg.lembreteAtivo) continue;
    if (e.groupId != null && !(await idsDestinatariosGrupo(e.groupId, cfg)).ids.has(userId)) continue;
    const ate = Math.max(0, ...cfg.lembreteDias);
    for (const i of await vencimentosDoEspaco(e, hoje, ate)) {
      const dias = Math.round((Date.parse(i.vencimento) - Date.parse(hoje)) / 86400000);
      const quando = i.situacao === "atraso" ? `venceu em ${dataBr(i.vencimento)}` : dias === 0 ? "vence hoje" : dias === 1 ? "vence amanhã" : `vence em ${dataBr(i.vencimento)}`;
      out.push({
        id: `fin:${chaveEspaco(e)}:${i.chave}`,
        titulo: `${i.descricao} — ${brl(i.valor)}`,
        texto: `${i.sentido === "pagar" ? "A pagar" : "A receber"}, ${quando}`,
        vencimento: i.vencimento,
        atrasado: i.situacao === "atraso",
      });
    }
  }
  return out.sort((a, b) => a.vencimento.localeCompare(b.vencimento));
}

/** Espaços com contas no financeiro: o pessoal de cada usuário e cada grupo (no grupo, o dono responde pelo espaço). */
async function espacosComContas(): Promise<{ e: Espaco; nome: string }[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `WITH esp AS (
       SELECT groupid, CASE WHEN groupid IS NULL THEN userid END AS uid FROM fin_titulos WHERE situacao = 'aberto'
       UNION SELECT groupid, CASE WHEN groupid IS NULL THEN userid END FROM fin_recorrencias WHERE ativo = 1
       UNION SELECT groupid, CASE WHEN groupid IS NULL THEN userid END FROM fin_contas
             WHERE tipo = 'cartao' AND dia_fechamento IS NOT NULL AND ativo = 1
     )
     SELECT esp.groupid AS "gid", COALESCE(esp.uid, s.ownerid) AS "uid", g.name AS "grupo"
     FROM esp
     LEFT JOIN groups g ON g.id = esp.groupid
     LEFT JOIN subscriptions s ON s.id = g.subscriptionid`
  );
  return rows
    .filter((r) => r.uid != null)
    .map((r) => ({
      e: { groupId: r.gid == null ? null : Number(r.gid), userId: Number(r.uid) },
      nome: r.gid == null ? "espaço pessoal" : `grupo ${String(r.grupo ?? r.gid)}`,
    }));
}

/** Hora em São Paulo (0–23). */
function horaSP(): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(new Date()));
}

/** Robô: uma vez por dia, a partir das 8h de São Paulo, um e-mail por espaço com o que vence. */
export async function executarLembretesFinanceiro(): Promise<void> {
  if (horaSP() < 8) return;
  const hoje = hojeSaoPaulo();
  for (const { e, nome } of await espacosComContas()) {
    try {
      const cfg = await obterFinConfig(e);
      if (!cfg.lembreteAtivo || !cfg.lembreteEmail) continue;
      const k = chaveEspaco(e);
      const [u] = await pool.query<RowDataPacket[]>(
        `SELECT to_char(lembrete_ultimo_dia, 'YYYY-MM-DD') AS "d" FROM fin_config WHERE espaco = ?`,
        [k]
      );
      if (u[0]?.d === hoje) continue;
      const ate = Math.max(0, ...cfg.lembreteDias);
      const alvo = new Set(cfg.lembreteDias.map((d) => somarDias(hoje, d)));
      const ontem = somarDias(hoje, -1);
      const itens = (await vencimentosDoEspaco(e, hoje, ate)).filter(
        (i) => (i.situacao !== "atraso" && alvo.has(i.vencimento)) || (i.situacao === "atraso" && i.vencimento === ontem)
      );
      // Marca o dia antes de enviar: se o envio falhar, não repete a cada 5 minutos
      await pool.query(
        `INSERT INTO fin_config (espaco, lembrete_ultimo_dia, updatedat) VALUES (?, ?, NOW())
         ON CONFLICT (espaco) DO UPDATE SET lembrete_ultimo_dia = EXCLUDED.lembrete_ultimo_dia`,
        [k, hoje]
      );
      if (!itens.length) continue;
      const para = await emailsDestinatarios(e, cfg);
      for (const email of para) {
        await enviarEmail(email, nome, hoje, itens).catch((err) =>
          console.error(`[lembretes-fin] ${k} → ${email}:`, err instanceof Error ? err.message : err)
        );
      }
      console.info(`[lembretes-fin] ${k}: ${itens.length} conta(s) → ${para.join(", ") || "ninguém"}`);
    } catch (err) {
      console.error(`[lembretes-fin] erro no espaço ${chaveEspaco(e)}:`, err instanceof Error ? err.message : err);
    }
  }
}

async function enviarEmail(to: string, nome: string, hoje: string, itens: FinItemAgenda[]): Promise<void> {
  const grupos: [string, FinItemAgenda[]][] = [
    ["Atrasou ontem", itens.filter((i) => i.situacao === "atraso")],
    ["Vence hoje", itens.filter((i) => i.situacao !== "atraso" && i.vencimento === hoje)],
    ["Vence nos próximos dias", itens.filter((i) => i.situacao !== "atraso" && i.vencimento > hoje)],
  ];
  const linha = (i: FinItemAgenda) =>
    `${dataBr(i.vencimento)} · ${i.sentido === "pagar" ? "pagar" : "receber"} · ${i.descricao} · ${brl(i.valor)}`;
  const link = `${config.publicWebUrl}/financeiro`;
  const texto = grupos
    .filter(([, l]) => l.length)
    .map(([t, l]) => `${t}:\n${l.map((i) => `- ${linha(i)}`).join("\n")}`)
    .join("\n\n");
  const html =
    `<p>Contas do ${esc(nome)}:</p>` +
    grupos
      .filter(([, l]) => l.length)
      .map(([t, l]) => `<p><b>${esc(t)}</b></p><ul>${l.map((i) => `<li>${esc(linha(i))}</li>`).join("")}</ul>`)
      .join("") +
    `<p><a href="${esc(link)}">Abrir Contas a pagar e receber</a></p>` +
    `<p style="color:#888;font-size:12px">Para mudar os dias ou desligar: Contas a pagar e receber → Fale comigo → Lembrete de vencimento.</p>`;
  const n = itens.length;
  await sendLembreteEmail({
    to,
    subject: n === 1 ? `Conta: ${itens[0].descricao} (${dataBr(itens[0].vencimento)})` : `${n} contas vencendo`,
    html,
    text: `Contas do ${nome}:\n\n${texto}\n\n${link}`,
  });
}
