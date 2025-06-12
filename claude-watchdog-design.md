# Claude Watchdog - Design Document

## Overview

Claude Watchdog is a Node.js wrapper for the Claude CLI that monitors output in real-time and reacts to configurable patterns. It acts as a transparent proxy between the user and Claude CLI while providing additional monitoring and alerting capabilities.

## Architecture Overview

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│    User     │ <-> │  Claude Watchdog │ <-> │ Claude CLI  │
│  Terminal   │     │    (Node.js)     │     │   Process   │
└─────────────┘     └──────────────────┘     └─────────────┘
                            │
                    ┌───────┴────────┐
                    │ Pattern Matcher │
                    └───────┬────────┘
                            │
                    ┌───────┴────────┐
                    │ Reaction Engine │
                    │ • Audio Alerts  │
                    │ • CLI Interrupt  │
                    └────────────────┘
```

## Key Components

### 1. Process Manager
- Spawns and manages the Claude CLI child process
- Handles process lifecycle (start, stop, restart)
- Manages bidirectional I/O streams

### 2. Stream Monitor
- Captures stdout/stderr from Claude CLI
- Buffers output for pattern matching
- Maintains context for multi-line patterns

### 3. Pattern Matcher
- Configurable regex patterns
- Case sensitivity options
- Context-aware matching (e.g., only in code blocks)

### 4. Reaction Engine
- Audio player for alerts
- CLI input injection for interrupts
- Logging system for matches
- Webhook/notification support

### 5. Configuration Manager
- JSON/YAML configuration support
- Runtime configuration updates
- Default configurations

### 6. I/O Proxy
- Transparent pass-through of user input
- Output formatting preservation
- ANSI color code handling

## Core Implementation

### Main Wrapper (index.js)

```javascript
#!/usr/bin/env node

const { spawn } = require('child_process');
const readline = require('readline');
const { EventEmitter } = require('events');
const ConfigManager = require('./lib/config-manager');
const PatternMatcher = require('./lib/pattern-matcher');
const ReactionEngine = require('./lib/reaction-engine');
const StreamMonitor = require('./lib/stream-monitor');

class ClaudeWatchdog extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = new ConfigManager(options.configPath);
    this.matcher = new PatternMatcher(this.config.get('patterns'));
    this.reactions = new ReactionEngine(this.config.get('reactions'));
    this.monitor = new StreamMonitor();
    
    this.claudeProcess = null;
    this.isRunning = false;
  }

  async start(claudeArgs = []) {
    if (this.isRunning) {
      throw new Error('Claude Watchdog is already running');
    }

    // Spawn Claude CLI
    this.claudeProcess = spawn('claude', claudeArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    this.isRunning = true;

    // Set up stream monitoring
    this.monitor.attach(this.claudeProcess.stdout, 'stdout');
    this.monitor.attach(this.claudeProcess.stderr, 'stderr');

    // Set up pattern matching
    this.monitor.on('data', ({ stream, data, line }) => {
      const matches = this.matcher.check(line);
      
      if (matches.length > 0) {
        this.emit('pattern-match', { matches, line, stream });
        this.reactions.execute(matches, { line, stream });
      }
    });

    // Set up I/O proxy
    this.setupIOProxy();

    // Handle process exit
    this.claudeProcess.on('exit', (code) => {
      this.isRunning = false;
      this.emit('exit', code);
    });
  }

  setupIOProxy() {
    // Create readline interface for user input
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    });

    // Forward user input to Claude
    rl.on('line', (input) => {
      if (this.claudeProcess && !this.claudeProcess.killed) {
        this.claudeProcess.stdin.write(input + '\n');
      }
    });

    // Forward Claude output to user
    this.monitor.on('raw-data', ({ stream, data }) => {
      if (stream === 'stdout') {
        process.stdout.write(data);
      } else if (stream === 'stderr') {
        process.stderr.write(data);
      }
    });

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      this.stop();
      process.exit(0);
    });
  }

  async interrupt(message) {
    if (this.claudeProcess && !this.claudeProcess.killed) {
      // Send interrupt signal to Claude
      this.claudeProcess.kill('SIGINT');
      
      // Wait a moment then send the message
      setTimeout(() => {
        if (this.claudeProcess && !this.claudeProcess.killed) {
          this.claudeProcess.stdin.write(message + '\n');
        }
      }, 100);
    }
  }

  stop() {
    if (this.claudeProcess && !this.claudeProcess.killed) {
      this.claudeProcess.kill('SIGTERM');
      this.isRunning = false;
    }
  }
}

