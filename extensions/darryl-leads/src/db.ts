import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { SQLInputValue } from "node:sqlite";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

// Pipeline status priority — higher index = more advanced. Upserts never regress.
const STATUS_PRIORITY: Record<string, number> = {
  awaiting_phone: -1, // Below "new" so upsert with "new" can promote from "awaiting_phone"
  new: 0,
  needs_human_review: 1,
  queued_for_outreach: 2,
  contacted: 3,
  in_conversation: 4,
  do_not_contact: 5,
};

export type LeadInput = {
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
};

export type SourceInput = {
  source_url: string;
  source_label?: string;
  published_on?: string;
};

export type Lead = {
  id: number;
  full_name: string;
  current_title: string;
  current_company: string;
  company_hq_address: string | null;
  email_address: string | null;
  mobile_phone: string | null;
  linkedin_url: string;
  source_url: string | null;
  source_label: string | null;
  source_published_date: string;
  move_effective_date: string | null;
  move_type: string;
  geography: string | null;
  functional_focus: string | null;
  notes: string | null;
  status_pipeline: string;
  do_not_contact_reason: string | null;
  first_seen_at: string;
  last_verified_at: string;
  last_contacted_at: string | null;
  contact_count: number;
  next_follow_up: string | null;
};

export type LeadSource = {
  id: number;
  leader_id: number;
  source_url: string;
  source_label: string | null;
  published_on: string | null;
  created_at: string;
};

export type SearchFilters = {
  name?: string;
  company?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
  require_contact?: boolean;
};

export type CandidateSourceType = "newsletter" | "web" | "referral" | "manual";

export type CandidateStatus = "candidate" | "qualified" | "rejected" | "enriched";

export type LeadCandidateInput = {
  full_name: string;
  current_company: string;
  source_url: string;
  current_title?: string;
  source_label?: string;
  source_published_date?: string;
  geography?: string;
  is_us_based?: boolean;
  pc_relevance?: string;
  title_match?: boolean;
  source_type?: CandidateSourceType;
  qualification_score?: number;
  qualification_status?: CandidateStatus;
  missing_fields?: string[];
  notes?: string;
};

