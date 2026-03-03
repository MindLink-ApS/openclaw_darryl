import { Type } from "@sinclair/typebox";
import { optionalStringEnum, stringEnum } from "openclaw/plugin-sdk";

export const MOVE_TYPES = [
  "new_employer",
  "internal_promotion",
  "lateral_move",
  "unspecified",
] as const;

export const PIPELINE_STATUSES = [
  "new",
  "queued_for_outreach",
  "contacted",
  "in_conversation",
  "do_not_contact",
  "needs_human_review",
] as const;

export const LeadUpsertParams = Type.Object(
  {
    full_name: Type.String({ description: "Full name of the executive" }),
    current_title: Type.String({ description: "Current job title" }),
    current_company: Type.String({ description: "Current company name" }),
    linkedin_url: Type.String({ description: "LinkedIn profile URL (required)" }),
    source_published_date: Type.String({ description: "Date the source was published (YYYY-MM-DD, required)" }),
    company_hq_address: Type.Optional(
      Type.String({ description: "Company headquarters address" }),
    ),
    email_address: Type.Optional(Type.String({ description: "Email address (only if lawfully sourced)" })),
    mobile_phone: Type.Optional(Type.String({ description: "Mobile phone number (only if lawfully sourced)" })),
    move_effective_date: Type.Optional(
      Type.String({ description: "Date the job move became effective (YYYY-MM-DD)" }),
    ),
    move_type: optionalStringEnum(MOVE_TYPES, {
      description: "Type of job change",
      default: "unspecified",
    }),
    geography: Type.Optional(
      Type.String({ description: "Geographic region or market" }),
    ),
    functional_focus: Type.Optional(
      Type.String({ description: "Functional area (e.g. underwriting, claims, distribution)" }),
    ),
    notes: Type.Optional(Type.String({ description: "Free-form notes" })),
    status_pipeline: optionalStringEnum(PIPELINE_STATUSES, {
      description: "Pipeline status",
      default: "new",
    }),
    sources: Type.Optional(
      Type.Array(
        Type.Object({
          source_url: Type.String({ description: "URL of the source article or announcement" }),
          source_label: Type.Optional(Type.String({ description: "Label for the source" })),
          published_on: Type.Optional(Type.String({ description: "Date published (YYYY-MM-DD)" })),
        }),
      ),
    ),
  },
  { additionalProperties: false },
);

export const LeadSearchParams = Type.Object(
  {
    name: Type.Optional(Type.String({ description: "Filter by name (partial match)" })),
    company: Type.Optional(Type.String({ description: "Filter by company (partial match)" })),
    status: optionalStringEnum(PIPELINE_STATUSES, { description: "Filter by pipeline status" }),
    date_from: Type.Optional(
      Type.String({ description: "Filter leads seen on or after this date (YYYY-MM-DD)" }),
    ),
    date_to: Type.Optional(
      Type.String({ description: "Filter leads seen on or before this date (YYYY-MM-DD)" }),
    ),
    limit: Type.Optional(
      Type.Number({ description: "Max results to return (default 50)", minimum: 1, maximum: 500 }),
    ),
    offset: Type.Optional(
      Type.Number({ description: "Offset for pagination (default 0)", minimum: 0 }),
    ),
  },
  { additionalProperties: false },
);

export const LeadGetParams = Type.Object(
  {
    id: Type.Number({ description: "Lead ID to look up" }),
  },
  { additionalProperties: false },
);

export const LeadUpdatePipelineParams = Type.Object(
  {
    id: Type.Number({ description: "Lead ID" }),
    status: stringEnum(PIPELINE_STATUSES, { description: "New pipeline status" }),
    do_not_contact_reason: Type.Optional(
      Type.String({ description: "Reason for do_not_contact status" }),
    ),
  },
  { additionalProperties: false },
);

export const LeadRecordContactParams = Type.Object(
  {
    id: Type.Number({ description: "Lead ID" }),
    next_follow_up: Type.Optional(
      Type.String({ description: "Next follow-up date (YYYY-MM-DD). Omit to clear." }),
    ),
  },
  { additionalProperties: false },
);

export const LeadExportCsvParams = Type.Object(
  {
    status: optionalStringEnum(PIPELINE_STATUSES, { description: "Filter by pipeline status" }),
    date_from: Type.Optional(
      Type.String({ description: "Filter leads seen on or after this date (YYYY-MM-DD)" }),
    ),
    date_to: Type.Optional(
      Type.String({ description: "Filter leads seen on or before this date (YYYY-MM-DD)" }),
    ),
  },
  { additionalProperties: false },
);

export const LeadStatsParams = Type.Object({}, { additionalProperties: false });
