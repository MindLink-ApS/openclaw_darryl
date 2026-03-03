/**
 * MemoryStore — wraps mem0ai/oss for persistent conversational memory.
 * Falls back to a simple SQLite-based store if mem0ai fails to load or initialize.
 */

import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

// ============================================================================
// Types
// ============================================================================

export type MemoryResult = {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type Logger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  debug?: (msg: string) => void;
};

// ============================================================================
// Mem0 backend
// ============================================================================

type Mem0Instance = {
  add(
    messages: Array<{ role: string; content: string }>,
    opts: { userId: string; metadata?: Record<string, unknown> },
  ): Promise<{ results: Array<{ id: string; memory: string }> }>;
  search(
    query: string,
    opts: { userId: string; limit?: number },
  ): Promise<{ results: Array<{ id: string; memory: string; score?: number }> }>;
  getAll(opts: { userId: string }): Promise<{ results: Array<{ id: string; memory: string }> }>;
  delete(id: string): Promise<void>;
};

async function createMem0Backend(
  dataDir: string,
  apiKey: string | undefined,
  logger: Logger,
): Promise<Mem0Instance | null> {
  try {
    const { Memory } = await import("mem0ai/oss");
    const config: Record<string, unknown> = {
      version: "v1.1",
      historyDbPath: join(dataDir, "history.db"),
    };

    // Configure OpenAI if key is available
    const resolvedKey = apiKey ?? process.env.OPENAI_API_KEY;
    if (resolvedKey) {
      config.embedder = {
        provider: "openai",
        config: { apiKey: resolvedKey, model: "text-embedding-3-small" },
      };
      config.llm = {
        provider: "openai",
        config: { apiKey: resolvedKey, model: "gpt-4.1-nano-2025-04-14" },
      };
    }

    const memory = new Memory(config);
    logger.info("darryl-mem0: mem0ai/oss backend initialized");
    return memory as Mem0Instance;
  } catch (err) {
    logger.warn(`darryl-mem0: mem0ai/oss failed to load, falling back to SQLite. ${String(err)}`);
    return null;
  }
}

// ============================================================================
// SQLite fallback — simple LIKE-based search, no vector embeddings
// ============================================================================

type SQLiteDb = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): void;
    get(...args: unknown[]): Record<string, unknown> | undefined;
    all(...args: unknown[]): Array<Record<string, unknown>>;
  };
  close(): void;
};

async function openSQLite(dbPath: string): Promise<SQLiteDb> {
  // Try node:sqlite first (Node 22+ built-in, used by darryl-leads)
  try {
    const { createRequire } = await import("node:module");
    const req = createRequire(import.meta.url);
    const { DatabaseSync } = req("node:sqlite") as typeof import("node:sqlite");
    return new DatabaseSync(dbPath) as unknown as SQLiteDb;
  } catch {
    // not available
  }

  // Try better-sqlite3 (common in Node environments)
  try {
    const mod = await import("better-sqlite3");
    const BetterSqlite3 = mod.default ?? mod;
    return new BetterSqlite3(dbPath) as SQLiteDb;
  } catch {
    // not available
  }

  // Try bun:sqlite
  try {
    const mod = await import("bun:sqlite");
    const Database = mod.Database ?? mod.default;
    return new Database(dbPath) as SQLiteDb;
  } catch {
    // not available
  }

  throw new Error("No SQLite driver available (tried node:sqlite, better-sqlite3, bun:sqlite)");
}

