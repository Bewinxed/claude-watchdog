import { watch, FSWatcher } from "fs";
import { readFile } from "fs/promises";
import { resolve, relative } from "path";
import { EventEmitter } from "events";
import type { Config, MatchInfo, FileContext } from "./types";
import { defaultPatterns } from "./default-patterns";

interface WatcherOptions {
  config: Config;
  directories: string[];
  fileExtensions?: string[];
  ignorePatterns?: string[];
}

export class FileWatcher extends EventEmitter {
  private config: Config;
  private directories: string[];
  private fileExtensions: Set<string>;
  private ignorePatterns: RegExp[];
  private recentMatches: Map<string, number> = new Map();
  private fileContexts: Map<string, FileContext> = new Map();
  private watchers: FSWatcher[] = [];

  constructor(options: WatcherOptions) {
    super();
    this.config = options.config;
    this.directories = options.directories.map(d => resolve(d));
    
    // Default to common code file extensions
    this.fileExtensions = new Set(options.fileExtensions || [
      '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.cpp', '.c', 
      '.go', '.rs', '.rb', '.php', '.vue', '.svelte', '.swift'
    ]);
    
    // Default ignore patterns
    this.ignorePatterns = (options.ignorePatterns || [
      'node_modules', 'dist', 'build', '.git', 'coverage', '.next'
    ]).map(pattern => new RegExp(pattern));
  }

  async start() {
    console.log(`🔍 Watching ${this.directories.length} directories for anti-patterns...`);
    console.log(`📝 Monitoring ${this.config.patterns.length} patterns`);
    console.log(`📁 File extensions: ${Array.from(this.fileExtensions).join(', ')}`);
    
    for (const dir of this.directories) {
      const watcher = this.watchDirectory(dir);
      this.watchers.push(watcher);
    }
  }

  private watchDirectory(dir: string) {
    const watcher = watch(dir, { recursive: true }, async (eventType, filename) => {
      if (!filename) return;
      
      const filePath = resolve(dir, filename.toString());
      
      // Check if we should process this file
      if (!this.shouldProcessFile(filePath)) return;
      
      try {
        await this.processFile(filePath);
      } catch (err) {
        // File might have been deleted or is inaccessible
        if ((err as any).code !== 'ENOENT') {
          console.error(`Error processing ${filePath}:`, err);
        }
      }
    });

    this.emit('watching', dir);
    return watcher;
  }

  private shouldProcessFile(filePath: string): boolean {
    // Check if file has a valid extension
    const hasValidExtension = Array.from(this.fileExtensions).some(ext => 
      filePath.endsWith(ext)
    );
    
    if (!hasValidExtension) return false;
    
    // Check ignore patterns
    const isIgnored = this.ignorePatterns.some(pattern => 
      pattern.test(filePath)
    );
    
    return !isIgnored;
  }

  private async processFile(filePath: string) {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    
    // Update file context
    const fileContext: FileContext = {
      currentFile: filePath,
      currentLine: null,
      history: []
    };
    
    this.fileContexts.set(filePath, fileContext);
    
    // Process each line
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      fileContext.currentLine = (lineNum + 1).toString();
      
      const matches = this.checkPatterns(line, filePath, lineNum + 1);
      
      if (matches.length > 0) {
        await this.executeReactions(matches);
      }
    }
  }

  private checkPatterns(line: string, filePath: string, lineNumber: number): MatchInfo[] {
    const matches: MatchInfo[] = [];
    
    for (const patternConfig of this.config.patterns) {
      const regex = new RegExp(patternConfig.pattern, 'gmi');
      let match: RegExpExecArray | null;
      
      while ((match = regex.exec(line)) !== null) {
        const matchInfo: MatchInfo = {
          pattern: patternConfig.name,
          severity: patternConfig.severity,
          match: match[0],
          index: match.index,
          reactions: patternConfig.reactions,
          message: patternConfig.message,
          file: relative(process.cwd(), filePath),
          line: lineNumber.toString(),
          context: this.getContext(line, match.index),
          timestamp: Date.now(),
          fullLine: line.trim()
        };

        // Check debounce
        const matchKey = `${filePath}-${lineNumber}-${patternConfig.name}`;
        const lastMatch = this.recentMatches.get(matchKey);
        
        if (!this.config.debounce.enabled || 
            !lastMatch || 
            Date.now() - lastMatch > this.config.debounce.window) {
          matches.push(matchInfo);
          this.recentMatches.set(matchKey, Date.now());
        }
      }
    }
    
    return matches;
  }

  private getContext(text: string, index: number, contextSize: number = 50): string {
    const start = Math.max(0, index - contextSize);
    const end = Math.min(text.length, index + contextSize);
    return text.substring(start, end).trim();
  }

  private async executeReactions(matches: MatchInfo[]) {
    for (const match of matches) {
      this.emit('match', match);
      
      for (const reaction of match.reactions) {
        switch (reaction) {
          case 'sound':
            if (this.config.reactions.sound.enabled) {
              this.playSound();
            }
            break;
            
          case 'alert':
            if (this.config.reactions.alert.enabled) {
              this.showAlert(match);
            }
            break;
            
          case 'interrupt':
            // In watch mode, we can't interrupt Claude, so we'll show a prominent alert
            if (this.config.reactions.interrupt.enabled) {
              this.showInterruptAlert(match);
            }
            break;
        }
      }
    }
  }

  private playSound() {
    const { exec } = require('child_process');
    exec(this.config.reactions.sound.command, (err: any) => {
      if (err) console.error('Failed to play sound:', err.message);
    });
  }

  private showAlert(match: MatchInfo) {
    const timestamp = new Date().toISOString();
    
    if (this.config.reactions.alert.format === 'color') {
      console.log(
        `\n\x1b[33m[WATCHDOG ${timestamp}]\x1b[0m \x1b[31m${match.pattern}\x1b[0m`
      );
      console.log(`📁 File: \x1b[36m${match.file}:${match.line}\x1b[0m`);
      console.log(`💬 Message: \x1b[91m${match.message}\x1b[0m`);
      console.log(`📝 Line: "${match.fullLine}"`);
      console.log(`🔍 Context: "${match.context}"`);
    } else {
      console.log(
        `\n[WATCHDOG ${timestamp}] ${match.pattern}`
      );
      console.log(`File: ${match.file}:${match.line}`);
      console.log(`Message: ${match.message}`);
      console.log(`Line: "${match.fullLine}"`);
      console.log(`Context: "${match.context}"`);
    }
  }

  private showInterruptAlert(match: MatchInfo) {
    console.log('\n' + '🚨'.repeat(20));
    console.log(`\x1b[91m⚠️  ${match.message}\x1b[0m`);
    console.log(`\x1b[93m📍 Location: ${match.file}:${match.line}\x1b[0m`);
    console.log('🚨'.repeat(20) + '\n');
  }

  stop() {
    // Close all watchers
    this.watchers.forEach(watcher => watcher.close());
    this.watchers = [];
    this.removeAllListeners();
    this.recentMatches.clear();
    this.fileContexts.clear();
  }
}