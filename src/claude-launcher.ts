#!/usr/bin/env node

import { spawn } from 'child_process';
import { FileWatcher } from './file-watcher';
import { StdoutMonitor } from './stdout-monitor';
import { defaultPatterns } from './default-patterns';
import type { Config } from './types';
import * as fs from 'fs';
import { join } from 'path';

export class ClaudeLauncher {
  static async startWithWatchdog(configPath?: string, keyboardEnabled?: boolean) {
    console.log('🔥 LLM Whip - Background Monitor Mode');
    console.log('====================================\n');

    // Load config
    let config: Config = {
      patterns: defaultPatterns,
      reactions: {
        sound: {
          enabled: true,
          command: process.platform === 'darwin' ? 'afplay /System/Library/Sounds/Basso.aiff' :
                   process.platform === 'win32' ? 'powershell -c (New-Object Media.SoundPlayer "C:\\\\Windows\\\\Media\\\\chord.wav").PlaySync()' :
                   'paplay /usr/share/sounds/freedesktop/stereo/bell.oga'
        },
        interrupt: { enabled: keyboardEnabled ?? true, delay: 500 }, // Longer delay for keyboard interrupts
        alert: { enabled: true, format: "color" }
      },
      debounce: { enabled: true, window: 3000 }, // Shorter debounce for faster response
      fileTracking: {
        enabled: true,
        patterns: {
          filePath: "(?:^|\\\\s)([\\\\/\\\\w\\\\-\\\\.]+\\\\.(js|ts|py|java|cpp|c|go|rs|rb|php|jsx|tsx|vue|svelte))",
          editingFile: "(?:editing|modifying|updating|writing to|creating)\\\\s+([\\\\/\\\\w\\\\-\\\\.]+\\\\.\\\\w+)",
          lineNumber: "line\\\\s+(\\\\d+)|:(\\\\d+):|at\\\\s+(\\\\d+)"
        }
      }
    };

    if (configPath) {
      try {
        // Try TypeScript config first  
        if (configPath.endsWith('.ts')) {
          // For TypeScript files, read and eval (since dynamic import may not work)
          const configContent = fs.readFileSync(configPath, 'utf8');
          const configCode = configContent
            .replace(/import.*from.*['"'];?\n?/g, '') // Remove imports
            .replace(/export\s+(const\s+)?config/, 'const config') // Remove export
            .replace(/export\s+default\s+config/, '// export removed');
          
          // Create a minimal eval context
          const tempFunc = new Function(`
            const process = { platform: "${process.platform}" };
            ${configCode}
            return config;
          `);
          const customConfig = tempFunc();
          config = { ...config, ...customConfig };
        } else if (configPath.endsWith('.js')) {
          const configModule = await import(join(process.cwd(), configPath));
          const customConfig = configModule.config || configModule.default;
          config = { ...config, ...customConfig };
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

    // Start file watcher in background
    const watcher = new FileWatcher({ 
      config, 
      directories: [process.cwd()],
      fileExtensions: ['.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.cpp', '.c', '.go', '.rs', '.rb', '.php', '.vue', '.svelte'],
      ignorePatterns: ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.nyc_output']
    });

    // Set up stdout monitoring if log file exists or will be created
    const stdoutLogPath = join(process.cwd(), 'claude-output.log');
    let stdoutMonitor: StdoutMonitor | null = null;
    
    try {
      // Check if log file exists or create it
      await fs.promises.access(stdoutLogPath);
      stdoutMonitor = new StdoutMonitor(config, stdoutLogPath);
      console.log('📜 Found claude-output.log - will monitor Claude\'s output too!');
    } catch {
      // Log file doesn't exist, we'll just monitor files
      console.log('💡 Tip: Create claude-output.log to also monitor Claude\'s stdout');
    }

    // Start watchers
    await watcher.start();
    if (stdoutMonitor) {
      await stdoutMonitor.start();
      
      // Forward stdout monitor events to file watcher for unified handling
      stdoutMonitor.on('match', (match) => {
        watcher.emit('match', match);
      });
    }

    console.log('🚀 Now starting Claude...');
    console.log('💡 The watchdog will monitor your files and interrupt Claude if anti-patterns are detected.');
    console.log('📝 Make sure this terminal stays open for monitoring to work.');
    console.log('\\n' + '='.repeat(50) + '\\n');

    // Launch Claude in foreground with optional output logging
    const claudePath = process.env.CLAUDE_PATH || 'claude';
    const shouldLogOutput = process.env.WATCHDOG_LOG_OUTPUT === 'true';
    
    let claudeProcess;
    let logStream: fs.WriteStream | null = null;
    
    if (shouldLogOutput) {
      // Create log file and pipe output
      logStream = fs.createWriteStream(stdoutLogPath, { flags: 'a' });
      
      claudeProcess = spawn(claudePath, [], {
        stdio: ['inherit', 'pipe', 'inherit'],
        env: { ...process.env }
      });
      
      // Pipe stdout to both console and log file
      claudeProcess.stdout?.on('data', (data) => {
        process.stdout.write(data);
        logStream?.write(data);
      });
      
      console.log('📝 Logging Claude output to claude-output.log');
    } else {
      claudeProcess = spawn(claudePath, [], {
        stdio: 'inherit',
        env: { ...process.env }
      });
    }

    // Handle Claude exit
    claudeProcess.on('exit', (code) => {
      console.log('\\n' + '='.repeat(50));
      console.log('🏁 Claude session ended');
      
      // Clean up
      watcher.stop();
      if (stdoutMonitor) {
        stdoutMonitor.stop();
      }
      if (logStream) {
        logStream.end();
      }
      
      process.exit(code || 0);
    });

    claudeProcess.on('error', (err) => {
      console.error('❌ Failed to start Claude:', err.message);
      console.error('💡 Make sure Claude CLI is installed and in your PATH');
      
      // Clean up
      watcher.stop();
      if (stdoutMonitor) {
        stdoutMonitor.stop();
      }
      if (logStream) {
        logStream.end();
      }
      
      process.exit(1);
    });

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      console.log('\\n\\n🛑 Received interrupt signal');
      console.log('📊 Stopping watchdog and Claude...');
      claudeProcess.kill('SIGTERM');
      
      // Clean up
      watcher.stop();
      if (stdoutMonitor) {
        stdoutMonitor.stop();
      }
      if (logStream) {
        logStream.end();
      }
      
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      claudeProcess.kill('SIGTERM');
      
      // Clean up
      watcher.stop();
      if (stdoutMonitor) {
        stdoutMonitor.stop();
      }
      if (logStream) {
        logStream.end();
      }
      
      process.exit(0);
    });
  }
}