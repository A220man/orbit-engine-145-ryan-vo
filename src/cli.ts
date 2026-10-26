
// CLI entry point - spawns the MCP server
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const serverPath = join(__dirname, "server.ts");

const result = spawnSync(process.execPath, [serverPath], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 0);
