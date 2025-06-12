import { describe, test, expect, beforeEach, mock } from "bun:test";
import ClaudeWatchdog from "../src/llm-whip";
import { EventEmitter } from "events";
import type { MatchInfo, Config } from "../src/types";

describe("ClaudeWatchdog", () => {
  let watchdog: ClaudeWatchdog;
  let mockConfig: Partial<Config>;

  beforeEach(() => {
    mockConfig = {
      patterns: [
        {
          name: "test-pattern",
          pattern: "TODO|FIXME",
          severity: "high",
          reactions: ["alert"],
          message: "Test message"
        }
      ],
      reactions: {
        sound: { enabled: false, command: "" },
        interrupt: { enabled: false, delay: 0 },
        alert: { enabled: true, format: "plain" }
      },
      debounce: { enabled: false, window: 0 },
      fileTracking: {
        enabled: true,
        patterns: {
          filePath: "([\\w-]+\\.ts)",
          editingFile: "editing\\s+([\\w-]+\\.ts)",
          lineNumber: "line\\s+(\\d+)"
        }
      }
    };
    watchdog = new ClaudeWatchdog(mockConfig);
  });

  describe("Pattern Detection", () => {
    test("should detect TODO pattern", () => {
      const matches: MatchInfo[] = [];
      watchdog.on("match", (match) => matches.push(match));

      // Simulate output processing
      const testOutput = "// TODO: implement this feature\n";
      // @ts-ignore - accessing private method for testing
      watchdog.processOutput(Buffer.from(testOutput));

      expect(matches.length).toBe(1);
      expect(matches[0].pattern).toBe("test-pattern");
      expect(matches[0].message).toBe("Test message");
    });

    test("should detect FIXME pattern", () => {
      const matches: MatchInfo[] = [];
      watchdog.on("match", (match) => matches.push(match));

      const testOutput = "# FIXME: broken implementation\n";
      // @ts-ignore
      watchdog.processOutput(Buffer.from(testOutput));

      expect(matches.length).toBe(1);
      expect(matches[0].pattern).toBe("test-pattern");
    });

    test("should not detect patterns when disabled", () => {
      const disabledWatchdog = new ClaudeWatchdog({
        patterns: [],
        reactions: mockConfig.reactions!,
        debounce: mockConfig.debounce!,
        fileTracking: mockConfig.fileTracking!
      });

      const matches: MatchInfo[] = [];
      disabledWatchdog.on("match", (match) => matches.push(match));

      const testOutput = "// TODO: this should not be detected\n";
      // @ts-ignore
      disabledWatchdog.processOutput(Buffer.from(testOutput));

      expect(matches.length).toBe(0);
    });
  });

  describe("File Context Tracking", () => {
    test("should detect file path in output", () => {
      const testOutput = "Working on test-file.ts\n";
      // @ts-ignore
      watchdog.detectFileContext(testOutput);
      // @ts-ignore
      expect(watchdog.fileContext.currentFile).toBe("test-file.ts");
    });

    test("should detect editing statement", () => {
      const testOutput = "editing user-service.ts\n";
      // @ts-ignore
      watchdog.detectFileContext(testOutput);
      // @ts-ignore
      expect(watchdog.fileContext.currentFile).toBe("user-service.ts");
    });

    test("should detect line numbers", () => {
      const testOutput = "Error at line 42\n";
      // @ts-ignore
      watchdog.detectFileContext(testOutput);
      // @ts-ignore
      expect(watchdog.fileContext.currentLine).toBe("42");
    });

    test("should include file context in matches", () => {
      const matches: MatchInfo[] = [];
      watchdog.on("match", (match) => matches.push(match));

      // Set file context first
      // @ts-ignore
      watchdog.detectFileContext("editing test.ts");
      // @ts-ignore
      watchdog.detectFileContext("line 10");

      // Then detect pattern
      const testOutput = "// TODO: fix this\n";
      // @ts-ignore
      watchdog.processOutput(Buffer.from(testOutput));

      expect(matches.length).toBe(1);
      expect(matches[0].file).toBe("test.ts");
      expect(matches[0].line).toBe("10");
    });
  });

  describe("Debouncing", () => {
    test("should debounce repeated matches", () => {
      const debouncedWatchdog = new ClaudeWatchdog({
        ...mockConfig,
        debounce: { enabled: true, window: 1000 }
      });

      const matches: MatchInfo[] = [];
      debouncedWatchdog.on("match", (match) => matches.push(match));

      // Send same pattern twice quickly
      const testOutput = "// TODO: implement\n";
      // @ts-ignore
      debouncedWatchdog.processOutput(Buffer.from(testOutput));
      // @ts-ignore
      debouncedWatchdog.processOutput(Buffer.from(testOutput));

      expect(matches.length).toBe(1);
    });

    test("should allow matches after debounce window", async () => {
      const debouncedWatchdog = new ClaudeWatchdog({
        ...mockConfig,
        debounce: { enabled: true, window: 100 }
      });

      const matches: MatchInfo[] = [];
      debouncedWatchdog.on("match", (match) => matches.push(match));

      const testOutput = "// TODO: implement\n";
      // @ts-ignore
      debouncedWatchdog.processOutput(Buffer.from(testOutput));

      // Wait for debounce window
      await Bun.sleep(150);

      // @ts-ignore
      debouncedWatchdog.processOutput(Buffer.from(testOutput));

      expect(matches.length).toBe(2);
    });
  });

  describe("Default Patterns", () => {
    test("should load default patterns when none provided", () => {
      const defaultWatchdog = new ClaudeWatchdog({});
      // @ts-ignore
      expect(defaultWatchdog.config.patterns.length).toBeGreaterThan(10);
    });

    test("should detect various cheat patterns", () => {
      const defaultWatchdog = new ClaudeWatchdog({});
      const matches: MatchInfo[] = [];
      defaultWatchdog.on("match", (match) => matches.push(match));

      const testCases = [
        "// placeholder implementation",
        "// TODO: implement later",
        "// for now, just return null",
        "mock_data = {}",
        "... rest of the code goes here",
        "def stub_function():",
        "raise NotImplementedError",
        "// coming soon",
        "pass",
        "// @ts-ignore",
        "console.log('TODO: fix this')"
      ];

      testCases.forEach(testCase => {
        // @ts-ignore
        defaultWatchdog.processOutput(Buffer.from(testCase + "\n"));
      });

      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some(m => m.severity === "high")).toBe(true);
    });
  });

  describe("Reactions", () => {
    test("should trigger alert reaction", () => {
      const stderrSpy = mock();
      const originalWrite = process.stderr.write;
      process.stderr.write = stderrSpy;

      const testOutput = "// TODO: implement\n";
      // @ts-ignore
      watchdog.processOutput(Buffer.from(testOutput));

      expect(stderrSpy).toHaveBeenCalled();
      process.stderr.write = originalWrite;
    });

    test("should respect reaction configuration", () => {
      const disabledAlertWatchdog = new ClaudeWatchdog({
        ...mockConfig,
        reactions: {
          ...mockConfig.reactions!,
          alert: { enabled: false, format: "plain" }
        }
      });

      const consoleSpy = mock();
      const originalError = console.error;
      console.error = consoleSpy;

      const testOutput = "// TODO: implement\n";
      // @ts-ignore
      disabledAlertWatchdog.processOutput(Buffer.from(testOutput));

      expect(consoleSpy).not.toHaveBeenCalled();
      console.error = originalError;
    });
  });

  describe("Output Processing", () => {
    test("should handle multi-line output", () => {
      const matches: MatchInfo[] = [];
      watchdog.on("match", (match) => matches.push(match));

      const multiLineOutput = 
        "Starting implementation\n" +
        "// TODO: add error handling\n" +
        "function test() {\n" +
        "  // FIXME: memory leak\n" +
        "}\n";

      // @ts-ignore
      watchdog.processOutput(Buffer.from(multiLineOutput));

      expect(matches.length).toBe(2);
    });

    test("should preserve incomplete lines in buffer", () => {
      const matches: MatchInfo[] = [];
      watchdog.on("match", (match) => matches.push(match));

      // Send incomplete line
      // @ts-ignore
      watchdog.processOutput(Buffer.from("// TO"));
      expect(matches.length).toBe(0);

      // Complete the line
      // @ts-ignore
      watchdog.processOutput(Buffer.from("DO: implement\n"));
      expect(matches.length).toBe(1);
    });

    test("should extract context around matches", () => {
      const matches: MatchInfo[] = [];
      watchdog.on("match", (match) => matches.push(match));

      const contextOutput = "This is some code before TODO: implement feature and some code after";
      // @ts-ignore
      watchdog.processOutput(Buffer.from(contextOutput + "\n"));

      expect(matches.length).toBe(1);
      expect(matches[0].context).toContain("code before");
      expect(matches[0].context).toContain("code after");
    });
  });
});