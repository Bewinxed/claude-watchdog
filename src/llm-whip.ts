#!/usr/bin/env node

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import type { Config } from './types';
import { config as rootConfig } from '../llm-whip.config';
import { showHelp } from './cli-help';
import { FileWatcher } from './file-watcher';
import { ClaudeLauncher } from './claude-launcher';
import { InitCommand } from './init-command';
import { AuditCommand } from './audit-command';
import { PermissionManager } from './permission-manager';

class ClaudeWatchdog extends EventEmitter {
  private config: Config;
  private claudeProcess: ChildProcess | null = null;

  constructor(customConfig: Partial<Config> = {}) {
    super();
    this.config = this.loadConfig(customConfig);
  }

  private loadConfig(customConfig: Partial<Config>): Config {
    const defaultConfig: Config = rootConfig;
    return { ...defaultConfig, ...customConfig };
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
    this.claudeProcess.on('exit', (code) => {
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
        this.claudeProcess.kill('SIGTERM');
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
if (import.meta.url === `file://${process.argv[1]}`) {
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
      const grepFlag = watchArgs.find(arg => arg.startsWith('--grep='));
      const grepPatterns = grepFlag ? grepFlag.split('=')[1]?.split(',') || [] : [];
      const directories = watchArgs.filter(arg => !arg.startsWith('--'));
      
      if (directories.length === 0) {
        console.error('Usage: llm-whip watch [directories...] [--config=path] [--grep=pattern1,pattern2]');
        console.error('Example: llm-whip watch ./src ./lib --config=config.ts --grep="TODO,FIXME"');
        process.exit(1);
      }
      
      let config: Config = rootConfig;
      
      if (configPath) {
        try {
          // Try TypeScript config first
          const tsConfig = await loadTypescriptConfig(configPath);
          if (tsConfig) {
            config = { ...config, ...tsConfig };
          } else {
            console.error('Config file must be a TypeScript (.ts) or JavaScript (.js) file');
            process.exit(1);
          }
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          console.error('Failed to load config:', errorMessage);
          process.exit(1);
        }
      }
      
      const watcher = new FileWatcher({ config, directories, grepPatterns });
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
        showHelp();
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