# LLM Whip

[![npm version](https://badge.fury.io/js/llm-whip.svg)](https://www.npmjs.com/package/llm-whip)
[![npm downloads](https://img.shields.io/npm/dm/llm-whip.svg)](https://www.npmjs.com/package/llm-whip)
[![CI](https://github.com/bewinxed/llm-whip/workflows/CI/badge.svg)](https://github.com/bewinxed/llm-whip/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

![banner](assets/banner.png)

A TypeScript CLI tool that monitors code for lazy patterns and anti-cheat detection when working with LLMs.

## Overview

LLM Whip detects common shortcuts and anti-patterns in code:

-   TODO comments and placeholders
-   Stub implementations
-   "The important thing is..." statements
-   Not implemented errors
-   Other lazy coding patterns

## Features

-   **Directory Auditing**: Scan codebases for existing patterns
-   **Real-time Monitoring**: Watch files as they change
-   **TypeScript Configuration**: Type-safe configuration files
-   **Multiple Output Formats**: Table, JSON, CSV export
-   **Baseline Tracking**: Alert only on new patterns
-   **Configurable Patterns**: Define custom detection rules

## Installation

```bash
bun add -g llm-whip
# or
npm install -g llm-whip
```

## Usage

```bash
# Show help
llm-whip --help

# Monitor current directory
llm-whip

# Monitor specific directories
llm-whip ./src ./lib

# Monitor with keyboard interrupts (sends text to active window)
llm-whip ./src --interrupt

# Monitor with sound alerts
llm-whip ./src --sound

# Create configuration file
llm-whip init

# Audit current directory
llm-whip audit
```

## Commands

| Command                    | Description                              |
| -------------------------- | ---------------------------------------- |
| `llm-whip`                 | Monitor current directory                |
| `llm-whip init [dir]`      | Create configuration file                |
| `llm-whip audit [dirs...]` | Scan directories for patterns            |
| `llm-whip watch <dirs...>` | Monitor directories in real-time         |

## Options

| Option              | Description                                              |
| ------------------- | -------------------------------------------------------- |
| `--config=<path>`   | Custom configuration file                                |
| `--format=<type>`   | Audit output format (table/json/csv)                     |
| `--grep=<patterns>` | Filter files by content patterns                         |
| `--interrupt`       | Enable keyboard interrupts (sends text to active window) |
| `--sound`           | Enable sound alerts                                       |

## Configuration

Create `llm-whip.config.ts`:

```typescript
import type { Config } from 'llm-whip/types';

export const config: Config = {
	patterns: [
		{
			name: 'todo',
			pattern: 'TODO',
			severity: 'high',
			reactions: ['sound', 'alert', 'interrupt'],
			message: 'TODO comment detected',
			messageText:
				'TODO comments should be completed before submitting code. Please implement the actual functionality instead of leaving placeholder comments.',
		},
		{
			name: 'important-thing',
			pattern: 'The important thing is',
			severity: 'medium',
			reactions: ['alert'],
			messageText:
				"Detected 'The important thing is...' - this often indicates avoiding detailed implementation. Please provide specific, actionable details.",
		},
	],
	reactions: {
		sound: { command: 'afplay /System/Library/Sounds/Glass.aiff' },
		interrupt: { delay: 500 },
		alert: { format: 'color' },
	},
	debounce: 2000,
	fileTracking: true,
};
```

## Default Patterns

Patterns use **JavaScript regex syntax** and are case-insensitive by default:

| Pattern           | Regex                                  | Example Match                        |
| ----------------- | -------------------------------------- | ------------------------------------ |
| `todo`            | `TODO`                                 | `// TODO: implement this`            |
| `placeholder`     | `placeholder\|stub`                    | `// placeholder implementation`      |
| `not-implemented` | `not implemented\|NotImplementedError` | `throw new Error("not implemented")` |
| `important-thing` | `The important thing is`               | `The important thing is to...`       |

**Custom Pattern Examples:**

```typescript
{
  name: "fixme",
  pattern: "FIXME\|BUG\|HACK",  // Matches FIXME, BUG, or HACK
  severity: "high"
},
{
  name: "console-log",
  pattern: "console\\.(log\|debug)",  // Matches console.log or console.debug
  severity: "low"
}
```

## Keyboard Interrupts

The `--interrupt` flag enables keyboard interrupts that send detailed warnings to the active window when patterns are detected:

```bash
# Enable keyboard interrupts
llm-whip ./src --interrupt
```

When a pattern is detected, LLM Whip will:

1. Type a warning message to the active window
2. Press Enter to send the message
3. The message includes:
    - Pattern type and custom message
    - File path and line number
    - Timestamp

Each pattern can have a custom `messageText` that gets sent:

```typescript
{
  name: "todo",
  pattern: "TODO",
  reactions: ["interrupt"],
  messageText: "TODO comments should be completed before submitting code. Please implement the actual functionality instead of leaving placeholder comments."
}
```

## Sound Alerts

The `--sound` flag enables cross-platform sound alerts:

```bash
# Enable sound alerts
llm-whip ./src --sound
```

Default sounds by platform:
- **macOS**: Glass.aiff (fallback: Ping.aiff)
- **Windows**: Windows Critical Stop.wav (fallback: console beep)
- **Linux**: alarm-clock-elapsed.oga (fallback: bell.oga)

## Monitoring LLM Conversations

LLM Whip can monitor LLM conversation outputs by watching log files. This helps detect anti-cheat patterns in both your code and the LLM's responses.

### Method 1: Using `tee` to clone output

When using Claude Code CLI or other LLM tools, pipe the output to a file that LLM Whip monitors:

```bash
# Terminal 1: Start LLM Whip monitoring
llm-whip ./project ./logs

# Terminal 2: Run Claude Code with output logging
claude-code ./project 2>&1 | tee logs/claude-session.log
```

### Method 2: Direct file monitoring

Create a log file and have your LLM tool write to it:

```bash
# Start monitoring the logs directory
llm-whip ./src ./logs

# Your LLM tool outputs to logs/conversation.txt
# LLM Whip will detect patterns in real-time
```

### Method 3: Script wrapper

Create a wrapper script that automatically logs and monitors:

```bash
#!/bin/bash
# llm-monitor.sh

# Create logs directory
mkdir -p ./logs

# Start LLM Whip in background
llm-whip ./src ./logs &
WHIP_PID=$!

# Run your LLM tool with logging
claude-code "$@" 2>&1 | tee logs/session-$(date +%Y%m%d-%H%M%S).log

# Clean up
kill $WHIP_PID 2>/dev/null
```

Then use it like: `./llm-monitor.sh ./my-project`

## Advanced Usage

### Baseline Tracking

Only alert on new patterns:

```bash
llm-whip audit ./src > /dev/null
llm-whip watch ./src
```

### Export Formats

```bash
# JSON export
llm-whip audit ./src --format=json > issues.json

# CSV export
llm-whip audit ./src --format=csv > issues.csv
```

### Configuration Priority

1. Local `llm-whip.config.ts` (current directory)
2. Custom path via `--config=path`
3. Built-in defaults

## Development

```bash
bun install
bun test
bun run build
```

## License

MIT
