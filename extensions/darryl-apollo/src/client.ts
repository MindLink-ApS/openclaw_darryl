import type {
  ApolloMatchRequest,
  ApolloMatchResponse,
  ApolloBulkMatchResponse,
  ApolloPhoneNumber,
} from "./types.js";

const APOLLO_BASE_URL = "https://api.apollo.io/api/v1";

const USABLE_PHONE_TYPES = new Set(["direct", "mobile"]);
const VALID_PHONE_STATUSES = new Set(["valid_number"]);
const ACCEPTABLE_CONFIDENCE = new Set(["high", "medium"]);

// ---------------------------------------------------------------------------
// Apollo API client
// ---------------------------------------------------------------------------

export class ApolloClient {
  constructor(
    private apiKey: string,
    private webhookUrl?: string,
  ) {}

  /** Sync enrichment — returns email + any cached phone numbers (1 credit). */
  async matchPerson(params: {
    first_name: string;
    last_name: string;
    organization_name?: string;
    domain?: string;
    linkedin_url?: string;
  }): Promise<ApolloMatchResponse> {
    const body: ApolloMatchRequest = {
      first_name: params.first_name,
      last_name: params.last_name,
      organization_name: params.organization_name,
      domain: params.domain,
      linkedin_url: params.linkedin_url,
      reveal_personal_emails: true,
    };
    return this.post<ApolloMatchResponse>("/people/match", body);
  }

  /** Trigger async mobile number hunt for a known Apollo person ID. */
  async triggerAsyncPhone(apolloPersonId: string): Promise<void> {
    if (!this.webhookUrl) {
      throw new Error("No webhook URL configured for async phone enrichment");
    }
    await this.post("/people/match", {
      id: apolloPersonId,
      reveal_phone_number: true,
      webhook_url: this.webhookUrl,
    });
  }

  /** Bulk sync enrichment — up to 10 people (1 credit each). */
  async bulkMatchPeople(details: ApolloMatchRequest[]): Promise<ApolloBulkMatchResponse> {
    return this.post<ApolloBulkMatchResponse>("/people/bulk_match", {
      details,
      reveal_personal_emails: true,
    });
  }

  /** Trigger async mobile hunt for multiple Apollo person IDs at once. */
  async triggerBulkAsyncPhone(apolloPersonIds: string[]): Promise<void> {
    if (!this.webhookUrl) {
      throw new Error("No webhook URL configured for async phone enrichment");
    }
    await this.post("/people/bulk_match", {
      details: apolloPersonIds.map((id) => ({ id })),
      reveal_phone_number: true,
      webhook_url: this.webhookUrl,
    });
  }

  private async post<T>(endpoint: string, body: unknown): Promise<T> {
    const res = await fetch(`${APOLLO_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Apollo API ${endpoint} failed (${res.status}): ${text}`);
    }
    return res.json() as Promise<T>;
  }
}

// ---------------------------------------------------------------------------
// Phone filtering — pick the best usable phone from an array
// ---------------------------------------------------------------------------

export function filterUsablePhones(phones?: ApolloPhoneNumber[]): ApolloPhoneNumber | null {
  if (!phones?.length) return null;

  // Best: direct/mobile + valid + high/medium confidence
  const best = phones.find(
    (p) =>
      USABLE_PHONE_TYPES.has(p.type_cd ?? "") &&
      VALID_PHONE_STATUSES.has(p.status_cd ?? "") &&
      ACCEPTABLE_CONFIDENCE.has(p.confidence_cd ?? ""),
  );
  if (best) return best;

  // Fallback: any direct/mobile regardless of confidence
  const fallback = phones.find((p) => USABLE_PHONE_TYPES.has(p.type_cd ?? ""));
  return fallback ?? null;
}
