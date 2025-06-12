import { Pattern } from './types';

export const defaultPatterns: Pattern[] = [
  {
    name: "placeholder-comment",
    pattern: "//\\s*(placeholder|todo|fixme|hack|temporary|for now|in a real implementation|this is just|quick and dirty)",
    severity: "high",
    reactions: ["sound", "interrupt"],
    message: "DO NOT CHEAT - Write production-ready code!"
  },
  {
    name: "fake-implementation",
    pattern: "\\b(mock|stub|fake|dummy|placeholder)\\s*(implementation|function|method|data)",
    severity: "high",
    reactions: ["sound", "interrupt"],
    message: "DO NOT CHEAT - Implement real functionality!"
  },
  {
    name: "ellipsis-skip",
    pattern: "\\.\\.\\.\\s*(rest of|more|additional|other|remaining)\\s*(code|implementation|logic)",
    severity: "high",
    reactions: ["sound", "interrupt"],
    message: "DO NOT CHEAT - Write complete implementations!"
  },
  {
    name: "hypothetical-code",
    pattern: "\\b(would|could|should|might)\\s+(implement|add|create|write)",
    severity: "medium",
    reactions: ["alert"],
    message: "Write actual code, not hypotheticals!"
  },
  {
    name: "hand-wavy-comment",
    pattern: "(simply|just|basically)\\s+(add|implement|create)",
    severity: "medium",
    reactions: ["alert"],
    message: "Be specific - no hand-waving!"
  },
  {
    name: "assume-exists",
    pattern: "(assume|assuming)\\s+(you have|there is|exists)",
    severity: "high",
    reactions: ["sound", "interrupt"],
    message: "DO NOT ASSUME - Check or implement what's needed!"
  },
  {
    name: "example-only",
    pattern: "\\b(example|sample|demo)\\s*(code|implementation|only)",
    severity: "high",
    reactions: ["sound", "interrupt"],
    message: "Write real code, not examples!"
  },
  {
    name: "not-implemented",
    pattern: "(not implemented|unimplemented|NotImplemented)",
    severity: "high",
    reactions: ["sound", "interrupt"],
    message: "IMPLEMENT IT NOW!"
  },
  {
    name: "coming-soon",
    pattern: "(coming soon|will be implemented|to be implemented|future work)",
    severity: "high",
    reactions: ["sound", "interrupt"],
    message: "Implement it now, not later!"
  },
  {
    name: "pass-keyword",
    pattern: "^\\s*pass\\s*$",
    severity: "high",
    reactions: ["sound", "interrupt"],
    message: "NO EMPTY IMPLEMENTATIONS!"
  },
  {
    name: "error-suppression",
    pattern: "(# type: ignore|# noqa|# pylint: disable|@ts-ignore|eslint-disable)",
    severity: "medium",
    reactions: ["alert"],
    message: "Fix the issue, don't suppress it!"
  },
  {
    name: "console-log-todo",
    pattern: "console\\.(log|warn|error)\\s*\\(\\s*['\"]?(TODO|FIXME|XXX)",
    severity: "high",
    reactions: ["sound", "interrupt"],
    message: "Remove debug logs and implement properly!"
  }
];