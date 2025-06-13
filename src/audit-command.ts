import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import * as p from "@clack/prompts";
import color from "picocolors";
import { config as rootConfig } from "../llm-whip.config";
import type { Config, Pattern } from "./types";

interface AuditResult {
  file: string;
  line: number;
  pattern: string;
  severity: "high" | "medium" | "low";
  match: string;
  message: string;
  fullLine: string;
}

export class AuditCommand {
  private static readonly DEFAULT_EXTENSIONS = [
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".py",
    ".java",
    ".cpp",
    ".c",
    ".go",
    ".rs",
    ".rb",
    ".php",
    ".vue",
    ".svelte",
    ".swift",
  ];

  private static readonly DEFAULT_IGNORE = [
    "node_modules",
    "dist",
    "build",
    ".git",
    "coverage",
    ".next",
    ".bun",
    "target",
    "__pycache__",
    ".pytest_cache",
  ];

  private static readonly CONFIG_FILES = [
    "llm-whip.config.json",
    "llm-whip.config.js",
    "llm-whip.config.ts",
  ];

  static async run(
    directories: string[],
    configPath?: string,
    format: "table" | "json" | "csv" = "table",
  ): Promise<void> {
    console.log();
    p.intro(color.bgMagenta(color.black(" LLM Whip Audit ")));

    // Load config
    const config = await AuditCommand.loadConfig(configPath);

    // Scan all directories
    const spinner = p.spinner();
    spinner.start("Scanning directories for anti-cheat patterns");

    const results: AuditResult[] = [];
    for (const dir of directories) {
      spinner.message(`Scanning ${color.cyan(dir)}`);
      const dirResults = await AuditCommand.scanDirectory(dir, config);
      results.push(...dirResults);
    }

    spinner.stop(
      `Found ${color.yellow(results.length.toString())} potential issues`,
    );

    if (results.length === 0) {
      p.outro(
        color.green("✅ No anti-cheat patterns detected! Your code is clean."),
      );
      return;
    }

    switch (format) {
      case "json":
        AuditCommand.outputJSON(results);
        break;
      case "csv":
        AuditCommand.outputCSV(results);
        break;
      default:
        AuditCommand.outputTable(results);
    }

    // Summary
    const summary = AuditCommand.generateSummary(results);
    const summaryLines = Object.entries(summary).map(([severity, count]) => {
      const emoji =
        severity === "high" ? "🔴" : severity === "medium" ? "🟡" : "🟢";
      const severityColor =
        severity === "high"
          ? color.red
          : severity === "medium"
            ? color.yellow
            : color.green;
      return `${emoji} ${severityColor(severity.toUpperCase())}: ${color.bold(count.toString())} ${count === 1 ? "issue" : "issues"}`;
    });

    p.outro(summaryLines.join(" · "));
  }

  private static async loadConfig(configPath?: string): Promise<Config> {
    const defaultConfig: Config = {
      ...rootConfig,
      reactions: { sound: false, interrupt: false, alert: false },
      debounce: false,
      fileTracking: false,
    };

    if (!configPath) return defaultConfig;

    try {
      const fullPath = join(process.cwd(), configPath);

      if (configPath.endsWith(".json")) {
        const content = await readFile(fullPath, "utf-8");
        const customConfig = JSON.parse(content);
        return { ...defaultConfig, ...customConfig };
      }
      if (configPath.endsWith(".js")) {
        const configModule = await import(fullPath);
        const customConfig = configModule.config || configModule.default;
        return { ...defaultConfig, ...customConfig };
      }
      console.warn(
        `⚠️  Unsupported config file type: ${configPath}. Please use JSON (.json) or JavaScript (.js) files.`,
      );
      return defaultConfig;
    } catch (error) {
      console.warn(`⚠️  Failed to load config ${configPath}, using defaults`);
      return defaultConfig;
    }
  }

  private static async scanDirectory(
    dir: string,
    config: Config,
  ): Promise<AuditResult[]> {
    const results: AuditResult[] = [];

    try {
      const items = await readdir(dir);

      for (const item of items) {
        const fullPath = join(dir, item);

        // Skip ignored directories
        if (
          AuditCommand.DEFAULT_IGNORE.some((pattern) => item.includes(pattern))
        ) {
          continue;
        }

        const stats = await stat(fullPath);

        if (stats.isDirectory()) {
          // Recurse into subdirectories
          const subResults = await AuditCommand.scanDirectory(fullPath, config);
          results.push(...subResults);
        } else if (stats.isFile() && AuditCommand.shouldScanFile(fullPath)) {
          // Scan file
          const fileResults = await AuditCommand.scanFile(fullPath, config);
          results.push(...fileResults);
        }
      }
    } catch (error) {
      console.warn(`⚠️  Could not scan directory ${dir}:`, error);
    }

    return results;
  }

