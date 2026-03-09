// ---------------------------------------------------------------------------
// Apollo API request / response types
// ---------------------------------------------------------------------------

export interface ApolloMatchRequest {
  first_name?: string;
  last_name?: string;
  name?: string;
  email?: string;
  organization_name?: string;
  domain?: string;
  id?: string;
  linkedin_url?: string;
  reveal_personal_emails?: boolean;
  reveal_phone_number?: boolean;
  webhook_url?: string;
}

export interface ApolloBulkMatchRequest {
  details: ApolloMatchRequest[];
  reveal_personal_emails?: boolean;
  reveal_phone_number?: boolean;
  webhook_url?: string;
}

export interface ApolloPhoneNumber {
  _id?: string;
  raw_number?: string;
  sanitized_number: string;
  type_cd?: string;
  status_cd?: string;
  confidence_cd?: string;
  direct_dial_source_cd?: string;
  position?: number;
  dnc_status_cd?: string;
}

export interface ApolloOrganization {
  id?: string;
  name?: string;
  website_url?: string;
  phone?: string;
}

export interface ApolloPerson {
  id: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  email?: string;
  email_status?: string;
  title?: string;
  phone_numbers?: ApolloPhoneNumber[];
  organization_id?: string;
  organization?: ApolloOrganization;
  linkedin_url?: string;
}

export interface ApolloMatchResponse {
  person: ApolloPerson | null;
  status?: string;
}

export interface ApolloBulkMatchResponse {
  status?: string;
  matches: ApolloPerson[];
  total_requested_enrichments?: number;
  unique_enriched_records?: number;
  missing_records?: number;
  credits_consumed?: number;
}

// ---------------------------------------------------------------------------
// Webhook payload (Apollo POSTs this when async phone lookup completes)
// ---------------------------------------------------------------------------

export interface ApolloWebhookPayload {
  status?: string;
  total_requested_enrichments?: number;
  unique_enriched_records?: number;
  missing_records?: number;
  credits_consumed?: number;
  people: ApolloWebhookPerson[];
}

export interface ApolloWebhookPerson {
  id: string;
  status?: string;
  phone_numbers?: ApolloPhoneNumber[];
}

// ---------------------------------------------------------------------------
// Internal result types returned by tools
// ---------------------------------------------------------------------------

export interface EnrichmentResult {
  deliver: boolean;
  email: string | null;
  email_status: string | null;
  phone: string | null;
  phone_type: string | null;
  phone_pending: boolean;
  apollo_id: string | null;
  status:
    | "complete"
    | "awaiting_phone"
    | "no_email"
    | "no_match"
    | "budget_exhausted"
    | "already_enriched";
  sync_usage: string;
  async_phone_usage: string;
  note?: string;
}

export interface BulkEnrichmentResult {
  complete: EnrichmentResult[];
  awaiting_phone: EnrichmentResult[];
  failed: EnrichmentResult[];
  sync_usage: string;
  async_phone_usage: string;
  summary: string;
}

export interface UsageStats {
  month: string;
  sync: { used: number; limit: number; remaining: number };
  async_phone: { used: number; limit: number; remaining: number };
  hit_rates: {
    complete: number;
    awaiting_phone: number;
    phone_received_via_webhook: number;
    phone_expired: number;
    no_email: number;
  };
  currently_awaiting: number;
  delivered_individually: number;
}
