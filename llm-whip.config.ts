import type { Config } from './src/types';

export const config: Config = {
  patterns: [
    { 
      name: "todo", 
      pattern: "TODO",
      message: "TODO comment detected",
      interruptMessage: "TODO comments should be completed before submitting code. Please implement the actual functionality instead of leaving placeholder comments."
    },
    { 
      name: "placeholder", 
      pattern: "placeholder|stub",
      message: "Placeholder implementation detected",
      interruptMessage: "Placeholder or stub implementations should be replaced with actual working code. Please complete the implementation."
    },
    { 
      name: "not-implemented", 
      pattern: "not implemented|NotImplementedError",
      message: "Not implemented error detected",
      interruptMessage: "Found 'not implemented' error. Please provide a proper implementation instead of throwing placeholder errors."
    },
    { 
      name: "important-thing", 
      pattern: "The important thing is",
      message: "Lazy explanation detected",
      interruptMessage: "Detected 'The important thing is...' - this often indicates avoiding detailed implementation. Please provide specific, actionable details."
    }
  ],
};