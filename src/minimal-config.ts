import type { Config } from './types';

/**
 * Minimal LLM Whip Configuration Template
 * 
 * This configuration uses the simplified interface with sensible defaults.
 * Most options are optional and will use built-in defaults.
 */
export const minimalConfigTemplate = `import type { Config } from './types';

/**
 * Minimal LLM Whip Configuration 
 */
export const config: Config = {
  // Core patterns - only the most important ones
  patterns: [
    {
      name: "todo-comments",
      pattern: "//\\\\s*TODO(?!.*test|.*spec)"
      // Uses defaults: severity: 'medium', reactions: ['alert'], message: auto-generated
    },
    {
      name: "not-implemented", 
      pattern: "not\\\\s+implemented|NotImplementedError",
      severity: "high"
      // Uses defaults: reactions: ['alert'], message: auto-generated
    },
    {
      name: "placeholder-implementation",
      pattern: "placeholder|this\\\\s+is\\\\s+a\\\\s+placeholder",
      severity: "high"
    },
    {
      name: "rest-of-implementation",
      pattern: "\\\\.{3,}\\\\s*(rest|more)\\\\s+(code|implementation)",
      severity: "high"
    }
  ]
  
  // All other options use sensible defaults:
  // - reactions: { sound: true, alert: true, interrupt: false }
  // - debounce: 2000 (2 second window)
  // - fileTracking: true (default patterns)
  // - logging: disabled
};

export default config;
`;

export function generateMinimalConfigFile(): string {
  return minimalConfigTemplate;
}

// Default configuration with sensible defaults applied
export const defaultMinimalConfig: Config = {
  patterns: [
    {
      name: "todo-comments",
      pattern: "//\\s*TODO(?!.*test|.*spec)",
      severity: "medium",
      reactions: ["alert"],
      message: "TODO comment detected"
    },
    {
      name: "not-implemented", 
      pattern: "not\\s+implemented|NotImplementedError",
      severity: "high",
      reactions: ["sound", "alert"],
      message: "Not implemented pattern detected"
    },
    {
      name: "placeholder-implementation",
      pattern: "placeholder|this\\s+is\\s+a\\s+placeholder",
      severity: "high",
      reactions: ["sound", "alert"],
      message: "Placeholder implementation detected"
    },
    {
      name: "rest-of-implementation",
      pattern: "\\.{3,}\\s*(rest|more)\\s+(code|implementation)",
      severity: "high", 
      reactions: ["sound", "alert"],
      message: "Incomplete implementation detected"
    }
  ],
  reactions: {
    sound: true,
    alert: true,
    interrupt: false
  },
  debounce: 2000,
  fileTracking: true
};