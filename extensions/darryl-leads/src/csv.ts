import type { Lead } from "./db.js";

const CSV_COLUMNS = [
  "id",
  "full_name",
  "current_title",
  "current_company",
  "company_hq_address",
  "email_address",
  "mobile_phone",
  "linkedin_url",
  "source_published_date",
  "move_effective_date",
  "move_type",
  "geography",
  "functional_focus",
  "notes",
  "status_pipeline",
  "do_not_contact_reason",
  "first_seen_at",
  "last_contacted_at",
  "contact_count",
  "next_follow_up",
] as const;

function escapeField(value: string | number | null | undefined): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateCsv(leads: Lead[]): string {
  const header = CSV_COLUMNS.join(",");
  const rows = leads.map((lead) =>
    CSV_COLUMNS.map((col) => escapeField(lead[col as keyof Lead] as string | number | null)).join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}
