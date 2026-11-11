import { SessionDB } from "../session/db.js";
import { executeInSandbox } from "../sandbox/executor.js";

export class ClaudeCodeHooks {
  private sessionDB: SessionDB;

  constructor(sessionDB: SessionDB) {
    this.sessionDB = sessionDB;
  }

  // PreToolUse: Inject routing instructions before tool execution
  async preToolUse(toolName: string, toolInput: Record<string, any>): Promise<void> {
    console.log(`[Hook] PreToolUse: ${toolName}`);
    await this.sessionDB.recordEvent("current-session", "pre_tool_use", {
      toolName,
      toolInput,
    });
  }

  // PostToolUse: Capture tool execution results
  async postToolUse(toolName: string, toolOutput: Record<string, any>): Promise<void> {
    console.log(`[Hook] PostToolUse: ${toolName}`);
    await this.sessionDB.recordEvent("current-session", "post_tool_use", {
      toolName,
      toolOutput,
    });
  }

  // UserPromptSubmit: Log user prompts
  async userPromptSubmit(prompt: string): Promise<void> {
    console.log(`[Hook] UserPromptSubmit: ${prompt}`);
    await this.sessionDB.recordEvent("current-session", "user_prompt_submit", {
      prompt,
    });
  }

  // PreCompact: Index session events into FTS5 before compacting
  async preCompact(sessionId: string): Promise<void> {
    console.log(`[Hook] PreCompact for session ${sessionId}`);
    await this.sessionDB.recordEvent(sessionId, "pre_compact", {
      message: "Indexing events into FTS5",
    });
  }

  // SessionStart: Inject routing instructions
  async sessionStart(sessionId: string, adapter: string): Promise<void> {
    console.log(`[Hook] SessionStart: ${adapter}`);
    await this.sessionDB.recordEvent(sessionId, "session_start", {
      adapter,
      message: "Routing instructions injected",
    });
  }

  // Stop: Clean up session resources
  async stop(sessionId: string): Promise<void> {
    console.log(`[Hook] Stop for session ${sessionId}`);
    await this.sessionDB.recordEvent(sessionId, "stop", {
      message: "Session stopped",
    });
  }
}
