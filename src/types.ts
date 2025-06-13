export interface Pattern {
  name: string;
  pattern: string;
  severity?: 'high' | 'medium' | 'low'; // Default: 'medium'
  reactions?: ReactionType[]; // Default: ['alert']
  message?: string; // Default: Generated from name
  interruptMessage?: string; // Custom message for keyboard interrupts
}

export interface FileTrackingPatterns {
  filePath?: string; // Default: common file extensions pattern
  editingFile?: string; // Default: editing/modifying pattern
  lineNumber?: string; // Default: line number pattern
}

export interface ReactionConfig {
  sound?: boolean | { command?: string }; // Default: true
  interrupt?: boolean | { delay?: number }; // Default: false
  alert?: boolean | { format?: 'color' | 'plain' }; // Default: true
  webhook?: string | { url: string; headers?: Record<string, string> };
}

export interface Config {
  patterns: Pattern[];
  reactions?: ReactionConfig; // Default: { sound: true, alert: true, interrupt: false }
  debounce?: number | false; // Debounce window in ms, or false to disable. Default: 2000
  fileTracking?: boolean | FileTrackingPatterns; // Default: true (uses default patterns)
  logging?: string | { file: string; level?: 'debug' | 'info' | 'warn' | 'error' }; // Path or config
}

export interface FileContext {
  currentFile: string | null;
  currentLine: string | null;
  history?: Array<{
    file: string;
    line: string;
    timestamp: number;
  }>;
}

export interface MatchInfo {
  pattern: string;
  severity: string;
  match: string;
  index: number;
  reactions: ReactionType[];
  message: string;
  file: string | null;
  line: string | null;
  context: string;
  timestamp?: number;
  fullLine?: string;
}

export type ReactionType = 'sound' | 'interrupt' | 'alert' | 'webhook';

export interface WatchdogEvent {
  type: 'match' | 'start' | 'stop' | 'error';
  data: unknown;
  timestamp: number;
}