import { Type } from "@sinclair/typebox";
import { optionalStringEnum, type AnyAgentTool } from "openclaw/plugin-sdk";
import type { ApolloClient } from "./client.js";
import { filterUsablePhones } from "./client.js";
import type { ApolloUsageDB } from "./db.js";
import type { ApolloMatchRequest, EnrichmentResult } from "./types.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
};

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function usageStr(used: number, limit: number): string {
  return `${used}/${limit}`;
}

const SOURCE_TYPES = ["newsletter", "web", "referral", "manual"] as const;
type SourceType = (typeof SOURCE_TYPES)[number];

const QUALIFICATION_THRESHOLDS: Record<SourceType, number> = {
  newsletter: 60,
  web: 70,
  referral: 65,
  manual: 70,
};

function normalizeSourceType(value?: string): SourceType {
  if (value && (SOURCE_TYPES as readonly string[]).includes(value)) {
    return value as SourceType;
  }
  return "web";
}

function qualificationThreshold(sourceType?: string): number {
  return QUALIFICATION_THRESHOLDS[normalizeSourceType(sourceType)];
}

function qualificationRejectedResult(params: {
  score: number;
  sourceType?: string;
  syncUsed: number;
  syncLimit: number;
  asyncPhoneUsed: number;
  asyncPhoneLimit: number;
  reason?: string;
}): EnrichmentResult | null {
  const threshold = qualificationThreshold(params.sourceType);
  if (params.score >= threshold) return null;
  const sourceType = normalizeSourceType(params.sourceType);
  return {
    deliver: false,
    email: null,
    email_status: null,
    phone: null,
    phone_type: null,
    phone_pending: false,
    apollo_id: null,
    status: "qualification_rejected",
    sync_usage: usageStr(params.syncUsed, params.syncLimit),
    async_phone_usage: usageStr(params.asyncPhoneUsed, params.asyncPhoneLimit),
    note: [
      `Skipped Apollo: qualification_score ${params.score}/100 is below ${threshold}/100 for ${sourceType} candidates.`,
      params.reason ? `Reason: ${params.reason}` : "",
      "Improve public-source validation or explicitly set force=true before spending credits.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

// ---------------------------------------------------------------------------
// Tool input schemas
// ---------------------------------------------------------------------------

const ApolloEnrichParams = Type.Object(
  {
    first_name: Type.String({ description: "First name of the person" }),
    last_name: Type.String({ description: "Last name of the person" }),
    organization_name: Type.String({ description: "Current company name" }),
    domain: Type.Optional(
      Type.String({ description: "Company website domain (e.g. allstate.com)" }),
    ),
    linkedin_url: Type.Optional(Type.String({ description: "LinkedIn profile URL" })),
    internal_lead_id: Type.Optional(
      Type.Number({ description: "Lead ID from leads database (if already stored)" }),
    ),
    candidate_id: Type.Optional(
      Type.Number({ description: "Candidate ID from lead_candidates_upsert" }),
    ),
    source_type: optionalStringEnum(SOURCE_TYPES, {
      description: "Source type used for the qualification threshold",
      default: "web",
    }),
    qualification_score: Type.Number({
      description:
        "0-100 pre-enrichment score from lead_candidates_upsert. Apollo is skipped below threshold.",
      minimum: 0,
      maximum: 100,
    }),
    qualification_reason: Type.Optional(
      Type.String({ description: "Short reason for the score and spend decision" }),
    ),
    force: Type.Optional(
      Type.Boolean({
        description:
          "Override the qualification threshold for explicit Darryl/Mindlink requests only.",
        default: false,
      }),
    ),
  },
  { additionalProperties: false },
);

const ApolloBulkEnrichParams = Type.Object(
  {
    leads: Type.Array(
      Type.Object({
        first_name: Type.String({ description: "First name" }),
        last_name: Type.String({ description: "Last name" }),
        organization_name: Type.String({ description: "Company name" }),
        domain: Type.Optional(Type.String({ description: "Company domain" })),
        linkedin_url: Type.Optional(Type.String({ description: "LinkedIn URL" })),
        internal_lead_id: Type.Optional(Type.Number({ description: "Lead ID if already stored" })),
        candidate_id: Type.Optional(Type.Number({ description: "Candidate ID" })),
        source_type: optionalStringEnum(SOURCE_TYPES, {
          description: "Source type used for the qualification threshold",
          default: "web",
        }),
        qualification_score: Type.Number({
          description: "0-100 pre-enrichment score. Apollo is skipped below threshold.",
          minimum: 0,
          maximum: 100,
        }),
        qualification_reason: Type.Optional(Type.String({ description: "Reason for the score" })),
        force: Type.Optional(
          Type.Boolean({
            description: "Override qualification threshold for explicit requests only.",
            default: false,
          }),
        ),
      }),
    ),
  },
  { additionalProperties: false },
);

const ApolloUsageParams = Type.Object({}, { additionalProperties: false });

const ApolloSetLimitParams = Type.Object(
  {
    sync_limit: Type.Optional(
      Type.Number({ description: "New monthly sync enrichment limit", minimum: 1 }),
    ),
    async_phone_limit: Type.Optional(
      Type.Number({ description: "New monthly async phone hunt limit", minimum: 1 }),
    ),
  },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createApolloTools(deps: {
  db: ApolloUsageDB;
  client: ApolloClient;
  syncLimitDefault: number;
  asyncPhoneLimitDefault: number;
}): AnyAgentTool[] {
  const { db, client, syncLimitDefault, asyncPhoneLimitDefault } = deps;

  function getLimits() {
    return {
      syncLimit: db.getSyncMonthlyLimit(syncLimitDefault),
      asyncPhoneLimit: db.getAsyncPhoneMonthlyLimit(asyncPhoneLimitDefault),
    };
  }

  // ---- Single enrichment (hybrid sync + async) ----

  async function enrichOne(params: {
    first_name: string;
    last_name: string;
    organization_name: string;
    domain?: string;
    linkedin_url?: string;
    internal_lead_id?: number;
    candidate_id?: number;
    source_type?: SourceType;
    qualification_score: number;
    qualification_reason?: string;
    force?: boolean;
  }): Promise<EnrichmentResult> {
    const { syncLimit, asyncPhoneLimit } = getLimits();
    const syncUsed = db.getSyncUsedThisMonth();
    const asyncPhoneUsed = db.getAsyncPhoneUsedThisMonth();
    const fullName = `${params.first_name} ${params.last_name}`;

    if (!params.force) {
      const rejected = qualificationRejectedResult({
        score: params.qualification_score,
        sourceType: params.source_type,
        syncUsed,
        syncLimit,
        asyncPhoneUsed,
        asyncPhoneLimit,
        reason: params.qualification_reason,
      });
      if (rejected) return rejected;
    }

    // Budget check
    if (syncUsed >= syncLimit) {
      return {
        deliver: false,
        email: null,
        email_status: null,
        phone: null,
        phone_type: null,
        phone_pending: false,
        apollo_id: null,
        status: "budget_exhausted",
        sync_usage: usageStr(syncUsed, syncLimit),
        async_phone_usage: usageStr(asyncPhoneUsed, asyncPhoneLimit),
        note: `Sync enrichment limit reached (${syncUsed}/${syncLimit}). Use web search as fallback.`,
      };
    }

    // Dedup check
    if (db.isAlreadyEnrichedThisMonth(fullName, params.organization_name)) {
      return {
        deliver: false,
        email: null,
        email_status: null,
        phone: null,
        phone_type: null,
        phone_pending: false,
        apollo_id: null,
        status: "already_enriched",
        sync_usage: usageStr(syncUsed, syncLimit),
        async_phone_usage: usageStr(asyncPhoneUsed, asyncPhoneLimit),
        note: "Already enriched this month. Check leads database for stored data.",
      };
    }

    // Sync enrichment call (1 credit)
    const res = await client.matchPerson({
      first_name: params.first_name,
      last_name: params.last_name,
      organization_name: params.organization_name,
      domain: params.domain,
      linkedin_url: params.linkedin_url,
    });

    if (!res.person) {
      db.logEnrichment({
        lead_name: fullName,
        lead_company: params.organization_name,
        email_found: false,
        phone_found: false,
      });
      return {
        deliver: false,
        email: null,
        email_status: null,
        phone: null,
        phone_type: null,
        phone_pending: false,
        apollo_id: null,
        status: "no_match",
        sync_usage: usageStr(syncUsed + 1, syncLimit),
        async_phone_usage: usageStr(asyncPhoneUsed, asyncPhoneLimit),
        note: "No match found in Apollo database.",
      };
    }

    const person = res.person;
    const email = person.email ?? null;
    const emailStatus = person.email_status ?? null;
    const usablePhone = filterUsablePhones(person.phone_numbers);

    // No email → can't deliver (need both)
    if (!email || emailStatus === "unavailable") {
      db.logEnrichment({
        lead_name: fullName,
        lead_company: params.organization_name,
        email_found: false,
        phone_found: !!usablePhone,
        apollo_person_id: person.id,
      });
      return {
        deliver: false,
        email: null,
        email_status: emailStatus,
        phone: usablePhone?.sanitized_number ?? null,
        phone_type: usablePhone?.type_cd ?? null,
        phone_pending: false,
        apollo_id: person.id,
        status: "no_email",
        sync_usage: usageStr(syncUsed + 1, syncLimit),
        async_phone_usage: usageStr(asyncPhoneUsed, asyncPhoneLimit),
        note: "No verified email found. Use web search as fallback for both email and phone.",
      };
    }

    // Email found + phone found → COMPLETE, deliver immediately
    if (usablePhone) {
      db.logEnrichment({
        lead_name: fullName,
        lead_company: params.organization_name,
        email_found: true,
        phone_found: true,
        apollo_person_id: person.id,
      });
      return {
        deliver: true,
        email,
        email_status: emailStatus,
        phone: usablePhone.sanitized_number,
        phone_type: usablePhone.type_cd ?? "mobile",
        phone_pending: false,
        apollo_id: person.id,
        status: "complete",
        sync_usage: usageStr(syncUsed + 1, syncLimit),
        async_phone_usage: usageStr(asyncPhoneUsed, asyncPhoneLimit),
      };
    }

    // Email found, no phone → trigger async mobile hunt
    db.logEnrichment({
      lead_name: fullName,
      lead_company: params.organization_name,
      email_found: true,
      phone_found: false,
      apollo_person_id: person.id,
    });

    if (asyncPhoneUsed >= asyncPhoneLimit) {
      return {
        deliver: false,
        email,
        email_status: emailStatus,
        phone: null,
        phone_type: null,
        phone_pending: false,
        apollo_id: person.id,
        status: "awaiting_phone",
        sync_usage: usageStr(syncUsed + 1, syncLimit),
        async_phone_usage: usageStr(asyncPhoneUsed, asyncPhoneLimit),
        note: `Async phone budget exhausted (${asyncPhoneUsed}/${asyncPhoneLimit}). Email found but no phone. Use web search for phone as fallback.`,
      };
    }

    // Fire async phone request
    try {
      await client.triggerAsyncPhone(person.id);
    } catch {
      return {
        deliver: false,
        email,
        email_status: emailStatus,
        phone: null,
        phone_type: null,
        phone_pending: false,
        apollo_id: person.id,
        status: "awaiting_phone",
        sync_usage: usageStr(syncUsed + 1, syncLimit),
        async_phone_usage: usageStr(asyncPhoneUsed, asyncPhoneLimit),
        note: "Async phone request failed. Email found but no phone. Use web search for phone as fallback.",
      };
    }

    // Record pending phone
    db.insertPendingPhone({
      apollo_person_id: person.id,
      internal_lead_id: params.internal_lead_id ?? 0,
      lead_name: fullName,
      lead_company: params.organization_name,
      email_found: email,
    });

    return {
      deliver: false,
      email,
      email_status: emailStatus,
      phone: null,
      phone_type: null,
      phone_pending: true,
      apollo_id: person.id,
      status: "awaiting_phone",
      sync_usage: usageStr(syncUsed + 1, syncLimit),
      async_phone_usage: usageStr(asyncPhoneUsed + 1, asyncPhoneLimit),
      note: "Async mobile lookup triggered. Store this lead as status 'awaiting_phone' now. Webhook phone arrivals update the DB silently and should be included in the next daily report.",
    };
  }

  // ---- Build tool array ----

  return [
    {
      name: "apollo_enrich",
      label: "Apollo Enrich",
      description: [
        "Enrich a single person via Apollo.io — returns verified email and phone number.",
        "Requires a pre-enrichment qualification_score from lead_candidates_upsert.",
        "Skips Apollo before spending credits when score is below the source-specific threshold.",
        "Uses hybrid sync+async: sync call gets email + cached phone (1 credit).",
        "If no phone found, automatically triggers async mobile hunt via webhook.",
        "Returns deliver=true ONLY when both email and phone are found.",
        "When deliver=false and status='awaiting_phone', upsert the lead with the email",
        "and status_pipeline='awaiting_phone'. The phone will arrive via webhook and",
        "the lead should stay silent until the next daily report or Darryl's direct reply flow.",
      ].join(" "),
      parameters: ApolloEnrichParams,
      async execute(_toolCallId: string, rawParams: unknown): Promise<ToolResult> {
        const p = rawParams as {
          first_name: string;
          last_name: string;
          organization_name: string;
          domain?: string;
          linkedin_url?: string;
          internal_lead_id?: number;
          candidate_id?: number;
          source_type?: SourceType;
          qualification_score: number;
          qualification_reason?: string;
          force?: boolean;
        };
        try {
          const result = await enrichOne(p);
          return jsonResult(result);
        } catch (err) {
          return jsonResult({ error: String(err) });
        }
      },
    },

    {
      name: "apollo_bulk_enrich",
      label: "Apollo Bulk Enrich",
      description: [
        "Enrich up to 10 people via Apollo.io in one batch call.",
        "Requires each person to include qualification_score from lead_candidates_upsert.",
        "Skips low-confidence candidates before spending Apollo credits.",
        "Same hybrid sync+async logic as apollo_enrich for each person.",
        "Returns results grouped: complete (deliver now), awaiting_phone (held),",
        "and failed (no match). Respects monthly sync and async phone budgets.",
      ].join(" "),
      parameters: ApolloBulkEnrichParams,
      async execute(_toolCallId: string, rawParams: unknown): Promise<ToolResult> {
        const p = rawParams as {
          leads: Array<{
            first_name: string;
            last_name: string;
            organization_name: string;
            domain?: string;
            linkedin_url?: string;
            internal_lead_id?: number;
            candidate_id?: number;
            source_type?: SourceType;
            qualification_score: number;
            qualification_reason?: string;
            force?: boolean;
          }>;
        };

        if (p.leads.length > 10) {
          return jsonResult({
            error: "Maximum 10 leads per bulk call. Split into multiple calls.",
          });
        }

        try {
          const { syncLimit, asyncPhoneLimit } = getLimits();
          const syncUsed = db.getSyncUsedThisMonth();
          const asyncPhoneUsed = db.getAsyncPhoneUsedThisMonth();
          const budgetRemaining = syncLimit - syncUsed;
          const qualificationRejected: EnrichmentResult[] = [];
          const qualifiedInput = p.leads.filter((lead) => {
            if (lead.force) return true;
            const rejected = qualificationRejectedResult({
              score: lead.qualification_score,
              sourceType: lead.source_type,
              syncUsed,
              syncLimit,
              asyncPhoneUsed,
              asyncPhoneLimit,
              reason: lead.qualification_reason,
            });
            if (rejected) {
              qualificationRejected.push(rejected);
              return false;
            }
            return true;
          });

          if (budgetRemaining <= 0) {
            return jsonResult({
              complete: [],
              awaiting_phone: [],
              failed: [
                ...qualificationRejected,
                ...qualifiedInput.map(() => ({
                  deliver: false,
                  email: null,
                  email_status: null,
                  phone: null,
                  phone_type: null,
                  phone_pending: false,
                  apollo_id: null,
                  status: "budget_exhausted" as const,
                  sync_usage: usageStr(syncUsed, syncLimit),
                  async_phone_usage: usageStr(asyncPhoneUsed, asyncPhoneLimit),
                  note: "Sync enrichment limit reached. Use web search as fallback.",
                })),
              ],
              sync_usage: usageStr(syncUsed, syncLimit),
              async_phone_usage: usageStr(asyncPhoneUsed, asyncPhoneLimit),
              summary: `0 complete, 0 awaiting phone, ${qualifiedInput.length} budget exhausted, ${qualificationRejected.length} skipped by qualification gate`,
            });
          }

          // Filter out already-enriched leads BEFORE budget slicing (don't waste budget slots on dupes)
          const freshLeads: typeof qualifiedInput = [];
          const dedupResults: EnrichmentResult[] = [...qualificationRejected];
          for (const lead of qualifiedInput) {
            const fullName = `${lead.first_name} ${lead.last_name}`;
            if (db.isAlreadyEnrichedThisMonth(fullName, lead.organization_name)) {
              dedupResults.push({
                deliver: false,
                email: null,
                email_status: null,
                phone: null,
                phone_type: null,
                phone_pending: false,
                apollo_id: null,
                status: "already_enriched",
                sync_usage: "",
                async_phone_usage: "",
                note: "Already enriched this month.",
              });
            } else {
              freshLeads.push(lead);
            }
          }

          // Trim fresh leads to budget
          const leadsToEnrich = freshLeads.slice(0, budgetRemaining);
          const overBudget = freshLeads.slice(budgetRemaining);

          const results: EnrichmentResult[] = [...dedupResults];

          if (leadsToEnrich.length > 0) {
            // Single bulk API call for all fresh, budget-allowed leads
            const details: ApolloMatchRequest[] = leadsToEnrich.map((l) => ({
              first_name: l.first_name,
              last_name: l.last_name,
              organization_name: l.organization_name,
              domain: l.domain,
              linkedin_url: l.linkedin_url,
              reveal_personal_emails: true,
            }));

            const bulkRes = await client.bulkMatchPeople(details);
            const matches = bulkRes.matches ?? [];

            // Correlate matches back to input leads by index
            const needAsyncPhone: string[] = [];
            for (let i = 0; i < leadsToEnrich.length; i++) {
              const lead = leadsToEnrich[i];
              const fullName = `${lead.first_name} ${lead.last_name}`;
              // Find match by name (Apollo returns matches in order, but verify)
              const person = matches[i] ?? null;

              if (!person) {
                db.logEnrichment({
                  lead_name: fullName,
                  lead_company: lead.organization_name,
                  email_found: false,
                  phone_found: false,
                });
                results.push({
                  deliver: false,
                  email: null,
                  email_status: null,
                  phone: null,
                  phone_type: null,
                  phone_pending: false,
                  apollo_id: null,
                  status: "no_match",
                  sync_usage: "",
                  async_phone_usage: "",
                  note: "No match found in Apollo database.",
                });
                continue;
              }

              const email = person.email ?? null;
              const emailStatus = person.email_status ?? null;
              const usablePhone = filterUsablePhones(person.phone_numbers);

              if (!email || emailStatus === "unavailable") {
                db.logEnrichment({
                  lead_name: fullName,
                  lead_company: lead.organization_name,
                  email_found: false,
                  phone_found: !!usablePhone,
                  apollo_person_id: person.id,
                });
                results.push({
                  deliver: false,
                  email: null,
                  email_status: emailStatus,
                  phone: usablePhone?.sanitized_number ?? null,
                  phone_type: usablePhone?.type_cd ?? null,
                  phone_pending: false,
                  apollo_id: person.id,
                  status: "no_email",
                  sync_usage: "",
                  async_phone_usage: "",
                  note: "No verified email. Use web search fallback for both.",
                });
                continue;
              }

              if (usablePhone) {
                db.logEnrichment({
                  lead_name: fullName,
                  lead_company: lead.organization_name,
                  email_found: true,
                  phone_found: true,
                  apollo_person_id: person.id,
                });
                results.push({
                  deliver: true,
                  email,
                  email_status: emailStatus,
                  phone: usablePhone.sanitized_number,
                  phone_type: usablePhone.type_cd ?? "mobile",
                  phone_pending: false,
                  apollo_id: person.id,
                  status: "complete",
                  sync_usage: "",
                  async_phone_usage: "",
                });
                continue;
              }

              // Email found, no phone → queue for async
              db.logEnrichment({
                lead_name: fullName,
                lead_company: lead.organization_name,
                email_found: true,
                phone_found: false,
                apollo_person_id: person.id,
              });

              const currentAsyncUsed = db.getAsyncPhoneUsedThisMonth();
              if (currentAsyncUsed >= asyncPhoneLimit) {
                results.push({
                  deliver: false,
                  email,
                  email_status: emailStatus,
                  phone: null,
                  phone_type: null,
                  phone_pending: false,
                  apollo_id: person.id,
                  status: "awaiting_phone",
                  sync_usage: "",
                  async_phone_usage: "",
                  note: "Async phone budget exhausted. Use web search for phone.",
                });
                continue;
              }

              needAsyncPhone.push(person.id);
              db.insertPendingPhone({
                apollo_person_id: person.id,
                internal_lead_id: lead.internal_lead_id ?? 0,
                lead_name: fullName,
                lead_company: lead.organization_name,
                email_found: email,
              });
              results.push({
                deliver: false,
                email,
                email_status: emailStatus,
                phone: null,
                phone_type: null,
                phone_pending: true,
                apollo_id: person.id,
                status: "awaiting_phone",
                sync_usage: "",
                async_phone_usage: "",
                note: "Async mobile lookup triggered. Webhook phone arrivals update the DB silently and should be included in the next daily report.",
              });
            }

            // Single bulk async phone call for all leads that need it
            if (needAsyncPhone.length > 0) {
              try {
                await client.triggerBulkAsyncPhone(needAsyncPhone);
              } catch (err) {
                console.warn("darryl-apollo: bulk async phone trigger failed:", err);
                // Pending records already inserted — webhook may still arrive
              }
            }
          }

          // Add budget-exhausted entries for leads that didn't fit
          for (const lead of overBudget) {
            results.push({
              deliver: false,
              email: null,
              email_status: null,
              phone: null,
              phone_type: null,
              phone_pending: false,
              apollo_id: null,
              status: "budget_exhausted",
              sync_usage: "",
              async_phone_usage: "",
              note: "Sync enrichment limit reached. Use web search as fallback.",
            });
          }

          // Fill in final usage counts
          const finalSyncUsed = db.getSyncUsedThisMonth();
          const finalAsyncUsed = db.getAsyncPhoneUsedThisMonth();
          for (const r of results) {
            r.sync_usage = usageStr(finalSyncUsed, syncLimit);
            r.async_phone_usage = usageStr(finalAsyncUsed, asyncPhoneLimit);
          }

          const complete = results.filter((r) => r.deliver);
          const awaitingPhone = results.filter((r) => !r.deliver && r.status === "awaiting_phone");
          const failed = results.filter(
            (r) => !r.deliver && r.status !== "awaiting_phone" && r.status !== "budget_exhausted",
          );

          return jsonResult({
            complete,
            awaiting_phone: awaitingPhone,
            failed,
            sync_usage: usageStr(finalSyncUsed, syncLimit),
            async_phone_usage: usageStr(finalAsyncUsed, asyncPhoneLimit),
            summary: [
              `${complete.length} complete`,
              `${awaitingPhone.length} awaiting phone`,
              `${failed.length} failed/no match`,
            ].join(", "),
          });
        } catch (err) {
          return jsonResult({ error: String(err) });
        }
      },
    },

    {
      name: "apollo_usage",
      label: "Apollo Usage",
      description: [
        "Check current month's Apollo enrichment usage, budgets, and hit rates.",
        "Also runs cleanup: expires pending phone requests older than 2 hours.",
        "Call this at the start of daily-scout/newsletter-parse to get budget status.",
      ].join(" "),
      parameters: ApolloUsageParams,
      async execute(): Promise<ToolResult> {
        const { syncLimit, asyncPhoneLimit } = getLimits();
        const expired = db.expireOldPending();
        const stats = db.getUsageStats(syncLimit, asyncPhoneLimit);
        return jsonResult({ ...stats, just_expired: expired });
      },
    },

    {
      name: "apollo_set_monthly_limit",
      label: "Apollo Set Monthly Limit",
      description: [
        "Change the monthly enrichment limits.",
        "sync_limit: max sync enrichments per month (default 100).",
        "async_phone_limit: max async phone hunts per month (default 50).",
        "Provide at least one parameter.",
      ].join(" "),
      parameters: ApolloSetLimitParams,
      async execute(_toolCallId: string, rawParams: unknown): Promise<ToolResult> {
        const p = rawParams as {
          sync_limit?: number;
          async_phone_limit?: number;
        };

        if (p.sync_limit == null && p.async_phone_limit == null) {
          return jsonResult({ error: "Provide at least one of sync_limit or async_phone_limit." });
        }

        const oldSync = db.getSyncMonthlyLimit(syncLimitDefault);
        const oldAsync = db.getAsyncPhoneMonthlyLimit(asyncPhoneLimitDefault);

        if (p.sync_limit != null) {
          db.setSetting("sync_monthly_limit", String(p.sync_limit));
        }
        if (p.async_phone_limit != null) {
          db.setSetting("async_phone_monthly_limit", String(p.async_phone_limit));
        }

        return jsonResult({
          sync_limit: { old: oldSync, new: p.sync_limit ?? oldSync },
          async_phone_limit: { old: oldAsync, new: p.async_phone_limit ?? oldAsync },
        });
      },
    },
  ] as AnyAgentTool[];
}
