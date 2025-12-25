# Grok Code CLI

<div align="center">

```
   ██████╗ ██████╗  ██████╗ ██╗  ██╗     ██████╗ ██████╗ ██████╗ ███████╗
  ██╔════╝ ██╔══██╗██╔═══██╗██║ ██╔╝    ██╔════╝██╔═══██╗██╔══██╗██╔════╝
  ██║  ███╗██████╔╝██║   ██║█████╔╝     ██║     ██║   ██║██║  ██║█████╗
  ██║   ██║██╔══██╗██║   ██║██╔═██╗     ██║     ██║   ██║██║  ██║██╔══╝
  ╚██████╔╝██║  ██║╚██████╔╝██║  ██╗    ╚██████╗╚██████╔╝██████╔╝███████╗
   ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝     ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝
```

**A production-ready CLI coding assistant powered by xAI's Grok models**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)

</div>

---

## Features

### Core Capabilities
- **Interactive AI Chat** - Real-time conversation with Grok AI for coding assistance
- **Streaming Responses** - Token-by-token streaming for responsive feedback
- **7 Powerful Tools** - Read, Write, Edit, Bash, Glob, Grep, WebFetch
- **Permission System** - Color-coded risk levels with session-based approvals

### Session Management
- **Persistent History** - Auto-save conversations with resume support
- **Context Management** - Visual context usage tracking with `/context`
- **Export Conversations** - Save chats to markdown files

### Security Hardened
- **Path Traversal Prevention** - Blocks access to system directories
- **Command Injection Protection** - Validates dangerous command patterns
- **SSRF Prevention** - Blocks localhost and internal network access
- **Sensitive File Detection** - Warns when accessing credential files

### Developer Experience
- **22+ Slash Commands** - Comprehensive command set for every workflow
- **Custom Commands** - Create your own commands in `.grok/commands/`
- **Syntax Highlighting** - Beautiful code output with language detection
- **Diagnostic Tools** - `/doctor` command checks your setup

---

## Quick Start

### Installation

```bash
# Install globally via npm
npm install -g grokcodecli

# Or install from source
git clone https://github.com/singhpratech/grokcodeclix.git
cd grokcodeclix
npm install
npm run build
npm link
```

### Setup

