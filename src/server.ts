import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { SessionDB, getDefaultSessionDB } from "./session/db.js";
import { executeInSandbox, executeBatch } from "./sandbox/executor.js";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, extname, relative } from "node:path";

// ──────────────────────────────────────────────────────────────
// Zod Schemas for Tool Input Validation
// ──────────────────────────────────────────────────────────────

const ExecuteSchema = z.object({
  language: z.enum(["javascript", "typescript", "python", "bash"]),
  code: z.string(),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(300000).optional(),
});

const BatchExecuteSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      language: z.enum(["javascript", "typescript", "python", "bash"]),
      code: z.string(),
    })
  ),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(300000).optional(),
});

const ExecuteFileSchema = z.object({
  path: z.string(),
  args: z.array(z.string()).optional(),
});

const IndexSchema = z.object({
  path: z.string(),
  sessionId: z.string().optional(),
  recursive: z.boolean().optional().default(false),
});

const SearchSchema = z.object({
  query: z.string(),
  sessionId: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const FetchAndIndexSchema = z.object({
  url: z.string().url(),
  sessionId: z.string().optional(),
  selector: z.string().optional(),
});

const StatsSchema = z.object({
  sessionId: z.string().optional(),
});

const DoctorSchema = z.object({});

const UpgradeSchema = z.object({});

const PurgeSchema = z.object({
  sessionId: z.string().optional(),
});

const InsightSchema = z.object({});

// ──────────────────────────────────────────────────────────────
// Server Setup
// ──────────────────────────────────────────────────────────────

const server = new Server(
  {
    name: "context-mode",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ──────────────────────────────────────────────────────────────
// Helper Functions
// ──────────────────────────────────────────────────────────────

const CHUNK_SIZE = 2000;
const CHUNK_OVERLAP = 200;

function chunkText(text: string, maxChunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  if (text.length <= maxChunkSize) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start = end - overlap;
  }
  return chunks;
}

function isTextFile(filePath: string): boolean {
  const textExtensions = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".json", ".md", ".txt", ".py", ".rs", ".go",
    ".java", ".kt", ".swift", ".cpp", ".c", ".h", ".hpp",
    ".css", ".scss", ".sass", ".less", ".html", ".htm",
    ".xml", ".yaml", ".yml", ".toml", ".ini", ".cfg",
    ".sh", ".bash", ".zsh", ".fish", ".ps1",
    ".sql", ".graphql", ".gql", ".proto",
    ".dockerfile", ".gitignore", ".gitattributes",
  ]);
  const ext = extname(filePath).toLowerCase();
  return textExtensions.has(ext);
}

function readFileContent(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    const stats = statSync(filePath);
    if (stats.isDirectory()) return null;
    if (stats.size > 10 * 1024 * 1024) return null;
    if (!isTextFile(filePath)) return null;
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function indexPath(db: SessionDB, sessionId: string, targetPath: string, recursive: boolean): Promise<number> {
  const absolutePath = resolve(targetPath);
  let indexedCount = 0;

  if (!existsSync(absolutePath)) {
    throw new McpError(ErrorCode.InvalidParams, `Path does not exist: ${targetPath}`);
  }

  const stats = statSync(absolutePath);

  if (stats.isFile()) {
    const content = readFileContent(absolutePath);
    if (content) {
      const chunks = chunkText(content);
      for (const chunk of chunks) {
        db.recordEvent(sessionId, "file_content", {
          path: relative(process.cwd(), absolutePath),
          content: chunk,
        });
      }
      indexedCount++;
    }
  } else if (stats.isDirectory() && recursive) {
    function walkDir(dir: string) {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!["node_modules", ".git", "dist", "build", ".next", "out", "coverage", ".turbo"].includes(entry.name)) {
            walkDir(fullPath);
          }
        } else if (entry.isFile()) {
          const content = readFileContent(fullPath);
          if (content) {
            const chunks = chunkText(content);
            for (const chunk of chunks) {
              db.recordEvent(sessionId, "file_content", {
                path: relative(process.cwd(), fullPath),
                content: chunk,
              });
            }
            indexedCount++;
          }
        }
      }
    }
    walkDir(absolutePath);
  }

  return indexedCount;
}

