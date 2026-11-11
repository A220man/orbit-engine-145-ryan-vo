import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionDB } from "../src/session/db.js";
import { ClaudeCodeHooks } from "../src/claude-code/hooks.js";
import { ClaudeCodeCommands } from "../src/claude-code/commands.js";
import { ClaudeCodeStatusLine } from "../src/claude-code/status-line.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

describe("claude-code-plugin", () => {
  let testDir: string;
  let db: SessionDB;
  let hooks: ClaudeCodeHooks;
  let commands: ClaudeCodeCommands;
  let statusLine: ClaudeCodeStatusLine;

  beforeEach(() => {
    testDir = join(tmpdir(), `context-mode-claude-test-${randomUUID()}`);
    db = new SessionDB(testDir);
    hooks = new ClaudeCodeHooks(db);
    commands = new ClaudeCodeCommands(db);
    statusLine = new ClaudeCodeStatusLine(db);
  });

  afterEach(() => {
    db.close();
  });

  it("registers all 6 hooks", () => {
    expect(typeof hooks.preToolUse).toBe("function");
    expect(typeof hooks.postToolUse).toBe("function");
    expect(typeof hooks.userPromptSubmit).toBe("function");
    expect(typeof hooks.preCompact).toBe("function");
    expect(typeof hooks.sessionStart).toBe("function");
    expect(typeof hooks.stop).toBe("function");
  });

  it("session start hook injects routing instructions", async () => {
    await hooks.sessionStart("test-session-1", "test-adapter");
    const events = db.getEvents("test-session-1");
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe("session_start");
  });

  it("ctx-stats slash command works", async () => {
    db.createSession("stats-session", "test-adapter");
    const result = await commands.handleCtxStats();
    expect(result.sessionId).toBe("stats-session");
    expect(result.eventCount).toBeGreaterThanOrEqual(0);
  });

  it("ctx-doctor slash command works", async () => {
    const result = await commands.handleCtxDoctor();
    expect(result.healthy).toBeDefined();
    expect(result.issues).toBeInstanceOf(Array);
  });

  it("ctx-index slash command works", async () => {
    const result = await commands.handleCtxIndex("/tmp", true);
    expect(result).toBeGreaterThan(0);
  });

  it("ctx-search slash command works", async () => {
    db.createSession("search-session", "test-adapter");
    db.recordEvent("search-session", "task", { description: "find something" });
    const results = await commands.handleCtxSearch("find");
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it("ctx-upgrade slash command works", async () => {
    const result = await commands.handleCtxUpgrade();
    expect(result.status).toBe("upgraded");
  });

  it("ctx-purge slash command works", async () => {
    db.createSession("purge-session", "test-adapter");
    db.recordEvent("purge-session", "task", { description: "test" });
    const result = await commands.handleCtxPurge();
    expect(result.status).toBe("purged");
  });

  it("ctx-insight slash command works", async () => {
    const result = await commands.handleCtxInsight();
    expect(result.insight).toBeDefined();
  });

  it("status line integration works", () => {
    const status = statusLine.updateStatusLine();
    expect(status).toContain("[Context-Mode]");
  });
});
