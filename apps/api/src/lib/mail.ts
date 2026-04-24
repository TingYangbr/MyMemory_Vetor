import { Resend } from "resend";
import { config } from "../config.js";

let resendClient: Resend | null = null;

function getResend(): Resend {
  if (!config.resendApiKey) {
    throw new Error(
      "RESEND_API_KEY não configurada. Crie apps/api/.env com RESEND_API_KEY (a API agora carrega esse arquivo sempre)."
    );
  }
  if (!resendClient) resendClient = new Resend(config.resendApiKey);
  return resendClient;
}

function formatResendError(error: unknown): string {
  if (error == null) return "Erro desconhecido do Resend.";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  const o = error as { message?: unknown; name?: string };
  if (typeof o.message === "string") return o.message;
  if (Array.isArray(o.message)) return JSON.stringify(o.message);
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export async function sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
  const html = `
    <p>Olá,</p>
    <p>Confirme seu e-mail no MyMemory clicando no link abaixo:</p>
    <p><a href="${verifyUrl}">Confirmar e-mail</a></p>
    <p>Se você não criou uma conta, ignore este e-mail.</p>
  `;
  const text = `Confirme seu e-mail no MyMemory abrindo este link no navegador:\n${verifyUrl}\n\nSe você não criou uma conta, ignore este e-mail.`;
  const client = getResend();
  const { data, error } = await client.emails.send({
    from: config.emailFrom,
    to: [to],
    subject: "Confirme seu e-mail — MyMemory",
    html,
    text,
  });
  if (error) throw new Error(`Resend: ${formatResendError(error)}`);
  const id = data && typeof data === "object" && "id" in data ? String((data as { id: string }).id) : null;
  if (!id) {
    console.warn("[mail] Resend não devolveu id do e-mail — resposta inesperada", { data });
  }
  console.info("[mail] Verificação aceita pelo Resend (id=%s) → %s", id ?? "?", to);
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const html = `
    <p>Olá,</p>
    <p>Recebemos um pedido para redefinir sua senha no MyMemory.</p>
    <p><a href="${resetUrl}">Redefinir senha</a></p>
    <p>O link expira em breve. Se não foi você, ignore este e-mail.</p>
  `;
  const text = `Redefinir senha no MyMemory:\n${resetUrl}\n\nSe não foi você, ignore este e-mail.`;
  const client = getResend();
  const { data, error } = await client.emails.send({
    from: config.emailFrom,
    to: [to],
    subject: "Redefinir senha — MyMemory",
    html,
    text,
  });
  if (error) throw new Error(`Resend: ${formatResendError(error)}`);
  const id = data && typeof data === "object" && "id" in data ? String((data as { id: string }).id) : null;
  console.info("[mail] Redefinição aceita pelo Resend (id=%s) → %s", id ?? "?", to);
}

export async function sendGroupInviteEmail(
  to: string,
  opts: { groupName: string; loginUrl: string; registerStartUrl: string }
): Promise<void> {
  const { groupName, loginUrl, registerStartUrl } = opts;
  const html = `
    <p>Olá,</p>
    <p>Você foi convidado a participar do grupo <strong>${escapeHtml(groupName)}</strong> no MyMemory.</p>
    <p><strong>Se você ainda não tem conta:</strong><br>
    <a href="${registerStartUrl}">Criar conta e escolher plano individual</a>; depois de confirmar o e-mail e entrar, você entra no grupo automaticamente ao abrir o convite.</p>
    <p><strong>Se você já tem conta cadastrada:</strong><br>
    <a href="${loginUrl}">Entrar e aceitar o convite</a> (use a conta com este e-mail)</p>
    <p>O convite expira em 14 dias. Se não foi você, ignore este e-mail.</p>
  `;
  const text = `Olá,\n\nVocê foi convidado a participar do grupo "${groupName}" no MyMemory.\n\nSe você ainda não tem conta:\nCriar conta e escolher plano individual: ${registerStartUrl}\nDepois de confirmar o e-mail e entrar, você entra no grupo automaticamente ao abrir o convite.\n\nSe você já tem conta cadastrada:\nEntrar e aceitar o convite (use a conta com este e-mail): ${loginUrl}\n\nO convite expira em 14 dias. Se não foi você, ignore este e-mail.`;
  const client = getResend();
  const { data, error } = await client.emails.send({
    from: config.emailFrom,
    to: [to],
    subject: `Convite — grupo ${groupName} — MyMemory`,
    html,
    text,
  });
  if (error) throw new Error(`Resend: ${formatResendError(error)}`);
  const id = data && typeof data === "object" && "id" in data ? String((data as { id: string }).id) : null;
  console.info("[mail] Convite de grupo aceito pelo Resend (id=%s) → %s", id ?? "?", to);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
