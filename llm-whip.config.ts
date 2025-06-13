import type { Config } from './src/types';

export const config: Config = {
  patterns: [
    { name: "todo", pattern: "TODO" },
    { name: "placeholder", pattern: "placeholder|stub" },
    { name: "not-implemented", pattern: "not implemented|NotImplementedError" }
  ],
};