module.exports = ClaudeWatchdog;

// CLI entry point
if (require.main === module) {
  const watchdog = new ClaudeWatchdog();
  const args = process.argv.slice(2);
  
  watchdog.start(args).catch(err => {
    console.error('Failed to start Claude Watchdog:', err);
    process.exit(1);
  });
}
```

### Stream Monitor (lib/stream-monitor.js)

```javascript
const { EventEmitter } = require('events');
const { Transform } = require('stream');

class StreamMonitor extends EventEmitter {
  constructor() {
    super();
    this.buffers = new Map();
  }

  attach(stream, name) {
    const buffer = [];
    let incomplete = '';

    const monitor = new Transform({
      transform(chunk, encoding, callback) {
        const data = chunk.toString();
        
        // Emit raw data for pass-through
        this.emit('raw-data', { stream: name, data });

        // Process lines
        const lines = (incomplete + data).split('\n');
        incomplete = lines.pop() || '';

        for (const line of lines) {
          if (line) {
            this.emit('data', { stream: name, data, line });
          }
        }

        callback(null, chunk);
      }.bind(this)
    });

    stream.pipe(monitor);
    this.buffers.set(name, { buffer, monitor });
  }

  getContext(streamName, lineNumber, contextLines = 3) {
    const buffer = this.buffers.get(streamName)?.buffer || [];
    const start = Math.max(0, lineNumber - contextLines);
    const end = Math.min(buffer.length, lineNumber + contextLines + 1);
    return buffer.slice(start, end);
  }
}

module.exports = StreamMonitor;
```

### Pattern Matcher (lib/pattern-matcher.js)

```javascript
class PatternMatcher {
  constructor(patterns = []) {
    this.patterns = this.compilePatterns(patterns);
  }

  compilePatterns(patterns) {
    return patterns.map(pattern => ({
      ...pattern,
      regex: new RegExp(pattern.pattern, pattern.flags || 'gi'),
      id: pattern.id || pattern.pattern,
      severity: pattern.severity || 'info',
      reactions: pattern.reactions || ['log']
    }));
  }

  check(line) {
    const matches = [];

    for (const pattern of this.patterns) {
      const match = pattern.regex.exec(line);
      if (match) {
        matches.push({
          pattern: pattern.id,
          severity: pattern.severity,
          match: match[0],
          groups: match.groups || {},
          index: match.index,
          reactions: pattern.reactions,
          context: pattern
        });
      }
    }

    return matches;
  }

  addPattern(pattern) {
    const compiled = this.compilePatterns([pattern])[0];
    this.patterns.push(compiled);
  }

  removePattern(id) {
    this.patterns = this.patterns.filter(p => p.id !== id);
  }
}

module.exports = PatternMatcher;
```

### Reaction Engine (lib/reaction-engine.js)

```javascript
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs').promises;

class ReactionEngine {
  constructor(config = {}) {
    this.config = config;
    this.reactions = new Map();
    
    // Register built-in reactions
    this.register('log', this.logReaction.bind(this));
    this.register('alert', this.alertReaction.bind(this));
    this.register('interrupt', this.interruptReaction.bind(this));
    this.register('sound', this.soundReaction.bind(this));
  }

  register(name, handler) {
    this.reactions.set(name, handler);
  }

  async execute(matches, context) {
    for (const match of matches) {
      for (const reactionName of match.reactions) {
        const reaction = this.reactions.get(reactionName);
        if (reaction) {
          try {
            await reaction(match, context);
          } catch (error) {
            console.error(`Reaction '${reactionName}' failed:`, error);
          }
        }
      }
    }
  }

