import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { FileWatcher } from "../src/file-watcher";
import type { Config, MatchInfo } from "../src/types";

describe("FileWatcher", () => {
  const testDir = path.join(__dirname, "test-watch-dir");
  let watcher: FileWatcher | null = null;
  let config: Config;

  beforeEach(async () => {
    // Create test directory
    await fs.mkdir(testDir, { recursive: true });

    config = {
      patterns: [
        {
          name: "test-todo",
          pattern: "TODO|FIXME",
          severity: "high",
          reactions: ["alert"],
          message: "Found TODO/FIXME",
        },
      ],
      reactions: {
        sound: { enabled: false, command: "" },
        interrupt: { enabled: false, delay: 0 },
        alert: { enabled: true, format: "plain" },
      },
      debounce: { enabled: false, window: 0 },
      fileTracking: {
        enabled: true,
        patterns: {
          filePath: "([\\w-]+\\.ts)",
          editingFile: "editing\\s+([\\w-]+\\.ts)",
          lineNumber: "line\\s+(\\d+)",
        },
      },
    };
  });

  afterEach(async () => {
    if (watcher) {
      watcher.stop();
      watcher = null;
    }

    // Clean up test directory
    try {
      const files = await fs.readdir(testDir);
      for (const file of files) {
        await fs.unlink(path.join(testDir, file));
      }
      await fs.rmdir(testDir);
    } catch (e) {
      // Ignore errors
    }
  });

  test("should create file watcher instance", () => {
    watcher = new FileWatcher({
      config,
      directories: [testDir],
      fileExtensions: [".ts", ".js"],
    });

    expect(watcher).toBeDefined();
  });

  test("should filter files by extension", () => {
    watcher = new FileWatcher({
      config,
      directories: [testDir],
      fileExtensions: [".ts"], // Only TypeScript files
    });

    // @ts-ignore - accessing private method for testing
    expect(watcher.shouldProcessFile("test.ts")).toBe(true);
    // @ts-ignore
    expect(watcher.shouldProcessFile("test.js")).toBe(false);
    // @ts-ignore
    expect(watcher.shouldProcessFile("test.txt")).toBe(false);
  });

  test("should respect ignore patterns", () => {
    watcher = new FileWatcher({
      config,
      directories: [testDir],
      ignorePatterns: ["node_modules", "dist"],
    });

    // @ts-ignore
    expect(watcher.shouldProcessFile("src/test.ts")).toBe(true);
    // @ts-ignore
    expect(watcher.shouldProcessFile("node_modules/package/test.ts")).toBe(
      false,
    );
    // @ts-ignore
    expect(watcher.shouldProcessFile("dist/build.js")).toBe(false);
  });

  test("should detect patterns in file content", async () => {
    watcher = new FileWatcher({
      config,
      directories: [testDir],
    });

    const testContent = `
function test() {
  // TODO: implement this
  return null;
}
`;

    // @ts-ignore - accessing private method for testing
    const matches = watcher.checkPatterns(
      "// TODO: implement this",
      "/test/file.ts",
      3,
    );

    expect(matches.length).toBe(1);
    expect(matches[0].pattern).toBe("test-todo");
    expect(matches[0].line).toBe("3");
    expect(matches[0].file).toContain("file.ts");
  });

  test("should extract context from matches", () => {
    watcher = new FileWatcher({
      config,
      directories: [testDir],
    });

    const line = "    // TODO: implement authentication logic here";

    // @ts-ignore
    const context = watcher.getContext(line, 7, 20);

    expect(context).toContain("TODO");
    expect(context.length).toBeLessThanOrEqual(40); // 20 chars on each side
  });

  test("should handle multiple patterns in same line", () => {
    const multiConfig = {
      ...config,
      patterns: [
        {
          name: "todo-pattern",
          pattern: "TODO",
          severity: "high" as const,
          reactions: ["alert" as const],
          message: "Found TODO",
        },
        {
          name: "fixme-pattern",
          pattern: "FIXME",
          severity: "high" as const,
          reactions: ["alert" as const],
          message: "Found FIXME",
        },
      ],
    };

    watcher = new FileWatcher({
      config: multiConfig,
      directories: [testDir],
    });

    // @ts-ignore
    const matches = watcher.checkPatterns(
      "// TODO: fix this FIXME issue",
      "/test/file.ts",
      1,
    );

    expect(matches.length).toBe(2);
    expect(matches[0].pattern).toBe("todo-pattern");
    expect(matches[1].pattern).toBe("fixme-pattern");
  });

  test("should respect debounce settings", () => {
    const debouncedConfig = {
      ...config,
      debounce: { enabled: true, window: 1000 },
    };

    watcher = new FileWatcher({
      config: debouncedConfig,
      directories: [testDir],
    });

    // @ts-ignore
    const matches1 = watcher.checkPatterns("// TODO: test", "/same/file.ts", 1);
    // @ts-ignore
    const matches2 = watcher.checkPatterns("// TODO: test", "/same/file.ts", 1);

    expect(matches1.length).toBe(1);
    expect(matches2.length).toBe(0); // Should be debounced
  });

  test("should handle file processing without file system changes", async () => {
    watcher = new FileWatcher({
      config,
      directories: [testDir],
    });

    // Create a test file directly
    const testFile = path.join(testDir, "direct-test.ts");
    await fs.writeFile(
      testFile,
      "// TODO: implement feature\nconsole.log('test');",
    );

    // Process the file directly
    // @ts-ignore
    await watcher.processFile(testFile);

    // Should not throw any errors
    expect(true).toBe(true);
  });
});
