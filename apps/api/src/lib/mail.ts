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

/**
 * Convite para grupo (marca proMemory). Duas versões, escolhidas no envio:
 * - temConta: a pessoa já tem conta com este e-mail → entrar e aceitar;
 * - sem conta: criar a conta com este e-mail → o grupo é aceito ao entrar.
 * Uma ação só por e-mail, para não deixar a pessoa escolher o caminho errado.
 */
export async function sendGroupInviteEmail(
  to: string,
  opts: {
    groupName: string;
    inviterName: string | null;
    temConta: boolean;
    actionUrl: string;
    resetUrl: string;
    expiresAt: Date;
  }
): Promise<void> {
  const { groupName, inviterName, temConta, actionUrl, resetUrl, expiresAt } = opts;
  const validade = expiresAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const de = inviterName?.trim() ? ` de <strong>${escapeHtml(inviterName.trim())}</strong>` : "";
  const deTxt = inviterName?.trim() ? ` de ${inviterName.trim()}` : "";
  const grupo = escapeHtml(groupName);
  const emailHtml = escapeHtml(to);
  const botao = (rotulo: string) =>
    `<p style="margin:20px 0"><a href="${actionUrl}" style="display:inline-block;background:#0d9488;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:8px">${rotulo}</a></p>`;
  const rodape = (extra: string) =>
    `<p style="margin-top:24px;font-size:13px;color:#6B7280">${extra}O convite vale até ${validade}. Se não esperava este convite, ignore este e-mail.</p>`;

  const html = temConta
    ? `
    <p>Olá!</p>
    <p>Você recebeu um convite${de} para participar do grupo <strong>${grupo}</strong> no proMemory.</p>
    <p>Para aceitar, entre na sua conta do proMemory (<strong>${emailHtml}</strong>).</p>
    ${botao("Entrar e aceitar o convite")}
    ${rodape(`Esqueceu a senha? <a href="${resetUrl}">Redefinir senha</a> · `)}
  `
    : `
    <p>Olá!</p>
    <p>Você recebeu um convite${de} para participar do grupo <strong>${grupo}</strong> no proMemory.</p>
    <p>Para aceitar, crie sua conta do proMemory com este e-mail (<strong>${emailHtml}</strong>). Leva 2 minutos.</p>
    ${botao("Criar minha conta e aceitar o convite")}
    <p>Depois de confirmar seu e-mail, você já entra no grupo.</p>
    ${rodape("")}
  `;
  const text = temConta
    ? `Olá!

Você recebeu um convite${deTxt} para participar do grupo "${groupName}" no proMemory.

Para aceitar, entre na sua conta do proMemory (${to}):
${actionUrl}

Esqueceu a senha? ${resetUrl}
O convite vale até ${validade}. Se não esperava este convite, ignore este e-mail.`
    : `Olá!

Você recebeu um convite${deTxt} para participar do grupo "${groupName}" no proMemory.

Para aceitar, crie sua conta do proMemory com este e-mail (${to}). Leva 2 minutos:
${actionUrl}

Depois de confirmar seu e-mail, você já entra no grupo.
O convite vale até ${validade}. Se não esperava este convite, ignore este e-mail.`;
  const client = getResend();
  const { data, error } = await client.emails.send({
    from: config.emailFrom,
    to: [to],
    subject: `Convite para o grupo ${groupName} no proMemory`,
    html,
    text,
  });
  if (error) throw new Error(`Resend: ${formatResendError(error)}`);
  const id = data && typeof data === "object" && "id" in data ? String((data as { id: string }).id) : null;
  console.info("[mail] Convite de grupo (%s) aceito pelo Resend (id=%s) → %s", temConta ? "com conta" : "sem conta", id ?? "?", to);
}