  async logReaction(match, context) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      pattern: match.pattern,
      severity: match.severity,
      line: context.line,
      stream: context.stream
    };
    
    console.error(`\n[WATCHDOG] ${match.severity.toUpperCase()}: ${match.pattern} detected`);
    
    // Also log to file if configured
    if (this.config.logFile) {
      await fs.appendFile(
        this.config.logFile,
        JSON.stringify(logEntry) + '\n'
      );
    }
  }

  async alertReaction(match, context) {
    // Visual alert in terminal
    console.error('\x1b[41m\x1b[37m' + // Red background, white text
      `\n${'='.repeat(50)}\n` +
      `ALERT: ${match.pattern} detected!\n` +
      `Line: ${context.line}\n` +
      `${'='.repeat(50)}\n` +
      '\x1b[0m' // Reset
    );
  }

  async soundReaction(match, context) {
    const soundFile = this.config.sounds?.[match.severity] || 
                     this.config.sounds?.default;
    
    if (!soundFile) return;

    // Platform-specific audio playback
    const platform = process.platform;
    let command;

    if (platform === 'darwin') {
      command = `afplay "${soundFile}"`;
    } else if (platform === 'linux') {
      command = `aplay "${soundFile}" 2>/dev/null || paplay "${soundFile}"`;
    } else if (platform === 'win32') {
      command = `powershell -c (New-Object Media.SoundPlayer "${soundFile}").PlaySync()`;
    }

    if (command) {
      exec(command, (error) => {
        if (error) {
          console.error('Failed to play sound:', error.message);
        }
      });
    }
  }

  async interruptReaction(match, context) {
    // This requires access to the watchdog instance
    // Typically injected via setWatchdog method
    if (this.watchdog) {
      const message = match.context.interruptMessage || 
        `WATCHDOG: Detected ${match.pattern}. Please review the above output.`;
      
      await this.watchdog.interrupt(message);
    }
  }

  setWatchdog(watchdog) {
    this.watchdog = watchdog;
  }
}

module.exports = ReactionEngine;
```

### Configuration Manager (lib/config-manager.js)

```javascript
const fs = require('fs').promises;
const path = require('path');
const { deepMerge } = require('./utils');

class ConfigManager {
  constructor(configPath) {
    this.configPath = configPath || this.getDefaultConfigPath();
    this.config = null;
    this.defaults = this.getDefaults();
  }

  getDefaultConfigPath() {
    // Check multiple locations in order
    const locations = [
      './.claude-watchdog.json',
      './.claude-watchdog.yaml',
      path.join(process.env.HOME || '', '.claude-watchdog.json'),
      path.join(process.env.HOME || '', '.config/claude-watchdog/config.json')
    ];

    // Return first existing config or default location
    for (const location of locations) {
      if (require('fs').existsSync(location)) {
        return location;
      }
    }

    return locations[0];
  }

  getDefaults() {
    return {
      patterns: [
        {
          id: 'todo',
          pattern: '\\b(TODO|FIXME)\\b',
          severity: 'warning',
          reactions: ['log', 'alert']
        },
        {
          id: 'error',
          pattern: '\\b(ERROR|CRITICAL|FATAL)\\b',
          severity: 'error',
          reactions: ['log', 'alert', 'sound']
        },
        {
          id: 'warning',
          pattern: '\\b(WARNING|WARN|CAUTION)\\b',
          severity: 'warning',
          reactions: ['log']
        }
      ],
      reactions: {
        logFile: './claude-watchdog.log',
        sounds: {
          error: '/System/Library/Sounds/Basso.aiff',
          warning: '/System/Library/Sounds/Pop.aiff',
          default: '/System/Library/Sounds/Tink.aiff'
        }
      }
    };
  }

