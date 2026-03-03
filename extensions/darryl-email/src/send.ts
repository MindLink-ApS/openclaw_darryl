import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

export type SmtpConfig = {
  host: string;
  port: number;
  secure?: boolean;
  user: string;
  pass: string;
  from: string;
};

export function createTransporter(cfg: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure ?? false,
    auth: { user: cfg.user, pass: cfg.pass },
  });
}

export type SendEmailOpts = {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
};

export type SendEmailWithCsvOpts = SendEmailOpts & {
  csvFilePath: string;
  csvFileName: string;
};

export type SendResult = {
  messageId: string;
  accepted: string[];
};

// Required Raymond James compliance disclosure appended to all outbound emails
const RJ_DISCLOSURE =
  "\n\n---\nThis is not a solicitation to buy or sell securities. " +
  "Securities offered through Raymond James Financial Services, Inc., member FINRA/SIPC.";

export async function sendEmail(
  transporter: Transporter,
  from: string,
  opts: SendEmailOpts,
): Promise<SendResult> {
  const info = await transporter.sendMail({
    from,
    to: opts.to,
    cc: opts.cc,
    bcc: opts.bcc,
    subject: opts.subject,
    text: opts.body + RJ_DISCLOSURE,
  });
  return { messageId: info.messageId, accepted: info.accepted as string[] };
}

export async function sendEmailWithCsv(
  transporter: Transporter,
  from: string,
  opts: SendEmailWithCsvOpts,
): Promise<SendResult> {
  const info = await transporter.sendMail({
    from,
    to: opts.to,
    cc: opts.cc,
    bcc: opts.bcc,
    subject: opts.subject,
    text: opts.body + RJ_DISCLOSURE,
    attachments: [
      {
        filename: opts.csvFileName,
        path: opts.csvFilePath,
        contentType: "text/csv",
      },
    ],
  });
  return { messageId: info.messageId, accepted: info.accepted as string[] };
}
