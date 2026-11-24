/**
 * Importador de extrato bancário (OFX) com conciliação — etapa 1 (desenho, seção 5 e 13.20).
 * Lê o arquivo, compara cada linha com o que já está no financeiro e propõe: ligar a um lançamento que já existe,
 * baixar uma conta em aberto (título, recorrente ou fatura), lançar como novo (grupo sugerido pelo histórico) ou
 * ignorar. A linha guarda a identificação do banco (FITID): importar o mesmo arquivo de novo não duplica.
 * A mesma porta servirá para a API (Open Finance): muda só a entrada.
 */
import type { FinExtratoDecisao, FinExtratoItem, FinExtratoPrevia } from "@mymemory/shared";
import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";
import {
  agenda,
  baixar,
  esp,
  FinErro,
  listarContasComSaldo,
  obterConta,
  pagarFatura,
  type Espaco,
} from "./financeiroService.js";

// ── Leitura do OFX ──────────────────────────────────────────────────────────

export interface OfxTransacao {
  fitid: string;
  data: string;
  valor: number;
  descricao: string;
}

export interface OfxExtrato {
  inicio: string | null;
  fim: string | null;
  saldo: number | null;
  saldoEm: string | null;
  transacoes: OfxTransacao[];
}

/** Valor de uma tag no OFX (SGML "<TAG>valor" ou XML "<TAG>valor</TAG>"). */
function tag(bloco: string, nome: string): string | null {
  const m = new RegExp(`<${nome}>([^<\\r\\n]*)`, "i").exec(bloco);
  const v = m?.[1]?.trim();
  return v ? v : null;
}

/** "20261115120000[-3:BRT]" → "2026-11-15". */
function dataOfx(v: string | null): string | null {
  const m = v ? /^(\d{4})(\d{2})(\d{2})/.exec(v) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** "-1.234,56", "-1234.56", "1,5" → número. */
function valorOfx(v: string | null): number | null {
  if (!v) return null;
  let t = v.replace(/\s/g, "");
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (t.includes(",")) t = t.replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function lerOfx(texto: string): OfxExtrato {
  if (!/<OFX>/i.test(texto)) throw new FinErro("ofx", "O arquivo não parece um extrato OFX (falta a marca <OFX>).");
  const blocos = texto.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]);
  const vistos = new Map<string, number>();
  const transacoes: OfxTransacao[] = [];
  for (const b of blocos) {
    const data = dataOfx(tag(b, "DTPOSTED"));
    const valor = valorOfx(tag(b, "TRNAMT"));
    if (!data || valor == null || valor === 0) continue;
    const descricao = (tag(b, "MEMO") ?? tag(b, "NAME") ?? tag(b, "TRNTYPE") ?? "Lançamento do banco").replace(/\s+/g, " ").slice(0, 200);
    let fitid = tag(b, "FITID") ?? `sem-id:${data}:${valor}:${descricao.slice(0, 40)}`;
    // Alguns bancos repetem o FITID em linhas diferentes: a 2ª vira "fitid#2"
    const n = (vistos.get(fitid) ?? 0) + 1;
    vistos.set(fitid, n);
    if (n > 1) fitid = `${fitid}#${n}`;
    transacoes.push({ fitid: fitid.slice(0, 120), data, valor, descricao });
  }
  const bal = texto.split(/<LEDGERBAL>/i)[1] ?? "";
  return {
    inicio: dataOfx(tag(texto, "DTSTART")),
    fim: dataOfx(tag(texto, "DTEND")),
    saldo: valorOfx(tag(bal, "BALAMT")),
    saldoEm: dataOfx(tag(bal, "DTASOF")),
    transacoes: transacoes.sort((a, b) => a.data.localeCompare(b.data)),
  };
}

// ── Conciliação (prévia) ────────────────────────────────────────────────────

const somarDias = (d: string, n: number): string => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const difDias = (a: string, b: string) => Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86400000));

/** Chave da descrição para achar o grupo usado antes: sem números, acentos e pontuação; as 3 primeiras palavras. */
function chaveDescricao(d: string): string {
  return d
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !["pix", "ted", "doc", "pagto", "pagamento", "compra", "debito", "credito", "transf", "transferencia", "enviado", "recebido", "para", "de"].includes(w))
    .slice(0, 3)
    .join(" ");
}