1. Get your API key from [xAI Console](https://console.x.ai/)

2. Configure authentication:
```bash
grok auth
```

Or set environment variable:
```bash
export XAI_API_KEY=your_api_key_here
```

3. Start chatting:
```bash
grok
```

---

## Slash Commands

### Session Management

| Command | Description |
|---------|-------------|
| `/clear` | Clear conversation and start fresh |
| `/save`, `/s` | Save current conversation |
| `/history` | Show saved conversations |
| `/resume [id]` | Resume a previous conversation |
| `/rename <name>` | Rename current session |
| `/export [file]` | Export conversation to file |
| `/compact [focus]` | Reduce context size (keep last 20 messages) |
| `/exit`, `/q` | Save and quit |

### Configuration

| Command | Description |
|---------|-------------|
| `/config` | Show current configuration |
| `/model [name]` | Show or change the AI model |
| `/stream` | Toggle streaming mode |
| `/permissions` | View permission settings |

### Status & Diagnostics

| Command | Description |
|---------|-------------|
| `/status` | Show session status and info |
| `/context` | Visualize context usage with progress bar |
| `/cost` | Show token usage and estimated cost |
| `/usage` | Show usage statistics |
| `/doctor` | Run comprehensive diagnostics |
| `/version` | Show version |

### Working Directory

| Command | Description |
|---------|-------------|
| `/add-dir <path>` | Add a working directory |
| `/pwd` | Show working directories |

### Quick Aliases

| Alias | Command |
|-------|---------|
| `/h` | `/help` |
| `/c` | `/clear` |
| `/s` | `/save` |
| `/q` | `/exit` |

---

## Available Tools

Grok Code has access to 7 powerful tools:

### 📖 Read (Low Risk)
Read file contents with line numbers.
```
→ Supports offset/limit for large files
→ Detects binary files
→ Maximum 10MB file size
```

### ✏️ Write (Medium Risk)
Create or overwrite files.
```
→ Auto-creates parent directories
→ Shows size diff from previous version
→ Maximum 50MB content size
```

### 🔧 Edit (Medium Risk)
Edit files by exact string replacement.
```
→ Requires exact string match
→ Prevents accidental multiple replacements
→ Supports replace_all mode
```

### ⚡ Bash (High Risk)
Execute shell commands.
```
→ 2-minute default timeout
→ Security validation for dangerous patterns
→ Captures both stdout and stderr
```

### 🔍 Glob (Low Risk)
Find files matching patterns.
```
→ Ignores node_modules, .git, dist, build
→ Maximum 100 results
→ Supports ** wildcards
```

### 🔎 Grep (Low Risk)
Search file contents with regex.
```
→ Supports 30+ file types
→ Maximum 50 results
→ Extended regex syntax
```

### 🌐 WebFetch (Low Risk)
Fetch content from URLs.
```
→ HTML to text conversion
→ JSON pretty printing
→ 30-second timeout
→ SSRF protection
```

---

## Permission System

When Grok wants to use a tool, you'll see a permission prompt:

```
╭─────────────────────────────────────────────────────╮
│ ⚡ Permission Request: Bash                         │
├─────────────────────────────────────────────────────┤
│ Execute command: npm install                        │
├─────────────────────────────────────────────────────┤
│ command: npm install                                │
╰─────────────────────────────────────────────────────╯

  [y] Yes, allow once
  [a] Allow for this session
  [n] No, deny
  [!] Deny and block for session
```

### Risk Levels

| Level | Icon | Color | Tools |
|-------|------|-------|-------|
| Read | 📖 | Green | Read, Glob, Grep, WebFetch |
| Write | ✏️ | Yellow | Write, Edit |
| Execute | ⚡ | Red | Bash |

---

## Custom Commands

Create your own slash commands as markdown files.

### Project Commands (shared with team)
```bash
mkdir -p .grok/commands
echo "Review this code for security issues" > .grok/commands/security.md
```

### User Commands (personal, all projects)
```bash
mkdir -p ~/.grok/commands
echo "Explain this code in detail" > ~/.grok/commands/explain.md
```

### Command with Arguments
```markdown
---
description: Fix a specific issue
argument-hint: [issue-number]
---

Fix issue #$ARGUMENTS following coding standards.
```

Usage: `/fix-issue 123`

---

## Security Features

Grok Code includes comprehensive security hardening:

### Path Protection
- Blocks access to `/etc/`, `/proc/`, `/sys/`, `/dev/`
- Prevents path traversal attacks (`../`)
- Warns about sensitive files (`.env`, credentials)

### Command Protection
- Blocks dangerous patterns (`rm -rf /`, `curl | sh`)
- Validates commands before execution
- Prevents privilege escalation attempts

### Network Protection
- Blocks localhost and internal IPs (SSRF prevention)
- Only allows HTTP/HTTPS protocols
- Request timeout protection

---

## Configuration

Config file: `~/.config/grokcodecli/config.json`

| Option | Default | Description |
|--------|---------|-------------|
| `model` | `grok-3` | Grok model to use |
| `temperature` | `0.7` | Response creativity (0-1) |
| `maxTokens` | `16384` | Maximum response length |
| `autoApprove` | `[]` | Tools to auto-approve |

### Supported Models

| Model | Description |
|-------|-------------|
| `grok-3` | Latest and most capable (recommended) |
| `grok-2` | Balanced performance |
| `grok-1` | Faster, lighter model |

---

## Session History

Sessions are saved to: `~/.config/grokcodecli/history/`

Each session stores:
- Full conversation messages
- Working directory
- Creation and update timestamps
- Auto-generated title from first message

Resume commands:
```bash
grok --resume           # Resume last session
grok --resume abc123    # Resume specific session
```

---

## Diagnostics

Run `/doctor` to check your setup:

```
🩺 Running diagnostics...

  ✓ API Key              API key is configured
  ✓ Node.js              v18.19.1 (>=18 required)
  ✓ Working Dir          Read/write access confirmed
  ✓ Config Dir           /home/user/.config/grokcodecli
  ✓ Git                  Git is available
  ✓ API Connection       Connected to xAI API

  All checks passed! Grok Code is ready.
```

---

## Development

### Building

```bash
npm run build    # Compile TypeScript
npm run dev      # Watch mode
```

### Project Structure

```
src/
├── cli.ts                 # CLI entry point
├── index.ts               # Public API exports
├── grok/
│   └── client.ts          # Grok API client
├── conversation/
│   ├── chat.ts            # Main interactive loop
│   └── history.ts         # Session persistence
├── config/
│   └── manager.ts         # Configuration management
├── permissions/
│   └── manager.ts         # Permission system
├── tools/
│   ├── registry.ts        # Tool registration
│   ├── read.ts            # File reading
│   ├── write.ts           # File writing
│   ├── edit.ts            # File editing
│   ├── bash.ts            # Command execution
│   ├── glob.ts            # File search
│   ├── grep.ts            # Content search
│   └── webfetch.ts        # HTTP requests
├── utils/
│   ├── security.ts        # Security utilities
│   └── ui.ts              # UI components
└── commands/
    └── loader.ts          # Custom commands
```

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Contributing

Pull requests welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Write tests if applicable
4. Submit a PR with clear description

---

## Credits

Built with:
- [xAI Grok API](https://x.ai/) - AI models
- [TypeScript](https://www.typescriptlang.org/) - Language
- [Chalk](https://github.com/chalk/chalk) - Terminal styling
- [Commander.js](https://github.com/tj/commander.js) - CLI framework

---

<div align="center">

*Built with Grok AI* 🚀

</div>
