
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SessionDB } from "../src/session/db.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

describe("session database", () => {
  let db: SessionDB;
  const testDir = join(tmpdir(), `context-mode-test-${randomUUID()}`);

  beforeAll(() => {
    db = new SessionDB(testDir);
  });

  afterAll(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it("creates and retrieves sessions", () => {
    const sessionId = "test-session-1";
    db.createSession(sessionId, "test-adapter", "worktree-hash");
    const session = db.getSession(sessionId);
    expect(session).toBeDefined();
    expect(session?.id).toBe(sessionId);
    expect(session?.adapter).toBe("test-adapter");
  });

  it("records and retrieves events", () => {
    const sessionId = "test-session-2";
    db.createSession(sessionId, "test-adapter");
    const eventId = db.recordEvent(sessionId, "file_edit", { file: "test.ts", lines: 10 }, 100);
    expect(eventId).toBeGreaterThan(0);

    const events = db.getEvents(sessionId);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("file_edit");
    expect(events[0].tokens_estimate).toBe(100);
  });

  it("searches events via FTS5", () => {
    const sessionId = "test-session-3";
    db.createSession(sessionId, "test-adapter");
    db.recordEvent(sessionId, "task", { description: "implement feature X" });
    db.recordEvent(sessionId, "task", { description: "fix bug Y" });

    const results = db.search("feature", sessionId);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("feature X");
  });

  it("computes session stats", () => {
    const sessionId = "test-session-4";
    db.createSession(sessionId, "test-adapter");
    db.recordEvent(sessionId, "file_edit", { file: "a.ts" }, 50);
    db.recordEvent(sessionId, "file_edit", { file: "b.ts" }, 75);
    db.recordEvent(sessionId, "git_op", { op: "commit" }, 20);

    const stats = db.getSessionStats(sessionId);
    expect(stats.eventCount).toBe(3);
    expect(stats.totalTokensEstimate).toBe(145);
    expect(stats.types.file_edit).toBe(2);
    expect(stats.types.git_op).toBe(1);
  });

  it("purges sessions", () => {
    const sessionId = "test-session-5";
    db.createSession(sessionId, "test-adapter");
    db.recordEvent(sessionId, "task", { description: "test" });
    db.deleteSession(sessionId);

    const session = db.getSession(sessionId);
    expect(session).toBeUndefined();

    const events = db.getEvents(sessionId);
    expect(events).toHaveLength(0);
  });
});
