import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Limite de tentativas em memória para as rotas de autenticação (login, cadastro, esqueci a
 * senha…): conta por IP e, quando há, por e-mail, numa janela de tempo. Uma instância da API.
 */
const contadores = new Map<string, { n: number; ate: number }>();

/** IP do cliente: o proxy (Traefik) acrescenta o IP real no fim de X-Forwarded-For. */
export function ipDoCliente(req: FastifyRequest): string {
  const xff = req.headers["x-forwarded-for"];
  const lista = (Array.isArray(xff) ? xff.join(",") : xff ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return lista[lista.length - 1] ?? req.ip;
}

function contar(chave: string, max: number, janelaMs: number, agora: number): number | null {
  const c = contadores.get(chave);
  if (!c || c.ate <= agora) {
    contadores.set(chave, { n: 1, ate: agora + janelaMs });
    return null;
  }
  c.n++;
  return c.n > max ? Math.ceil((c.ate - agora) / 1000) : null;
}

/**
 * Conta a tentativa nas regras dadas; se alguma estourou, responde 429 e devolve true
 * (a rota deve parar). `email` é opcional — conta também por conta.
 */
export function bloquearSeExcedeu(
  req: FastifyRequest,
  reply: FastifyReply,
  rota: string,
  regras: { porIp: [number, number]; porEmail?: [number, number] },
  email?: unknown
): boolean {
  const agora = Date.now();
  if (contadores.size > 50_000) {
    for (const [k, v] of contadores) if (v.ate <= agora) contadores.delete(k);
  }
  let espera = contar(`${rota}|ip|${ipDoCliente(req)}`, regras.porIp[0], regras.porIp[1], agora);
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (e && regras.porEmail) {
    espera = Math.max(espera ?? 0, contar(`${rota}|email|${e}`, regras.porEmail[0], regras.porEmail[1], agora) ?? 0) || null;
  }
  if (espera == null) return false;
  reply.header("Retry-After", String(espera));
  reply.code(429).send({
    error: "too_many_requests",
    message: `Muitas tentativas. Tente de novo em ${Math.ceil(espera / 60)} minuto(s).`,
  });
  return true;
}
