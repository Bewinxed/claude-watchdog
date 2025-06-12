import type { Config } from './types';

/**
 * LLM Whip Configuration
 * 
 * This file configures the anti-cheat patterns and reactions for monitoring
 * LLM code generation. The whip will detect lazy coding patterns and alert 
 * you when they're found.
 */
export const config: Config = {
  /**
   * Anti-cheat patterns to detect in code
   * Each pattern defines what to look for and how to react
   */
  patterns: [
    {
      name: "todo-comments",
      pattern: "//\\s*TODO(?!.*test|.*spec)",
      severity: "high",
      reactions: ["sound", "alert", "interrupt"],
      message: "🚨 TODO comment detected - implement the code properly!"
    },
    {
      name: "fixme-comments", 
      pattern: "//\\s*FIXME|#\\s*FIXME",
      severity: "high",
      reactions: ["sound", "alert", "interrupt"],
      message: "🚨 FIXME comment detected - fix the issue, don't mark it!"
    },
    {
      name: "placeholder-implementation",
      pattern: "placeholder\\s+implementation|this\\s+is\\s+a\\s+placeholder",
      severity: "high",
      reactions: ["sound", "alert", "interrupt"],
      message: "🚨 Placeholder detected - write real implementation!"
    },
    {
      name: "mock-data",
      pattern: "mock[_\\s]data|fake[_\\s]data|dummy[_\\s]data",
      severity: "medium",
      reactions: ["alert", "interrupt"],
      message: "⚠️ Mock data detected - use real data structures!"
    },
    {
      name: "coming-soon",
      pattern: "coming\\s+soon|will\\s+implement\\s+later",
      severity: "medium", 
      reactions: ["alert"],
      message: "⚠️ 'Coming soon' detected - implement it now!"
    },
    {
      name: "not-implemented",
      pattern: "not\\s+implemented|notimplemented|raise\\s+NotImplementedError",
      severity: "high",
      reactions: ["sound", "alert", "interrupt"],
      message: "🚨 NotImplemented detected - write the actual code!"
    },
    {
      name: "stub-functions",
      pattern: "\\bstub[_\\s]|\\bmock[_\\s]function|def\\s+stub_",
      severity: "medium",
      reactions: ["alert", "interrupt"],
      message: "⚠️ Stub function detected - implement real functionality!"
    },
    {
      name: "rest-of-implementation",
      pattern: "\\.{3,}\\s*(rest|more)\\s+(of\\s+)?(the\\s+)?(code|implementation)",
      severity: "high",
      reactions: ["sound", "alert", "interrupt"],
      message: "🚨 '...rest of implementation' detected - show the full code!"
    },
    {
      name: "error-suppression",
      pattern: "//\\s*@ts-ignore|#\\s*pylint:\\s*disable|#\\s*type:\\s*ignore",
      severity: "medium",
      reactions: ["alert"],
      message: "⚠️ Error suppression detected - fix the issue, don't suppress it!"
    }
  ],

  /**
   * Reaction configuration - how the watchdog responds to detected patterns
   */
  reactions: {
    /**
     * Sound alerts - play notification sounds when patterns are detected
     */
    sound: {
      enabled: true,
      command: process.platform === 'darwin' 
        ? 'afplay /System/Library/Sounds/Basso.aiff'
        : process.platform === 'win32'
        ? 'powershell -c "(New-Object Media.SoundPlayer \"C:\\\\Windows\\\\Media\\\\chord.wav\").PlaySync()"'
        : 'paplay /usr/share/sounds/freedesktop/stereo/bell.oga'
    },

    /**
     * Keyboard interrupts - send messages directly to LLMs when patterns detected
     * Requires system permissions to send keystrokes to other applications
     */
    interrupt: {
      enabled: false, // Will be set to true after user consent
      delay: 1000 // Delay in milliseconds before sending interrupt
    },

    /**
     * Console alerts - show colored alerts in the terminal
     */
    alert: {
      enabled: true,
      format: "color" // "color" or "plain"
    }
  },

  /**
   * Debouncing - prevent spam when the same pattern is detected repeatedly
   */
  debounce: {
    enabled: true,
    window: 2000 // Time window in milliseconds
  },

  /**
   * File tracking - detect which file and line Claude is working on
   */
  fileTracking: {
    enabled: true,
    patterns: {
      filePath: "(?:^|\\\\s)([\\\\/\\\\w\\\\-\\\\.]+\\\\.(js|ts|py|java|cpp|c|go|rs|rb|php|jsx|tsx|vue|svelte))",
      editingFile: "(?:editing|modifying|updating|writing to|creating)\\\\s+([\\\\/\\\\w\\\\-\\\\.]+\\\\.\\\\w+)",
      lineNumber: "line\\\\s+(\\\\d+)|:(\\\\d+):|at\\\\s+(\\\\d+)"
    }
  }
};

export default config;
