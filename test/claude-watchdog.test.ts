import { describe, test, expect } from "bun:test";
import { config as rootConfig } from "../llm-whip.config";
import type { Config } from "../src/types";

describe("LLM Whip Configuration", () => {
  describe("Default Patterns", () => {
    test("should have required default patterns", () => {
      expect(rootConfig.patterns).toBeDefined();
      expect(rootConfig.patterns.length).toBeGreaterThan(0);
      expect(rootConfig.patterns.some(p => p.name === "todo")).toBe(true);
      expect(rootConfig.patterns.some(p => p.name === "important-thing")).toBe(true);
    });

    test("should have valid pattern structure", () => {
      const patterns = rootConfig.patterns;
      
      patterns.forEach(pattern => {
        expect(pattern.name).toBeDefined();
        expect(typeof pattern.name).toBe("string");
        expect(pattern.pattern).toBeDefined();
        expect(typeof pattern.pattern).toBe("string");
        
        if (pattern.severity) {
          expect(["low", "medium", "high"]).toContain(pattern.severity);
        }
        
        if (pattern.message) {
          expect(typeof pattern.message).toBe("string");
        }
      });
    });
  });
});