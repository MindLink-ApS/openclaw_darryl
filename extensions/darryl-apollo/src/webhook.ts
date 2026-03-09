import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { filterUsablePhones } from "./client.js";
import type { ApolloUsageDB } from "./db.js";
import type { ApolloWebhookPayload } from "./types.js";

interface ResolvedLead {
  lead_name: string;
  lead_company: string;
  email: string | null;
  phone: string;
  phone_type: string;
  lead_id: number;
}

// ---------------------------------------------------------------------------
// Webhook handler — receives Apollo async phone callbacks
// ---------------------------------------------------------------------------

export function createWebhookHandler(params: {
  db: ApolloUsageDB;
  leadsDbPath: string;
  hooksToken: string;
  gatewayPort: number;
}): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const { db, leadsDbPath, hooksToken, gatewayPort } = params;

  return async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return true;
    }

    let body: ApolloWebhookPayload;
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return true;
    }

    if (!body.people?.length) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, resolved: 0 }));
      return true;
    }

    const resolvedLeads: ResolvedLead[] = [];

    // Open leads DB for cross-DB write
    const req2 = createRequire(import.meta.url);
    const { DatabaseSync } = req2("node:sqlite") as typeof import("node:sqlite");
    const leadsDb = new DatabaseSync(leadsDbPath);

    try {
      leadsDb.exec("PRAGMA journal_mode=WAL;");

      for (const person of body.people) {
        const pending = db.getPendingByApolloId(person.id);
        if (!pending) continue; // Not ours or already resolved — idempotent

        const usablePhone = filterUsablePhones(person.phone_numbers);
        if (!usablePhone) {
          db.failPendingPhone(person.id);
          continue;
        }

        // Resolve pending record
        db.resolvePendingPhone({
          apollo_person_id: person.id,
          phone_number: usablePhone.sanitized_number,
          phone_type: usablePhone.type_cd ?? "mobile",
          delivered_individually: true,
        });

        // Promote lead in leads DB
        leadsDb
          .prepare(
            `UPDATE leaders SET mobile_phone = ?, status_pipeline = 'new'
             WHERE id = ? AND (status_pipeline = 'awaiting_phone' OR mobile_phone IS NULL)`,
          )
          .run(usablePhone.sanitized_number, pending.internal_lead_id);

        // Fallback: update by name+company if internal_lead_id was 0 (new lead without ID)
        if (pending.internal_lead_id === 0) {
          leadsDb
            .prepare(
              `UPDATE leaders SET mobile_phone = ?, status_pipeline = 'new'
               WHERE lower(trim(full_name)) = lower(trim(?))
                 AND lower(replace(trim(current_company), '.', '')) = lower(replace(trim(?), '.', ''))
                 AND status_pipeline = 'awaiting_phone'
                 AND mobile_phone IS NULL`,
            )
            .run(usablePhone.sanitized_number, pending.lead_name, pending.lead_company);
        }

        resolvedLeads.push({
          lead_name: pending.lead_name,
          lead_company: pending.lead_company,
          email: pending.email_found,
          phone: usablePhone.sanitized_number,
          phone_type: usablePhone.type_cd ?? "mobile",
          lead_id: pending.internal_lead_id,
        });
      }
    } finally {
      leadsDb.close();
    }

    // Dispatch agent turn for immediate delivery to Darryl
    if (resolvedLeads.length > 0) {
      await dispatchAgentTurn(resolvedLeads, hooksToken, gatewayPort);
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, resolved: resolvedLeads.length }));
    return true;
  };
}

// ---------------------------------------------------------------------------
// Agent dispatch — wake Emma to send Darryl the now-complete lead(s)
// ---------------------------------------------------------------------------

async function dispatchAgentTurn(
  leads: ResolvedLead[],
  hooksToken: string,
  gatewayPort: number,
): Promise<void> {
  let message: string;

  if (leads.length === 1) {
    const l = leads[0];
    message = [
      "Apollo phone webhook just delivered a mobile number for a lead.",
      "The lead is now complete with both email and phone.",
      "",
      `Lead ID: ${l.lead_id}`,
      `Name: ${l.lead_name}`,
      `Company: ${l.lead_company}`,
      `Email: ${l.email}`,
      `Phone: ${l.phone} (${l.phone_type})`,
      "",
      "Send Darryl a brief email RIGHT NOW with this lead's full contact details.",
      "Use leads_get to fetch the complete record (title, LinkedIn, geography, etc.)",
      "and email_send to deliver.",
      `Subject line: "New Lead: ${l.lead_name} — ${l.lead_company}"`,
      "Keep it short. Include all contact info inline. No CSV attachment for a single lead.",
    ].join("\n");
  } else {
    const leadList = leads
      .map(
        (l) =>
          `- ${l.lead_name} at ${l.lead_company} (ID: ${l.lead_id}, email: ${l.email}, phone: ${l.phone})`,
      )
      .join("\n");
    message = [
      `Apollo phone webhook delivered phone numbers for ${leads.length} leads.`,
      "All are now complete with both email and phone.",
      "",
      leadList,
      "",
      "Send Darryl ONE email listing all of them.",
      "Use leads_get for each to get full details (title, LinkedIn, geography, etc.).",
      `Subject: "${leads.length} New Leads Ready"`,
      "Keep it concise. Include all contact info inline.",
    ].join("\n");
  }

  try {
    await fetch(`http://localhost:${gatewayPort}/hooks/agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hooksToken}`,
      },
      body: JSON.stringify({ message, name: "Apollo Lead Update" }),
    });
  } catch (err) {
    console.warn("darryl-apollo: agent dispatch failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
