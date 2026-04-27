import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { filterUsablePhones } from "./client.js";
import type { ApolloUsageDB } from "./db.js";
import type { ApolloWebhookPayload } from "./types.js";

// ---------------------------------------------------------------------------
// Webhook handler — receives Apollo async phone callbacks
// ---------------------------------------------------------------------------

export function createWebhookHandler(params: {
  db: ApolloUsageDB;
  leadsDbPath: string;
}): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const { db, leadsDbPath } = params;

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

    const resolved = handleApolloWebhookPayload({ db, leadsDbPath, body });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, resolved }));
    return true;
  };
}

// ---------------------------------------------------------------------------
// Webhook resolution — update DB only. Delivery happens in daily reports.
// ---------------------------------------------------------------------------

export function handleApolloWebhookPayload(params: {
  db: ApolloUsageDB;
  leadsDbPath: string;
  body: ApolloWebhookPayload;
}): number {
  const { db, leadsDbPath, body } = params;
  const req2 = createRequire(import.meta.url);
  const { DatabaseSync } = req2("node:sqlite") as typeof import("node:sqlite");
  const leadsDb = new DatabaseSync(leadsDbPath);
  let resolved = 0;

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

      db.resolvePendingPhone({
        apollo_person_id: person.id,
        phone_number: usablePhone.sanitized_number,
        phone_type: usablePhone.type_cd ?? "mobile",
        delivered_individually: false,
      });

      leadsDb
        .prepare(
          `UPDATE leaders SET mobile_phone = ?, status_pipeline = 'new'
           WHERE id = ? AND (status_pipeline = 'awaiting_phone' OR mobile_phone IS NULL)`,
        )
        .run(usablePhone.sanitized_number, pending.internal_lead_id);

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

      resolved++;
    }
  } finally {
    leadsDb.close();
  }

  return resolved;
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
