/**
 * Pattern configuration for detecting specific text in code files
 */
export interface Pattern {
  /** Unique identifier for this pattern */
  name: string;
  /** JavaScript regular expression to match against file content */
  pattern: string;
  /** Severity level affecting alert display and priority */
  severity?: 'high' | 'medium' | 'low'; // Default: 'medium'
  /** Actions to trigger when pattern is detected */
  reactions?: ReactionType[]; // Default: ['alert']
  /** Custom message displayed when pattern is found */
  message?: string; // Default: Generated from name
  /** Message sent to active window during keyboard interrupt */
  interruptMessage?: string; // Custom message for keyboard interrupts
}

/**
 * Custom patterns for file tracking and context detection
 */
export interface FileTrackingPatterns {
  /** Regex pattern to extract file paths from content */
  filePath?: string; // Default: common file extensions pattern
  /** Regex pattern to detect file editing indicators */
  editingFile?: string; // Default: editing/modifying pattern
  /** Regex pattern to extract line numbers from content */
  lineNumber?: string; // Default: line number pattern
}

/**
 * Global reaction configuration for all patterns
 */
export interface ReactionConfig {
  /** Enable sound alerts or provide custom sound command */
  sound?: boolean | { command?: string }; // Default: true
  /** Enable keyboard interrupts with optional delay */
  interrupt?: boolean | { delay?: number }; // Default: false
  /** Enable console alerts with formatting options */
  alert?: boolean | { format?: 'color' | 'plain' }; // Default: true
  /** Webhook URL for external notifications */
  webhook?: string | { url: string; headers?: Record<string, string> };
}

/**
 * Main configuration for LLM Whip
 */
export interface Config {
  /** Array of patterns to detect in code files */
  patterns: Pattern[];
  /** Global reaction settings that apply to all patterns */
  reactions?: ReactionConfig; // Default: { sound: true, alert: true, interrupt: false }
  /** Debounce window in milliseconds to prevent spam, or false to disable */
  debounce?: number | false; // Default: 2000
  /** File tracking configuration for context detection */
  fileTracking?: boolean | FileTrackingPatterns; // Default: true (uses default patterns)
  /** Logging configuration for debugging and monitoring */
  logging?: string | { file: string; level?: 'debug' | 'info' | 'warn' | 'error' }; // Path or config
}

/**
 * Context information about currently tracked files
 */
export interface FileContext {
  /** Path of the currently active file being edited */
  currentFile: string | null;
  /** Current line number being edited */
  currentLine: string | null;
  /** History of recent file/line changes */
  history?: Array<{
    file: string;
    line: string;
    timestamp: number;
  }>;
}

/**
 * Information about a detected pattern match
 */
export interface MatchInfo {
  /** Name of the pattern that was matched */
  pattern: string;
  /** Severity level of the match */
  severity: string;
  /** The actual text that was matched */
  match: string;
  /** Position where the match was found */
  index: number;
  /** Reactions that should be triggered for this match */
  reactions: ReactionType[];
  /** Display message for this match */
  message: string;
  /** File where the match was found */
  file: string | null;
  /** Line number where the match was found */
  line: string | null;
  /** Surrounding context of the match */
  context: string;
  /** When the match was detected */
  timestamp?: number;
  /** Complete line containing the match */
  fullLine?: string;
}

/** Available reaction types that can be triggered when patterns are detected */
export type ReactionType = 'sound' | 'interrupt' | 'alert' | 'webhook';

/**
 * Event emitted by the file watcher system
 */
export interface WatchdogEvent {
  /** Type of event that occurred */
  type: 'match' | 'start' | 'stop' | 'error';
  /** Event-specific data payload */
  data: unknown;
  /** When the event occurred */
  timestamp: number;
}