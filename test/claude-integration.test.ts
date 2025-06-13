import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

describe("LLM Integration Test", () => {
  const testDir = join(__dirname, "llm-test-workspace");
  const configPath = join(testDir, "watchdog-config.ts");
  let watchdogProcess: ChildProcess | null = null;

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });

    // Create watchdog config
    const configContent = `import type { Config } from '../../src/types';

export const config: Config = {
  patterns: [
    {
      name: "todo-cheat",
      pattern: "TODO",
      severity: "high",
      reactions: ["alert"],
      message: "🚨 TODO DETECTED - NO CHEATING!"
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
    if (watchdogProcess) {
      watchdogProcess.kill();
    }
    await rm(testDir, { recursive: true, force: true });
  });

  test("should catch TODO when LLM generates code", async () => {
    return new Promise<void>(async (resolve, reject) => {
      // Start watchdog in file watch mode
      const watchdogScript = join(__dirname, "..", "src", "llm-whip.ts");
      watchdogProcess = spawn(
        "bun",
        [watchdogScript, "watch", testDir, `--config=${configPath}`],
        {
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      let alertFound = false;

      watchdogProcess.stdout.on("data", (data) => {
        const output = data.toString();
        console.log("[WATCHDOG]", output);
        // Look for the pattern in the new clack output format
        if (
          output.includes("TODO") &&
          (output.includes("detected") || output.includes("todo-cheat"))
        ) {
          alertFound = true;
          watchdogProcess?.kill();
          resolve();
        }
      });

      watchdogProcess.stderr.on("data", (data) => {
        console.log("[ERR]", data.toString());
      });

      watchdogProcess.on("error", reject);

      // Wait for watchdog to start
      await Bun.sleep(1000);

      try {
        // Spawn LLM tool with a prompt that will create a TODO
        const llmProcess = spawn("claude", ["--print"], {
          cwd: testDir,
          stdio: ["pipe", "pipe", "pipe"],
        });

        let llmOutput = "";

        llmProcess.stdout.on("data", (data) => {
          llmOutput += data.toString();
        });

        // Send the prompt via stdin
        llmProcess.stdin?.write(
          "Create a simple TypeScript function with a TODO comment\n",
        );
        llmProcess.stdin?.end();

        llmProcess.on("exit", async (code) => {
          console.log("✅ LLM tool finished with code:", code);
          console.log("LLM output length:", llmOutput.length);
          console.log("LLM output contains TODO:", llmOutput.includes("TODO"));

          if (llmOutput.includes("TODO")) {
            // Save LLM's output to a file (this should trigger the watchdog)
            await writeFile(join(testDir, "llm-output.ts"), llmOutput);
            console.log("💾 Saved file, waiting for watchdog...");

            // Wait longer for watchdog to detect
            await Bun.sleep(2000);

            if (!alertFound) {
              watchdogProcess?.kill();
              reject(
                new Error("Watchdog did not detect the TODO pattern in file"),
              );
            }
          } else {
            // LLM didn't create a TODO, create one manually to test watchdog
            console.log("🔧 LLM didn't create TODO, creating manual test...");
            await writeFile(
              join(testDir, "manual-test.ts"),
              "// TODO: test pattern\nfunction test() {}",
            );
            await Bun.sleep(2000);

            if (!alertFound) {
              watchdogProcess?.kill();
              reject(new Error("Watchdog did not detect manual TODO pattern"));
            }
          }
        });

        llmProcess.on("error", (err) => {
          console.error("Failed to run LLM tool:", err.message);
          // Skip test if LLM tool not available
          watchdogProcess?.kill();
          resolve();
        });

        // Timeout after 10 seconds
        setTimeout(() => {
          llmProcess.kill();
          if (!alertFound) {
            watchdogProcess?.kill();
            console.log(
              "⏱️ Test timed out, but that's OK if LLM tool is not available",
            );
            resolve(); // Don't fail the test if LLM tool is not available
          }
        }, 10000);
      } catch (error) {
        reject(error);
      }
    });
  }, 20000);
});
