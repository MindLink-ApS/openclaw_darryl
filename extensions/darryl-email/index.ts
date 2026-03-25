import { Type } from "@sinclair/typebox";
import type { Transporter } from "nodemailer";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { checkInbox } from "./src/inbox.js";
import { createTransporter, sendEmail, sendEmailWithCsv, type SmtpConfig } from "./src/send.js";

const plugin = {
  id: "darryl-email",
  name: "Darryl Email",
  description: "Outbound email via SMTP",

  register(api: OpenClawPluginApi) {
    const cfg = api.pluginConfig as Partial<SmtpConfig> | undefined;

    const host = cfg?.host;
    const port = cfg?.port;
    const user = cfg?.user;
    const pass = cfg?.pass;
    const from = cfg?.from;

    const missing: string[] = [];
    if (!host) missing.push("host");
    if (port === undefined || port === null) missing.push("port");
    if (!user) missing.push("user");
    if (!pass) missing.push("pass");
    if (!from) missing.push("from");

    if (missing.length > 0) {
      api.logger.warn(
        `[darryl-email] Missing required config fields: ${missing.join(", ")}. Email tools will fail until configured.`,
      );
    }

    const smtpConfig: SmtpConfig = {
      host: host ?? "",
      port: port ?? 587,
      secure: cfg?.secure,
      user: user ?? "",
      pass: pass ?? "",
      from: from ?? "",
    };

    let transporter: Transporter | null = null;

    function ensureTransporter(): Transporter {
      if (!transporter) {
        if (!smtpConfig.host || !smtpConfig.user || !smtpConfig.pass || !smtpConfig.from) {
          throw new Error("SMTP not configured. Set host, user, pass, and from in plugin config.");
        }
        transporter = createTransporter(smtpConfig);
      }
      return transporter;
    }

    // --- email_send tool ---
    api.registerTool({
      name: "email_send",
      label: "Send Email",
      description: "Send a plain-text email via SMTP. Requires SMTP credentials in plugin config.",
      parameters: Type.Object({
        to: Type.String({ description: "Recipient email address." }),
        subject: Type.String({ description: "Email subject line." }),
        body: Type.String({ description: "Plain-text email body." }),
        cc: Type.Optional(Type.String({ description: "CC recipient(s)." })),
        bcc: Type.Optional(Type.String({ description: "BCC recipient(s)." })),
      }),
      async execute(_toolCallId, params) {
        const p = params as {
          to: string;
          subject: string;
          body: string;
          cc?: string;
          bcc?: string;
        };
        const t = ensureTransporter();
        const result = await sendEmail(t, smtpConfig.from, {
          to: p.to,
          subject: p.subject,
          body: p.body,
          cc: p.cc,
          bcc: p.bcc,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, ...result }),
            },
          ],
        };
      },
    });

    // --- email_send_csv tool ---
    api.registerTool({
      name: "email_send_csv",
      label: "Send Email with CSV",
      description: "Send a plain-text email with a CSV file attachment via SMTP.",
      parameters: Type.Object({
        to: Type.String({ description: "Recipient email address." }),
        subject: Type.String({ description: "Email subject line." }),
        body: Type.String({ description: "Plain-text email body." }),
        csvFilePath: Type.String({ description: "Absolute path to the CSV file to attach." }),
        csvFileName: Type.String({ description: "Filename for the CSV attachment." }),
        cc: Type.Optional(Type.String({ description: "CC recipient(s)." })),
        bcc: Type.Optional(Type.String({ description: "BCC recipient(s)." })),
      }),
      async execute(_toolCallId, params) {
        const p = params as {
          to: string;
          subject: string;
          body: string;
          csvFilePath: string;
          csvFileName: string;
          cc?: string;
          bcc?: string;
        };
        const t = ensureTransporter();
        const result = await sendEmailWithCsv(t, smtpConfig.from, {
          to: p.to,
          subject: p.subject,
          body: p.body,
          csvFilePath: p.csvFilePath,
          csvFileName: p.csvFileName,
          cc: p.cc,
          bcc: p.bcc,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, ...result }),
            },
          ],
        };
      },
    });

    // --- email_inbox_check tool ---
    api.registerTool({
      name: "email_inbox_check",
      label: "Check Inbox",
      description:
        "Check for recent unread emails in the Gmail inbox. Returns unread messages from the last 24 hours. Use during heartbeat to catch emails missed by push notifications.",
      parameters: Type.Object({
        max_results: Type.Optional(
          Type.Number({
            description: "Maximum number of emails to return. Default: 50.",
            default: 50,
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const p = params as { max_results?: number };
        const account = smtpConfig.user;
        if (!account) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  error: "No Gmail account configured (SMTP user not set)",
                }),
              },
            ],
          };
        }
        const result = await checkInbox(account, p.max_results ?? 50);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      },
    });

    // --- SMTP verification service ---
    api.registerService({
      id: "darryl-email",
      start: async () => {
        if (missing.length > 0) {
          api.logger.warn(
            `[darryl-email] Skipping SMTP verification — missing config: ${missing.join(", ")}`,
          );
          return;
        }
        try {
          const t = ensureTransporter();
          await t.verify();
          api.logger.info("[darryl-email] SMTP connection verified successfully.");
        } catch (err) {
          api.logger.error(
            `[darryl-email] SMTP verification failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    });
  },
};

export default plugin;
