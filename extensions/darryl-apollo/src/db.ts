import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { UsageStats } from "./types.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

// ---------------------------------------------------------------------------
// Pending phone record shape (returned by queries)
// ---------------------------------------------------------------------------

export interface PendingPhone {
  id: number;
  apollo_person_id: string;
  internal_lead_id: number;
  lead_name: string;
  lead_company: string;
  email_found: string | null;
  requested_at: string;
  resolved_at: string | null;
  status: string;
  phone_number: string | null;
  phone_type: string | null;
  credits_used: number;
  delivered_individually: number;
}

// ---------------------------------------------------------------------------
// ApolloUsageDB — tracks enrichment usage, pending phones, and settings
// ---------------------------------------------------------------------------

export class ApolloUsageDB {
  private db: InstanceType<typeof DatabaseSync>;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.runMigrations();
  }

  private runMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS enrichment_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_name TEXT NOT NULL,
        lead_company TEXT NOT NULL,
        enriched_at TEXT NOT NULL,
        email_found INTEGER NOT NULL DEFAULT 0,
        phone_found INTEGER NOT NULL DEFAULT 0,
        credits_used INTEGER NOT NULL DEFAULT 1,
        apollo_person_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_enrichment_log_month
        ON enrichment_log (enriched_at);

      CREATE TABLE IF NOT EXISTS apollo_pending_phones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        apollo_person_id TEXT NOT NULL UNIQUE,
        internal_lead_id INTEGER NOT NULL DEFAULT 0,
        lead_name TEXT NOT NULL,
        lead_company TEXT NOT NULL,
        email_found TEXT,
        requested_at TEXT NOT NULL,
        resolved_at TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        phone_number TEXT,
        phone_type TEXT,
        credits_used INTEGER NOT NULL DEFAULT 1,
        delivered_individually INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_pending_status
        ON apollo_pending_phones (status);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  // ---- Month helpers ----

  currentMonth(): string {
    return new Date().toISOString().slice(0, 7);
  }

  private monthStart(): string {
    return `${this.currentMonth()}-01`;
  }

  // ---- Budget queries ----

  getSyncUsedThisMonth(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as cnt FROM enrichment_log WHERE enriched_at >= ?")
      .get(this.monthStart()) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  getAsyncPhoneUsedThisMonth(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as cnt FROM apollo_pending_phones WHERE requested_at >= ?")
      .get(this.monthStart()) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  // ---- Settings ----

  getSetting(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  getSyncMonthlyLimit(configDefault: number): number {
    const stored = this.getSetting("sync_monthly_limit");
    return stored ? Number.parseInt(stored, 10) : configDefault;
  }

  getAsyncPhoneMonthlyLimit(configDefault: number): number {
    const stored = this.getSetting("async_phone_monthly_limit");
    return stored ? Number.parseInt(stored, 10) : configDefault;
  }

  // ---- Enrichment log ----

  logEnrichment(params: {
    lead_name: string;
    lead_company: string;
    email_found: boolean;
    phone_found: boolean;
    apollo_person_id?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO enrichment_log
           (lead_name, lead_company, enriched_at, email_found, phone_found, apollo_person_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.lead_name,
        params.lead_company,
        new Date().toISOString(),
        params.email_found ? 1 : 0,
        params.phone_found ? 1 : 0,
        params.apollo_person_id ?? null,
      );
  }

  isAlreadyEnrichedThisMonth(name: string, company: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM enrichment_log
         WHERE lower(trim(lead_name)) = lower(trim(?))
           AND lower(trim(lead_company)) = lower(trim(?))
           AND enriched_at >= ?
         LIMIT 1`,
      )
      .get(name, company, this.monthStart());
    return !!row;
  }

  // ---- Pending phones ----

  insertPendingPhone(params: {
    apollo_person_id: string;
    internal_lead_id: number;
    lead_name: string;
    lead_company: string;
    email_found: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO apollo_pending_phones
           (apollo_person_id, internal_lead_id, lead_name, lead_company, email_found, requested_at, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      )
      .run(
        params.apollo_person_id,
        params.internal_lead_id,
        params.lead_name,
        params.lead_company,
        params.email_found,
        new Date().toISOString(),
      );
  }

  getPendingByApolloId(apolloPersonId: string): PendingPhone | null {
    return (
      (this.db
        .prepare(
          "SELECT * FROM apollo_pending_phones WHERE apollo_person_id = ? AND status = 'pending'",
        )
        .get(apolloPersonId) as PendingPhone | undefined) ?? null
    );
  }

  resolvePendingPhone(params: {
    apollo_person_id: string;
    phone_number: string;
    phone_type: string;
    delivered_individually: boolean;
  }): void {
    this.db
      .prepare(
        `UPDATE apollo_pending_phones SET
           status = 'received',
           resolved_at = ?,
           phone_number = ?,
           phone_type = ?,
           delivered_individually = ?
         WHERE apollo_person_id = ? AND status = 'pending'`,
      )
      .run(
        new Date().toISOString(),
        params.phone_number,
        params.phone_type,
        params.delivered_individually ? 1 : 0,
        params.apollo_person_id,
      );
  }

  failPendingPhone(apolloPersonId: string): void {
    this.db
      .prepare(
        `UPDATE apollo_pending_phones SET status = 'failed', resolved_at = ?
         WHERE apollo_person_id = ? AND status = 'pending'`,
      )
      .run(new Date().toISOString(), apolloPersonId);
  }

  /** Mark pending records older than maxAgeMs as expired. Returns count expired. */
  expireOldPending(maxAgeMs: number = 2 * 60 * 60 * 1000): number {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const result = this.db
      .prepare(
        `UPDATE apollo_pending_phones SET status = 'expired', resolved_at = ?
         WHERE status = 'pending' AND requested_at < ?`,
      )
      .run(new Date().toISOString(), cutoff);
    return result.changes;
  }

  // ---- Usage stats ----

  getUsageStats(syncLimit: number, asyncPhoneLimit: number): UsageStats {
    const syncUsed = this.getSyncUsedThisMonth();
    const asyncPhoneUsed = this.getAsyncPhoneUsedThisMonth();
    const ms = this.monthStart();

    const q = (sql: string, ...args: unknown[]) =>
      (this.db.prepare(sql).get(...args) as { cnt: number } | undefined)?.cnt ?? 0;

    return {
      month: this.currentMonth(),
      sync: { used: syncUsed, limit: syncLimit, remaining: Math.max(0, syncLimit - syncUsed) },
      async_phone: {
        used: asyncPhoneUsed,
        limit: asyncPhoneLimit,
        remaining: Math.max(0, asyncPhoneLimit - asyncPhoneUsed),
      },
      hit_rates: {
        complete: q(
          "SELECT COUNT(*) as cnt FROM enrichment_log WHERE email_found = 1 AND phone_found = 1 AND enriched_at >= ?",
          ms,
        ),
        awaiting_phone: q(
          "SELECT COUNT(*) as cnt FROM apollo_pending_phones WHERE status = 'pending'",
        ),
        phone_received_via_webhook: q(
          "SELECT COUNT(*) as cnt FROM apollo_pending_phones WHERE status = 'received' AND requested_at >= ?",
          ms,
        ),
        phone_expired: q(
          "SELECT COUNT(*) as cnt FROM apollo_pending_phones WHERE status IN ('expired', 'failed') AND requested_at >= ?",
          ms,
        ),
        no_email: q(
          "SELECT COUNT(*) as cnt FROM enrichment_log WHERE email_found = 0 AND enriched_at >= ?",
          ms,
        ),
      },
      currently_awaiting: q(
        "SELECT COUNT(*) as cnt FROM apollo_pending_phones WHERE status = 'pending'",
      ),
      delivered_individually: q(
        "SELECT COUNT(*) as cnt FROM apollo_pending_phones WHERE delivered_individually = 1 AND requested_at >= ?",
        ms,
      ),
    };
  }

  close(): void {
    this.db.close();
  }
}