export async function previaExtrato(e: Espaco, contaId: number, conteudo: string): Promise<FinExtratoPrevia> {
  const conta = await obterConta(pool, e, contaId, ["banco", "corretora", "cartao"], "conta do extrato");
  const ext = lerOfx(conteudo);
  if (!ext.transacoes.length) throw new FinErro("ofx_vazio", "O arquivo não tem lançamentos.");
  const fitids = ext.transacoes.map((t) => t.fitid);
  const [imp] = await pool.query<RowDataPacket[]>(
    `SELECT chave_externa AS "f" FROM fin_lancamentos WHERE extrato_contaid = ? AND chave_externa = ANY(?::text[])`,
    [conta.id, fitids]
  );
  const [ign] = await pool.query<RowDataPacket[]>(
    `SELECT fitid AS "f" FROM fin_extrato_ignorados WHERE contaid = ? AND fitid = ANY(?::text[])`,
    [conta.id, fitids]
  );
  const importados = new Set(imp.map((r) => String(r.f)));
  const ignorados = new Set(ign.map((r) => String(r.f)));

  const de = ext.transacoes[0].data;
  const ate = ext.transacoes[ext.transacoes.length - 1].data;
  const f = esp(e, "l");
  // Lançamentos desta conta no período (±5 dias) ainda não ligados a uma linha de extrato
  const [ls] = await pool.query<RowDataPacket[]>(
    `SELECT l.id, to_char(l.data, 'YYYY-MM-DD') AS "data", l.valor, l.descricao, l.conta_origemid AS "o", l.conta_destinoid AS "d"
     FROM fin_lancamentos l
     WHERE ${f.sql} AND (l.conta_origemid = ? OR l.conta_destinoid = ?) AND l.chave_externa IS NULL
       AND l.data BETWEEN ? AND ?`,
    [...f.params, conta.id, conta.id, somarDias(de, -5), somarDias(ate, 5)]
  );
  // Histórico: o outro lado usado antes para cada descrição (o mais recente)
  const [hist] = await pool.query<RowDataPacket[]>(
    `SELECT l.descricao, CASE WHEN l.conta_origemid = ? THEN l.conta_destinoid ELSE l.conta_origemid END AS "contra"
     FROM fin_lancamentos l
     JOIN fin_contas c ON c.id = CASE WHEN l.conta_origemid = ? THEN l.conta_destinoid ELSE l.conta_origemid END
     WHERE ${f.sql} AND (l.conta_origemid = ? OR l.conta_destinoid = ?) AND c.chave IS NULL AND l.tituloid IS NULL
     ORDER BY l.data DESC, l.id DESC
     LIMIT 2000`,
    [conta.id, conta.id, ...f.params, conta.id, conta.id]
  );
  const sugestao = new Map<string, number>();
  for (const h of hist) {
    const k = chaveDescricao(String(h.descricao));
    if (k && !sugestao.has(k)) sugestao.set(k, Number(h.contra));
  }
  const abertos = (await agenda(e, somarDias(de, -15), somarDias(ate, 15))).itens.filter((i) => i.situacao !== "pago");

  const usadosL = new Set<number>();
  const usadosA = new Set<string>();
  const itens: FinExtratoItem[] = ext.transacoes.map((t) => {
    const base = { fitid: t.fitid, data: t.data, valor: t.valor, descricao: t.descricao };
    if (importados.has(t.fitid)) return { ...base, situacao: "importado" as const };
    if (ignorados.has(t.fitid)) return { ...base, situacao: "ignorado" as const };
    const v = Math.abs(t.valor);
    const saida = t.valor < 0;
    // 1) Já lançado: mesmo valor, mesmo lado da conta, até 3 dias de diferença (o mais próximo)
    const cand = ls
      .filter((l) => !usadosL.has(Number(l.id)) && Math.abs(Number(l.valor) - v) < 0.005)
      .filter((l) => (saida ? Number(l.o) === conta.id : Number(l.d) === conta.id))
      .filter((l) => difDias(String(l.data), t.data) <= 3)
      .sort((a, b) => difDias(String(a.data), t.data) - difDias(String(b.data), t.data))[0];
    if (cand) {
      usadosL.add(Number(cand.id));
      return { ...base, situacao: "existe" as const, lancamentoId: Number(cand.id), lancamentoDescricao: `${String(cand.data).slice(8, 10)}/${String(cand.data).slice(5, 7)} ${cand.descricao}` };
    }
    // 2) Paga uma conta em aberto: mesmo valor e sentido, vencimento até 10 dias de distância
    const alvo = abertos
      .filter((a) => !usadosA.has(a.chave) && Math.abs(a.valor - v) < 0.005 && a.sentido === (saida ? "pagar" : "receber"))
      .filter((a) => a.origem !== "fatura" || conta.tipo !== "cartao")
      .filter((a) => difDias(a.vencimento, t.data) <= 10)
      .sort((a, b) => difDias(a.vencimento, t.data) - difDias(b.vencimento, t.data))[0];
    if (alvo) {
      usadosA.add(alvo.chave);
      return { ...base, situacao: "baixa" as const, alvoChave: alvo.chave, alvoDescricao: `${alvo.descricao} (vence ${alvo.vencimento.slice(8, 10)}/${alvo.vencimento.slice(5, 7)})` };
    }
    // 3) Novo: o outro lado sugerido pelo histórico da mesma descrição
    return { ...base, situacao: "novo" as const, contraContaId: sugestao.get(chaveDescricao(t.descricao)) ?? null };
  });

  let saldoSistema: number | null = null;
  if (ext.saldoEm) {
    const cs = await listarContasComSaldo(e, ext.saldoEm, ext.saldoEm);
    const c = cs.find((x) => x.id === conta.id);
    // Cartão: o sistema mostra a dívida positiva; o banco costuma mandar negativa
    saldoSistema = c ? (conta.tipo === "cartao" ? -c.saldo : c.saldo) : null;
  }
  return {
    contaId: conta.id,
    conta: conta.nome,
    inicio: ext.inicio ?? de,
    fim: ext.fim ?? ate,
    saldoBanco: ext.saldo,
    saldoEm: ext.saldoEm,
    saldoSistema,
    itens,
  };
}

