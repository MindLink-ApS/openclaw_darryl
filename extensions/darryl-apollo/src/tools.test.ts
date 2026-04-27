import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApolloClient } from "./client.js";
import { ApolloUsageDB } from "./db.js";
import { createApolloTools } from "./tools.js";

type ToolResult = {
  content: Array<{ text: string }>;
};

function parseToolJson(result: unknown): Record<string, unknown> {
  const toolResult = result as ToolResult;
  return JSON.parse(toolResult.content[0]?.text ?? "{}") as Record<string, unknown>;
}

describe("darryl apollo tools qualification gate", () => {
  let tmpDir: string;
  let db: ApolloUsageDB;
  let matchCalls: number;
  let bulkCalls: number;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "darryl-apollo-tools-"));
    db = new ApolloUsageDB(path.join(tmpDir, "apollo.db"));
    matchCalls = 0;
    bulkCalls = 0;
  });

  afterEach(async () => {
    db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function tools() {
    const client = {
      async matchPerson() {
        matchCalls++;
        return { person: null };
      },
      async triggerAsyncPhone() {},
      async bulkMatchPeople() {
        bulkCalls++;
        return { matches: [] };
      },
      async triggerBulkAsyncPhone() {},
    } as unknown as ApolloClient;

    return createApolloTools({
      db,
      client,
      syncLimitDefault: 100,
      asyncPhoneLimitDefault: 50,
    });
  }

  it("skips single Apollo enrichment below the source threshold", async () => {
    const tool = tools().find((candidate) => candidate.name === "apollo_enrich");
    const result = await tool?.execute("call-1", {
      first_name: "Jane",
      last_name: "Doe",
      organization_name: "Acme P&C",
      source_type: "newsletter",
      qualification_score: 59,
      qualification_reason: "US/P&C plausible but source lacks enough detail",
    });

    const parsed = parseToolJson(result);
    expect(parsed.status).toBe("qualification_rejected");
    expect(matchCalls).toBe(0);
  });

  it("allows single Apollo enrichment at the newsletter threshold", async () => {
    const tool = tools().find((candidate) => candidate.name === "apollo_enrich");
    const result = await tool?.execute("call-1", {
      first_name: "Jane",
      last_name: "Doe",
      organization_name: "Acme P&C",
      source_type: "newsletter",
      qualification_score: 60,
      qualification_reason: "US P&C newsletter source",
    });

    const parsed = parseToolJson(result);
    expect(parsed.status).toBe("no_match");
    expect(matchCalls).toBe(1);
  });

  it("filters low-confidence bulk leads before making the Apollo API call", async () => {
    const tool = tools().find((candidate) => candidate.name === "apollo_bulk_enrich");
    const result = await tool?.execute("call-1", {
      leads: [
        {
          first_name: "Low",
          last_name: "Score",
          organization_name: "Acme P&C",
          source_type: "web",
          qualification_score: 40,
          qualification_reason: "Weak source",
        },
        {
          first_name: "High",
          last_name: "Score",
          organization_name: "Acme P&C",
          source_type: "web",
          qualification_score: 75,
          qualification_reason: "Verified US P&C move",
        },
      ],
    });

    const parsed = parseToolJson(result);
    const failed = parsed.failed as Array<{ status: string }>;
    expect(bulkCalls).toBe(1);
    expect(failed.map((entry) => entry.status).sort()).toEqual([
      "no_match",
      "qualification_rejected",
    ]);
  });
});
