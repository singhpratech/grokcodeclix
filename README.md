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

### A Production-Ready CLI Coding Assistant Powered by xAI's Grok Models

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)
[![xAI API](https://img.shields.io/badge/xAI-Grok%20Models-orange)](https://x.ai/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/singhpratech/grokcodeclix/pulls)

**[Installation](#-quick-start)** · **[Features](#-features)** · **[Commands](#-slash-commands)** · **[Tools](#-available-tools)** · **[Security](#-security-features)** · **[Contributing](#-contributing)**

</div>

---

## What is Grok Code?

**Grok Code** is an agentic coding assistant that lives in your terminal. Think of it as having a senior developer pair programming with you - one that can read your files, write code, run commands, search the web, and help you build software faster.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   $ grok                                                                    │
│                                                                             │
│   ╭──────────────────────────────────────────────────────────────────────╮  │
│   │  🚀 Grok Code v0.1.0                                                 │  │
│   │  Model: grok-3 | Streaming: ON                                       │  │
│   ╰──────────────────────────────────────────────────────────────────────╯  │
│                                                                             │
│   You: Help me create a REST API with Express                               │
│                                                                             │
│   Grok: I'll help you create a REST API with Express. Let me start by      │
│   checking your project structure and then create the necessary files.      │
│                                                                             │
│   📖 Reading package.json...                                                │
│   ✏️ Creating src/server.ts...                                              │
│   ✏️ Creating src/routes/api.ts...                                          │
│   ⚡ Running npm install express...                                         │
│                                                                             │
│   ✓ Created Express API with the following endpoints:                       │
│     GET  /api/users     - List all users                                    │
│     POST /api/users     - Create a user                                     │
│     GET  /api/users/:id - Get user by ID                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Why Grok Code?

<table>
<tr>
<td width="50%">

### Powered by Grok AI
Access xAI's latest models including **Grok 4**, **Grok 3**, and specialized models. Dynamic model fetching ensures you always have access to the newest models.

### Production Ready
Built with TypeScript, comprehensive security hardening, and battle-tested on real projects. Not a toy - a real tool for real developers.

### Claude Code Compatible
Familiar slash commands, permission system, and workflows. If you've used Claude Code, you'll feel right at home.

</td>
<td width="50%">

### 7 Powerful Tools
Read files, write code, execute commands, search codebases, and fetch web content - all with intelligent permission management.

### Session Persistence
Resume conversations where you left off. Your context, history, and progress are automatically saved.

### Extensible
Create custom slash commands for your team. Define project-specific workflows in `.grok/commands/`.

</td>
</tr>
</table>

---

## Quick Start

### Installation

#### Option 1: Install from npm (Recommended)

```bash
npm install -g grokcodecli
```

#### Option 2: Install from Source

```bash
git clone https://github.com/singhpratech/grokcodeclix.git
cd grokcodeclix
npm install
npm run build
npm link
```

### Setup

#### Step 1: Get Your API Key

Visit [xAI Console](https://console.x.ai/) to create an account and generate your API key.

#### Step 2: Configure Authentication

**Option A: Interactive Setup**
```bash
grok auth
```

**Option B: Environment Variable**
```bash
# Add to your shell profile (~/.bashrc, ~/.zshrc, etc.)
export XAI_API_KEY=your_api_key_here
```

**Option C: Config File**
```bash
mkdir -p ~/.config/grokcodecli
echo '{"apiKey": "your_api_key_here"}' > ~/.config/grokcodecli/config.json
```

#### Step 3: Start Coding

```bash
grok
```

That's it! You're ready to go.

---

## Features

### Core Capabilities

| Feature | Description |
|---------|-------------|
| **Interactive AI Chat** | Real-time conversation with Grok AI for coding assistance, debugging, and learning |
| **Streaming Responses** | Token-by-token streaming for responsive, natural feedback |
| **7 Powerful Tools** | Read, Write, Edit, Bash, Glob, Grep, WebFetch - everything you need |
| **Permission System** | Color-coded risk levels with granular session-based approvals |
| **Dynamic Model Support** | Automatically fetches latest models from xAI API |

### Session Management

| Feature | Description |
|---------|-------------|
| **Persistent History** | Auto-save conversations with full context preservation |
| **Resume Sessions** | Pick up exactly where you left off with `/resume` |
| **Export Conversations** | Save chats to markdown for documentation |
| **Context Visualization** | Track token usage with visual progress bars |

### Security Hardened

| Protection | What It Does |
|------------|--------------|
| **Path Traversal Prevention** | Blocks access to `/etc/`, `/proc/`, `/sys/`, `/dev/` and `../` attacks |
| **Command Injection Protection** | Validates and blocks dangerous command patterns |
| **SSRF Prevention** | Blocks localhost, internal IPs, and non-HTTP protocols |
| **Sensitive File Detection** | Warns when accessing `.env`, credentials, and secrets |

### Developer Experience

| Feature | Description |
|---------|-------------|
| **25+ Slash Commands** | Comprehensive command set for every workflow |
| **Custom Commands** | Create your own commands in `.grok/commands/` |
| **Syntax Highlighting** | Beautiful code output with language detection |
| **Diagnostic Tools** | `/doctor` command validates your entire setup |
| **Smart Model Matching** | Type `grok4` or `grok 3` - we'll figure it out |

---

## Dynamic Model Support

Grok Code **automatically fetches the latest models** from the xAI API. When xAI releases new models, they appear instantly in your CLI without any updates needed.

### Current Models (Auto-Updated)

```
🤖 Model Selection

  Current: grok-3

  Grok 4:
    • grok-4-0709 (recommended)
    • grok-4-1-fast-non-reasoning
    • grok-4-1-fast-reasoning
    • grok-4-fast-non-reasoning
    • grok-4-fast-reasoning

  Grok 3:
    • grok-3 ← current (recommended)
    • grok-3-mini

  Grok 2:
    • grok-2-image-1212
    • grok-2-vision-1212

  Specialized:
    • grok-code-fast-1

  10 models available from xAI API
  Use /model <name> to switch.
```

### Smart Model Matching

You don't need to type exact model names. Grok Code understands:

| You Type | Matches |
|----------|---------|
| `grok4` | grok-4-0709 |
| `grok 3` | grok-3 |
| `mini` | grok-3-mini |
| `code` | grok-code-fast-1 |
| `vision` | grok-2-vision-1212 |
| `reasoning` | grok-4-fast-reasoning |

```bash
# All of these work:
/model grok4
/model grok-4-0709
/model vision
/model code
```

---

## Slash Commands

Grok Code includes **25+ built-in commands** for every workflow:

### Session Management

| Command | Alias | Description |
|---------|-------|-------------|
| `/clear` | `/c` | Clear conversation and start fresh |
| `/save` | `/s` | Save current conversation |
| `/history` | | Show saved conversations with timestamps |
| `/resume [id]` | | Resume a previous conversation |
| `/rename <name>` | | Rename current session |
| `/export [file]` | | Export conversation to markdown file |
| `/compact [focus]` | | Reduce context size (keep last 20 messages) |
| `/exit` | `/q` | Save and quit |

### Configuration

| Command | Description |
|---------|-------------|
| `/config` | Show current configuration settings |
| `/model [name]` | Show available models or switch to a different model |
| `/stream` | Toggle streaming mode on/off |
| `/permissions` | View permission settings and risk levels |

### Status & Diagnostics

| Command | Description |
|---------|-------------|
| `/status` | Show session status, model, uptime, and message count |
| `/context` | Visualize context usage with progress bar |
| `/cost` | Show token usage and estimated cost |
| `/usage` | Show detailed usage statistics |
| `/doctor` | Run comprehensive diagnostics check |
| `/version` | Show Grok Code version |

### Project Setup

| Command | Description |
|---------|-------------|
| `/init` | Initialize project with GROK.md configuration file |
| `/review [focus]` | Request AI code review with optional focus area |
| `/terminal-setup` | Show terminal configuration tips |

### Working Directory

| Command | Description |
|---------|-------------|
| `/add-dir <path>` | Add a working directory to the session |
| `/pwd` | Show current working directories |

### Quick Reference

| Alias | Full Command | Description |
|-------|--------------|-------------|
| `/h` | `/help` | Show help |
| `/c` | `/clear` | Clear conversation |
| `/s` | `/save` | Save conversation |
| `/q` | `/exit` | Quit |
| `exit` | `/exit` | Quit (natural language) |
| `quit` | `/exit` | Quit (natural language) |

---

## Available Tools

Grok Code has access to **7 powerful tools** that enable it to interact with your codebase:

### 📖 Read Tool (Low Risk)

Read file contents with line numbers and intelligent handling.

```
Capabilities:
  ✓ Supports offset/limit for large files
  ✓ Detects and rejects binary files
  ✓ Line number formatting (like cat -n)
  ✓ Truncates very long lines (>2000 chars)

Limits:
  → Maximum file size: 10MB
  → Maximum lines returned: 2000
```

**Example Usage:**
```
You: Read the first 50 lines of src/index.ts
Grok: [Uses Read tool with limit: 50]

You: Show me lines 100-150 of the config file
Grok: [Uses Read tool with offset: 100, limit: 50]
```

---

### ✏️ Write Tool (Medium Risk)

Create or overwrite files with full content.

```
Capabilities:
  ✓ Auto-creates parent directories
  ✓ Shows size diff from previous version
  ✓ Reports line count and file size

Limits:
  → Maximum content size: 50MB

Security:
  ⚠️ Warns when writing to sensitive paths
  ⚠️ Blocked from system directories
```

**Example Usage:**
```
You: Create a new React component called Button
Grok: [Uses Write tool to create src/components/Button.tsx]
      ✓ File written: src/components/Button.tsx
        Lines: 45
        Size: 1.2KB
```

---

### 🔧 Edit Tool (Medium Risk)

Edit files by exact string replacement.

```
Capabilities:
  ✓ Precise string matching
  ✓ Prevents accidental multiple replacements
  ✓ Supports replace_all mode for bulk changes

Safety:
  → Requires exact string match
  → Fails if string appears multiple times (unless replace_all)
  → Shows before/after context
```

**Example Usage:**
```
You: Change the API endpoint from /api/v1 to /api/v2
Grok: [Uses Edit tool with old_string: "/api/v1", new_string: "/api/v2"]
      ✓ Edited src/config.ts
        Replaced 1 occurrence
```

---

### ⚡ Bash Tool (High Risk)

Execute shell commands with security validation.

```
Capabilities:
  ✓ Full bash shell access
  ✓ Captures stdout and stderr
  ✓ Configurable timeout (default: 2 minutes)
  ✓ Working directory support

Security:
  🛡️ Blocks dangerous patterns (rm -rf /, curl | sh, etc.)
  🛡️ Prevents privilege escalation
  🛡️ Validates commands before execution

Limits:
  → Maximum output: 1MB
  → Default timeout: 120 seconds
  → Maximum timeout: 10 minutes
```

**Blocked Patterns:**
```
✗ rm -rf /                    # Catastrophic deletion
✗ curl ... | sh               # Remote code execution
✗ wget ... | bash             # Remote code execution
✗ chmod 777                   # Dangerous permissions
✗ > /dev/sda                  # Device destruction
✗ :(){:|:&};:                 # Fork bombs
```

---

### 🔍 Glob Tool (Low Risk)

Find files matching patterns.

```
Capabilities:
  ✓ Full glob pattern support (*, **, ?, [])
  ✓ Recursive directory searching
  ✓ Sorted by modification time

Auto-Ignored:
  → node_modules/
  → .git/
  → dist/
  → build/
  → coverage/

Limits:
  → Maximum 100 results
```

**Example Patterns:**
```
**/*.ts           # All TypeScript files
src/**/*.test.js  # All test files in src
*.{js,ts}         # All JS and TS files in current dir
```

---

### 🔎 Grep Tool (Low Risk)

Search file contents with regex.

```
Capabilities:
  ✓ Full regex support (extended syntax)
  ✓ Case-sensitive and case-insensitive modes
  ✓ Context lines (before/after matches)
  ✓ 30+ file type filters

Limits:
  → Maximum 50 results
  → Respects .gitignore
```

**Example Searches:**
```
/TODO|FIXME/          # Find all TODOs
/function\s+\w+/      # Find function declarations
/import.*from/        # Find all imports
```

---

### 🌐 WebFetch Tool (Low Risk)

Fetch content from URLs.

```
Capabilities:
  ✓ HTML to readable text conversion
  ✓ JSON pretty printing
  ✓ Automatic content type detection
  ✓ Redirect following

Security:
  🛡️ SSRF protection (blocks localhost, internal IPs)
  🛡️ Only HTTP/HTTPS protocols allowed
  🛡️ Request timeout: 30 seconds

Limits:
  → Maximum response: 5MB
```

**Blocked URLs:**
```
✗ http://localhost:*          # Local services
✗ http://127.0.0.1:*          # Loopback
✗ http://192.168.*.*          # Private networks
✗ http://10.*.*.*             # Private networks
✗ file:///etc/passwd          # Local files
```

---

## Permission System

Grok Code uses a **granular permission system** to keep you in control:

### Permission Prompt

When Grok wants to use a tool, you'll see a beautifully formatted prompt:

```
╭─────────────────────────────────────────────────────────────────╮
│ ⚡ Permission Request: Bash                                     │
├─────────────────────────────────────────────────────────────────┤
│ Execute command: npm install express                            │
├─────────────────────────────────────────────────────────────────┤
│ command: npm install express                                    │
│ timeout: 120000                                                 │
╰─────────────────────────────────────────────────────────────────╯

  [y] Yes, allow once
  [a] Allow for this session
  [n] No, deny
  [!] Deny and block for session
```

### Risk Levels

| Level | Icon | Color | Tools | Description |
|-------|------|-------|-------|-------------|
| **Read** | 📖 | Green | Read, Glob, Grep, WebFetch | Safe operations that only read data |
| **Write** | ✏️ | Yellow | Write, Edit | Modifies files but reversible |
| **Execute** | ⚡ | Red | Bash | Runs commands with system access |

### Permission Responses

| Key | Action | Scope |
|-----|--------|-------|
| `y` | Allow | This request only |
| `a` | Allow | All similar requests this session |
| `n` | Deny | This request only |
| `!` | Block | All similar requests this session |

### Auto-Approve Configuration

For trusted operations, you can configure auto-approval in your config:

```json
{
  "autoApprove": ["Read", "Glob", "Grep"]
}
```

---

## Custom Commands

Create your own slash commands as markdown files:

### Project Commands (Shared with Team)

Create commands in `.grok/commands/` in your project:

```bash
mkdir -p .grok/commands
```

**`.grok/commands/security.md`**
```markdown
---
description: Review code for security vulnerabilities
---

Review this code for security issues including:
- SQL injection
- XSS vulnerabilities
- Authentication bypasses
- Sensitive data exposure

Focus on the most critical issues first.
```

Usage: `/security`

### User Commands (Personal, All Projects)

Create commands in `~/.grok/commands/`:

```bash
mkdir -p ~/.grok/commands
```

**`~/.grok/commands/explain.md`**
```markdown
---
description: Explain code in detail
---

Explain this code in detail:
- What does each part do?
- Why was it written this way?
- Are there any potential issues?
```

Usage: `/explain`

### Commands with Arguments

```markdown
---
description: Fix a specific GitHub issue
argument-hint: <issue-number>
---

Fix GitHub issue #$ARGUMENTS following these guidelines:
1. Read the issue description
2. Understand the root cause
3. Implement the fix
4. Add tests if applicable
5. Update documentation if needed
```

Usage: `/fix-issue 123`

### Command Priority

1. **Project commands** (`.grok/commands/`) - highest priority
2. **User commands** (`~/.grok/commands/`) - fallback

---

## Security Features

Grok Code includes **enterprise-grade security hardening**:

### Path Protection

```
Blocked Directories:
  ✗ /etc/           # System configuration
  ✗ /proc/          # Process information
  ✗ /sys/           # Kernel parameters
  ✗ /dev/           # Device files
  ✗ /boot/          # Boot files
  ✗ /root/          # Root home directory

Attack Prevention:
  ✗ ../../../etc/passwd    # Path traversal
  ✗ /home/user/../../../   # Directory escape
```

### Sensitive File Detection

```
Warning Files (allowed with warning):
  ⚠️ .env                  # Environment variables
  ⚠️ .env.local            # Local environment
  ⚠️ credentials.json      # API credentials
  ⚠️ secrets.yaml          # Secret configuration
  ⚠️ id_rsa                # SSH private keys
  ⚠️ *.pem                 # Certificates
```

### Command Protection

```
Blocked Patterns:
  ✗ rm -rf /              # Mass deletion
  ✗ rm -rf ~              # Home deletion
  ✗ rm -rf .              # Current dir deletion
  ✗ mkfs.*                # Filesystem formatting
  ✗ dd if=.* of=/dev/     # Device overwriting
  ✗ curl|sh, wget|bash    # Remote code execution
  ✗ chmod 777             # Dangerous permissions
  ✗ chown root            # Privilege escalation
  ✗ sudo su               # Root access
```

### Network Protection (SSRF Prevention)

```
Blocked Hosts:
  ✗ localhost             # Local services
  ✗ 127.0.0.1             # Loopback IPv4
  ✗ ::1                   # Loopback IPv6
  ✗ 0.0.0.0               # All interfaces
  ✗ 192.168.*.*           # Private Class C
  ✗ 10.*.*.*              # Private Class A
  ✗ 172.16-31.*.*         # Private Class B
  ✗ 169.254.*.*           # Link-local

Blocked Protocols:
  ✗ file://               # Local files
  ✗ ftp://                # FTP
  ✗ gopher://             # Gopher
  ✗ data://               # Data URLs
```

---

## Configuration

### Config File Location

```
~/.config/grokcodecli/config.json
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | string | - | Your xAI API key |
| `model` | string | `grok-3` | Default Grok model |
| `temperature` | number | `0.7` | Response creativity (0.0 - 1.0) |
| `maxTokens` | number | `16384` | Maximum response tokens |
| `streaming` | boolean | `true` | Enable token streaming |
| `autoApprove` | string[] | `[]` | Tools to auto-approve |

### Example Configuration

```json
{
  "apiKey": "xai-your-api-key-here",
  "model": "grok-3",
  "temperature": 0.7,
  "maxTokens": 16384,
  "streaming": true,
  "autoApprove": ["Read", "Glob", "Grep"]
}
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `XAI_API_KEY` | Your xAI API key (overrides config) |
| `GROK_MODEL` | Default model (overrides config) |

---

## Session History

### Storage Location

```
~/.config/grokcodecli/history/
```

### What's Saved

Each session stores:
- Full conversation messages
- Tool call history
- Working directory
- Creation timestamp
- Last update timestamp
- Auto-generated title

### Resume Commands

```bash
# Resume the most recent session
grok --resume

# Resume a specific session by ID
grok --resume abc123def

# List all saved sessions
grok
/history
```

### Session Lifecycle

```
┌─────────────────┐
│   grok start    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  New Session    │───────┐
│  Created        │       │
└────────┬────────┘       │
         │                │
         ▼                │
┌─────────────────┐       │
│  Conversation   │◄──────┘
│  (auto-saved)   │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌───────┐ ┌───────┐
│/save  │ │/exit  │
│       │ │       │
└───┬───┘ └───┬───┘
    │         │
    ▼         ▼
┌─────────────────┐
│ Session Saved   │
│ ~/.config/...   │
└─────────────────┘
         │
         ▼
┌─────────────────┐
│ /resume or      │
│ grok --resume   │
└─────────────────┘
```

---

## Diagnostics

Run `/doctor` to validate your setup:

```
🩺 Running diagnostics...

  ✓ API Key          API key is configured
  ✓ Node.js          v18.19.1 (>=18 required)
  ✓ Working Dir      Read/write access confirmed
  ✓ Config Dir       /home/user/.config/grokcodecli
  ✓ Git              Git is available
  ✓ API Connection   Connected to xAI API

  All checks passed! Grok Code is ready.
```

### Diagnostic Checks

| Check | What It Validates |
|-------|-------------------|
| API Key | Key is configured and has correct format |
| Node.js | Version 18.0.0 or higher |
| Working Dir | Read/write access to current directory |
| Config Dir | Config directory exists and is writable |
| Git | Git is installed and accessible |
| API Connection | Can reach xAI API and authenticate |

---

## CLI Options

```bash
grok [options]

Options:
  -V, --version          Show version number
  -r, --resume [id]      Resume a previous session
  -m, --model <model>    Use a specific model
  -p, --prompt <text>    Start with an initial prompt
  -h, --help             Show help

Subcommands:
  grok auth              Configure API key
  grok config            Show configuration
  grok doctor            Run diagnostics
```

### Examples

```bash
# Start a new session
grok

# Resume last session
grok --resume

# Start with a specific model
grok --model grok-4-0709

# Start with a prompt
grok --prompt "Help me refactor this function"

# Run diagnostics
grok doctor
```

---

## Development

### Building from Source

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Development mode (watch)
npm run dev

# Link for local testing
npm link
```

### Project Structure

```
grokcodeclix/
├── src/
│   ├── cli.ts                 # CLI entry point & argument parsing
│   ├── index.ts               # Public API exports
│   │
│   ├── grok/
│   │   └── client.ts          # xAI Grok API client
│   │
│   ├── conversation/
│   │   ├── chat.ts            # Main interactive loop (900+ lines)
│   │   └── history.ts         # Session persistence
│   │
│   ├── config/
│   │   └── manager.ts         # Configuration management
│   │
│   ├── permissions/
│   │   └── manager.ts         # Permission system
│   │
│   ├── tools/
│   │   ├── registry.ts        # Tool registration & execution
│   │   ├── read.ts            # File reading
│   │   ├── write.ts           # File writing
│   │   ├── edit.ts            # File editing
│   │   ├── bash.ts            # Command execution
│   │   ├── glob.ts            # File pattern matching
│   │   ├── grep.ts            # Content search
│   │   └── webfetch.ts        # HTTP requests
│   │
│   ├── utils/
│   │   ├── security.ts        # Security validation
│   │   └── ui.ts              # UI components
│   │
│   └── commands/
│       └── loader.ts          # Custom command loader
│
├── dist/                      # Compiled JavaScript
├── package.json
├── tsconfig.json
└── README.md
```

### Code Statistics

| Metric | Value |
|--------|-------|
| Total Lines | ~3,500 |
| TypeScript Files | 15 |
| Tools | 7 |
| Slash Commands | 25+ |
| Test Coverage | Growing |

---

## Troubleshooting

### Common Issues

#### "API key not configured"

```bash
# Set via environment variable
export XAI_API_KEY=your_key_here

# Or use auth command
grok auth
```

#### "Connection refused"

Check your network connection and ensure you can reach `api.x.ai`:
```bash
curl https://api.x.ai/v1/models -H "Authorization: Bearer $XAI_API_KEY"
```

#### "Permission denied"

```bash
# Ensure config directory is writable
chmod 755 ~/.config/grokcodecli
```

#### "Command not found: grok"

```bash
# If installed from source, link it
npm link

# Or add to PATH
export PATH="$PATH:$(npm prefix -g)/bin"
```

---

## Comparison with Claude Code

| Feature | Grok Code | Claude Code |
|---------|-----------|-------------|
| AI Model | xAI Grok | Anthropic Claude |
| Slash Commands | 25+ | 35+ |
| Tools | 7 | 10+ |
| Custom Commands | ✓ | ✓ |
| Permission System | ✓ | ✓ |
| Session Persistence | ✓ | ✓ |
| Streaming | ✓ | ✓ |
| Security Hardening | ✓ | ✓ |
| MCP Support | Planned | ✓ |
| IDE Integration | Planned | ✓ |
| Cost | xAI pricing | Anthropic pricing |

---

## Contributing

We welcome contributions! Here's how to get started:

### Development Setup

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/grokcodeclix.git
cd grokcodeclix

# Install dependencies
npm install

# Create a branch
git checkout -b feature/your-feature

# Make changes and test
npm run build
npm link
grok  # Test your changes

# Submit a PR
git push origin feature/your-feature
```

### Contribution Guidelines

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Code Style

- Use TypeScript strict mode
- Follow existing patterns
- Add comments for complex logic
- Update documentation for new features

---

## Roadmap

- [ ] MCP (Model Context Protocol) support
- [ ] IDE integrations (VS Code, JetBrains)
- [ ] Multi-file editing mode
- [ ] Git integration commands
- [ ] Image/vision support with Grok vision models
- [ ] Plugin system
- [ ] Team collaboration features

---

## License

MIT License - see [LICENSE](LICENSE) for details.

```
MIT License

Copyright (c) 2024 Grok Code CLI Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Credits

Built with these amazing technologies:

| Technology | Purpose |
|------------|---------|
| [xAI Grok API](https://x.ai/) | AI models powering the assistant |
| [TypeScript](https://www.typescriptlang.org/) | Type-safe development |
| [Node.js](https://nodejs.org/) | Runtime environment |
| [Chalk](https://github.com/chalk/chalk) | Beautiful terminal styling |
| [Commander.js](https://github.com/tj/commander.js) | CLI framework |
| [Glob](https://github.com/isaacs/node-glob) | File pattern matching |

---

## Support

- **Issues**: [GitHub Issues](https://github.com/singhpratech/grokcodeclix/issues)
- **Discussions**: [GitHub Discussions](https://github.com/singhpratech/grokcodeclix/discussions)
- **Email**: [Contact maintainers](mailto:support@example.com)

---

<div align="center">

### Built with Grok AI

**[Get Started](#-quick-start)** · **[Documentation](#features)** · **[Contribute](#-contributing)**

Made with determination by the Grok Code community

</div>