// ── Importar (grava as decisões) ────────────────────────────────────────────

export async function importarExtrato(
  e: Espaco,
  contaId: number,
  decisoes: FinExtratoDecisao[]
): Promise<{ ligados: number; baixados: number; novos: number; ignorados: number; erros: string[] }> {
  const conta = await obterConta(pool, e, contaId, ["banco", "corretora", "cartao"], "conta do extrato");
  const f = esp(e);
  const out = { ligados: 0, baixados: 0, novos: 0, ignorados: 0, erros: [] as string[] };
  /** Marca o lançamento com a linha do extrato. */
  const marcar = (id: number, fitid: string) =>
    pool.query(`UPDATE fin_lancamentos SET chave_externa = ?, extrato_contaid = ? WHERE id = ? AND chave_externa IS NULL`, [fitid, conta.id, id]);
  for (const d of decisoes) {
    const rot = `${d.data.slice(8, 10)}/${d.data.slice(5, 7)} ${d.descricao}`;
    try {
      const v = Math.round(Math.abs(d.valor) * 100) / 100;
      if (d.acao === "ignorar") {
        await pool.query(`INSERT INTO fin_extrato_ignorados (contaid, fitid) VALUES (?, ?) ON CONFLICT DO NOTHING`, [conta.id, d.fitid]);
        out.ignorados++;
      } else if (d.acao === "ligar") {
        if (!d.lancamentoId) throw new FinErro("ligar", "Falta o lançamento a ligar.");
        const [ok] = await pool.query<RowDataPacket[]>(`SELECT id FROM fin_lancamentos WHERE id = ? AND ${f.sql}`, [d.lancamentoId, ...f.params]);
        if (!ok[0]) throw new FinErro("ligar", "Lançamento não encontrado.");
        await marcar(d.lancamentoId, d.fitid);
        out.ligados++;
      } else if (d.acao === "baixar") {
        const partes = (d.alvoChave ?? "").split(":");
        let lancId: number | null = null;
        if (partes[0] === "f") {
          lancId = (await pagarFatura(e, { cartaoId: Number(partes[1]), vencimento: partes[2], data: d.data, valor: v, contaPagamentoId: conta.id })).id;
        } else if (partes[0] === "t" || partes[0] === "r") {
          const r = await baixar(e, {
            ...(partes[0] === "t" ? { tituloId: Number(partes[1]) } : { recorrenciaId: Number(partes[1]), referencia: partes.slice(2).join(":") }),
            data: d.data,
            valorPago: v,
            contaPagamentoId: conta.id,
            modo: "quitar",
          });
          const [l] = await pool.query<RowDataPacket[]>(
            `SELECT id FROM fin_lancamentos WHERE tituloid = ? AND (conta_origemid = ? OR conta_destinoid = ?) ORDER BY id LIMIT 1`,
            [r.tituloId, conta.id, conta.id]
          );
          lancId = l[0] ? Number(l[0].id) : null;
        } else throw new FinErro("baixar", "Falta a conta em aberto.");
        if (lancId) await marcar(lancId, d.fitid);
        out.baixados++;
      } else {
        if (!d.contraContaId) throw new FinErro("novo", "Escolha o grupo ou a conta.");
        const contra = await obterConta(pool, e, d.contraContaId, ["despesa", "receita", "banco", "corretora", "cartao", "investimento"], "grupo ou conta");
        if (contra.id === conta.id) throw new FinErro("novo", "O outro lado não pode ser a própria conta.");
        const saida = d.valor < 0;
        await pool.query(
          `INSERT INTO fin_lancamentos (groupid, userid, data, descricao, valor, conta_origemid, conta_destinoid, chave_externa, extrato_contaid)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [e.groupId, e.userId, d.data, d.descricao.slice(0, 200), v, saida ? conta.id : contra.id, saida ? contra.id : conta.id, d.fitid, conta.id]
        );
        out.novos++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      out.erros.push(`${rot}: ${/duplicate key|unique/i.test(msg) ? "esta linha já foi importada" : msg}`);
    }
  }
  return out;
}
