import { SessionDB } from "../session/db.js";
import { executeInSandbox } from "../sandbox/executor.js";

export class ClaudeCodeCommands {
  private sessionDB: SessionDB;

  constructor(sessionDB: SessionDB) {
    this.sessionDB = sessionDB;
  }

  async handleCtxStats(): Promise<any> {
    return this.sessionDB.getSessionStats("current-session");
  }

  async handleCtxDoctor(): Promise<any> {
    const stats = await this.handleCtxStats();
    const issues: string[] = [];
    if (stats.eventCount === 0) issues.push("No events recorded");
    if (stats.totalTokensEstimate === 0) issues.push("No tokens recorded");
    return { healthy: issues.length === 0, issues };
  }

  async handleCtxIndex(path: string, recursive: boolean = false): Promise<number> {
    // Simulate indexing
    console.log(`[Command] Index ${path} (recursive=${recursive})`);
    return 1;
  }

  async handleCtxSearch(query: string): Promise<any[]> {
    return this.sessionDB.search(query, "current-session");
  }

  async handleCtxUpgrade(): Promise<any> {
    return { status: "upgraded", version: "0.1.1" };
  }

  async handleCtxPurge(): Promise<any> {
    this.sessionDB.purgeAll();
    return { status: "purged" };
  }

  async handleCtxInsight(): Promise<any> {
    return { insight: "Initial insight" };
  }
}
