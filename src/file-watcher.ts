import { readFile } from "fs/promises";
import { resolve, relative, join } from "path";
import { EventEmitter } from "events";
import { watch } from "fs";
import { existsSync, readFileSync } from "fs";
import ignore from "ignore";
import type { Config, MatchInfo, FileContext } from "./types";
import { KeyboardController } from "./keyboard-controller";
import { BaselineTracker } from "./baseline-tracker";

interface WatcherOptions {
  config: Config;
  directories: string[];
  fileExtensions?: string[];
  ignorePatterns?: string[];
  respectGitignore?: boolean; // Default: true
  grepPatterns?: string[]; // Only process files matching these patterns
}

export class FileWatcher extends EventEmitter {
  private config: Config;
  private directories: string[];
  private fileExtensions: Set<string>;
  private ignorePatterns: RegExp[];
  private gitignore: ReturnType<typeof ignore> | null = null;
  private grepPatterns: RegExp[];
  private recentMatches: Map<string, number> = new Map();
  private fileContexts: Map<string, FileContext> = new Map();
  private watchers: (() => void)[] = []; // Array of cleanup functions
  private baseline: Awaited<ReturnType<typeof BaselineTracker.loadBaseline>> = null;
  private respectGitignore: boolean;

  constructor(options: WatcherOptions) {
    super();
    this.config = options.config;
    this.directories = options.directories.map(d => resolve(d));
    this.respectGitignore = options.respectGitignore !== false; // Default to true
    
    // Default to common code file extensions
    this.fileExtensions = new Set(options.fileExtensions || [
      '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.cpp', '.c', 
      '.go', '.rs', '.rb', '.php', '.vue', '.svelte', '.swift'
    ]);
    
    // Default ignore patterns
    this.ignorePatterns = (options.ignorePatterns || [
      'node_modules', 'dist', 'build', '.git', 'coverage', '.next'
    ]).map(pattern => new RegExp(pattern));
    
    // Grep patterns for filtering file content
    this.grepPatterns = (options.grepPatterns || []).map(pattern => new RegExp(pattern, 'i'));
    
    // Initialize gitignore if enabled
    if (this.respectGitignore) {
      this.gitignore = ignore();
      this.loadGitignorePatterns();
    }
  }

  async start() {
    console.log(`🔍 Watching ${this.directories.length} directories for anti-patterns...`);
    console.log(`📝 Monitoring ${this.config.patterns.length} patterns`);
    console.log(`📁 File extensions: ${Array.from(this.fileExtensions).join(', ')}`);
    console.log(`⌨️  Will send keyboard interrupts to active window when patterns detected`);
    
    if (this.respectGitignore) {
      console.log(`🚫 Respecting .gitignore patterns`);
    }
    
    if (this.grepPatterns.length > 0) {
      console.log(`🔍 Filtering files with grep patterns: ${this.grepPatterns.map(p => p.source).join(', ')}`);
    }
    
    // Load baseline for new vs existing pattern detection
    this.baseline = await BaselineTracker.loadBaseline();
    if (this.baseline) {
      console.log(`📸 Loaded baseline with ${this.baseline.entries.length} existing patterns (will only alert on NEW patterns)`);
    } else {
      console.log(`📸 No baseline found - will alert on ALL patterns. Run 'llm-whip audit' first to create baseline.`);
    }
    
    console.log(`🎯 Focus your Claude window and start coding...\n`);
    
    // Initialize keyboard controller
    await KeyboardController.init();
    
    for (const dir of this.directories) {
      const watcher = this.watchDirectory(dir);
      this.watchers.push(watcher);
    }
  }

  private watchDirectory(dir: string) {
    // Use Node.js fs.watch for directory watching
    const watcher = watch(dir, { recursive: true }, async (_, filename) => {
      if (!filename) return;
      
      const filePath = resolve(dir, filename);
      
      // Check if we should process this file
      if (!this.shouldProcessFile(filePath)) return;
      
      // Add small delay to ensure file is written
      setTimeout(async () => {
        try {
          await this.processFile(filePath);
        } catch (err) {
          // File might have been deleted or is inaccessible
          const nodeError = err as NodeJS.ErrnoException;
          if (nodeError.code !== 'ENOENT') {
            console.error(`Error processing ${filePath}:`, err);
          }
        }
      }, 100); // 100ms delay to ensure file write is complete
    });

    watcher.on('error', (error) => {
      console.error(`Watcher error for ${dir}:`, error);
    });

    const stopWatching = () => {
      watcher.close();
    };

    this.emit('watching', dir);
    return stopWatching;
  }

