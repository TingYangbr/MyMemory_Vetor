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
    <p style="margin-bottom:8px"><strong>Escolha a opção correta para você:</strong></p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      <tr>
        <td style="border:2px solid #4F46E5;border-radius:8px;padding:16px 20px;background:#F5F5FF">
          <p style="margin:0 0 4px 0;font-size:13px;color:#6B7280;text-transform:uppercase;letter-spacing:.05em">OPÇÃO 1</p>
          <p style="margin:0 0 6px 0;font-size:16px;font-weight:700;color:#1F2937">Ainda não tenho conta</p>
          <p style="margin:0 0 12px 0;font-size:14px;color:#374151">Crie sua conta e escolha o plano individual. Após confirmar o e-mail e entrar, o grupo é aceito automaticamente.</p>
          <a href="${registerStartUrl}" style="display:inline-block;background:#4F46E5;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 20px;border-radius:6px">Criar conta →</a>
        </td>
      </tr>
      <tr><td style="height:12px"></td></tr>
      <tr>
        <td style="border:2px solid #059669;border-radius:8px;padding:16px 20px;background:#F0FDF4">
          <p style="margin:0 0 4px 0;font-size:13px;color:#6B7280;text-transform:uppercase;letter-spacing:.05em">OPÇÃO 2</p>
          <p style="margin:0 0 6px 0;font-size:16px;font-weight:700;color:#1F2937">Já tenho conta cadastrada</p>
          <p style="margin:0 0 12px 0;font-size:14px;color:#374151">Entre com a conta associada a este e-mail e aceite o convite.</p>
          <a href="${loginUrl}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 20px;border-radius:6px">Entrar e aceitar →</a>
        </td>
      </tr>
    </table>
    <p style="margin-top:20px;font-size:13px;color:#6B7280">O convite expira em 14 dias. Se não foi você, ignore este e-mail.</p>
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
