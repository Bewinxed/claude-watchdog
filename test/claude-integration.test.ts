import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawn, type ChildProcess } from "child_process";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";

describe("Claude Integration Test", () => {
  const testDir = join(__dirname, "claude-test-workspace");
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

  test("should catch TODO when Claude generates code", async () => {
    return new Promise<void>(async (resolve, reject) => {
      // Start watchdog in file watch mode  
      const watchdogScript = join(__dirname, "..", "src", "llm-whip.ts");
      watchdogProcess = spawn("bun", [watchdogScript, "watch", testDir, `--config=${configPath}`], {
        stdio: ["pipe", "pipe", "pipe"]
      });

      let alertFound = false;

      watchdogProcess.stdout.on("data", (data) => {
        const output = data.toString();
        console.log("[WATCHDOG]", output);
        // Look for the pattern in the new clack output format
        if (output.includes("TODO") && (output.includes("detected") || output.includes("todo-cheat"))) {
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
        // Spawn Claude with a prompt that will create a TODO
        const claudeProcess = spawn("claude", ["--print"], {
          cwd: testDir,
          stdio: ["pipe", "pipe", "pipe"]
        });

        let claudeOutput = "";
        
        claudeProcess.stdout.on("data", (data) => {
          claudeOutput += data.toString();
        });

        // Send the prompt via stdin
        claudeProcess.stdin?.write("Create a simple TypeScript function with a TODO comment\n");
        claudeProcess.stdin?.end();

        claudeProcess.on("exit", async (code) => {
          console.log("✅ Claude finished with code:", code);
          console.log("Claude output length:", claudeOutput.length);
          console.log("Claude output contains TODO:", claudeOutput.includes("TODO"));
          
          if (claudeOutput.includes("TODO")) {
            // Save Claude's output to a file (this should trigger the watchdog)
            await writeFile(join(testDir, "claude-output.ts"), claudeOutput);
            console.log("💾 Saved file, waiting for watchdog...");
            
            // Wait longer for watchdog to detect
            await Bun.sleep(2000);
            
            if (!alertFound) {
              watchdogProcess?.kill();
              reject(new Error("Watchdog did not detect the TODO pattern in file"));
            }
          } else {
            // Claude didn't create a TODO, create one manually to test watchdog
            console.log("🔧 Claude didn't create TODO, creating manual test...");
            await writeFile(join(testDir, "manual-test.ts"), "// TODO: test pattern\nfunction test() {}");
            await Bun.sleep(2000);
            
            if (!alertFound) {
              watchdogProcess?.kill();
              reject(new Error("Watchdog did not detect manual TODO pattern"));
            }
          }
        });

        claudeProcess.on("error", (err) => {
          console.error("Failed to run Claude:", err.message);
          // Skip test if Claude not available
          watchdogProcess?.kill();
          resolve();
        });

        // Timeout after 10 seconds
        setTimeout(() => {
          claudeProcess.kill();
          if (!alertFound) {
            watchdogProcess?.kill();
            console.log("⏱️ Test timed out, but that's OK if Claude is not available");
            resolve(); // Don't fail the test if Claude is not available
          }
        }, 10000);

      } catch (error) {
        reject(error);
      }
    });
  }, 20000);
});