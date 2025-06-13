import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

describe("Simple Watchdog Test", () => {
  const testDir = join(__dirname, "simple-test");
  const configPath = join(testDir, "config.ts");

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });

    const configContent = `import type { Config } from '../../src/types';

export const config: Config = {
  patterns: [
    {
      name: "todo",
      pattern: "TODO",
      severity: "high",
      reactions: ["alert"],
      message: "TODO FOUND"
    }
  ],
  reactions: {
    sound: { enabled: false, command: "" },
    interrupt: { enabled: false, delay: 0 },
    alert: { enabled: true, format: "plain" }
  },
  debounce: { enabled: false, window: 0 },
  fileTracking: {
    enabled: false,
    patterns: {
      filePath: "",
      editingFile: "",
      lineNumber: ""
    }
  }
};
`;

    await writeFile(configPath, configContent);
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("file watch mode detects TODO", async () => {
    return new Promise<void>(async (resolve, reject) => {
      const watchdogScript = join(__dirname, "..", "src", "llm-whip.ts");

      // Start watchdog in file watch mode
      const watchdog = spawn(
        "bun",
        [watchdogScript, "watch", testDir, `--config=${configPath}`],
        {
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      let alertFound = false;

      watchdog.stdout.on("data", (data) => {
        const output = data.toString();
        console.log("OUT:", output);
        if (output.includes("TODO FOUND")) {
          alertFound = true;
          watchdog.kill();
          resolve();
        }
      });

      watchdog.stderr.on("data", (data) => {
        console.log("ERR:", data.toString());
      });

      watchdog.on("error", reject);

      // Wait for watchdog to start
      await Bun.sleep(1000);

      // Create a file with TODO
      await writeFile(join(testDir, "test.ts"), "// TODO: fix this");

      // Timeout after 5 seconds
      setTimeout(() => {
        watchdog.kill();
        if (!alertFound) {
          reject(new Error("No alert detected"));
        }
      }, 5000);
    });
  });
});
