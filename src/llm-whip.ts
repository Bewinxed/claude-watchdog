#!/usr/bin/env node

import { spawn, type ChildProcess, exec } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { type Config, type FileContext, type MatchInfo, ReactionType, Pattern } from './types';
import { defaultPatterns } from './default-patterns';
import { FileWatcher } from './file-watcher';
import { ClaudeLauncher } from './claude-launcher';
import { InitCommand } from './init-command';
import { AuditCommand } from './audit-command';
import { PermissionManager } from './permission-manager';

class ClaudeWatchdog extends EventEmitter {
  private config: Config;
  private claudeProcess: ChildProcess | null = null;
  private fileContext: FileContext = { currentFile: null, currentLine: null };
  private recentMatches: Map<string, number> = new Map();
  private outputBuffer = '';

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

  private getContext(text: string, index: number, contextSize = 100): string {
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
    
    // Show prominent interrupt message
    process.stderr.write(
      `\r\x1b[K\n` +
      `\x1b[41m\x1b[97m${'🚨'.repeat(10)} STOP CODING ${' 🚨'.repeat(10)}\x1b[0m\n` +
      `\x1b[91m\x1b[1m${match.message}\x1b[0m ${location}\n` +
      `\x1b[41m\x1b[97m${'🚨'.repeat(31)}\x1b[0m\n\n`
    );
    
    // Note: We can't send input to Claude's stdin in TUI mode
    // The visual alert above should be sufficient
  }