  async load() {
    try {
      const content = await fs.readFile(this.configPath, 'utf8');
      const extension = path.extname(this.configPath);
      
      if (extension === '.json') {
        this.config = JSON.parse(content);
      } else if (extension === '.yaml' || extension === '.yml') {
        // Would need to add yaml parsing library
        const yaml = require('yaml');
        this.config = yaml.parse(content);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      // Use defaults if config doesn't exist
      this.config = {};
    }

    // Merge with defaults
    this.config = deepMerge(this.defaults, this.config);
    return this.config;
  }

  async save() {
    const dir = path.dirname(this.configPath);
    await fs.mkdir(dir, { recursive: true });
    
    const extension = path.extname(this.configPath);
    let content;
    
    if (extension === '.json') {
      content = JSON.stringify(this.config, null, 2);
    } else if (extension === '.yaml' || extension === '.yml') {
      const yaml = require('yaml');
      content = yaml.stringify(this.config);
    }
    
    await fs.writeFile(this.configPath, content, 'utf8');
  }

  get(key) {
    if (!this.config) {
      this.loadSync();
    }
    
    if (!key) return this.config;
    
    // Support dot notation
    return key.split('.').reduce((obj, k) => obj?.[k], this.config);
  }

  set(key, value) {
    if (!this.config) {
      this.loadSync();
    }
    
    const keys = key.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((obj, k) => {
      if (!obj[k]) obj[k] = {};
      return obj[k];
    }, this.config);
    
    target[lastKey] = value;
  }

  loadSync() {
    try {
      const content = require('fs').readFileSync(this.configPath, 'utf8');
      const extension = path.extname(this.configPath);
      
      if (extension === '.json') {
        this.config = JSON.parse(content);
      } else if (extension === '.yaml' || extension === '.yml') {
        const yaml = require('yaml');
        this.config = yaml.parse(content);
      }
    } catch (error) {
      this.config = {};
    }
    
    this.config = deepMerge(this.defaults, this.config);
  }
}

module.exports = ConfigManager;
```

### Utilities (lib/utils.js)

```javascript
function deepMerge(target, source) {
  const output = { ...target };
  
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  
  return output;
}

function isObject(item) {
  return item && typeof item === 'object' && !Array.isArray(item);
}

module.exports = {
  deepMerge,
  isObject
};
```

## Configuration System

### Configuration File Format (.claude-watchdog.json)

```json
{
  "patterns": [
    {
      "id": "todo",
      "pattern": "\\b(TODO|FIXME)\\b",
      "severity": "warning",
      "flags": "gi",
      "reactions": ["log", "alert", "sound"]
    },
    {
      "id": "security",
      "pattern": "\\b(password|secret|api[_-]?key)\\s*=\\s*[\"']\\w+[\"']",
      "severity": "error",
      "reactions": ["log", "alert", "interrupt"],
      "interruptMessage": "SECURITY WARNING: Possible hardcoded credential detected!"
    },
    {
      "id": "performance",
      "pattern": "O\\(n[²³]\\)|nested.*loop|performance.*issue",
      "severity": "warning",
      "reactions": ["log"]
    }
  ],
  "reactions": {
    "logFile": "./watchdog.log",
    "sounds": {
      "error": "/path/to/error-sound.wav",
      "warning": "/path/to/warning-sound.wav",
      "info": "/path/to/info-sound.wav"
    },
    "webhooks": {
      "error": "https://hooks.slack.com/services/..."
    }
  },
  "monitoring": {
    "bufferLines": 100,
    "contextLines": 3,
    "debounceMs": 500
  }
}
```

### YAML Configuration Example (.claude-watchdog.yaml)

```yaml
patterns:
  - id: todo
    pattern: '\b(TODO|FIXME)\b'
    severity: warning
    reactions:
      - log
      - alert

