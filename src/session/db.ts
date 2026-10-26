
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ──────────────────────────────────────────────────────────────
// Schema
// ──────────────────────────────────────────────────────────────

const SCHEMA = `
-- Sessions table: tracks conversation sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  adapter TEXT NOT NULL,
  worktree_hash TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  metadata_json TEXT
);

-- Events table: every file edit, git op, task, error, decision
CREATE TABLE IF NOT EXISTS session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,           -- 'file_edit' | 'git_op' | 'task' | 'error' | 'decision' | 'tool_call'
  timestamp INTEGER NOT NULL,
  payload_json TEXT NOT NULL,   -- structured event data
  tokens_estimate INTEGER       -- rough token count of raw output
);

-- FTS5 virtual table for BM25 full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS session_events_fts USING fts5(
  session_id UNINDEXED,
  type UNINDEXED,
  timestamp UNINDEXED,
  content,
  tokenize = 'porter unicode61'
);

-- Trigger to keep FTS in sync with session_events
CREATE TRIGGER IF NOT EXISTS session_events_ai AFTER INSERT ON session_events BEGIN
  INSERT INTO session_events_fts (session_id, type, timestamp, content)
  VALUES (new.session_id, new.type, new.timestamp, new.payload_json);
END;

CREATE TRIGGER IF NOT EXISTS session_events_ad AFTER DELETE ON session_events BEGIN
  INSERT INTO session_events_fts (session_events_fts, session_id, type, timestamp, content)
  VALUES ('delete', old.session_id, old.type, old.timestamp, old.payload_json);
END;

CREATE TRIGGER IF NOT EXISTS session_events_au AFTER UPDATE ON session_events BEGIN
  INSERT INTO session_events_fts (session_events_fts, session_id, type, timestamp, content)
  VALUES ('delete', old.session_id, old.type, old.timestamp, old.payload_json);
  INSERT INTO session_events_fts (session_id, type, timestamp, content)
  VALUES (new.session_id, new.type, new.timestamp, new.payload_json);
END;

-- Index for session lookup by adapter + worktree
CREATE INDEX IF NOT EXISTS idx_sessions_adapter_worktree ON sessions(adapter, worktree_hash);
CREATE INDEX IF NOT EXISTS idx_events_session_ts ON session_events(session_id, timestamp);
`;

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export interface SessionRow {
  id: string;
  adapter: string;
  worktree_hash: string | null;
  started_at: number;
  ended_at: number | null;
  metadata_json: string | null;
}

export interface EventRow {
  id: number;
  session_id: string;
  type: string;
  timestamp: number;
  payload_json: string;
  tokens_estimate: number | null;
}

export interface SearchResult {
  session_id: string;
  type: string;
  timestamp: number;
  content: string;
  rank: number;
}

export interface SessionStats {
  sessionId: string;
  eventCount: number;
  totalTokensEstimate: number;
  types: Record<string, number>;
}

// ──────────────────────────────────────────────────────────────
// Database Class
// ──────────────────────────────────────────────────────────────

export class SessionDB {
  private db: Database.Database;
  private sessionsDir: string;

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir;
    if (!existsSync(sessionsDir)) {
      mkdirSync(sessionsDir, { recursive: true });
    }
    const dbPath = join(sessionsDir, "sessions.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  // ─── Session Management ──────────────────────────────────────

  createSession(id: string, adapter: string, worktreeHash: string | null = null, metadata?: Record<string, unknown>): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, adapter, worktree_hash, started_at, metadata_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, adapter, worktreeHash, Date.now(), metadata ? JSON.stringify(metadata) : null);
  }

  endSession(id: string): void {
    const stmt = this.db.prepare(`UPDATE sessions SET ended_at = ? WHERE id = ?`);
    stmt.run(Date.now(), id);
  }

  getSession(id: string): SessionRow | undefined {
    return this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as SessionRow | undefined;
  }

  getLatestSession(adapter: string, worktreeHash: string | null): SessionRow | undefined {
    return this.db.prepare(`
      SELECT * FROM sessions
      WHERE adapter = ? AND worktree_hash IS ?
      ORDER BY started_at DESC
      LIMIT 1
    `).get(adapter, worktreeHash) as SessionRow | undefined;
  }

  deleteSession(id: string): void {
    // Cascades to session_events and FTS via triggers
    this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
  }

  // ─── Event Recording ─────────────────────────────────────────

  recordEvent(
    sessionId: string,
    type: string,
    payload: Record<string, unknown>,
    tokensEstimate?: number
  ): number {
    const stmt = this.db.prepare(`
      INSERT INTO session_events (session_id, type, timestamp, payload_json, tokens_estimate)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(sessionId, type, Date.now(), JSON.stringify(payload), tokensEstimate ?? null);
    return result.lastInsertRowid as number;
  }

  getEvents(sessionId: string, limit = 100, offset = 0): EventRow[] {
    return this.db.prepare(`
      SELECT * FROM session_events
      WHERE session_id = ?
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `).all(sessionId, limit, offset) as EventRow[];
  }

  // ─── FTS5 Search ─────────────────────────────────────────────

  search(query: string, sessionId?: string, limit = 20): SearchResult[] {
    let sql = `
      SELECT session_id, type, timestamp, content, bm25(session_events_fts) as rank
      FROM session_events_fts
      WHERE session_events_fts MATCH ?
    `;
    const params: (string | number)[] = [query];

    if (sessionId) {
      sql += ` AND session_id = ?`;
      params.push(sessionId);
    }

    sql += ` ORDER BY rank LIMIT ?`;
    params.push(limit);

    return this.db.prepare(sql).all(...params) as SearchResult[];
  }

  // ─── Stats ───────────────────────────────────────────────────

  getSessionStats(sessionId: string): SessionStats {
    const events = this.db.prepare(`
      SELECT type, COUNT(*) as count, COALESCE(SUM(tokens_estimate), 0) as tokens
      FROM session_events
      WHERE session_id = ?
      GROUP BY type
    `).all(sessionId) as Array<{ type: string; count: number; tokens: number }>;

    const totalEvents = events.reduce((sum, e) => sum + e.count, 0);
    const totalTokens = events.reduce((sum, e) => sum + e.tokens, 0);
    const types: Record<string, number> = {};
    for (const e of events) types[e.type] = e.count;

    return { sessionId, eventCount: totalEvents, totalTokensEstimate: totalTokens, types };
  }

  getAllSessionsStats(): Array<{ sessionId: string; eventCount: number; totalTokens: number }> {
    return this.db.prepare(`
      SELECT session_id as sessionId, COUNT(*) as eventCount, COALESCE(SUM(tokens_estimate), 0) as totalTokens
      FROM session_events
      GROUP BY session_id
    `).all() as Array<{ sessionId: string; eventCount: number; totalTokens: number }>;
  }

  // ─── Cleanup ─────────────────────────────────────────────────

  purgeAll(): void {
    this.db.exec(`DELETE FROM session_events; DELETE FROM sessions;`);
  }

  close(): void {
    this.db.close();
  }
}

// ──────────────────────────────────────────────────────────────
// Singleton / Factory
// ──────────────────────────────────────────────────────────────

let _defaultDB: SessionDB | null = null;

export function getDefaultSessionDB(sessionsDir?: string): SessionDB {
  if (!_defaultDB) {
    const dir = sessionsDir ?? join(__dirname, "..", "..", "..", ".context-mode", "sessions");
    _defaultDB = new SessionDB(dir);
  }
  return _defaultDB;
}

export function resetDefaultSessionDB(): void {
  if (_defaultDB) {
    _defaultDB.close();
    _defaultDB = null;
  }
}
