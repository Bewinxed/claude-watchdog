export interface Pattern {
  name: string;
  pattern: string;
  severity: 'high' | 'medium' | 'low';
  reactions: ReactionType[];
  message: string;
}

export interface FileTrackingPatterns {
  filePath: string;
  editingFile: string;
  lineNumber: string;
}

export interface ReactionConfig {
  sound: {
    enabled: boolean;
    command: string;
    customCommands?: {
      darwin?: string;
      win32?: string;
      linux?: string;
    };
  };
  interrupt: {
    enabled: boolean;
    delay: number;
    prefix?: string;
    suffix?: string;
  };
  alert: {
    enabled: boolean;
    format: 'color' | 'plain';
    logFile?: string;
  };
  webhook?: {
    enabled: boolean;
    url: string;
    headers?: Record<string, string>;
  };
}

export interface Config {
  patterns: Pattern[];
  reactions: ReactionConfig;
  debounce: {
    enabled: boolean;
    window: number;
  };
  fileTracking: {
    enabled: boolean;
    patterns: FileTrackingPatterns;
  };
  logging?: {
    enabled: boolean;
    file: string;
    level: 'debug' | 'info' | 'warn' | 'error';
  };
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
  data: any;
  timestamp: number;
}