  - id: security
    pattern: '\b(password|secret|api[_-]?key)\s*=\s*["\'']\w+["\''']'
    severity: error
    reactions:
      - log
      - alert
      - interrupt
    interruptMessage: 'SECURITY WARNING: Possible hardcoded credential detected!'

reactions:
  logFile: ./watchdog.log
  sounds:
    error: /System/Library/Sounds/Basso.aiff
    warning: /System/Library/Sounds/Pop.aiff
```

## Usage Examples

### Basic Usage

```bash
# Run Claude with watchdog monitoring
claude-watchdog

# Pass arguments to Claude
claude-watchdog --model claude-3-opus --temperature 0.7

# Use custom config file
claude-watchdog --config ./my-patterns.json
```

### Programmatic Usage

```javascript
const ClaudeWatchdog = require('claude-watchdog');

const watchdog = new ClaudeWatchdog({
  configPath: './custom-config.json'
});

// Add custom pattern at runtime
watchdog.matcher.addPattern({
  id: 'custom',
  pattern: 'BREAKING CHANGE',
  severity: 'error',
  reactions: ['interrupt']
});

// Add custom reaction
watchdog.reactions.register('email', async (match, context) => {
  // Send email notification
  await sendEmail({
    subject: `Claude Watchdog: ${match.pattern}`,
    body: `Detected at: ${context.line}`
  });
});

// Start monitoring
watchdog.start(['--model', 'claude-3-opus']);

// Listen to events
watchdog.on('pattern-match', ({ matches, line }) => {
  console.log('Pattern matched:', matches);
});

watchdog.on('exit', (code) => {
  console.log('Claude exited with code:', code);
});
```

### Creating Custom Reactions

```javascript
// Custom reaction plugin
class DesktopNotificationReaction {
  constructor(options = {}) {
    this.options = options;
  }

  async execute(match, context) {
    const notifier = require('node-notifier');
    
    notifier.notify({
      title: `Claude Watchdog: ${match.severity.toUpperCase()}`,
      message: `${match.pattern} detected`,
      sound: true,
      wait: true
    });
  }
}

// Register the reaction
watchdog.reactions.register('desktop-notify', 
  new DesktopNotificationReaction().execute);
```

## Advanced Features

### Context-Aware Matching

```javascript
// Only match patterns within code blocks
class CodeBlockMatcher extends PatternMatcher {
  constructor(patterns) {
    super(patterns);
    this.inCodeBlock = false;
  }

  check(line) {
    // Detect code block boundaries
    if (line.match(/^```/)) {
      this.inCodeBlock = !this.inCodeBlock;
    }

    // Only match if we're in a code block
    if (this.inCodeBlock) {
      return super.check(line);
    }

    return [];
  }
}
```

### Multi-line Pattern Support

```javascript
// Match patterns across multiple lines
class MultiLineMatcher {
  constructor(patterns) {
    this.patterns = patterns;
    this.buffer = [];
    this.maxBufferSize = 10;
  }

  check(line) {
    this.buffer.push(line);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }

    const context = this.buffer.join('\n');
    const matches = [];

    for (const pattern of this.patterns) {
      if (pattern.multiline) {
        const regex = new RegExp(pattern.pattern, 'gms');
        const match = regex.exec(context);
        if (match) {
          matches.push({
            ...pattern,
            match: match[0],
            startLine: this.buffer.length - match[0].split('\n').length
          });
        }
      }
    }

    return matches;
  }
}
```

### Performance Optimization

```javascript
// Debounce reactions to avoid spam
class DebouncedReactionEngine extends ReactionEngine {
  constructor(config) {
    super(config);
    this.debounceTimers = new Map();
  }

  async execute(matches, context) {
    for (const match of matches) {
      const key = `${match.pattern}-${match.severity}`;
      
      // Clear existing timer
      if (this.debounceTimers.has(key)) {
        clearTimeout(this.debounceTimers.get(key));
      }

      // Set new timer
      const timer = setTimeout(() => {
        super.execute([match], context);
        this.debounceTimers.delete(key);
      }, this.config.debounceMs || 500);

      this.debounceTimers.set(key, timer);
    }
  }
}
```

## Testing

### Unit Test Example

```javascript
const { describe, test, expect } = require('@jest/globals');
const PatternMatcher = require('../lib/pattern-matcher');

describe('PatternMatcher', () => {
  test('matches TODO patterns', () => {
    const matcher = new PatternMatcher([
      {
        id: 'todo',
        pattern: '\\b(TODO|FIXME)\\b',
        severity: 'warning'
      }
    ]);

    const matches = matcher.check('// TODO: Fix this later');
    expect(matches).toHaveLength(1);
    expect(matches[0].pattern).toBe('todo');
  });

  test('handles multiple matches', () => {
    const matcher = new PatternMatcher([
      {
        id: 'todo',
        pattern: '\\bTODO\\b',
        severity: 'warning'
      },
      {
        id: 'fixme',
        pattern: '\\bFIXME\\b',
        severity: 'warning'
      }
    ]);

    const matches = matcher.check('TODO: FIXME this issue');
    expect(matches).toHaveLength(2);
  });
});
```

## Deployment

### NPM Package Structure

```
claude-watchdog/
├── package.json
├── README.md
├── LICENSE
├── bin/
│   └── claude-watchdog
├── lib/
│   ├── config-manager.js
│   ├── pattern-matcher.js
│   ├── reaction-engine.js
│   ├── stream-monitor.js
│   └── utils.js
├── index.js
├── examples/
│   ├── basic-config.json
│   ├── advanced-config.yaml
│   └── custom-reaction.js
└── test/
    ├── pattern-matcher.test.js
    ├── reaction-engine.test.js
    └── integration.test.js
```

### Installation

```bash
# Global installation
npm install -g claude-watchdog

# Local installation
npm install claude-watchdog

# Development
git clone https://github.com/yourusername/claude-watchdog
cd claude-watchdog
npm install
npm link
```

## Security Considerations

1. **Input Sanitization**: All patterns should be validated before compilation
2. **Command Injection**: Audio playback commands must properly escape file paths
3. **Resource Limits**: Buffer sizes and pattern counts should be limited
4. **Sensitive Data**: Log files should not capture sensitive information
5. **Process Isolation**: Child process should run with minimal privileges

## Future Enhancements

1. **Web UI Dashboard**: Real-time monitoring interface
2. **Plugin System**: Extensible architecture for custom matchers and reactions
3. **Machine Learning**: Intelligent pattern detection based on context
4. **Remote Monitoring**: Send alerts to external services
5. **Performance Metrics**: Track Claude's response times and patterns
6. **Integration APIs**: Webhooks and REST API for external tools
7. **Smart Interrupts**: Context-aware interruption strategies
8. **Pattern Libraries**: Shareable pattern configurations for common use cases