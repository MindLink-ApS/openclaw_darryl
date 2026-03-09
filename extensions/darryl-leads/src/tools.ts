import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AnyAgentTool } from "openclaw/plugin-sdk";
import { generateCsv } from "./csv.js";
import type { LeadsDB } from "./db.js";
import {
  LeadExportCsvParams,
  LeadGetParams,
  LeadRecordContactParams,
  LeadSearchParams,
  LeadStatsParams,
  LeadUpdatePipelineParams,
  LeadUpsertParams,
} from "./schema.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
};

function jsonResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

type UpsertParams = {
  full_name: string;
  current_title: string;
  current_company: string;
  linkedin_url: string;
  source_published_date: string;
  company_hq_address?: string;
  email_address?: string;
  mobile_phone?: string;
  move_effective_date?: string;
  move_type?: string;
  geography?: string;
  functional_focus?: string;
  notes?: string;
  status_pipeline?: string;
  sources?: Array<{
    source_url: string;
    source_label?: string;
    published_on?: string;
  }>;
};

type SearchParams = {
  name?: string;
  company?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
};

type UpdatePipelineParams = {
  id: number;
  status: string;
  do_not_contact_reason?: string;
};

type ExportCsvParams = {
  status?: string;
  date_from?: string;
  date_to?: string;
};

export function createLeadsTools(db: LeadsDB): AnyAgentTool[] {
  return [
    {
      name: "leads_upsert",
      label: "Leads Upsert",
      description:
        "Insert or update a P&C insurance executive lead. " +
        "Deduplicates on name + company + title + source date. " +
        "Pipeline status never regresses (e.g., 'contacted' won't revert to 'new'). " +
        "Optionally attach source URLs (duplicates auto-ignored).",
      parameters: LeadUpsertParams,
      async execute(_toolCallId: string, rawParams: unknown): Promise<ToolResult> {
        const params = rawParams as UpsertParams;
        const { sources, ...leadFields } = params;
        const result = db.upsert(leadFields);

        if (sources?.length) {
          for (const source of sources) {
            db.addSource(result.id, source);
          }
        }

        return jsonResult({
          ...result,
          sourcesAdded: sources?.length ?? 0,
        });
      },
    },
    {
      name: "leads_get",
      label: "Leads Get",
      description: "Get a single lead by ID, including all associated source URLs.",
      parameters: LeadGetParams,
      async execute(_toolCallId: string, rawParams: unknown): Promise<ToolResult> {
        const { id } = rawParams as { id: number };
        const lead = db.getById(id);
        if (!lead) {
          return jsonResult({ error: "Lead not found", id });
        }
        return jsonResult(lead);
      },
    },
    {
      name: "leads_search",
      label: "Leads Search",
      description:
        "Search P&C executive leads by name, company, pipeline status, or date range. " +
        "Returns paginated results (default limit 50).",
      parameters: LeadSearchParams,
      async execute(_toolCallId: string, rawParams: unknown): Promise<ToolResult> {
        const params = rawParams as SearchParams;
        const leads = db.search(params);
        return jsonResult({ count: leads.length, leads });
      },
    },
    {
      name: "leads_update_pipeline",
      label: "Leads Update Pipeline",
      description:
        "Update the pipeline status for a lead by ID. " +
        "Statuses: new, awaiting_phone, queued_for_outreach, contacted, in_conversation, do_not_contact, needs_human_review.",
      parameters: LeadUpdatePipelineParams,
      async execute(_toolCallId: string, rawParams: unknown): Promise<ToolResult> {
        const params = rawParams as UpdatePipelineParams;
        db.updatePipeline(params.id, params.status, params.do_not_contact_reason);
        return jsonResult({ success: true, id: params.id, status: params.status });
      },
    },
    {
      name: "leads_record_contact",
      label: "Leads Record Contact",
      description:
        "Record that a lead was contacted. Increments contact_count, sets last_contacted_at to now, " +
        "and optionally sets next_follow_up date. Use for tracking call cadence.",
      parameters: LeadRecordContactParams,
      async execute(_toolCallId: string, rawParams: unknown): Promise<ToolResult> {
        const { id, next_follow_up } = rawParams as { id: number; next_follow_up?: string };
        db.recordContact(id, next_follow_up);
        const lead = db.getById(id);
        return jsonResult({
          success: true,
          id,
          contact_count: lead?.contact_count ?? 0,
          next_follow_up: lead?.next_follow_up ?? null,
        });
      },
    },
    {
      name: "leads_export_csv",
      label: "Leads Export CSV",
      description:
        "Export filtered leads to a CSV file. Returns the file path. " +
        "Filters: status, date_from, date_to.",
      parameters: LeadExportCsvParams,
      async execute(_toolCallId: string, rawParams: unknown): Promise<ToolResult> {
        const params = rawParams as ExportCsvParams;
        const leads = db.exportLeads({
          status: params.status,
          date_from: params.date_from,
          date_to: params.date_to,
        });
        const csv = generateCsv(leads);

        const tmpDir = os.tmpdir();
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filePath = path.join(tmpDir, `darryl-leads-${timestamp}.csv`);
        fs.writeFileSync(filePath, csv, "utf-8");

        return jsonResult({
          filePath,
          rowCount: leads.length,
        });
      },
    },
    {
      name: "leads_stats",
      label: "Leads Stats",
      description: "Return lead counts by pipeline status and recent additions (last 7 days).",
      parameters: LeadStatsParams,
      async execute(_toolCallId: string, _rawParams: unknown): Promise<ToolResult> {
        const stats = db.getStats();
        return jsonResult(stats);
      },
    },
  ] as AnyAgentTool[];
}
