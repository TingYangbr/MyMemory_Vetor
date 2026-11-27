/**
 * "Resultado da reunião com Carlos: fechamos o orçamento em 12 mil" no Fale comigo: acha a reunião que já passou
 * (até 14 dias, sem resultado ligado) e oferece registrar o texto como resultado dela — o Catalogar abre com o
 * texto e, ao salvar, liga à reunião e a conclui. Regra, sem IA; nada é gravado aqui.
 */
import type { RowDataPacket } from "../lib/dbTypes.js";
import type { ResultadoReuniaoOferta } from "@mymemory/shared";
import { pool } from "../db.js";
import { reunioesSemResultado } from "./lembreteService.js";

const semAcento = (s: string) => s.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();

const RE_PEDIDO =
  /^\s*(?:o\s+|registr\w*\s+(?:o\s+)?)?resultados?\s+d[aoe]s?\s+(?:minha\s+|nossa\s+|ultima\s+)?(reuniao|compromisso|visita|consulta|encontro|call|agenda|conversa)\b(.*)$/i;

const VAZIAS = new Set([
  "com", "para", "pra", "hoje", "ontem", "anteontem", "dia", "que", "foi", "dos", "das", "nos", "nas", "uma", "sobre",
  "sobre", "ultima", "manha", "tarde", "noite", "semana", "passada", "esta", "essa", "aquela", "reuniao",
]);

export function pedeResultadoReuniao(pergunta: string): { alvo: string } | null {
  const m = RE_PEDIDO.exec(semAcento(pergunta));
  if (!m) return null;
  // Quem/qual reunião: o que vem antes de ":" (ou a frase toda, se não houver ":")
  const resto = m[2] ?? "";
  const alvo = resto.split(/[:\n]|\s+-\s+/)[0] ?? "";
  return { alvo };
}

function quandoBR(d: Date): string {
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export async function ofertaResultadoReuniao(input: {
  userId: number;
  pergunta: string;
  alvo: string;
}): Promise<ResultadoReuniaoOferta> {
  const [u] = await pool.query<RowDataPacket[]>(`SELECT email FROM users WHERE id = ?`, [input.userId]);
  const reunioes = await reunioesSemResultado(input.userId, String(u[0]?.email ?? ""), "sempre", { paraFala: true, dias: 14 });
  const base = { texto: input.pergunta.trim() };
  if (!reunioes.length) {
    return {
      ...base,
      mensagem:
        "Não achei reunião dos últimos 14 dias esperando o resultado. Posso guardar o texto pelo Catalogar, sem ligar a uma reunião.",
      opcoes: [],
    };
  }
  const ids = reunioes.map((r) => r.memoId);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, NULLIF(titulo_curto, '') AS "titulo", mediatext AS "texto", dadosespecificosjson AS "dados" FROM memos WHERE id = ANY(?::int[])`,
    [ids]
  );
  const info = new Map(rows.map((r) => [Number(r.id), r]));
  const termos = semAcento(input.alvo)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !VAZIAS.has(w));
  const pontuadas = reunioes.map((r) => {
    const i = info.get(r.memoId);
    const alvoTexto = semAcento(`${i?.titulo ?? ""} ${i?.texto ?? ""} ${i?.dados ?? ""}`);
    const pontos = termos.filter((t) => alvoTexto.includes(t)).length;
    return { r, pontos, titulo: String(i?.titulo ?? i?.texto ?? "").replace(/\s+/g, " ").slice(0, 80) };
  });
  const melhor = Math.max(0, ...pontuadas.map((p) => p.pontos));
  let escolhidas = melhor > 0 ? pontuadas.filter((p) => p.pontos === melhor) : pontuadas;
  // Citou alguém que não está em nenhuma reunião: mostra as mais recentes para escolher
  escolhidas = escolhidas.slice(0, 5);
  const opcoes = escolhidas.map((p) => ({
    memoId: p.r.memoId,
    categoria: p.r.categoria,
    titulo: p.titulo || `${p.r.categoria} #${p.r.memoId}`,
    quando: quandoBR(p.r.momento),
  }));
  const mensagem =
    opcoes.length === 1
      ? `Registrar como resultado de: ${opcoes[0]!.titulo} (${opcoes[0]!.quando})?`
      : termos.length && melhor === 0
        ? "Não achei a reunião citada. Qual destas é?"
        : "Qual reunião?";
  return { ...base, mensagem, opcoes };
}
