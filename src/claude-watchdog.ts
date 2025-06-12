#!/usr/bin/env node

import { spawn, ChildProcess, exec } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Config, FileContext, MatchInfo, ReactionType, Pattern } from './types';
import { defaultPatterns } from './default-patterns';
import { FileWatcher } from './file-watcher';

class ClaudeWatchdog extends EventEmitter {
  private config: Config;
  private claudeProcess: ChildProcess | null = null;
  private fileContext: FileContext = { currentFile: null, currentLine: null };
  private recentMatches: Map<string, number> = new Map();
  private outputBuffer: string = '';

  constructor(customConfig: Partial<Config> = {}) {
    super();
    this.config = this.loadConfig(customConfig);
  }

  private loadConfig(customConfig: Partial<Config>): Config {
    const defaultConfig: Config = {
      patterns: customConfig.patterns || defaultPatterns,
      reactions: {
        sound: {
          enabled: true,
          command: process.platform === 'darwin' ? 'afplay /System/Library/Sounds/Basso.aiff' :
                   process.platform === 'win32' ? 'powershell -c (New-Object Media.SoundPlayer "C:\\Windows\\Media\\chord.wav").PlaySync()' :
                   'paplay /usr/share/sounds/freedesktop/stereo/bell.oga'
        },
        interrupt: {
          enabled: true,
          delay: 100
        },
        alert: {
          enabled: true,
          format: "color"
        }
      },
      debounce: {
        enabled: true,
        window: 5000
      },
      fileTracking: {
        enabled: true,
        patterns: {
          filePath: "(?:^|\\s)([\\/\\w\\-\\.]+\\.(js|ts|py|java|cpp|c|go|rs|rb|php|jsx|tsx|vue|svelte))",
          editingFile: "(?:editing|modifying|updating|writing to|creating)\\s+([\\/\\w\\-\\.]+\\.\\w+)",
          lineNumber: "line\\s+(\\d+)|:(\\d+):|at\\s+(\\d+)"
        }
      }
    };

    return { ...defaultConfig, ...customConfig };
  }

  private detectFileContext(line: string): void {
    if (!this.config.fileTracking.enabled) return;

    // Check for file path mentions
    const fileMatch = line.match(new RegExp(this.config.fileTracking.patterns.filePath, 'i'));
    if (fileMatch) {
      this.fileContext.currentFile = fileMatch[1];
    }

    // Check for explicit editing mentions
    const editMatch = line.match(new RegExp(this.config.fileTracking.patterns.editingFile, 'i'));
    if (editMatch) {
      this.fileContext.currentFile = editMatch[1];
    }

    // Check for line numbers
    const lineMatch = line.match(new RegExp(this.config.fileTracking.patterns.lineNumber, 'i'));
    if (lineMatch) {
      this.fileContext.currentLine = lineMatch[1] || lineMatch[2] || lineMatch[3];
    }
  }

  private checkPatterns(text: string): MatchInfo[] {
    const matches: MatchInfo[] = [];
    
    for (const patternConfig of this.config.patterns) {
      const regex = new RegExp(patternConfig.pattern, 'gmi');
      let match: RegExpExecArray | null;
      
      while ((match = regex.exec(text)) !== null) {
        const matchInfo: MatchInfo = {
          pattern: patternConfig.name,
          severity: patternConfig.severity,
          match: match[0],
          index: match.index,
          reactions: patternConfig.reactions,
          message: patternConfig.message,
          file: this.fileContext.currentFile,
          line: this.fileContext.currentLine,
          context: this.getContext(text, match.index)
        };

        // Check debounce
        const matchKey = `${patternConfig.name}-${matchInfo.file || 'unknown'}`;
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

  private getContext(text: string, index: number, contextSize: number = 100): string {
    const start = Math.max(0, index - contextSize);
    const end = Math.min(text.length, index + contextSize);
    return text.substring(start, end).replace(/\n/g, ' ');
  }

  private async executeReactions(matches: MatchInfo[]): Promise<void> {
    for (const match of matches) {
      this.emit('match', match);
      
      for (const reaction of match.reactions) {
        switch (reaction) {
          case 'sound':
            if (this.config.reactions.sound.enabled) {
              this.playSound();
            }
            break;
            
          case 'interrupt':
            if (this.config.reactions.interrupt.enabled) {
              await this.interruptClaude(match);
            }
            break;
            
          case 'alert':
            if (this.config.reactions.alert.enabled) {
              this.showAlert(match);
            }
            break;
        }
      }
    }
  }

  private playSound(): void {
    exec(this.config.reactions.sound.command, (err) => {
      if (err) console.error('Failed to play sound:', err.message);
    });
  }

  private async interruptClaude(match: MatchInfo): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, this.config.reactions.interrupt.delay));
    
    const location = match.file ? `in ${match.file}${match.line ? `:${match.line}` : ''}` : '';
    const message = `\n${match.message} ${location}\n`;
    
    // Send interrupt to Claude's stdin
    if (this.claudeProcess && this.claudeProcess.stdin) {
      this.claudeProcess.stdin.write(message);
    }
  }

