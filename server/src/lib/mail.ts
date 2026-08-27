// SMTP delivery. Mail is a side effect of a request, never its purpose: a dead
// mail server must not fail a booking, so every send here swallows its errors
// and logs them instead.
import { createTransport, type Transporter } from "nodemailer";
import { env } from "../env.ts";

export interface Attachment {
  filename: string;
  content: string;
  contentType: string;
}

export interface Mail {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  attachments?: Attachment[];
}

let transporter: Transporter | null = null;

/** Whether a host is configured. Without one, sends are logged and dropped. */
export function mailConfigured(): boolean {
  return env.smtp.host !== "";
}

function transport(): Transporter {
  if (!transporter) {
    transporter = createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      // Implicit TLS on 465; everything else upgrades with STARTTLS.
      secure: env.smtp.secure,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    });
  }
  return transporter;
}

/**
 * Sends one message. Resolves either way — the boolean says whether it went out,
 * for callers that want to tell the user (the invite flow does).
 */
export async function sendMail(mail: Mail): Promise<boolean> {
  const recipients = Array.isArray(mail.to) ? mail.to.filter(Boolean) : [mail.to];
  if (recipients.length === 0) return false;

  if (!mailConfigured()) {
    console.info(`[mail] not configured, dropping "${mail.subject}" to ${recipients.join(", ")}`);
    return false;
  }

  try {
    await transport().sendMail({
      from: env.smtp.from,
      to: recipients,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      replyTo: mail.replyTo,
      attachments: mail.attachments,
    });
    return true;
  } catch (error) {
    // Logged and swallowed: the caller's own work already succeeded.
    console.error(`[mail] failed to send "${mail.subject}" to ${recipients.join(", ")}:`, error);
    return false;
  }
}

/** Fire-and-forget for request paths that should not wait on the mail server. */
export function sendMailInBackground(mail: Mail): void {
  void sendMail(mail);
}
