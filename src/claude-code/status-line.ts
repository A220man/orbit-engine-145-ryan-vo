import { SessionDB } from "../session/db.js";

export class ClaudeCodeStatusLine {
  private sessionDB: SessionDB;

  constructor(sessionDB: SessionDB) {
    this.sessionDB = sessionDB;
  }

  updateStatusLine(): string {
    const stats = this.sessionDB.getSessionStats("current-session");
    return `[Context-Mode] Sessions: ${stats.eventCount} Events | Tokens: ${stats.totalTokensEstimate}`;
  }
}