  private static shouldScanFile(filePath: string): boolean {
    const ext = extname(filePath);
    const fileName = basename(filePath);

    // Skip config files
    if (AuditCommand.CONFIG_FILES.includes(fileName)) {
      return false;
    }

    return AuditCommand.DEFAULT_EXTENSIONS.includes(ext);
  }

  private static async scanFile(
    filePath: string,
    config: Config,
  ): Promise<AuditResult[]> {
    const results: AuditResult[] = [];

    try {
      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n");
      const relativePath = relative(process.cwd(), filePath);

      for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];

        for (const pattern of config.patterns) {
          const regex = new RegExp(pattern.pattern, "gmi");
          let match: RegExpExecArray | null;

          while ((match = regex.exec(line || "")) !== null) {
            results.push({
              file: relativePath,
              line: lineNum + 1,
              pattern: pattern.name,
              severity: pattern.severity || "medium",
              match: match[0],
              message: pattern.message || `${pattern.name} detected`,
              fullLine: line?.trim() || "",
            });
          }
        }
      }
    } catch (error) {
      console.warn(`⚠️  Could not scan file ${filePath}:`, error);
    }

    return results;
  }

  private static outputTable(results: AuditResult[]): void {
    console.log();

    // Group by severity for better readability
    const grouped = AuditCommand.groupBySeverity(results);

    for (const [severity, items] of Object.entries(grouped)) {
      if (items.length === 0) continue;

      const severityColor =
        severity === "high"
          ? color.red
          : severity === "medium"
            ? color.yellow
            : color.green;
      const emoji =
        severity === "high" ? "🔴" : severity === "medium" ? "🟡" : "🟢";

      p.note(
        items
          .map((result, idx) => {
            const lines = [
              `${color.cyan(result.file)}:${color.dim(result.line.toString())}`,
              `Pattern: ${color.bold(result.pattern)}`,
              `${color.dim("Code:")} ${result.fullLine}`,
              `${color.dim("Match:")} ${severityColor(`"${result.match}"`)}`,
            ];

            if (idx < items.length - 1) {
              lines.push(color.dim("─".repeat(40)));
            }

            return lines.join("\n");
          })
          .join("\n\n"),
        `${emoji} ${severity.toUpperCase()} (${items.length} ${items.length === 1 ? "issue" : "issues"})`,
      );
    }
  }

  private static outputJSON(results: AuditResult[]): void {
    console.log("📋 Audit Results (JSON Format):\n");
    console.log("```json");
    console.log(
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          totalIssues: results.length,
          summary: AuditCommand.generateSummary(results),
          issues: results,
        },
        null,
        2,
      ),
    );
    console.log("```");
  }

  private static outputCSV(results: AuditResult[]): void {
    console.log("📋 Audit Results (CSV Format):\n");
    console.log("```csv");
    console.log("File,Line,Pattern,Severity,Match,Message,FullLine");

    for (const result of results) {
      const csvLine = [
        result.file,
        result.line.toString(),
        result.pattern,
        result.severity,
        `"${result.match.replace(/"/g, '""')}"`,
        `"${result.message.replace(/"/g, '""')}"`,
        `"${result.fullLine.replace(/"/g, '""')}"`,
      ].join(",");
      console.log(csvLine);
    }
    console.log("```");
  }

  private static groupBySeverity(
    results: AuditResult[],
  ): Record<string, AuditResult[]> {
    return results.reduce(
      (groups, result) => {
        if (!groups[result.severity]) {
          groups[result.severity] = [];
        }
        groups[result.severity]?.push(result);
        return groups;
      },
      {} as Record<string, AuditResult[]>,
    );
  }

  private static generateSummary(
    results: AuditResult[],
  ): Record<string, number> {
    return results.reduce(
      (summary, result) => {
        summary[result.severity] = (summary[result.severity] || 0) + 1;
        return summary;
      },
      {} as Record<string, number>,
    );
  }
}