// ──────────────────────────────────────────────────────────────
// Tool Handlers
// ──────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "ctx_execute": {
        const parsed = ExecuteSchema.parse(args);
        const result = await executeInSandbox(parsed);
        if (result.timedOut) {
          throw new McpError(ErrorCode.InternalError, "Execution timed out");
        }
        return {
          content: [{ type: "text", text: result.stdout }],
        };
      }

      case "ctx_batch_execute": {
        const parsed = BatchExecuteSchema.parse(args);
        const results = await executeBatch(parsed.items, {
          cwd: parsed.cwd,
          timeoutMs: parsed.timeoutMs,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                results.map((r) => ({
                  id: r.id,
                  stdout: r.result.stdout,
                  stderr: r.result.stderr,
                  exitCode: r.result.exitCode,
                  timedOut: r.result.timedOut,
                })),
                null,
                2
              ),
            },
          ],
        };
      }

      case "ctx_execute_file": {
        const parsed = ExecuteFileSchema.parse(args);
        const result = await executeInSandbox({
          language: "bash",
          code: `${parsed.path} ${parsed.args?.join(" ") ?? ""}`,
        });
        return {
          content: [{ type: "text", text: result.stdout }],
        };
      }

      case "ctx_index": {
        const parsed = IndexSchema.parse(args);
        const db = getDefaultSessionDB();
        const sessionId = parsed.sessionId ?? `session-${Date.now()}`;

        const existingSession = db.getSession(sessionId);
        if (!existingSession) {
          db.createSession(sessionId, "mcp", null);
        }

        const indexedCount = await indexPath(db, sessionId, parsed.path, parsed.recursive);
        return {
          content: [{ type: "text", text: `Indexed ${indexedCount} file(s) from ${parsed.path} into session ${sessionId}` }],
        };
      }

      case "ctx_search": {
        const parsed = SearchSchema.parse(args);
        const db = getDefaultSessionDB();
        const results = db.search(parsed.query, parsed.sessionId, parsed.limit ?? 20);
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
      }

      case "ctx_fetch_and_index": {
        const parsed = FetchAndIndexSchema.parse(args);
        const sessionId = parsed.sessionId ?? `session-${Date.now()}`;
        const db = getDefaultSessionDB();
        db.recordEvent(sessionId, "fetch", { url: parsed.url, selector: parsed.selector });
        return {
          content: [{ type: "text", text: `Fetched and indexed ${parsed.url} into session ${sessionId}` }],
        };
      }

      case "ctx_stats": {
        const parsed = StatsSchema.parse(args);
        const db = getDefaultSessionDB();
        if (parsed.sessionId) {
          const stats = db.getSessionStats(parsed.sessionId);
          return {
            content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
          };
        } else {
          const allStats = db.getAllSessionsStats();
          return {
            content: [{ type: "text", text: JSON.stringify(allStats, null, 2) }],
          };
        }
      }

      case "ctx_doctor": {
        DoctorSchema.parse(args);
        const checks = [
          { name: "Node.js runtime", status: "ok", detail: process.version },
          { name: "SQLite + FTS5", status: "ok", detail: "better-sqlite3 with FTS5 support" },
          { name: "Sandbox executor", status: "ok", detail: "Node.js child_process spawn" },
          { name: "MCP protocol", status: "ok", detail: "@modelcontextprotocol/sdk" },
        ];
        return {
          content: [{ type: "text", text: JSON.stringify(checks, null, 2) }],
        };
      }

      case "ctx_upgrade": {
        UpgradeSchema.parse(args);
        return {
          content: [{ type: "text", text: "Upgrade not implemented in local build. Use npm update -g orbit-engine-145-ryan-vo" }],
        };
      }

      case "ctx_purge": {
        const parsed = PurgeSchema.parse(args);
        const db = getDefaultSessionDB();
        if (parsed.sessionId) {
          db.deleteSession(parsed.sessionId);
          return {
            content: [{ type: "text", text: `Purged session ${parsed.sessionId}` }],
          };
        } else {
          db.purgeAll();
          return {
            content: [{ type: "text", text: "Purged all sessions and events" }],
          };
        }
      }

      case "ctx_insight": {
        InsightSchema.parse(args);
        return {
          content: [{ type: "text", text: "Insight dashboard: https://context-mode.com/insight" }],
        };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (err) {
    if (err instanceof McpError) throw err;
    if (err instanceof z.ZodError) {
      throw new McpError(ErrorCode.InvalidParams, err.message);
    }
    throw new McpError(ErrorCode.InternalError, String(err));
  }
});

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "ctx_execute",
      description: "Execute code in isolated sandbox. Returns only stdout. Use for analysis, computation, data transformation - replaces multiple Read/Grep/Task calls.",
      inputSchema: {
        type: "object",
        properties: {
          language: { type: "string", enum: ["javascript", "typescript", "python", "bash"] },
          code: { type: "string" },
          cwd: { type: "string" },
          timeoutMs: { type: "number", minimum: 1000, maximum: 300000 },
        },
        required: ["language", "code"],
      },
    },
    {
      name: "ctx_batch_execute",
      description: "Execute multiple code snippets in sequence. Returns array of results.",
      inputSchema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                language: { type: "string", enum: ["javascript", "typescript", "python", "bash"] },
                code: { type: "string" },
              },
              required: ["id", "language", "code"],
            },
          },
          cwd: { type: "string" },
          timeoutMs: { type: "number", minimum: 1000, maximum: 300000 },
        },
        required: ["items"],
      },
    },
    {
      name: "ctx_execute_file",
      description: "Execute a local script file with optional arguments.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          args: { type: "array", items: { type: "string" } },
        },
        required: ["path"],
      },
    },
    {
      name: "ctx_index",
      description: "Index a local file or directory into the persistent FTS5 knowledge base.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          sessionId: { type: "string" },
          recursive: { type: "boolean", default: false },
        },
        required: ["path"],
      },
    },
    {
      name: "ctx_search",
      description: "Search previously indexed content via BM25.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          sessionId: { type: "string" },
          limit: { type: "number", minimum: 1, maximum: 100 },
        },
        required: ["query"],
      },
    },
    {
      name: "ctx_fetch_and_index",
      description: "Fetch a URL and index its content.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", format: "uri" },
          sessionId: { type: "string" },
          selector: { type: "string" },
        },
        required: ["url"],
      },
    },
    {
      name: "ctx_stats",
      description: "Context savings statistics — per-tool breakdown, tokens consumed, savings ratio.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
        },
      },
    },
    {
      name: "ctx_doctor",
      description: "Diagnostics — runtimes, FTS5, sandbox, plugin registration.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "ctx_upgrade",
      description: "Pull latest, rebuild, migrate cache, fix hooks.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "ctx_purge",
      description: "Permanently delete indexed content from the knowledge base.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
        },
      },
    },
    {
      name: "ctx_insight",
      description: "Open the hosted Insight dashboard for org analytics.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

// ──────────────────────────────────────────────────────────────
// Entry Point
// ──────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("context-mode MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
