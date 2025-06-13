import { describe, test, expect } from "bun:test";
import ClaudeWatchdog from "../src/llm-whip";
import type { Config } from "../src/types";

describe("ClaudeWatchdog", () => {
  describe("Configuration", () => {
    test("should load default patterns when none provided", () => {
      const watchdog = new ClaudeWatchdog();
      // @ts-ignore - accessing private property for testing
      const config = watchdog.config;
      
      expect(config.patterns).toBeDefined();
      expect(config.patterns.length).toBeGreaterThan(0);
      expect(config.patterns.some(p => p.name === "todo")).toBe(true);
      expect(config.patterns.some(p => p.name === "important-thing")).toBe(true);
    });

    test("should merge custom config with defaults", () => {
      const customConfig: Partial<Config> = {
        debounce: 5000
      };
      
      const watchdog = new ClaudeWatchdog(customConfig);
      // @ts-ignore - accessing private property for testing
      const config = watchdog.config;
      
      expect(config.debounce).toBe(5000);
      expect(config.patterns).toBeDefined(); // Should still have default patterns
    });
  });
});