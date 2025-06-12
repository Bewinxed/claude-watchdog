import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spawn, type ChildProcess } from "child_process";
import { promises as fs } from "fs";
import path from "path";

describe("Claude Watchdog Integration Tests", () => {
  let watchdogProcess: ChildProcess | null = null;
  const testConfigPath = path.join(__dirname, "test-config.json");

  beforeEach(async () => {
    // Create test config
    const testConfig = {
      patterns: [
        {
          name: "test-todo",
          pattern: "TODO_TEST_PATTERN",
          severity: "high",
          reactions: ["alert"],
          message: "TEST DETECTION SUCCESSFUL"
        }
      ],
      reactions: {
        sound: { enabled: false, command: "" },
        interrupt: { enabled: true, delay: 100 },
        alert: { enabled: true, format: "plain" }
      },
      debounce: { enabled: false, window: 0 },
      fileTracking: { enabled: true, patterns: {
        filePath: "([\\w-]+\\.ts)",
        editingFile: "editing\\s+([\\w-]+\\.ts)",
        lineNumber: "line\\s+(\\d+)"
      }}
    };

    await fs.writeFile(testConfigPath, JSON.stringify(testConfig, null, 2));
  });

  afterEach(async () => {
    if (watchdogProcess) {
      watchdogProcess.kill();
      watchdogProcess = null;
    }
    
    try {
      await fs.unlink(testConfigPath);
    } catch (e) {
      // Ignore if file doesn't exist
    }
  });

  test("should start watchdog process with mock echo command", async () => {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, "..", "src", "claude-watchdog.ts");
      
      // Use echo command as a simple mock for Claude
      watchdogProcess = spawn("bun", [scriptPath, "--config=" + testConfigPath], {
        env: { ...process.env, CLAUDE_PATH: "echo" }
      });

      let output = "";
      let errorOutput = "";

      watchdogProcess.stdout?.on("data", (data) => {
        output += data.toString();
      });

      watchdogProcess.stderr?.on("data", (data) => {
        errorOutput += data.toString();
      });

      // Send some input to test
      setTimeout(() => {
        watchdogProcess?.stdin?.write("test input\n");
        setTimeout(() => {
          watchdogProcess?.kill();
        }, 100);
      }, 100);

      watchdogProcess.on("exit", () => {
        expect(output).toContain("Starting Claude Watchdog");
        expect(output).toContain("Monitoring for 1 patterns");
        resolve(true);
      });

      watchdogProcess.on("error", (err) => {
        reject(err);
      });
    });
  });

  test("should handle watch mode", async () => {
    return new Promise(async (resolve, reject) => {
      const scriptPath = path.join(__dirname, "..", "src", "claude-watchdog.ts");
      const watchDir = path.join(__dirname, "watch-test");
      
      // Create test directory
      await fs.mkdir(watchDir, { recursive: true });
      
      // Start in watch mode
      watchdogProcess = spawn("bun", [scriptPath, "watch", watchDir, "--config=" + testConfigPath]);

      let output = "";
      let errorOutput = "";

      watchdogProcess.stdout?.on("data", (data) => {
        output += data.toString();
      });

      watchdogProcess.stderr?.on("data", (data) => {
        errorOutput += data.toString();
      });

      setTimeout(async () => {
        try {
          // Create a file with the test pattern
          await fs.writeFile(path.join(watchDir, "test.ts"), "// TODO_TEST_PATTERN: test\n");
          
          setTimeout(async () => {
            watchdogProcess?.kill();
            
            // Clean up
            await fs.unlink(path.join(watchDir, "test.ts"));
            await fs.rmdir(watchDir);
            
            expect(output).toContain("Watching 1 directories");
            resolve(true);
          }, 200);
        } catch (err) {
          reject(err);
        }
      }, 100);

      watchdogProcess.on("error", (err) => {
        reject(err);
      });
    });
  });

  test("should show help when no arguments provided to watch command", async () => {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, "..", "src", "claude-watchdog.ts");
      
      watchdogProcess = spawn("bun", [scriptPath, "watch"]);

      let errorOutput = "";

      watchdogProcess.stderr?.on("data", (data) => {
        errorOutput += data.toString();
      });

      watchdogProcess.on("exit", (code) => {
        expect(code).toBe(1); // Should exit with error
        expect(errorOutput).toContain("Usage: claude-watchdog watch");
        resolve(true);
      });

      watchdogProcess.on("error", (err) => {
        reject(err);
      });
    });
  });
});