import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateCsv } from "./csv.js";
import { LeadsDB, type Lead } from "./db.js";

describe("generateCsv", () => {
  it("includes source citation columns for Darryl exports", () => {
    const lead: Lead = {
      id: 1,
      full_name: "Shelley Rathsam",
      current_title: "Vice President, M&A",
      current_company: "Trucordia",
      company_hq_address: "Lindon, Utah",
      email_address: "shelley.rathsam@example.com",
      mobile_phone: "555-0100",
      linkedin_url: "https://www.linkedin.com/in/shelley-rathsam",
      source_label: "Business Insurance - Comings & Goings",
      source_url: "https://www.businessinsurance.com/ppl/shelley-rathsam/",
      source_published_date: "2026-04-24",
      move_effective_date: null,
      move_type: "new_employer",
      geography: "United States",
      functional_focus: "M&A",
      notes: "Complete lead",
      status_pipeline: "new",
      do_not_contact_reason: null,
      first_seen_at: "2026-04-27T10:00:00.000Z",
      last_verified_at: "2026-04-27T10:00:00.000Z",
      last_contacted_at: null,
      contact_count: 0,
      next_follow_up: null,
    };

    const csv = generateCsv([lead]);
    const [header, row] = csv.trim().split("\n");

    expect(header).toContain("source_label,source_url");
    expect(row).toContain("Business Insurance - Comings & Goings");
    expect(row).toContain("https://www.businessinsurance.com/ppl/shelley-rathsam/");
  });

  it("exports the newest stored source citation with each lead", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "darryl-leads-csv-"));
    const db = new LeadsDB(path.join(dir, "leads.sqlite"));

    try {
      const inserted = db.upsert({
        full_name: "Shelley Rathsam",
        current_title: "Vice President, M&A",
        current_company: "Trucordia",
        company_hq_address: "Lindon, Utah",
        email_address: "shelley.rathsam@example.com",
        mobile_phone: "555-0100",
        linkedin_url: "https://www.linkedin.com/in/shelley-rathsam",
        source_published_date: "2026-04-24",
        move_type: "new_employer",
        geography: "United States",
        functional_focus: "M&A",
        status_pipeline: "new",
      });
      db.addSource(inserted.id, {
        source_label: "Business Insurance - Comings & Goings",
        source_url: "https://www.businessinsurance.com/ppl/shelley-rathsam/",
        published_on: "2026-04-24",
      });

      const [lead] = db.exportLeads({ require_contact: true });

      expect(lead?.source_label).toBe("Business Insurance - Comings & Goings");
      expect(lead?.source_url).toBe("https://www.businessinsurance.com/ppl/shelley-rathsam/");
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
