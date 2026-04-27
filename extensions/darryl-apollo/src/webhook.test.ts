import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LeadsDB } from "../../darryl-leads/src/db.js";
import { ApolloUsageDB } from "./db.js";
import { handleApolloWebhookPayload } from "./webhook.js";

describe("darryl apollo webhook", () => {
  let tmpDir: string;
  let apolloDb: ApolloUsageDB;
  let leadsDb: LeadsDB;
  let leadsDbPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "darryl-apollo-webhook-"));
    leadsDbPath = path.join(tmpDir, "leads.db");
    apolloDb = new ApolloUsageDB(path.join(tmpDir, "apollo.db"));
    leadsDb = new LeadsDB(leadsDbPath);
  });

  afterEach(async () => {
    apolloDb.close();
    leadsDb.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("promotes awaiting leads silently when Apollo phone webhook resolves", () => {
    const lead = leadsDb.upsert({
      full_name: "Jane Doe",
      current_title: "VP Distribution",
      current_company: "Acme P&C",
      linkedin_url: "https://linkedin.com/in/jane-doe",
      source_published_date: "2026-04-20",
      email_address: "jane.doe@example.com",
      status_pipeline: "awaiting_phone",
    });

    apolloDb.insertPendingPhone({
      apollo_person_id: "apollo-person-1",
      internal_lead_id: lead.id,
      lead_name: "Jane Doe",
      lead_company: "Acme P&C",
      email_found: "jane.doe@example.com",
    });

    const resolved = handleApolloWebhookPayload({
      db: apolloDb,
      leadsDbPath,
      body: {
        people: [
          {
            id: "apollo-person-1",
            phone_numbers: [
              {
                sanitized_number: "+16155550123",
                type_cd: "mobile",
                status_cd: "valid_number",
                confidence_cd: "high",
              },
            ],
          },
        ],
      },
    });

    expect(resolved).toBe(1);
    const stored = leadsDb.getById(lead.id);
    expect(stored?.mobile_phone).toBe("+16155550123");
    expect(stored?.status_pipeline).toBe("new");

    const stats = apolloDb.getUsageStats(100, 50);
    expect(stats.delivered_individually).toBe(0);
    expect(stats.hit_rates.phone_received_via_webhook).toBe(1);
  });
});
