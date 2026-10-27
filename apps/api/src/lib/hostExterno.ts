import { lookup } from "node:dns/promises";
import net from "node:net";

/**
 * Conexão de banco cadastrada por owner (não admin) deve apontar para um servidor externo — nunca
 * para a rede interna do próprio MyMemory (localhost, IPs privados, metadados da nuvem, nomes de
 * container sem domínio).
 */
function ipInterno(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return ipInterno(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

/** Motivo para recusar o host (null = é externo). */
export async function motivoHostInterno(host: string): Promise<string | null> {
  const h = host.trim().replace(/^\[|\]$/g, "").replace(/\\.*$/, ""); // "srv\INSTANCIA" → "srv"
  if (!h) return "Informe o servidor.";
  if (!net.isIP(h) && !h.includes(".")) return "Use o endereço completo do servidor (domínio ou IP público).";
  let ips: string[];
  try {
    ips = net.isIP(h) ? [h] : (await lookup(h, { all: true })).map((r) => r.address);
  } catch {
    return `Não foi possível localizar o servidor "${h}".`;
  }
  return ips.some(ipInterno)
    ? "Endereço interno não é permitido. Use o endereço público do servidor do ERP (ou peça ao administrador)."
    : null;
}
