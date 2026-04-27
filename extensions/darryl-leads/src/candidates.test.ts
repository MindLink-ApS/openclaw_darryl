import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LeadsDB } from "./db.js";

describe("darryl lead candidates", () => {
  let tmpDir: string;
  let db: LeadsDB;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "darryl-leads-candidates-"));
    db = new LeadsDB(path.join(tmpDir, "leads.db"));
  });

  afterEach(async () => {
    db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("stores and searches pre-enrichment candidates", () => {
    const result = db.upsertCandidate({
      full_name: "Jane Doe",
      current_company: "Acme P&C",
      current_title: "Chief Growth Officer",
      source_url: "https://example.com/people-moves",
      source_type: "newsletter",
      qualification_score: 72,
      qualification_status: "qualified",
      is_us_based: true,
      title_match: false,
      missing_fields: ["linkedin_url", "company_domain"],
      notes: "US Comings & Goings item; title outside daily target list.",
    });

    expect(result.action).toBe("created");

    const candidates = db.searchCandidates({
      status: "qualified",
      source_type: "newsletter",
      min_score: 60,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.full_name).toBe("Jane Doe");
    expect(candidates[0]?.is_us_based).toBe(true);
    expect(candidates[0]?.title_match).toBe(false);
    expect(candidates[0]?.missing_fields).toEqual(["linkedin_url", "company_domain"]);
  });

  it("deduplicates candidates by name, company, and source URL", () => {
    db.upsertCandidate({
      full_name: "Jane Doe",
      current_company: "Acme P&C",
      source_url: "https://example.com/people-moves",
      qualification_score: 45,
      qualification_status: "candidate",
    });

    const second = db.upsertCandidate({
      full_name: "Jane Doe",
      current_company: "Acme P&C",
      source_url: "https://example.com/people-moves",
      qualification_score: 80,
      qualification_status: "qualified",
      pc_relevance: "Broker leadership move",
    });

    expect(second.action).toBe("updated");
    const candidates = db.searchCandidates({ min_score: 0 });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.qualification_score).toBe(80);
    expect(candidates[0]?.qualification_status).toBe("qualified");
  });
});
