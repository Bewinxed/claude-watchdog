// Using Bun.watch instead of fs.watch
import { readFile } from "fs/promises";
import { EventEmitter } from "events";
import type { Config, MatchInfo } from "./types";

export class StdoutMonitor extends EventEmitter {
  private config: Config;
  private logFilePath: string;
  private lastPosition = 0;
  private watcher: (() => void) | null = null;

  constructor(config: Config, logFilePath: string) {
    super();
    this.config = config;
    this.logFilePath = logFilePath;
  }

  async start() {
    console.log(`📜 Monitoring stdout log: ${this.logFilePath}`);
    
    // Use Bun's native file watcher
    const watcher = Bun.watch(this.logFilePath, {
      onError: (error) => {
        console.error(`Log watcher error:`, error);
      }
    });

    this.watcher = () => watcher.close();

    // Handle file changes
    (async () => {
      for await (const event of watcher) {
        if (event.kind === 'change') {
          await this.processNewContent();
        }
      }
    })();

    // Process existing content
    await this.processNewContent();
  }

  private async processNewContent() {
    try {
      const content = await readFile(this.logFilePath, 'utf-8');
      const newContent = content.slice(this.lastPosition);
      
      if (newContent.length > 0) {
        this.lastPosition = content.length;
        this.checkPatterns(newContent);
      }
    } catch (error) {
      // File might not exist yet or be temporarily unavailable
      console.warn('Could not read log file:', error);
    }
  }

  private checkPatterns(content: string) {
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;

      for (const patternConfig of this.config.patterns) {
        const regex = new RegExp(patternConfig.pattern, 'gmi');
        const matches = line.match(regex);
        
        if (matches) {
          const matchInfo: MatchInfo = {
            pattern: patternConfig.name,
            severity: patternConfig.severity,
            match: matches[0],
            index: line.indexOf(matches[0]),
            reactions: patternConfig.reactions,
            message: patternConfig.message,
            file: 'claude-output.log',
            line: (this.lastPosition + i + 1).toString(),
            context: line.trim(),
            timestamp: Date.now(),
            fullLine: line
          };

          this.emit('match', matchInfo);
        }
      }
    }
  }

  stop() {
    if (this.watcher) {
      this.watcher();
      this.watcher = null;
    }
    this.removeAllListeners();
  }
}