  private shouldProcessFile(filePath: string): boolean {
    // Check if file has a valid extension
    const hasValidExtension = Array.from(this.fileExtensions).some(ext => 
      filePath.endsWith(ext)
    );
    
    if (!hasValidExtension) return false;
    
    // Check custom ignore patterns
    const isIgnored = this.ignorePatterns.some(pattern => 
      pattern.test(filePath)
    );
    
    if (isIgnored) return false;
    
    // Check gitignore patterns if enabled
    if (this.respectGitignore && this.gitignore) {
      // Find the relative path from the closest watched directory
      const watchedDir = this.directories.find(dir => filePath.startsWith(dir));
      if (watchedDir) {
        const relativePath = relative(watchedDir, filePath);
        if (this.gitignore.ignores(relativePath)) {
          return false;
        }
      }
    }
    
    return true;
  }

  private async processFile(filePath: string) {
    const content = await readFile(filePath, 'utf-8');
    
    // If grep patterns are specified, only process files that match
    if (this.grepPatterns.length > 0) {
      const hasMatch = this.grepPatterns.some(pattern => pattern.test(content));
      if (!hasMatch) {
        return; // Skip files that don't match grep patterns
      }
    }
    
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
      
      const matches = this.checkPatterns(line || '', filePath, lineNum + 1);
      
      
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
        const relativePath = relative(process.cwd(), filePath);
        const fullLineContent = line.trim();
        
        // Check if this is a new pattern (not in baseline)
        const isNew = !this.baseline || BaselineTracker.isNewPattern(
          relativePath, 
          lineNumber, 
          patternConfig.name, 
          fullLineContent, 
          this.baseline
        );

        // Only alert on new patterns if we have a baseline
        if (!isNew && this.baseline) {
          continue; // Skip existing patterns
        }

        const matchInfo: MatchInfo = {
          pattern: patternConfig.name,
          severity: patternConfig.severity || 'medium',
          match: match[0],
          index: match.index,
          reactions: patternConfig.reactions || ['alert'],
          message: isNew ? `🆕 NEW ${patternConfig.message || `${patternConfig.name} detected`}` : (patternConfig.message || `${patternConfig.name} detected`),
          file: relativePath,
          line: lineNumber.toString(),
          context: this.getContext(line, match.index),
          timestamp: Date.now(),
          fullLine: fullLineContent
        };

        // Check debounce
        const matchKey = `${filePath}-${lineNumber}-${patternConfig.name}`;
        const lastMatch = this.recentMatches.get(matchKey);
        
        const debounceWindow = typeof this.config.debounce === 'number' ? this.config.debounce : (this.config.debounce === false ? 0 : 2000);
        if (debounceWindow === 0 || !lastMatch || Date.now() - lastMatch > debounceWindow) {
          matches.push(matchInfo);
          this.recentMatches.set(matchKey, Date.now());
          
          // Schedule baseline update (async, don't wait)
          if (isNew) {
            const baselineEntry = BaselineTracker.createBaselineEntry(
              relativePath, 
              lineNumber, 
              patternConfig.name, 
              fullLineContent
            );
            BaselineTracker.updateBaseline([baselineEntry]).catch(console.error);
          }
        }
      }
    }
    
    return matches;
  }

  private getContext(text: string, index: number, contextSize = 50): string {
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
            const soundEnabled = this.config.reactions?.sound !== false;
            if (soundEnabled) {
              this.playSound();
              // Also send system notification
              await KeyboardController.sendNotification(
                'Claude Watchdog',
                `Anti-cheat detected in ${match.file}:${match.line}`
              );
            }
            break;
            
          case 'alert':
            const alertEnabled = this.config.reactions?.alert !== false;
            if (alertEnabled) {
              this.showAlert(match);
            }
            break;
            
          case 'interrupt':
            const interruptEnabled = this.config.reactions?.interrupt === true || 
              (typeof this.config.reactions?.interrupt === 'object' && this.config.reactions.interrupt !== null);
            if (interruptEnabled) {
              await this.sendKeyboardInterrupt(match);
            }
            break;
        }
      }
    }
  }

  private playSound() {
    const { exec } = require('child_process');
    const soundConfig = this.config.reactions?.sound;
    const command = typeof soundConfig === 'object' && soundConfig?.command 
      ? soundConfig.command 
      : process.platform === 'darwin' ? 'afplay /System/Library/Sounds/Basso.aiff' :
        process.platform === 'win32' ? 'powershell -c (New-Object Media.SoundPlayer "C:\\Windows\\Media\\chord.wav").PlaySync()' :
        'paplay /usr/share/sounds/freedesktop/stereo/bell.oga';
    
    exec(command, (err: Error | null) => {
      if (err) console.error('Failed to play sound:', err.message);
    });
  }

  private showAlert(match: MatchInfo) {
    const timestamp = new Date().toISOString();
    const alertConfig = this.config.reactions?.alert;
    const format = typeof alertConfig === 'object' && alertConfig?.format ? alertConfig.format : 'color';
    
    if (format === 'color') {
      console.log(
        `\n\x1b[33m[WATCHDOG ${timestamp}]\x1b[0m \x1b[31m${match.pattern}\x1b[0m`
      );
      console.log(`📁 File: \x1b[36m${match.file}:${match.line}\x1b[0m`);
      console.log(`💬 Message: \x1b[91m${match.message}\x1b[0m`);
      console.log(`📝 Line: "${match.fullLine}"`);
      console.log(`🔍 Context: "${match.context}"`);
    } else {
      // Plain format - output to stdout for test compatibility
      console.log(
        `\n[WATCHDOG ${timestamp}] ${match.pattern}`
      );
      console.log(`File: ${match.file}:${match.line}`);
      console.log(`Message: ${match.message}`);
      console.log(`Line: "${match.fullLine}"`);
      console.log(`Context: "${match.context}"`);
    }
  }

  private async sendKeyboardInterrupt(match: MatchInfo) {
    const location = `${match.file}:${match.line}`;
    
    // Show local alert
    process.stderr.write(
      `\n\x1b[41m\x1b[97m${'🚨'.repeat(10)} INTERRUPTING CLAUDE ${'🚨'.repeat(10)}\x1b[0m\n` +
      `\x1b[91m\x1b[1m⚠️  ${match.message}\x1b[0m\n` +
      `\x1b[93m📍 Location: ${location}\x1b[0m\n` +
      `\x1b[90mSending keyboard interrupt to active window...\x1b[0m\n` +
      `\x1b[41m\x1b[97m${'🚨'.repeat(41)}\x1b[0m\n\n`
    );
    
    // Send keyboard interrupt to Claude
    const success = await KeyboardController.sendInterruptSequence(match.message, location);
    
    if (!success) {
      process.stderr.write(
        `\x1b[93m⚠️  Could not send keyboard interrupt. Make sure Claude window is active.\x1b[0m\n\n`
      );
      
      // Fallback to system notification
      await KeyboardController.sendNotification(
        'Claude Watchdog - Anti-Cheat Detected',
        `${match.message} at ${location}`
      );
    }
  }

  private loadGitignorePatterns(): void {
    if (!this.gitignore) return;
    
    // Look for .gitignore files in watched directories and their parents
    const gitignorePaths = new Set<string>();
    
    for (const dir of this.directories) {
      let currentDir = dir;
      
      // Walk up the directory tree looking for .gitignore files
      while (currentDir !== '/' && currentDir !== '') {
        const gitignorePath = join(currentDir, '.gitignore');
        if (existsSync(gitignorePath)) {
          gitignorePaths.add(gitignorePath);
        }
        
        const parentDir = resolve(currentDir, '..');
        if (parentDir === currentDir) break; // Reached root
        currentDir = parentDir;
      }
    }
    
    // Load all found .gitignore files
    for (const gitignorePath of gitignorePaths) {
      try {
        const content = readFileSync(gitignorePath, 'utf-8');
        this.gitignore.add(content);
      } catch (err) {
        console.warn(`Failed to load .gitignore from ${gitignorePath}:`, err);
      }
    }
    
    // Always ignore .git directory
    this.gitignore.add('.git');
  }

  stop() {
    console.log('\n🛑 Stopping file watcher...');
    // Close all watchers
    this.watchers.forEach(watcher => watcher());
    this.watchers = [];
    this.removeAllListeners();
    this.recentMatches.clear();
    this.fileContexts.clear();
  }
}