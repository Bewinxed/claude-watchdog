import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

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
  private static readonly BASELINE_FILE = '.llm-whip-baseline.json';

  static async createBaseline(entries: BaselineEntry[]): Promise<void> {
    const baseline: Baseline = {
      timestamp: Date.now(),
      entries
    };

    await writeFile(this.BASELINE_FILE, JSON.stringify(baseline, null, 2));
    console.log(`📸 Created baseline with ${entries.length} existing patterns`);
  }

  static async loadBaseline(): Promise<Baseline | null> {
    try {
      await access(this.BASELINE_FILE);
      const content = await readFile(this.BASELINE_FILE, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  static async hasBaseline(): Promise<boolean> {
    try {
      await access(this.BASELINE_FILE);
      return true;
    } catch {
      return false;
    }
  }

  static isNewPattern(file: string, line: number, pattern: string, fullLine: string, baseline: Baseline): boolean {
    const contentHash = this.hashContent(fullLine);
    
    return !baseline.entries.some(entry => 
      entry.file === file &&
      entry.line === line &&
      entry.pattern === pattern &&
      entry.contentHash === contentHash
    );
  }

  static createBaselineEntry(file: string, line: number, pattern: string, fullLine: string): BaselineEntry {
    return {
      file,
      line,
      pattern,
      contentHash: this.hashContent(fullLine)
    };
  }

  private static hashContent(content: string): string {
    return createHash('md5').update(content.trim()).digest('hex');
  }

  static async updateBaseline(newEntries: BaselineEntry[]): Promise<void> {
    let baseline = await this.loadBaseline();
    
    if (!baseline) {
      await this.createBaseline(newEntries);
      return;
    }

    // Merge new entries with existing ones
    const existingKeys = new Set(
      baseline.entries.map(e => `${e.file}:${e.line}:${e.pattern}:${e.contentHash}`)
    );

    const uniqueNewEntries = newEntries.filter(entry => 
      !existingKeys.has(`${entry.file}:${entry.line}:${entry.pattern}:${entry.contentHash}`)
    );

    if (uniqueNewEntries.length > 0) {
      baseline.entries.push(...uniqueNewEntries);
      baseline.timestamp = Date.now();
      await writeFile(this.BASELINE_FILE, JSON.stringify(baseline, null, 2));
      console.log(`📸 Updated baseline with ${uniqueNewEntries.length} new patterns`);
    }
  }

  static async clearBaseline(): Promise<void> {
    try {
      await writeFile(this.BASELINE_FILE, '');
      console.log('🗑️ Cleared baseline');
    } catch (error) {
      console.warn('Failed to clear baseline:', error);
    }
  }
}