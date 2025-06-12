# Claude Watchdog

A TypeScript wrapper for Claude CLI that monitors output for lazy coding patterns and anti-patterns, alerting you when the AI tries to take shortcuts.

## Features

- **Two Operation Modes**:
  - **Claude Wrapper**: Monitor Claude CLI output in real-time
  - **File Watch**: Monitor directories for anti-patterns
- **Real-time Output Monitoring**: Watches Claude's output for configurable patterns
- **File/Line Tracking**: Detects which file and line is being edited when cheating occurs
- **Multiple Reaction Types**:
  - Sound alerts (platform-specific)
  - CLI interruption with custom messages (wrapper mode)
  - Console alerts with context
  - Webhook notifications (optional)
- **Smart Pattern Detection**: Catches common LLM shortcuts like:
  - Placeholder comments (`// TODO`, `// for now`)
  - Fake implementations (`mock`, `stub`, `placeholder`)
  - Ellipsis skipping (`... rest of implementation`)
  - Hypothetical code (`would implement`, `could add`)
  - Hand-wavy descriptions (`just add`, `simply implement`)
  - Empty implementations (`pass`, `NotImplemented`)
  - Error suppression (`@ts-ignore`, `# type: ignore`)
- **Efficient File Watching**: 
  - Uses Bun's native file watcher
  - Configurable file extensions
  - Ignore patterns for node_modules, dist, etc.
  - Recursive directory watching

## Installation

```bash
# Clone the repository
git clone https://github.com/bewinxed/claude-watchdog.git
cd claude-watchdog

# Install dependencies with Bun
bun install

# Build the TypeScript code
bun run build

# Build standalone executable
bun run build:standalone

# Run tests
bun test
```

## Usage

### Basic Usage - Claude Wrapper Mode

```bash
# Run with default patterns
bun run dev

# Or if built and linked globally
claude-watchdog
```

### Watch Mode - Monitor Files in Directories

```bash
# Watch directories for anti-patterns
claude-watchdog watch ./src ./lib

# With custom config
claude-watchdog watch ./src --config=my-patterns.json

# Watch specific file types
bun run dev watch ./project --config=config.json
```

### Claude Wrapper Mode with Custom Configuration

```bash
# Use custom config file
claude-watchdog --config=my-patterns.json

# Pass arguments to Claude
claude-watchdog --model claude-3-opus --temperature 0.7
```

## Configuration

Create a JSON configuration file to customize patterns and reactions:

```json
{
  "patterns": [
    {
      "name": "placeholder-comment",
      "pattern": "//\\s*(placeholder|todo|fixme|for now)",
      "severity": "high",
      "reactions": ["sound", "interrupt"],
      "message": "DO NOT CHEAT - Write production-ready code!"
    }
  ],
  "reactions": {
    "sound": {
      "enabled": true,
      "command": "afplay /System/Library/Sounds/Basso.aiff"
    },
    "interrupt": {
      "enabled": true,
      "delay": 100,
      "prefix": "\n⚠️  WATCHDOG: ",
      "suffix": "\n"
    },
    "alert": {
      "enabled": true,
      "format": "color",
      "logFile": "./watchdog.log"
    }
  },
  "debounce": {
    "enabled": true,
    "window": 5000
  },
  "fileTracking": {
    "enabled": true,
    "patterns": {
      "filePath": "(?:^|\\s)([\\/\\w\\-\\.]+\\.(js|ts|py|java|cpp|c|go|rs|rb|php|jsx|tsx|vue|svelte))",
      "editingFile": "(?:editing|modifying|updating|writing to|creating)\\s+([\\/\\w\\-\\.]+\\.\\w+)",
      "lineNumber": "line\\s+(\\d+)|:(\\d+):|at\\s+(\\d+)"
    }
  }
}
```

### Pattern Configuration

Each pattern object supports:
- `name`: Identifier for the pattern
- `pattern`: Regular expression (as string)
- `severity`: "high", "medium", or "low"
- `reactions`: Array of reactions to trigger
- `message`: Message to display/send on match

### Available Reactions

1. **sound**: Plays system sound
2. **interrupt**: Sends message to Claude's stdin
3. **alert**: Prints formatted warning to console
4. **webhook**: Send notification to external service (configure in reactions)

### File Tracking

The watchdog automatically detects:
- File paths mentioned in output
- "Editing/modifying/creating" statements
- Line numbers in various formats

## Default Patterns

The watchdog includes 12 default patterns that catch common shortcuts:

- `// TODO`, `// FIXME`, `// placeholder`, `// for now`
- `mock implementation`, `stub function`
- `... rest of code`, `... additional logic`
- `would implement`, `could add`
- `not implemented`, `NotImplementedError`
- `coming soon`, `to be implemented`
- Empty `pass` statements
- Error suppressions (`@ts-ignore`, `# noqa`)
- Debug console logs with TODOs

## Platform-Specific Sound Commands

Default sound commands for each platform:
- **macOS**: `afplay /System/Library/Sounds/Basso.aiff`
- **Windows**: `powershell -c (New-Object Media.SoundPlayer "C:\\Windows\\Media\\chord.wav").PlaySync()`
- **Linux**: `paplay /usr/share/sounds/freedesktop/stereo/bell.oga`

You can customize these in your configuration file.

## Development

```bash
# Install dependencies
bun install

# Build TypeScript
bun run build

# Build standalone executable
bun run build:standalone

# Run directly with Bun
bun run dev

# Run tests
bun test

# Run tests in watch mode
bun test --watch
```

## Architecture

### Claude Wrapper Mode
The watchdog works by:
1. Spawning Claude CLI as a child process
2. Intercepting stdout/stderr streams
3. Parsing output line-by-line for context and patterns
4. Maintaining file/line context from Claude's output
5. Executing configured reactions when patterns match
6. Passing through all I/O transparently

### Watch Mode
File watching works by:
1. Using Bun's native file watcher for efficient monitoring
2. Watching specified directories recursively
3. Processing only files with allowed extensions
4. Scanning file contents when changes are detected
5. Tracking matches with file path and line numbers
6. Executing same reactions as wrapper mode

## Advanced Features

- **Debouncing**: Prevents repeated alerts for the same issue
- **Context Tracking**: Maintains history of files being edited
- **Extensible**: Easy to add new patterns and reaction types
- **TypeScript**: Full type safety and IDE support

## Contributing

Pull requests are welcome! Please make sure to:
1. Add tests for new features
2. Update documentation
3. Follow the existing code style
4. Build and test before submitting

## License

MIT