export type LeadCandidate = {
  id: number;
  full_name: string;
  current_title: string | null;
  current_company: string;
  source_url: string;
  source_label: string | null;
  source_published_date: string | null;
  geography: string | null;
  is_us_based: boolean | null;
  pc_relevance: string | null;
  title_match: boolean | null;
  source_type: CandidateSourceType;
  qualification_score: number;
  qualification_status: CandidateStatus;
  missing_fields: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CandidateSearchFilters = {
  status?: CandidateStatus;
  source_type?: CandidateSourceType;
  min_score?: number;
  limit?: number;
  offset?: number;
};

export type LeadStats = {
  total: number;
  byStatus: Record<string, number>;
  recentCount: number;
};

const MIGRATIONS = [
  // v1: core schema
  `CREATE TABLE IF NOT EXISTS leaders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    current_title TEXT NOT NULL,
    current_company TEXT NOT NULL,
    company_hq_address TEXT,
    email_address TEXT,
    mobile_phone TEXT,
    linkedin_url TEXT NOT NULL,
    source_published_date TEXT NOT NULL,
    move_effective_date TEXT,
    move_type TEXT NOT NULL DEFAULT 'unspecified'
      CHECK (move_type IN ('new_employer','internal_promotion','lateral_move','unspecified')),
    geography TEXT,
    functional_focus TEXT,
    notes TEXT,
    status_pipeline TEXT NOT NULL DEFAULT 'new'
      CHECK (status_pipeline IN ('new','awaiting_phone','queued_for_outreach','contacted','in_conversation','do_not_contact','needs_human_review')),
    do_not_contact_reason TEXT,
    first_seen_at TEXT NOT NULL,
    last_verified_at TEXT NOT NULL,
    last_contacted_at TEXT,
    contact_count INTEGER NOT NULL DEFAULT 0,
    next_follow_up TEXT,
    normalized_name TEXT NOT NULL GENERATED ALWAYS AS (lower(trim(full_name))) STORED,
    normalized_company TEXT NOT NULL GENERATED ALWAYS AS (lower(replace(trim(current_company), '.', ''))) STORED
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_leaders_dedup
    ON leaders (normalized_name, normalized_company, current_title, source_published_date);
  CREATE INDEX IF NOT EXISTS idx_leaders_recent ON leaders (source_published_date DESC);
  CREATE INDEX IF NOT EXISTS idx_leaders_pipeline ON leaders (status_pipeline);
  CREATE INDEX IF NOT EXISTS idx_leaders_company ON leaders (normalized_company);

  CREATE TABLE IF NOT EXISTS leader_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    leader_id INTEGER NOT NULL REFERENCES leaders(id) ON DELETE CASCADE,
    source_url TEXT NOT NULL,
    source_label TEXT,
    published_on TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (leader_id, source_url)
  );

  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    display_name TEXT NOT NULL,
    normalized_name TEXT UNIQUE NOT NULL,
    hq_address TEXT,
    website TEXT
  );`,

  // v3: pre-enrichment candidates. This stores cheap research before Apollo credits are spent.
  `CREATE TABLE IF NOT EXISTS lead_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    current_title TEXT,
    current_company TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_label TEXT,
    source_published_date TEXT,
    geography TEXT,
    is_us_based INTEGER,
    pc_relevance TEXT,
    title_match INTEGER,
    source_type TEXT NOT NULL DEFAULT 'web'
      CHECK (source_type IN ('newsletter','web','referral','manual')),
    qualification_score INTEGER NOT NULL DEFAULT 0
      CHECK (qualification_score >= 0 AND qualification_score <= 100),
    qualification_status TEXT NOT NULL DEFAULT 'candidate'
      CHECK (qualification_status IN ('candidate','qualified','rejected','enriched')),
    missing_fields TEXT NOT NULL DEFAULT '[]',
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    normalized_name TEXT NOT NULL GENERATED ALWAYS AS (lower(trim(full_name))) STORED,
    normalized_company TEXT NOT NULL GENERATED ALWAYS AS (lower(replace(trim(current_company), '.', ''))) STORED,
    UNIQUE (normalized_name, normalized_company, source_url)
  );

  CREATE INDEX IF NOT EXISTS idx_lead_candidates_status
    ON lead_candidates (qualification_status, qualification_score DESC);
  CREATE INDEX IF NOT EXISTS idx_lead_candidates_source_type
    ON lead_candidates (source_type);
  CREATE INDEX IF NOT EXISTS idx_lead_candidates_updated
    ON lead_candidates (updated_at DESC);`,
];

// v2: widen status_pipeline CHECK to include 'awaiting_phone' (SQLite requires table rebuild).
// This is a function migration because SQLite can't ALTER CHECK constraints — we must
// conditionally rebuild the table, which requires logic that pure SQL can't express.
function migrateV2AddAwaitingPhone(db: InstanceType<typeof DatabaseSync>): void {
  // Idempotency marker — skip if already applied
  const marker = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_migration_v2_done'")
    .get();
  if (marker) return;

  // Check if the existing CHECK already includes 'awaiting_phone' (new DB from v1)
  const tableInfo = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='leaders'")
    .get() as { sql: string } | undefined;

  if (!tableInfo) return; // Table doesn't exist yet — v1 will create it with the correct CHECK

  if (tableInfo.sql.includes("awaiting_phone")) {
    // Already has the correct CHECK (created fresh with updated v1). Just mark done.
    db.exec(
      "CREATE TABLE _migration_v2_done (v INTEGER); INSERT INTO _migration_v2_done VALUES (1);",
    );
    return;
  }

  // Rebuild: create new table with updated CHECK → copy data → swap (atomic via transaction)
  db.exec(`
    BEGIN;
    CREATE TABLE leaders_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      current_title TEXT NOT NULL,
      current_company TEXT NOT NULL,
      company_hq_address TEXT,
      email_address TEXT,
      mobile_phone TEXT,
      linkedin_url TEXT NOT NULL,
      source_published_date TEXT NOT NULL,
      move_effective_date TEXT,
      move_type TEXT NOT NULL DEFAULT 'unspecified'
        CHECK (move_type IN ('new_employer','internal_promotion','lateral_move','unspecified')),
      geography TEXT,
      functional_focus TEXT,
      notes TEXT,
      status_pipeline TEXT NOT NULL DEFAULT 'new'
        CHECK (status_pipeline IN ('new','awaiting_phone','queued_for_outreach','contacted','in_conversation','do_not_contact','needs_human_review')),
      do_not_contact_reason TEXT,
      first_seen_at TEXT NOT NULL,
      last_verified_at TEXT NOT NULL,
      last_contacted_at TEXT,
      contact_count INTEGER NOT NULL DEFAULT 0,
      next_follow_up TEXT,
      normalized_name TEXT NOT NULL GENERATED ALWAYS AS (lower(trim(full_name))) STORED,
      normalized_company TEXT NOT NULL GENERATED ALWAYS AS (lower(replace(trim(current_company), '.', ''))) STORED
    );

    INSERT INTO leaders_v2 (
      id, full_name, current_title, current_company, company_hq_address,
      email_address, mobile_phone, linkedin_url, source_published_date,
      move_effective_date, move_type, geography, functional_focus, notes,
      status_pipeline, do_not_contact_reason, first_seen_at, last_verified_at,
      last_contacted_at, contact_count, next_follow_up
    )
    SELECT
      id, full_name, current_title, current_company, company_hq_address,
      email_address, mobile_phone, linkedin_url, source_published_date,
      move_effective_date, move_type, geography, functional_focus, notes,
      status_pipeline, do_not_contact_reason, first_seen_at, last_verified_at,
      last_contacted_at, contact_count, next_follow_up
    FROM leaders;

    DROP TABLE leaders;
    ALTER TABLE leaders_v2 RENAME TO leaders;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_leaders_dedup
      ON leaders (normalized_name, normalized_company, current_title, source_published_date);
    CREATE INDEX IF NOT EXISTS idx_leaders_recent ON leaders (source_published_date DESC);
    CREATE INDEX IF NOT EXISTS idx_leaders_pipeline ON leaders (status_pipeline);
    CREATE INDEX IF NOT EXISTS idx_leaders_company ON leaders (normalized_company);

    CREATE TABLE _migration_v2_done (v INTEGER);
    INSERT INTO _migration_v2_done VALUES (1);
    COMMIT;
  `);
}

// Also clean up the broken v2 marker table if it exists from the previous stub
function cleanupBrokenV2Stub(db: InstanceType<typeof DatabaseSync>): void {
  const stub = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_leaders_v2_check'")
    .get();
  if (stub) {
    db.exec("DROP TABLE _leaders_v2_check;");
  }
}

export class LeadsDB {
  private db: InstanceType<typeof DatabaseSync>;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.db.exec("PRAGMA foreign_keys=ON;");
    this.runMigrations();
  }

  private runMigrations(): void {
    for (const sql of MIGRATIONS) {
      this.db.exec(sql);
    }
    // Function migrations (can't be expressed as pure SQL)
    cleanupBrokenV2Stub(this.db);
    migrateV2AddAwaitingPhone(this.db);
  }

  upsert(lead: LeadInput): { id: number; action: "created" | "updated"; status_pipeline: string } {
    const now = new Date().toISOString();
    const moveType = lead.move_type ?? "unspecified";
    let statusPipeline = lead.status_pipeline ?? "new";

    // Try to find existing lead by dedup key
    const existing = this.db
      .prepare(
        `SELECT id, status_pipeline, move_type, email_address, mobile_phone FROM leaders
         WHERE normalized_name = lower(trim(?))
           AND normalized_company = lower(replace(trim(?), '.', ''))
           AND current_title = ?
           AND source_published_date = ?`,
      )
      .get(lead.full_name, lead.current_company, lead.current_title, lead.source_published_date) as
      | {
          id: number;
          status_pipeline: string;
          move_type: string;
          email_address: string | null;
          mobile_phone: string | null;
        }
      | undefined;

    if (existing) {
      // Never regress pipeline status — keep whichever is more advanced
      const existingPriority = STATUS_PRIORITY[existing.status_pipeline] ?? 0;
      const incomingPriority = STATUS_PRIORITY[statusPipeline] ?? 0;
      let finalStatus =
        incomingPriority > existingPriority ? statusPipeline : existing.status_pipeline;

      // Enforce delivery gate: "new" requires both email AND phone
      const resultingEmail = lead.email_address ?? existing.email_address;
      const resultingPhone = lead.mobile_phone ?? existing.mobile_phone;
      if (finalStatus === "new" && (!resultingEmail || !resultingPhone)) {
        finalStatus = resultingEmail ? "awaiting_phone" : "needs_human_review";
      }

      // Never overwrite a specific move_type with "unspecified"
      const finalMoveType =
        moveType === "unspecified" && existing.move_type !== "unspecified"
          ? existing.move_type
          : moveType;

      this.db
        .prepare(
          `UPDATE leaders SET
            company_hq_address = COALESCE(?, company_hq_address),
            email_address = COALESCE(?, email_address),
            mobile_phone = COALESCE(?, mobile_phone),
            linkedin_url = COALESCE(?, linkedin_url),
            move_effective_date = COALESCE(?, move_effective_date),
            move_type = ?,
            geography = COALESCE(?, geography),
            functional_focus = COALESCE(?, functional_focus),
            notes = COALESCE(?, notes),
            status_pipeline = ?,
            last_verified_at = ?
          WHERE id = ?`,
        )
        .run(
          lead.company_hq_address ?? null,
          lead.email_address ?? null,
          lead.mobile_phone ?? null,
          lead.linkedin_url ?? null,
          lead.move_effective_date ?? null,
          finalMoveType,
          lead.geography ?? null,
          lead.functional_focus ?? null,
          lead.notes ?? null,
          finalStatus,
          now,
          existing.id,
        );
      return { id: existing.id, action: "updated", status_pipeline: finalStatus };
    }

    // Enforce delivery gate: "new" requires both email AND phone
    if (statusPipeline === "new" && (!lead.email_address || !lead.mobile_phone)) {
      statusPipeline = lead.email_address ? "awaiting_phone" : "needs_human_review";
    }

    const result = this.db
      .prepare(
        `INSERT INTO leaders (
          full_name, current_title, current_company,
          company_hq_address, email_address, mobile_phone, linkedin_url,
          source_published_date, move_effective_date, move_type,
          geography, functional_focus, notes, status_pipeline,
          first_seen_at, last_verified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        lead.full_name,
        lead.current_title,
        lead.current_company,
        lead.company_hq_address ?? null,
        lead.email_address ?? null,
        lead.mobile_phone ?? null,
        lead.linkedin_url,
        lead.source_published_date,
        lead.move_effective_date ?? null,
        moveType,
        lead.geography ?? null,
        lead.functional_focus ?? null,
        lead.notes ?? null,
        statusPipeline,
        now,
        now,
      );

    return {
      id: Number(result.lastInsertRowid),
      action: "created",
      status_pipeline: statusPipeline,
    };
  }

  getById(id: number): (Lead & { sources: LeadSource[] }) | null {
    const lead = this.db
      .prepare(
        `SELECT id, full_name, current_title, current_company,
          company_hq_address, email_address, mobile_phone, linkedin_url,
          (SELECT source_url FROM leader_sources WHERE leader_id = leaders.id ORDER BY created_at DESC LIMIT 1) AS source_url,
          (SELECT source_label FROM leader_sources WHERE leader_id = leaders.id ORDER BY created_at DESC LIMIT 1) AS source_label,
          source_published_date, move_effective_date, move_type,
          geography, functional_focus, notes, status_pipeline,
          do_not_contact_reason, first_seen_at, last_verified_at,
          last_contacted_at, contact_count, next_follow_up
        FROM leaders WHERE id = ?`,
      )
      .get(id) as Lead | undefined;

    if (!lead) return null;

    const sources = this.db
      .prepare(
        `SELECT id, leader_id, source_url, source_label, published_on, created_at
         FROM leader_sources WHERE leader_id = ? ORDER BY created_at DESC`,
      )
      .all(id) as LeadSource[];

    return { ...lead, sources };
  }

  search(filters: SearchFilters): Lead[] {
    const conditions: string[] = [];
    const params: SQLInputValue[] = [];

    if (filters.name) {
      conditions.push("normalized_name LIKE ?");
      params.push(`%${filters.name.toLowerCase()}%`);
    }
    if (filters.company) {
      conditions.push("normalized_company LIKE ?");
      params.push(`%${filters.company.toLowerCase().replace(/\./g, "")}%`);
    }
    if (filters.status) {
      conditions.push("status_pipeline = ?");
      params.push(filters.status);
    }
    if (filters.date_from) {
      conditions.push("first_seen_at >= ?");
      params.push(filters.date_from);
    }
    if (filters.date_to) {
      conditions.push("first_seen_at <= ?");
      params.push(filters.date_to + "T23:59:59.999Z");
    }
    if (filters.require_contact) {
      conditions.push("email_address IS NOT NULL AND email_address != ''");
      conditions.push("mobile_phone IS NOT NULL AND mobile_phone != ''");
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const sql = `SELECT id, full_name, current_title, current_company,
      company_hq_address, email_address, mobile_phone, linkedin_url,
      (SELECT source_url FROM leader_sources WHERE leader_id = leaders.id ORDER BY created_at DESC LIMIT 1) AS source_url,
      (SELECT source_label FROM leader_sources WHERE leader_id = leaders.id ORDER BY created_at DESC LIMIT 1) AS source_label,
      source_published_date, move_effective_date, move_type,
      geography, functional_focus, notes, status_pipeline,
      do_not_contact_reason, first_seen_at, last_verified_at,
      last_contacted_at, contact_count, next_follow_up
    FROM leaders ${where}
    ORDER BY first_seen_at DESC
    LIMIT ? OFFSET ?`;

    return this.db.prepare(sql).all(...params, limit, offset) as Lead[];
  }

  updatePipeline(id: number, status: string, reason?: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE leaders
         SET status_pipeline = ?,
             do_not_contact_reason = ?,
             last_verified_at = ?
         WHERE id = ?`,
      )
      .run(status, reason ?? null, now, id);
  }

  recordContact(id: number, nextFollowUp?: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE leaders
         SET last_contacted_at = ?,
             contact_count = contact_count + 1,
             next_follow_up = ?,
             last_verified_at = ?
         WHERE id = ?`,
      )
      .run(now, nextFollowUp ?? null, now, id);
  }

  getStats(): LeadStats {
    const totalRow = this.db.prepare("SELECT COUNT(*) as count FROM leaders").get() as {
      count: number;
    };

    const statusRows = this.db
      .prepare("SELECT status_pipeline, COUNT(*) as count FROM leaders GROUP BY status_pipeline")
      .all() as Array<{ status_pipeline: string; count: number }>;

    const byStatus: Record<string, number> = {};
    for (const row of statusRows) {
      byStatus[row.status_pipeline] = row.count;
    }

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentRow = this.db
      .prepare("SELECT COUNT(*) as count FROM leaders WHERE first_seen_at >= ?")
      .get(weekAgo) as { count: number };

    return {
      total: totalRow.count,
      byStatus,
      recentCount: recentRow.count,
    };
  }

  exportLeads(filters?: SearchFilters): Lead[] {
    return this.search({
      ...filters,
      limit: 100_000,
      offset: 0,
    });
  }

  upsertCandidate(candidate: LeadCandidateInput): {
    id: number;
    action: "created" | "updated";
    qualification_status: CandidateStatus;
  } {
    const now = new Date().toISOString();
    const qualificationScore = clampQualificationScore(candidate.qualification_score ?? 0);
    const qualificationStatus = candidate.qualification_status ?? "candidate";
    const sourceType = candidate.source_type ?? "web";
    const missingFields = JSON.stringify(candidate.missing_fields ?? []);

    const existing = this.db
      .prepare(
        `SELECT id FROM lead_candidates
         WHERE normalized_name = lower(trim(?))
           AND normalized_company = lower(replace(trim(?), '.', ''))
           AND source_url = ?`,
      )
      .get(candidate.full_name, candidate.current_company, candidate.source_url) as
      | { id: number }
      | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE lead_candidates SET
             current_title = COALESCE(?, current_title),
             source_label = COALESCE(?, source_label),
             source_published_date = COALESCE(?, source_published_date),
             geography = COALESCE(?, geography),
             is_us_based = COALESCE(?, is_us_based),
             pc_relevance = COALESCE(?, pc_relevance),
             title_match = COALESCE(?, title_match),
             source_type = ?,
             qualification_score = ?,
             qualification_status = ?,
             missing_fields = ?,
             notes = COALESCE(?, notes),
             updated_at = ?
           WHERE id = ?`,
        )
        .run(
          candidate.current_title ?? null,
          candidate.source_label ?? null,
          candidate.source_published_date ?? null,
          candidate.geography ?? null,
          optionalBoolToInt(candidate.is_us_based),
          candidate.pc_relevance ?? null,
          optionalBoolToInt(candidate.title_match),
          sourceType,
          qualificationScore,
          qualificationStatus,
          missingFields,
          candidate.notes ?? null,
          now,
          existing.id,
        );
      return { id: existing.id, action: "updated", qualification_status: qualificationStatus };
    }

    const result = this.db
      .prepare(
        `INSERT INTO lead_candidates (
          full_name, current_title, current_company, source_url, source_label,
          source_published_date, geography, is_us_based, pc_relevance,
          title_match, source_type, qualification_score, qualification_status,
          missing_fields, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        candidate.full_name,
        candidate.current_title ?? null,
        candidate.current_company,
        candidate.source_url,
        candidate.source_label ?? null,
        candidate.source_published_date ?? null,
        candidate.geography ?? null,
        optionalBoolToInt(candidate.is_us_based),
        candidate.pc_relevance ?? null,
        optionalBoolToInt(candidate.title_match),
        sourceType,
        qualificationScore,
        qualificationStatus,
        missingFields,
        candidate.notes ?? null,
        now,
        now,
      );

    return {
      id: Number(result.lastInsertRowid),
      action: "created",
      qualification_status: qualificationStatus,
    };
  }

  searchCandidates(filters: CandidateSearchFilters): LeadCandidate[] {
    const conditions: string[] = [];
    const params: SQLInputValue[] = [];

    if (filters.status) {
      conditions.push("qualification_status = ?");
      params.push(filters.status);
    }
    if (filters.source_type) {
      conditions.push("source_type = ?");
      params.push(filters.source_type);
    }
    if (typeof filters.min_score === "number") {
      conditions.push("qualification_score >= ?");
      params.push(clampQualificationScore(filters.min_score));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    const rows = this.db
      .prepare(
        `SELECT id, full_name, current_title, current_company, source_url, source_label,
          source_published_date, geography, is_us_based, pc_relevance, title_match,
          source_type, qualification_score, qualification_status, missing_fields,
          notes, created_at, updated_at
         FROM lead_candidates ${where}
         ORDER BY qualification_score DESC, updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as Array<Record<string, unknown>>;

    return rows.map(rowToCandidate);
  }

  getSourcesByLeaderId(leaderId: number): LeadSource[] {
    return this.db
      .prepare(
        `SELECT id, leader_id, source_url, source_label, published_on, created_at
         FROM leader_sources WHERE leader_id = ? ORDER BY created_at DESC`,
      )
      .all(leaderId) as LeadSource[];
  }

  addSource(leaderId: number, source: SourceInput): void {
    // INSERT OR IGNORE prevents duplicate (leader_id, source_url) entries
    this.db
      .prepare(
        `INSERT OR IGNORE INTO leader_sources (leader_id, source_url, source_label, published_on)
         VALUES (?, ?, ?, ?)`,
      )
      .run(leaderId, source.source_url, source.source_label ?? null, source.published_on ?? null);
  }

  close(): void {
    this.db.close();
  }
}

function optionalBoolToInt(value: boolean | undefined): number | null {
  if (value === undefined) return null;
  return value ? 1 : 0;
}

function intToOptionalBool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return Number(value) === 1;
}

function clampQualificationScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseMissingFields(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function rowToCandidate(row: Record<string, unknown>): LeadCandidate {
  return {
    id: Number(row.id),
    full_name: String(row.full_name),
    current_title: typeof row.current_title === "string" ? row.current_title : null,
    current_company: String(row.current_company),
    source_url: String(row.source_url),
    source_label: typeof row.source_label === "string" ? row.source_label : null,
    source_published_date:
      typeof row.source_published_date === "string" ? row.source_published_date : null,
    geography: typeof row.geography === "string" ? row.geography : null,
    is_us_based: intToOptionalBool(row.is_us_based),
    pc_relevance: typeof row.pc_relevance === "string" ? row.pc_relevance : null,
    title_match: intToOptionalBool(row.title_match),
    source_type: String(row.source_type) as CandidateSourceType,
    qualification_score: Number(row.qualification_score),
    qualification_status: String(row.qualification_status) as CandidateStatus,
    missing_fields: parseMissingFields(row.missing_fields),
    notes: typeof row.notes === "string" ? row.notes : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}
