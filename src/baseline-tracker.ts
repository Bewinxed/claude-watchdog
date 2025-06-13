import { createHash } from "node:crypto";

interface BaselineEntry {
  file: string;
  line: number;
  pattern: string;
  contentHash: string; // Hash of the line content to detect changes
}

interface Baseline {
  timestamp: number;
  entries: BaselineEntry[];
}

export class BaselineTracker {
  private static baseline: Baseline | null = null;

  static async createBaseline(entries: BaselineEntry[]): Promise<void> {
    BaselineTracker.baseline = {
      timestamp: Date.now(),
      entries,
    };
    console.log(`📸 Created baseline with ${entries.length} existing patterns`);
  }

  static async loadBaseline(): Promise<Baseline | null> {
    return BaselineTracker.baseline;
  }

  static async hasBaseline(): Promise<boolean> {
    return BaselineTracker.baseline !== null;
  }

  static isNewPattern(
    file: string,
    line: number,
    pattern: string,
    fullLine: string,
    baseline: Baseline,
  ): boolean {
    const contentHash = BaselineTracker.hashContent(fullLine);

    return !baseline.entries.some(
      (entry) =>
        entry.file === file &&
        entry.line === line &&
        entry.pattern === pattern &&
        entry.contentHash === contentHash,
    );
  }

  static createBaselineEntry(
    file: string,
    line: number,
    pattern: string,
    fullLine: string,
  ): BaselineEntry {
    return {
      file,
      line,
      pattern,
      contentHash: BaselineTracker.hashContent(fullLine),
    };
  }

  private static hashContent(content: string): string {
    return createHash("md5").update(content.trim()).digest("hex");
  }

  static async updateBaseline(newEntries: BaselineEntry[]): Promise<void> {
    if (!BaselineTracker.baseline) {
      await BaselineTracker.createBaseline(newEntries);
      return;
    }

    // Merge new entries with existing ones
    const existingKeys = new Set(
      BaselineTracker.baseline.entries.map(
        (e) => `${e.file}:${e.line}:${e.pattern}:${e.contentHash}`,
      ),
    );

    const uniqueNewEntries = newEntries.filter(
      (entry) =>
        !existingKeys.has(
          `${entry.file}:${entry.line}:${entry.pattern}:${entry.contentHash}`,
        ),
    );

    if (uniqueNewEntries.length > 0) {
      BaselineTracker.baseline.entries.push(...uniqueNewEntries);
      BaselineTracker.baseline.timestamp = Date.now();
      console.log(
        `📸 Updated baseline with ${uniqueNewEntries.length} new patterns`,
      );
    }
  }

  static async clearBaseline(): Promise<void> {
    BaselineTracker.baseline = null;
    console.log("🗑️ Cleared baseline");
  }
}
