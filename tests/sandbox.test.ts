
import { describe, it, expect } from "vitest";
import { executeInSandbox, executeBatch } from "../src/sandbox/executor.js";

describe("sandbox executor", () => {
  it("executes javascript code", async () => {
    const result = await executeInSandbox({
      language: "javascript",
      code: 'console.log("hello")',
    });
    expect(result.stdout).toContain("hello");
    expect(result.exitCode).toBe(0);
  });

  it("executes typescript code", async () => {
    const result = await executeInSandbox({
      language: "typescript",
      code: 'console.log("typescript")',
    });
    expect(result.stdout).toContain("typescript");
    expect(result.exitCode).toBe(0);
  });

  it("handles errors", async () => {
    const result = await executeInSandbox({
      language: "javascript",
      code: 'throw new Error("test error")',
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("test error");
  });

  it("executes batch items", async () => {
    const results = await executeBatch([
      { id: "1", language: "javascript", code: 'console.log("a")' },
      { id: "2", language: "javascript", code: 'console.log("b")' },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].result.stdout).toContain("a");
    expect(results[1].result.stdout).toContain("b");
  });
});
