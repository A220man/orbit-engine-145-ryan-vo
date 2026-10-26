
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

export interface SandboxOptions {
  language: "javascript" | "typescript" | "python" | "bash";
  code: string;
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
}

// ──────────────────────────────────────────────────────────────
// Language Config
// ──────────────────────────────────────────────────────────────

interface LanguageConfig {
  fileExtension: string;
  command: string;
  args: (filePath: string) => string[];
  preamble?: string;
}

const LANGUAGES: Record<SandboxOptions["language"], LanguageConfig> = {
  javascript: {
    fileExtension: ".mjs",
    command: "node",
    args: (filePath) => [filePath],
    preamble: `import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync, rmSync, cpSync } from "node:fs";\nimport { join, dirname, resolve, basename, extname } from "node:path";\nimport { fileURLToPath } from "node:url";\nimport { execSync, spawnSync } from "node:child_process";\nimport { tmpdir } from "node:os";\nimport { randomUUID } from "node:crypto";\n\nconst __filename = fileURLToPath(import.meta.url);\nconst __dirname = dirname(__filename);\n`,
  },
  typescript: {
    fileExtension: ".ts",
    command: "npx",
    args: (filePath) => ["tsx", filePath],
    preamble: `import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync, rmSync, cpSync } from "node:fs";\nimport { join, dirname, resolve, basename, extname } from "node:path";\nimport { fileURLToPath } from "node:url";\nimport { execSync, spawnSync } from "node:child_process";\nimport { tmpdir } from "node:os";\nimport { randomUUID } from "node:crypto";\n\nconst __filename = fileURLToPath(import.meta.url);\nconst __dirname = dirname(__filename);\n`,
  },
  python: {
    fileExtension: ".py",
    command: "python3",
    args: (filePath) => [filePath],
  },
  bash: {
    fileExtension: ".sh",
    command: "bash",
    args: (filePath) => [filePath],
  },
};

// ──────────────────────────────────────────────────────────────
// Execution
// ──────────────────────────────────────────────────────────────

export async function executeInSandbox(options: SandboxOptions): Promise<SandboxResult> {
  const config = LANGUAGES[options.language];
  const workDir = options.cwd ?? process.cwd();
  const sessionDir = join(tmpdir(), `context-mode-sandbox-${randomUUID()}`);
  const fileName = `script${config.fileExtension}`;
  const filePath = join(sessionDir, fileName);

  mkdirSync(sessionDir, { recursive: true });

  // Prepare code with preamble for JS/TS
  let fullCode = options.code;
  if (config.preamble) {
    fullCode = config.preamble + "\n" + options.code;
  }

  writeFileSync(filePath, fullCode, "utf-8");

  // Make bash scripts executable
  if (options.language === "bash") {
    try {
      spawnSync("chmod", ["+x", filePath], { stdio: "ignore" });
    } catch {
      // ignore
    }
  }

  const timeoutMs = options.timeoutMs ?? 30000;
  const startTime = Date.now();

  let result: SandboxResult;

  try {
    const spawnResult = spawnSync(config.command, config.args(filePath), {
      cwd: workDir,
      timeout: timeoutMs,
      encoding: "utf-8",
      env: { ...process.env, ...options.env },
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    result = {
      stdout: spawnResult.stdout ?? "",
      stderr: spawnResult.stderr ?? "",
      exitCode: spawnResult.status ?? 0,
      timedOut: spawnResult.signal === "SIGTERM",
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    if (err instanceof Error && "signal" in err && err.signal === "SIGTERM") {
      result = {
        stdout: "",
        stderr: "Execution timed out",
        exitCode: 124,
        timedOut: true,
        durationMs: timeoutMs,
      };
    } else {
      throw err;
    }
  } finally {
    // Cleanup sandbox directory
    try {
      rmSync(sessionDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  return result;
}

// ──────────────────────────────────────────────────────────────
// Batch Execution
// ──────────────────────────────────────────────────────────────

export interface BatchItem {
  id: string;
  language: SandboxOptions["language"];
  code: string;
}

export interface BatchResult {
  id: string;
  result: SandboxResult;
}

export async function executeBatch(
  items: BatchItem[],
  options: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {}
): Promise<BatchResult[]> {
  const results: BatchResult[] = [];
  for (const item of items) {
    const result = await executeInSandbox({
      language: item.language,
      code: item.code,
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      env: options.env,
    });
    results.push({ id: item.id, result });
  }
  return results;
}