  private showAlert(match: MatchInfo): void {
    const location = match.file ? `in ${match.file}${match.line ? `:${match.line}` : ''}` : '';
    const timestamp = new Date().toISOString();
    
    if (this.config.reactions.alert.format === 'color') {
      console.error(
        `\n\x1b[33m[WATCHDOG ${timestamp}]\x1b[0m \x1b[31m${match.pattern}\x1b[0m: ${match.message} ${location}\n` +
        `Context: "${match.context}"\n`
      );
    } else {
      console.error(
        `\n[WATCHDOG ${timestamp}] ${match.pattern}: ${match.message} ${location}\n` +
        `Context: "${match.context}"\n`
      );
    }
  }

  private processOutput(data: Buffer): void {
    const text = data.toString();
    this.outputBuffer += text;
    
    // Process complete lines
    const lines = this.outputBuffer.split('\n');
    this.outputBuffer = lines.pop() || '';
    
    for (const line of lines) {
      // Update file context
      this.detectFileContext(line);
      
      // Check for cheat patterns
      const matches = this.checkPatterns(line);
      if (matches.length > 0) {
        this.executeReactions(matches);
      }
    }
    
    // Pass through to stdout
    process.stdout.write(data);
  }

  public start(claudeArgs: string[] = []): void {
    const claudePath = process.env.CLAUDE_PATH || '/Users/bewinxed/.bun/bin/claude';
    
    console.log('Starting Claude Watchdog...');
    console.log(`Monitoring for ${this.config.patterns.length} patterns`);
    
    // Spawn Claude process
    this.claudeProcess = spawn(claudePath, claudeArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    // Set up stdout monitoring
    this.claudeProcess.stdout!.on('data', (data: Buffer) => {
      this.processOutput(data);
    });

    // Pass through stderr
    this.claudeProcess.stderr!.on('data', (data: Buffer) => {
      process.stderr.write(data);
    });

    // Set up stdin forwarding
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.pipe(this.claudeProcess.stdin!);

    // Handle process exit
    this.claudeProcess.on('exit', (code) => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.exit(code || 0);
    });

    // Handle errors
    this.claudeProcess.on('error', (err) => {
      console.error('Failed to start Claude:', err);
      process.exit(1);
    });

    // Handle SIGINT
    process.on('SIGINT', () => {
      if (this.claudeProcess) {
        this.claudeProcess.kill('SIGINT');
      }
      process.exit(0);
    });
  }
}

// CLI entry point
if (import.meta.main) {
  const args = process.argv.slice(2);
  
  // Check if running in watch mode
  if (args[0] === 'watch') {
    const watchArgs = args.slice(1);
    const configPath = watchArgs.find(arg => arg.startsWith('--config='))?.split('=')[1];
    const directories = watchArgs.filter(arg => !arg.startsWith('--'));
    
    if (directories.length === 0) {
      console.error('Usage: claude-watchdog watch [directories...] [--config=path]');
      console.error('Example: claude-watchdog watch ./src ./lib --config=config.json');
      process.exit(1);
    }
    
    let config: Config = {
      patterns: defaultPatterns,
      reactions: {
        sound: {
          enabled: true,
          command: process.platform === 'darwin' ? 'afplay /System/Library/Sounds/Basso.aiff' :
                   process.platform === 'win32' ? 'powershell -c (New-Object Media.SoundPlayer "C:\\Windows\\Media\\chord.wav").PlaySync()' :
                   'paplay /usr/share/sounds/freedesktop/stereo/bell.oga'
        },
        interrupt: { enabled: true, delay: 100 },
        alert: { enabled: true, format: "color" }
      },
      debounce: { enabled: true, window: 5000 },
      fileTracking: {
        enabled: true,
        patterns: {
          filePath: "(?:^|\\s)([\\/\\w\\-\\.]+\\.(js|ts|py|java|cpp|c|go|rs|rb|php|jsx|tsx|vue|svelte))",
          editingFile: "(?:editing|modifying|updating|writing to|creating)\\s+([\\/\\w\\-\\.]+\\.\\w+)",
          lineNumber: "line\\s+(\\d+)|:(\\d+):|at\\s+(\\d+)"
        }
      }
    };
    
    if (configPath) {
      try {
        const customConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        config = { ...config, ...customConfig };
      } catch (err: any) {
        console.error('Failed to load config:', err.message);
        process.exit(1);
      }
    }
    
    const watcher = new FileWatcher({ config, directories });
    watcher.start();
    
    // Handle exit
    process.on('SIGINT', () => {
      console.log('\nStopping file watcher...');
      watcher.stop();
      process.exit(0);
    });
  } else {
    // Normal Claude wrapper mode
    const configPath = args.find(arg => arg.startsWith('--config='))?.split('=')[1];
    const claudeArgs = args.filter(arg => !arg.startsWith('--config='));
    
    let config: Partial<Config> = {};
    if (configPath) {
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch (err: any) {
        console.error('Failed to load config:', err.message);
        process.exit(1);
      }
    }
    
    const watchdog = new ClaudeWatchdog(config);
    watchdog.start(claudeArgs);
  }
}

export default ClaudeWatchdog;