class SqliteFallbackStore {
  private db: SQLiteDb | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly dbPath: string,
    private readonly userId: string,
    private readonly logger: Logger,
  ) {}

  private async ensureInit(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    this.db = await openSQLite(this.dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        user_id TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.logger.info("darryl-mem0: SQLite fallback initialized");
  }

  async add(
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<{ id: string }> {
    await this.ensureInit();
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db!.prepare(
      "INSERT INTO memories (id, content, user_id, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, content, this.userId, JSON.stringify(metadata ?? {}), now, now);
    return { id };
  }

  async search(query: string, limit = 5): Promise<MemoryResult[]> {
    await this.ensureInit();
    // Simple LIKE matching on content — not vector search, but functional
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    if (words.length === 0) {
      return this.getAll();
    }
    const conditions = words.map(() => "LOWER(content) LIKE ?").join(" OR ");
    const params = words.map((w) => `%${w}%`);
    const rows = this.db!.prepare(
      `SELECT id, content, metadata, created_at, updated_at FROM memories WHERE user_id = ? AND (${conditions}) ORDER BY updated_at DESC LIMIT ?`,
    ).all(this.userId, ...params, limit);
    return rows.map(rowToResult);
  }

  async delete(id: string): Promise<void> {
    await this.ensureInit();
    this.db!.prepare("DELETE FROM memories WHERE id = ? AND user_id = ?").run(id, this.userId);
  }

  async getAll(): Promise<MemoryResult[]> {
    await this.ensureInit();
    const rows = this.db!.prepare(
      "SELECT id, content, metadata, created_at, updated_at FROM memories WHERE user_id = ? ORDER BY updated_at DESC",
    ).all(this.userId);
    return rows.map(rowToResult);
  }

  close(): void {
    this.db?.close();
    this.db = null;
    this.initPromise = null;
  }
}

function rowToResult(row: Record<string, unknown>): MemoryResult {
  let metadata: Record<string, unknown> = {};
  try {
    if (typeof row.metadata === "string") {
      metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    }
  } catch {
    // ignore malformed JSON
  }
  return {
    id: String(row.id),
    content: String(row.content),
    metadata,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// ============================================================================
// MemoryStore — unified interface
// ============================================================================

export class MemoryStore {
  private mem0: Mem0Instance | null = null;
  private fallback: SqliteFallbackStore | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly userId: string;
  private readonly dataDir: string;
  private readonly apiKey: string | undefined;
  private readonly logger: Logger;

  constructor(
    dataDir: string,
    logger: Logger,
    opts?: { userId?: string; openaiApiKey?: string },
  ) {
    this.dataDir = dataDir;
    this.logger = logger;
    this.userId = opts?.userId ?? "darryl";
    this.apiKey = opts?.openaiApiKey;
  }

  private async ensureInit(): Promise<void> {
    if (this.mem0 || this.fallback) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    // Ensure data dir exists
    fs.mkdirSync(this.dataDir, { recursive: true });

    // Try mem0 first
    this.mem0 = await createMem0Backend(this.dataDir, this.apiKey, this.logger);
    if (!this.mem0) {
      // Fallback to SQLite
      this.fallback = new SqliteFallbackStore(
        join(this.dataDir, "memories.db"),
        this.userId,
        this.logger,
      );
    }
  }

  async add(
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<{ id: string }> {
    await this.ensureInit();

    if (this.mem0) {
      const result = await this.mem0.add(
        [{ role: "user", content }],
        { userId: this.userId, metadata },
      );
      const firstResult = result.results?.[0];
      return { id: firstResult?.id ?? randomUUID() };
    }

    return this.fallback!.add(content, metadata);
  }

  async search(query: string, limit = 5): Promise<MemoryResult[]> {
    await this.ensureInit();

    if (this.mem0) {
      const result = await this.mem0.search(query, { userId: this.userId, limit });
      return (result.results ?? []).map((r) => ({
        id: r.id,
        content: r.memory,
        metadata: {},
        createdAt: "",
        updatedAt: "",
      }));
    }

    return this.fallback!.search(query, limit);
  }

  async delete(id: string): Promise<void> {
    await this.ensureInit();

    if (this.mem0) {
      await this.mem0.delete(id);
      return;
    }

    await this.fallback!.delete(id);
  }

  async getAll(): Promise<MemoryResult[]> {
    await this.ensureInit();

    if (this.mem0) {
      const result = await this.mem0.getAll({ userId: this.userId });
      return (result.results ?? []).map((r) => ({
        id: r.id,
        content: r.memory,
        metadata: {},
        createdAt: "",
        updatedAt: "",
      }));
    }

    return this.fallback!.getAll();
  }

  stop(): void {
    this.fallback?.close();
    this.fallback = null;
    this.mem0 = null;
    this.initPromise = null;
  }
}