  private showAlert(match: MatchInfo): void {
    const location = match.file ? `in ${match.file}${match.line ? `:${match.line}` : ''}` : '';
    const timestamp = new Date().toLocaleTimeString();
    
    // Clear current line and show alert above Claude's output
    if (this.config.reactions.alert.format === 'color') {
      process.stderr.write(
        `\r\x1b[K\x1b[41m\x1b[97m ⚠️  ANTI-CHEAT DETECTED \x1b[0m\n` +
        `\x1b[90m[${timestamp}]\x1b[0m \x1b[31m${match.pattern}\x1b[0m: ${match.message} ${location}\n` +
        `\x1b[90mContext:\x1b[0m "${match.context}"\n\n`
      );
    } else {
      process.stderr.write(
        `\r\x1b[K[WATCHDOG ${timestamp}] ${match.pattern}: ${match.message} ${location}\n` +
        `Context: "${match.context}"\n\n`
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
    const claudePath = process.env.CLAUDE_PATH || 'claude';
    
    // Show startup message
    process.stderr.write('\x1b[90m[WATCHDOG]\x1b[0m Starting Claude...\n');
    process.stderr.write('\x1b[90m[WATCHDOG]\x1b[0m Note: Use "claude-watchdog watch ./src" for real-time file monitoring\n\n');
    
    // For Claude TUI, we pass through completely to avoid breaking the interface
    // Real-time monitoring works best with "watch" mode
    this.claudeProcess = spawn(claudePath, claudeArgs, {
      stdio: 'inherit',
      env: { ...process.env }
    });

    // Note: stdout/stderr monitoring is set up above based on mode

    // Handle process exit
    this.claudeProcess.on('exit', (code, signal) => {
      console.log('\n\x1b[90m[WATCHDOG]\x1b[0m Claude session ended');
      process.exit(code || 0);
    });

    // Handle errors
    this.claudeProcess.on('error', (err) => {
      console.error('\x1b[91m[WATCHDOG ERROR]\x1b[0m Failed to start Claude:', err.message);
      console.error('\x1b[93mTip:\x1b[0m Make sure Claude CLI is installed and in your PATH');
      process.exit(1);
    });

    // Proper signal handling for Ctrl+C
    const handleExit = (signal: string) => {
      console.log(`\n\x1b[90m[WATCHDOG]\x1b[0m Received ${signal}, shutting down...`);
      if (this.claudeProcess && !this.claudeProcess.killed) {
        this.claudeProcess.kill(signal === 'SIGINT' ? 'SIGTERM' : signal);
        // Give Claude time to clean up
        setTimeout(() => {
          if (!this.claudeProcess!.killed) {
            this.claudeProcess!.kill('SIGKILL');
          }
          process.exit(0);
        }, 1000);
      } else {
        process.exit(0);
      }
    };

    process.on('SIGINT', () => handleExit('SIGINT'));
    process.on('SIGTERM', () => handleExit('SIGTERM'));
    process.on('SIGHUP', () => handleExit('SIGHUP'));
  }
}

async function findConfigFile(): Promise<string | undefined> {
  const possibleConfigs = [
    'llm-whip.config.ts',
    'llm-whip.config.js',
    'claude-watchdog.config.ts', // Legacy support
    'claude-watchdog.config.js',
    'watchdog.config.ts',
    'watchdog.config.js',
    '.llm-whip.ts',
    '.llm-whip.js'
  ];

  for (const configFile of possibleConfigs) {
    try {
      await fs.promises.access(path.join(process.cwd(), configFile));
      return configFile;
    } catch {
      continue;
    }
  }

  return undefined;
}

async function loadTypescriptConfig(configPath: string): Promise<Config | null> {
  try {
    // For TypeScript config files, we need to import them dynamically
    if (configPath.endsWith('.ts')) {
      // Use dynamic import for TS files (requires ts-node or similar)
      const configModule = await import(path.resolve(configPath));
      return configModule.config || configModule.default;
    } else {
      // For JS files, use regular require
      const configModule = require(path.resolve(configPath));
      return configModule.config || configModule.default;
    }
  } catch (error) {
    console.warn(`Failed to load TypeScript config ${configPath}:`, error);
    return null;
  }
}

// CLI entry point
if (import.meta.main) {
  const args = process.argv.slice(2);
  
  async function main() {
    if (args[0] === 'init') {
      // Initialize configuration
      const targetDir = args[1] || process.cwd();
      await InitCommand.run(targetDir);
      return;
    }

    if (args[0] === 'audit') {
      // Audit directories for existing patterns
      const auditArgs = args.slice(1);
      const configPath = auditArgs.find(arg => arg.startsWith('--config='))?.split('=')[1] || await findConfigFile();
      const format = auditArgs.find(arg => arg.startsWith('--format='))?.split('=')[1] as 'table' | 'json' | 'csv' || 'table';
      const directories = auditArgs.filter(arg => !arg.startsWith('--'));
      
      if (directories.length === 0) {
        directories.push(process.cwd()); // Default to current directory
      }
      
      await AuditCommand.run(directories, configPath, format);
      return;
    }
    
    // Check for different modes
    if (args[0] === 'watch') {
      // File watch only mode
      const watchArgs = args.slice(1);
      const configPath = watchArgs.find(arg => arg.startsWith('--config='))?.split('=')[1] || await findConfigFile();
      const directories = watchArgs.filter(arg => !arg.startsWith('--'));
      
      if (directories.length === 0) {
        console.error('Usage: llm-whip watch [directories...] [--config=path]');
        console.error('Example: llm-whip watch ./src ./lib --config=config.ts');
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
          interrupt: { enabled: false, delay: 100 }, // Disabled by default
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
          // Try TypeScript config first
          const tsConfig = await loadTypescriptConfig(configPath);
          if (tsConfig) {
            config = { ...config, ...tsConfig };
          } else {
            // Fallback to JSON
            const customConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            config = { ...config, ...customConfig };
          }
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          console.error('Failed to load config:', errorMessage);
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
      // Default: Background monitoring mode
      if (args.includes('--help') || args.includes('-h')) {
        console.log(`
LLM Whip - Anti-cheat monitoring for LLM coding sessions

Usage:
  llm-whip [options]                     Launch Claude with background monitoring (DEFAULT)
  llm-whip init [dir]                    Create TypeScript configuration file
  llm-whip audit [dirs...] [options]     Scan directories and report existing patterns
  llm-whip watch <dirs...>               Watch directories only (no LLM)

Options:
  --config=<path>                        Custom configuration file (.ts, .js, or .json)
  --format=<type>                        Audit output format: table, json, csv (default: table)
  --help, -h                             Show this help

Examples:
  llm-whip init                          # Create llm-whip.config.ts
  llm-whip audit                         # Scan current directory for patterns
  llm-whip audit ./src --format=json     # Audit src directory, output as JSON
  llm-whip                               # Launch Claude with background monitoring
  llm-whip --config=strict.ts            # With custom TypeScript config
  llm-whip watch ./src ./lib             # File monitoring only

The default mode runs Claude normally while monitoring files for anti-cheat patterns!
TypeScript configs provide full type safety and better IDE support.
`);
        process.exit(0);
      }
      
      // Check for first-time use and permission setup
      const keyboardEnabled = await PermissionManager.promptForKeyboardPermission();
      
      // Default: Background monitoring mode
      const configPath = args.find(arg => arg.startsWith('--config='))?.split('=')[1] || await findConfigFile();
      await ClaudeLauncher.startWithWatchdog(configPath, keyboardEnabled);
    }
  }
  
  main().catch(console.error);
}

export default ClaudeWatchdog;