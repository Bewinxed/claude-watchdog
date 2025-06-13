import { EventEmitter } from "node:events";
import { watch } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import * as p from "@clack/prompts";
import ignore from "ignore";
import color from "picocolors";
import { BaselineTracker } from "./baseline-tracker";
import { KeyboardController } from "./keyboard-controller";
import type { Config, FileContext, MatchInfo, Pattern } from "./types";

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
  private baseline: Awaited<ReturnType<typeof BaselineTracker.loadBaseline>> =
    null;
  private respectGitignore: boolean;

  constructor(options: WatcherOptions) {
    super();
    this.config = options.config;
    this.directories = options.directories.map((d) => resolve(d));
    this.respectGitignore = options.respectGitignore !== false; // Default to true

    // Default to common code file extensions
    this.fileExtensions = new Set(
      options.fileExtensions || [
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
      ],
    );

    // Default ignore patterns
    this.ignorePatterns = (
      options.ignorePatterns || [
        "node_modules",
        "dist",
        "build",
        ".git",
        "coverage",
        ".next",
        "llm-whip\\.config\\.(ts|js)",
      ]
    ).map((pattern) => new RegExp(pattern));

    // Grep patterns for filtering file content
    this.grepPatterns = (options.grepPatterns || []).map(
      (pattern) => new RegExp(pattern, "i"),
    );

    // Initialize gitignore if enabled
    if (this.respectGitignore) {
      this.gitignore = ignore();
      this.loadGitignorePatterns();
    }
  }

  async start() {
    console.log();
    p.intro(color.bgYellow(color.black(" LLM Whip Watch Mode ")));

    const info = [
      `Watching ${color.cyan(this.directories.length.toString())} directories`,
      `Monitoring ${color.cyan(this.config.patterns.length.toString())} patterns`,
      `Extensions: ${color.dim(Array.from(this.fileExtensions).join(", "))}`,
    ];

    if (this.respectGitignore) {
      info.push(`Respecting ${color.dim(".gitignore")} patterns`);
    }

    if (this.grepPatterns.length > 0) {
      info.push(
        `Grep filter: ${color.dim(this.grepPatterns.map((p) => p.source).join(", "))}`,
      );
    }

    p.note(info.join("\n"), "🔍 Configuration");

    // Load baseline for new vs existing pattern detection
    const spinner = p.spinner();
    spinner.start("Loading baseline");

    this.baseline = await BaselineTracker.loadBaseline();
    if (this.baseline) {
      spinner.stop(
        `Loaded baseline with ${color.yellow(this.baseline.entries.length.toString())} existing patterns`,
      );
      p.note("Will only alert on NEW patterns", "📸 Baseline Mode");
    } else {
      spinner.stop("No baseline found");
      p.note("Will alert on ALL patterns", "📸 No Baseline");
    }

    p.outro(color.dim("Watching for changes... Press Ctrl+C to stop"));

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
          if (nodeError.code !== "ENOENT") {
            console.error(`Error processing ${filePath}:`, err);
          }
        }
      }, 100); // 100ms delay to ensure file write is complete
    });

    watcher.on("error", (error) => {
      console.error(`Watcher error for ${dir}:`, error);
    });

    const stopWatching = () => {
      watcher.close();
    };

    this.emit("watching", dir);
    return stopWatching;
  }

  private shouldProcessFile(filePath: string): boolean {
    // Check if file has a valid extension
    const hasValidExtension = Array.from(this.fileExtensions).some((ext) =>
      filePath.endsWith(ext),
    );

    if (!hasValidExtension) return false;

    // Check custom ignore patterns
    const isIgnored = this.ignorePatterns.some((pattern) =>
      pattern.test(filePath),
    );

    if (isIgnored) return false;

    // Check gitignore patterns if enabled
    if (this.respectGitignore && this.gitignore) {
      // Find the relative path from the closest watched directory
      const watchedDir = this.directories.find((dir) =>
        filePath.startsWith(dir),
      );
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
    const content = await readFile(filePath, "utf-8");

    // If grep patterns are specified, only process files that match
    if (this.grepPatterns.length > 0) {
      const hasMatch = this.grepPatterns.some((pattern) =>
        pattern.test(content),
      );
      if (!hasMatch) {
        return; // Skip files that don't match grep patterns
      }
    }

    const lines = content.split("\n");

    // Update file context
    const fileContext: FileContext = {
      currentFile: filePath,
      currentLine: null,
      history: [],
    };

    this.fileContexts.set(filePath, fileContext);

    // Process each line
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      fileContext.currentLine = (lineNum + 1).toString();

      const matches = this.checkPatterns(line || "", filePath, lineNum + 1);

      if (matches.length > 0) {
        await this.executeReactions(matches);
      }
    }
  }

  private checkPatterns(
    line: string,
    filePath: string,
    lineNumber: number,
  ): MatchInfo[] {
    const matches: MatchInfo[] = [];

    for (const patternConfig of this.config.patterns) {
      const regex = new RegExp(patternConfig.pattern, "gmi");
      let match: RegExpExecArray | null;

      while ((match = regex.exec(line)) !== null) {
        const relativePath = relative(process.cwd(), filePath);
        const fullLineContent = line.trim();

        // Check if this is a new pattern (not in baseline)
        const isNew =
          !this.baseline ||
          BaselineTracker.isNewPattern(
            relativePath,
            lineNumber,
            patternConfig.name,
            fullLineContent,
            this.baseline,
          );

        // Only alert on new patterns if we have a baseline
        if (!isNew && this.baseline) {
          continue; // Skip existing patterns
        }

        const matchInfo: MatchInfo & { patternConfig?: typeof patternConfig } =
          {
            pattern: patternConfig.name,
            severity: patternConfig.severity || "medium",
            match: match[0],
            index: match.index,
            reactions: patternConfig.reactions || ["alert"],
            message: isNew
              ? `🆕 NEW ${patternConfig.message || `${patternConfig.name} detected`}`
              : patternConfig.message || `${patternConfig.name} detected`,
            file: relativePath,
            line: lineNumber.toString(),
            context: this.getContext(line, match.index),
            timestamp: Date.now(),
            fullLine: fullLineContent,
            patternConfig, // Store the full pattern config for interrupt messages
          };

        // Check debounce
        const matchKey = `${filePath}-${lineNumber}-${patternConfig.name}`;
        const lastMatch = this.recentMatches.get(matchKey);

        const debounceWindow =
          typeof this.config.debounce === "number"
            ? this.config.debounce
            : this.config.debounce === false
              ? 0
              : 2000;
        if (
          debounceWindow === 0 ||
          !lastMatch ||
          Date.now() - lastMatch > debounceWindow
        ) {
          matches.push(matchInfo);
          this.recentMatches.set(matchKey, Date.now());

          // Schedule baseline update (async, don't wait)
          if (isNew) {
            const baselineEntry = BaselineTracker.createBaselineEntry(
              relativePath,
              lineNumber,
              patternConfig.name,
              fullLineContent,
            );
            BaselineTracker.updateBaseline([baselineEntry]).catch(
              console.error,
            );
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
      this.emit("match", match);

      for (const reaction of match.reactions) {
        switch (reaction) {
          case "sound": {
            const soundEnabled = this.config.reactions?.sound !== false;
            if (soundEnabled) {
              this.playSound();
              // Also send system notification
              await KeyboardController.sendNotification(
                "LLM Whip",
                `Anti-cheat detected in ${match.file}:${match.line}`,
              );
            }
            break;
          }

          case "alert": {
            const alertEnabled = this.config.reactions?.alert !== false;
            if (alertEnabled) {
              this.showAlert(match);
            }
            break;
          }

          case "interrupt": {
            const interruptEnabled =
              this.config.reactions?.interrupt === true ||
              (typeof this.config.reactions?.interrupt === "object" &&
                this.config.reactions.interrupt !== null);
            if (interruptEnabled) {
              await this.sendKeyboardInterrupt(match);
            }
            break;
          }
        }
      }
    }
  }

  private playSound() {
    const { exec } = require("node:child_process");
    const soundConfig = this.config.reactions?.sound;
    const command =
      typeof soundConfig === "object" && soundConfig?.command
        ? soundConfig.command
        : process.platform === "darwin"
          ? "afplay /System/Library/Sounds/Basso.aiff"
          : process.platform === "win32"
            ? 'powershell -c (New-Object Media.SoundPlayer "C:\\Windows\\Media\\chord.wav").PlaySync()'
            : "paplay /usr/share/sounds/freedesktop/stereo/bell.oga";

    exec(command, (err: Error | null) => {
      if (err) console.error("Failed to play sound:", err.message);
    });
  }

  private showAlert(match: MatchInfo) {
    const timestamp = new Date().toLocaleTimeString();
    const alertConfig = this.config.reactions?.alert;
    const format =
      typeof alertConfig === "object" && alertConfig?.format
        ? alertConfig.format
        : "color";

    console.log(); // Add spacing

    if (format === "color") {
      const severityColor =
        match.severity === "high"
          ? color.red
          : match.severity === "medium"
            ? color.yellow
            : color.green;
      const emoji =
        match.severity === "high"
          ? "🔴"
          : match.severity === "medium"
            ? "🟡"
            : "🟢";

      p.log.warning(
        `${emoji} ${severityColor(match.pattern.toUpperCase())} detected at ${color.dim(timestamp)}\n` +
          `${color.cyan(match.file)}:${color.dim(match.line)}\n` +
          `${color.dim("Message:")} ${match.message}\n` +
          `${color.dim("Code:")} ${match.fullLine}\n` +
          `${color.dim("Match:")} ${severityColor(`"${match.match}"`)}`,
      );
    } else {
      // Plain format - output to stdout for test compatibility
      console.log(`\n[WATCHDOG ${timestamp}] ${match.pattern}`);
      console.log(`File: ${match.file}:${match.line}`);
      console.log(`Message: ${match.message}`);
      console.log(`Line: "${match.fullLine}"`);
      console.log(`Context: "${match.context}"`);
    }
  }

  private async sendKeyboardInterrupt(
    match: MatchInfo & { patternConfig?: Pattern },
  ) {
    const location = `${match.file}:${match.line}`;

    // Show local alert
    process.stderr.write(
      `\n\x1b[41m\x1b[97m${"🚨".repeat(10)} INTERRUPTING LLM ${"🚨".repeat(10)}\x1b[0m\n\x1b[91m\x1b[1m⚠️  ${match.message}\x1b[0m\n\x1b[93m📍 Location: ${location}\x1b[0m\n\x1b[90mSending keyboard interrupt to active window...\x1b[0m\n\x1b[41m\x1b[97m${"🚨".repeat(41)}\x1b[0m\n\n`,
    );

    // Use custom interrupt message if available, otherwise fall back to generic message
    const interruptMessage =
      match.patternConfig?.interruptMessage ||
      match.message ||
      `${match.pattern} detected - please review and fix`;

    // Send keyboard interrupt to LLM with detailed information
    const success = await KeyboardController.sendInterruptSequence(
      interruptMessage,
      location,
      match.pattern,
      match.fullLine,
    );

    if (!success) {
      process.stderr.write(
        "\x1b[93m⚠️  Could not send keyboard interrupt. Make sure LLM window is active.\x1b[0m\n\n",
      );

      // Fallback to system notification
      await KeyboardController.sendNotification(
        "LLM Whip - Anti-Cheat Detected",
        `${match.message} at ${location}`,
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
      while (currentDir !== "/" && currentDir !== "") {
        const gitignorePath = join(currentDir, ".gitignore");
        if (existsSync(gitignorePath)) {
          gitignorePaths.add(gitignorePath);
        }

        const parentDir = resolve(currentDir, "..");
        if (parentDir === currentDir) break; // Reached root
        currentDir = parentDir;
      }
    }

    // Load all found .gitignore files
    for (const gitignorePath of gitignorePaths) {
      try {
        const content = readFileSync(gitignorePath, "utf-8");
        this.gitignore.add(content);
      } catch (err) {
        console.warn(`Failed to load .gitignore from ${gitignorePath}:`, err);
      }
    }

    // Always ignore .git directory
    this.gitignore.add(".git");
  }

  stop() {
    console.log("\n🛑 Stopping file watcher...");
    // Close all watchers
    for (const watcher of this.watchers) {
      watcher();
    }
    this.watchers = [];
    this.removeAllListeners();
    this.recentMatches.clear();
    this.fileContexts.clear();
  }
}
