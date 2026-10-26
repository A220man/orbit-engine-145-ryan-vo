# Product development plan

Each round completes one feature or repair. Future items are planned, not implemented claims.

## Current round

core-mcp-server

## Roadmap

### core-mcp-server — Core MCP Server with Sandbox Tools

Status: in_progress

Acceptance:
- MCP server starts and registers 6 sandbox tools (ctx_execute, ctx_batch_execute, ctx_execute_file, ctx_index, ctx_search, ctx_fetch_and_index)
- MCP server registers 5 meta tools (ctx_stats, ctx_doctor, ctx_upgrade, ctx_purge, ctx_insight)
- SQLite + FTS5 session database persists events and enables BM25 search
- ctx_execute runs JavaScript/TypeScript code in isolated sandbox and returns only stdout
- Basic CLI entry point works: `npx context-mode` starts the server

Implementation: `src/server.ts`, `src/session/db.ts`, `src/sandbox/executor.ts`, `package.json`

Tests: `tests/server.test.ts`, `tests/sandbox.test.ts`

### claude-code-plugin — Claude Code Plugin with Hooks

Status: planned

Acceptance:
- Plugin manifest registers all 6 hooks (PreToolUse, PostToolUse, UserPromptSubmit, PreCompact, SessionStart, Stop)
- SessionStart hook injects routing instructions
- Slash commands work: ctx-stats, ctx-doctor, ctx-index, ctx-search, ctx-upgrade, ctx-purge, ctx-insight
- Status line integration works

### gemini-cli-support — Gemini CLI Configuration

Status: planned

Acceptance:
- settings.json config registers MCP server and 4 hooks
- BeforeTool matcher targets high-output tools only
- SessionStart hook injects routing

### session-continuity — Session Continuity & FTS5 Search

Status: planned

Acceptance:
- File edits, git ops, tasks, errors, decisions tracked in SQLite
- PreCompact hook indexes events into FTS5
- BM25 search retrieves only relevant context
- Fresh session without --continue deletes previous data