export async function sendUserInviteEmail(
  to: string,
  opts: { registerUrl: string }
): Promise<void> {
  const { registerUrl } = opts;
  const html = `
    <p>Olá,</p>
    <p>Um administrador do <strong>MyMemory</strong> convidou você para criar uma conta pessoal na plataforma.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      <tr>
        <td style="border:2px solid #4F46E5;border-radius:8px;padding:16px 20px;background:#F5F5FF">
          <p style="margin:0 0 6px 0;font-size:16px;font-weight:700;color:#1F2937">Criar minha conta</p>
          <p style="margin:0 0 12px 0;font-size:14px;color:#374151">Escolha seu plano individual e conclua o cadastro. O convite expira em 14 dias.</p>
          <a href="${registerUrl}" style="display:inline-block;background:#4F46E5;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 20px;border-radius:6px">Criar conta →</a>
        </td>
      </tr>
    </table>
    <p style="margin-top:20px;font-size:13px;color:#6B7280">Se não esperava este convite, pode ignorar este e-mail.</p>
  `;
  const text = `Olá,\n\nUm administrador do MyMemory convidou você para criar uma conta pessoal.\n\nAcesse o link abaixo para escolher seu plano e concluir o cadastro (válido por 14 dias):\n${registerUrl}\n\nSe não esperava este convite, pode ignorar este e-mail.`;
  const client = getResend();
  const { data, error } = await client.emails.send({
    from: config.emailFrom,
    to: [to],
    subject: "Convite para criar sua conta — MyMemory",
    html,
    text,
  });
  if (error) throw new Error(`Resend: ${formatResendError(error)}`);
  const id = data && typeof data === "object" && "id" in data ? String((data as { id: string }).id) : null;
  console.info("[mail] Convite de usuário aceito pelo Resend (id=%s) → %s", id ?? "?", to);
}

export async function sendAvisoAlert(opts: {
  to: string;
  descricao: string;
  perguntaOriginal: string;
  texto: string;
  textoHtml?: string;
  linkVisualizacao: string;
}): Promise<void> {
  const { to, descricao, perguntaOriginal, texto, textoHtml, linkVisualizacao } = opts;
  const corpoHtml = textoHtml ?? escapeHtml(texto).replace(/\n/g, "<br>");
  const html = `
    <p style="margin:0 0 8px;color:#374151;font-size:14px">Olá,</p>
    <p style="margin:0 0 4px;color:#374151;font-size:14px">Detectada alteração na sua pergunta:</p>
    <blockquote style="border-left:3px solid #9CA3AF;margin:8px 0 16px;padding:8px 16px;background:#F9FAFB;color:#374151;font-style:italic;font-size:14px">
      ${escapeHtml(perguntaOriginal)}
    </blockquote>
    <div style="border-left:3px solid #4F46E5;margin:16px 0;padding:8px 16px;background:#F5F5FF;color:#1F2937;font-size:14px;line-height:1.6">
      ${corpoHtml}
    </div>
    <p style="margin:20px 0">
      <a href="${linkVisualizacao}" style="display:inline-block;background:#4F46E5;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 20px;border-radius:6px">
        Ver no MyMemory →
      </a>
    </p>
    <p style="font-size:12px;color:#9CA3AF;margin-top:24px">
      Aviso: ${escapeHtml(descricao)}<br>
      Você recebeu este e-mail pois tem um aviso ativo no MyMemory.
      Acesse a plataforma para pausar ou excluir este aviso.
    </p>
  `;
  const text = `Detectada alteração na sua pergunta:\n"${perguntaOriginal}"\n\n${texto}\n\nVer no MyMemory: ${linkVisualizacao}`;
  const client = getResend();
  const { data, error } = await client.emails.send({
    from: config.emailFrom,
    to: [to],
    subject: `Aviso: ${descricao} — MyMemory`,
    html,
    text,
  });
  if (error) throw new Error(`Resend: ${formatResendError(error)}`);
  const id = data && typeof data === "object" && "id" in data ? String((data as { id: string }).id) : null;
  console.info("[mail] Aviso aceito pelo Resend (id=%s) → %s", id ?? "?", to);
}

/** Lembrete de compromisso/vencimento (lembreteService). Um destinatário por envio. */
export async function sendLembreteEmail(opts: { to: string; subject: string; html: string; text: string }): Promise<void> {
  const client = getResend();
  const { data, error } = await client.emails.send({
    from: config.emailFrom,
    to: [opts.to],
    subject: `${opts.subject} — MyMemory`,
    html: opts.html,
    text: opts.text,
  });
  if (error) throw new Error(`Resend: ${formatResendError(error)}`);
  const id = data && typeof data === "object" && "id" in data ? String((data as { id: string }).id) : null;
  console.info("[mail] Lembrete aceito pelo Resend (id=%s) → %s", id ?? "?", opts.to);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
