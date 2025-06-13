import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { AuditCommand } from "../src/audit-command";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";

describe("AuditCommand", () => {
  const testDir = join(__dirname, "test-audit");
  
  beforeAll(async () => {
    // Create test directory with some files containing patterns
    await mkdir(testDir, { recursive: true });
    
    // Create files with various patterns
    await writeFile(join(testDir, "todo.ts"), `
// TODO: implement this feature
function doSomething() {
  // placeholder implementation
}
`);
    
    await writeFile(join(testDir, "important.ts"), `
// The important thing is to test properly
function test() {
  throw new Error("not implemented");
}
`);
    
    await writeFile(join(testDir, "clean.ts"), `
// This file has no patterns
function clean() {
  return true;
}
`);
  });
  
  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });
  
  test("should detect patterns in directory", async () => {
    // Capture stdout instead since clack uses that
    const originalWrite = process.stdout.write;
    let output = "";
    
    process.stdout.write = (chunk: any) => {
      output += chunk.toString();
      return true;
    };
    
    try {
      await AuditCommand.run([testDir]);
      
      // Check that patterns were detected
      expect(output).toContain("todo");
      expect(output).toContain("placeholder");
      expect(output).toContain("important-thing");
      expect(output).toContain("not-implemented");
      
      // Should find 4 issues total
      expect(output).toContain("4 issues");
    } finally {
      process.stdout.write = originalWrite;
    }
  });
  
  test("should output JSON format", async () => {
    const originalLog = console.log;
    let output = "";
    console.log = (msg: any) => {
      output += msg + "\n";
    };
    
    try {
      await AuditCommand.run([testDir], undefined, 'json');
      
      // Should contain valid JSON
      expect(output).toContain('```json');
      expect(output).toContain('"totalIssues"');
      expect(output).toContain('"issues"');
    } finally {
      console.log = originalLog;
    }
  });
});