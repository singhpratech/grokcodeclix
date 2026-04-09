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
$ grok

   ██████╗ ██████╗  ██████╗ ██╗  ██╗     ██████╗ ██████╗ ██████╗ ███████╗
  ██╔════╝ ██╔══██╗██╔═══██╗██║ ██╔╝    ██╔════╝██╔═══██╗██╔══██╗██╔════╝
  ██║  ███╗██████╔╝██║   ██║█████╔╝     ██║     ██║   ██║██║  ██║█████╗
  ██║   ██║██╔══██╗██║   ██║██╔═██╗     ██║     ██║   ██║██║  ██║██╔══╝
  ╚██████╔╝██║  ██║╚██████╔╝██║  ██╗    ╚██████╗╚██████╔╝██████╔╝███████╗
   ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝     ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝

╭────────────────────────────────────────────────────────────╮
│ ✻ ✻ ✻  Welcome to Grok Code!                                │
│                                                              │
│   /help for help, /status for your current setup            │
│                                                              │
│   cwd: ~/myproject                                           │
│   ✓ GROK.md loaded                                           │
╰────────────────────────────────────────────────────────────╯

  ? for shortcuts
> Help me create a REST API with Express

● Read(package.json)
  ⎿  Read 47 lines from package.json

● Write(src/server.ts)
  ⎿  Created src/server.ts (34 lines, 812B)

● Bash(npm install express)
  ⎿  3 lines of output
  │ added 64 packages in 2s

Done. Created an Express API with these endpoints:

- `GET  /api/users`     — list all users
- `POST /api/users`     — create a user
- `GET  /api/users/:id` — get user by ID

> _
```

---

## Why Grok Code?

<table>
<tr>
<td width="50%">

### Powered by Grok AI
Access xAI's latest models including **Grok 4.1**, **Grok 4**, and specialized models. Dynamic model fetching ensures you always have access to the newest models as they're released.

### Production Ready
Built with TypeScript, comprehensive security hardening, and battle-tested on real projects. Not a toy - a real tool for real developers.

### Claude Code Compatible
Familiar slash commands, permission system, and workflows. If you've used Claude Code, you'll feel right at home.

</td>
<td width="50%">

### 8 Powerful Tools
Read files, write code, execute commands, search codebases, fetch web content, and **search the web** - all with intelligent permission management.

### Session Persistence
Resume conversations where you left off. Your context, history, and progress are automatically saved.

### Extensible
Create custom slash commands for your team. Define project-specific workflows in `.grok/commands/`.

</td>
</tr>
</table>

---

## 📸 Screenshots

### Welcome Screen

A clean bordered box with the tiranga ✻ accent (saffron · white · green), help hint, and working directory:

```
╭────────────────────────────────────────────────────────────╮
│ ✻ ✻ ✻  Welcome to Grok Code!                                │
│                                                              │
│   /help for help, /status for your current setup            │
│                                                              │
│   cwd: ~/myproject                                           │
│   ✓ GROK.md loaded                                           │
│   ✓ 3 custom commands                                        │
╰────────────────────────────────────────────────────────────╯

  ? for shortcuts
> _
```

### /help Command

Shows all **32+** built-in slash commands, input prefixes, and keyboard shortcuts organized by category:

```
  ✻ Grok Code v0.1.21
  ────────────────────────────────────────────────────────────────

  Session
  /clear               Clear the conversation
  /save                Save the current session
  /back                Undo the last turn (Ctrl+B)
  /backup [name]       Save a named backup snapshot (Ctrl+O)
  /history             Browse previous sessions
  /resume [id]         Resume a previous session
  /rename <name>       Rename the current session
  /export [file]       Export conversation
  /compact [focus]     Compact context
  /exit                Save and quit

  Config
  /model [name]        Show or change the model
  /plan                Toggle plan mode (Shift+Tab)
  /stream              Toggle streaming
  /output-style        Response style (default/concise/verbose)
  /theme               Color theme
  /permissions         Permission settings
  /config              Show configuration
  /login               Authenticate with xAI
  /logout              Clear credentials

  Info
  /status              Session status
  /context             Context window usage
  /cost                Token usage and cost
  /usage               Usage stats
  /doctor              Run diagnostics
  /version             Show version
  /release-notes       Recent changes
  /bug                 Report a bug on GitHub

  Project & memory
  /init                Initialize GROK.md + .grok/commands/
  /memory [show|edit]  View or edit GROK.md
  /review [focus]      Code review
  /add-dir <path>      Add a working directory
  /pwd                 Show working directories

  Images & custom commands
  /image <path>        Attach an image from file
  /paste               Paste image from clipboard
  /commands            List custom commands

  Prefixes (at start of message)
  !<command>           Run shell command directly (bypasses Grok)
  #<note>              Add a note to GROK.md memory
  /<command>           Run a slash command
  ?                    Show this help

  Keyboard shortcuts
  Tab          Autocomplete slash command
  Shift+Tab    Toggle plan mode
  Ctrl+B       Undo last turn (back)
  Ctrl+O       Save backup snapshot
  Ctrl+L       Clear screen
  Esc          Stop streaming response
  Ctrl+C       Abort current action / exit
  Ctrl+D       Exit

  Tools
  📖 Read   🔍 Glob   🔎 Grep   🌐 WebFetch   🔍 WebSearch
  ✏️  Write   🔧 Edit
  ⚡ Bash
```

### /model Command

Interactive model picker with arrow-key navigation. Defaults to **grok-4-1-fast-reasoning** (latest):

```
  Select model:
  ↑↓/Tab to navigate, Enter to select, Esc to cancel
❯ grok-4-1-fast-reasoning (current) - reasoning
  grok-4-1-fast-non-reasoning - fast
  grok-4-0709
  grok-4-fast-reasoning - reasoning
  grok-4-fast-non-reasoning - fast
  grok-3
  grok-3-mini - small/fast
  grok-2-vision-1212 - vision
  grok-code-fast-1
```

Or skip the picker and switch directly:

```
> /model grok41
  ✓ Switched to grok-4-1-fast-reasoning
```

### /doctor Command

Comprehensive diagnostics to ensure everything is working:

```
  Running diagnostics…

  ✓ API Key          configured
  ✓ Node.js          v22.22.2 (≥18 required)
  ✓ Working Dir      r/w access
  ✓ Config Dir       /home/user/.config/grokcodecli-nodejs
  ✓ Git              available
  ✓ Global memory    ~/.grok/GROK.md
  ✓ Project memory   GROK.md
  ✓ Custom commands  3 loaded
  ✓ Clipboard tool   xclip available
  ✓ API Connection   10 models available

  All checks passed.
```

### /status Command

Sectioned status view showing model, session state, context usage, and project context:

```
  ✻ Grok Code Status
  ────────────────

  Version & model
    Version:   0.1.21
    Model:     grok-4-1-fast-reasoning
    Mode:      🧠 Thinking
    Streaming: on
    Style:     default

  Session
    Title:     Welcome to Grok Code!
    ID:        a3f9e21b
    Messages:  18 (6 user, 6 grok, 6 tools)
    Uptime:    12m 04s
    Undo:      5 snapshot(s) available

  Context
    Used:      ~12,400 / 256,000 tokens (4%)
    Tokens:    24,812 this session

  Project
    CWD:       /home/user/myproject
    Memory:    ✓ GROK.md loaded
    Commands:  ✓ 3 custom

  Environment
    Platform:  linux x64
    Node:      v22.22.2
    Config:    ~/.config/grokcodecli-nodejs/
```

### Authentication Flow

Beautiful browser-based OAuth-like authentication:

```
╭──────────────────────────────────────────────────────────────────────╮
│  🔐 Grok Code CLI - Authentication                                    │
╰──────────────────────────────────────────────────────────────────────╯

  Welcome to Grok Code!

  To use Grok Code, you need an API key from xAI.
  We'll open your browser to the xAI console where you can:

    1. Sign in or create an account
    2. Go to API Keys section
    3. Create a new API key
    4. Copy the key and paste it here

❯ Open xAI Console in browser? [Y/n]: Y

  ⏳ Opening browser...
  ✓ Browser opened!

  ─────────────────────────────────────────────────────────────────
  Follow these steps in the browser:
  1. Sign in to your xAI account
  2. Click on "API Keys" in the sidebar
  3. Click "Create API Key"
  4. Copy the key (starts with "xai-")
  ─────────────────────────────────────────────────────────────────

❯ API Key: xai-••••••••••••••••••••

  ⠋ Validating API key...
  ✓ API key validated!

╭──────────────────────────────────────────────────────────────────────╮
│  🎉 Authentication Successful!                                        │
│                                                                      │
│  API Key:    ✓ Saved securely                                        │
│  Models:     10 available                                            │
│  Get started: grok                                                   │
╰──────────────────────────────────────────────────────────────────────╯
```

### Tool Execution

Claude-Code-style tool invocation display — saffron `●` marker, tool name, args, then a `⎿  summary` line underneath. Edits show a colored `+`/`-` diff:

```
> Read the package.json file

● Read(package.json)
  ⎿  Read 47 lines from package.json

Here's your package.json — the project uses TypeScript with Commander,
Chalk, Conf, and Glob as runtime deps.

> Now change the name to "my-cli"

● Edit(package.json)
  ⎿  Updated package.json with 1 addition and 1 removal
     2 -   "name": "grokcodecli",
     2 +   "name": "my-cli",
     3    "version": "0.1.21",

Done.
```

---

## Quick Start

### Requirements

- **Node.js ≥ 18** (check with `node --version`)
- **git** (for cloning)
- An xAI API key (any paid Grok plan — SuperGrok, Grok Heavy, or pay-as-you-go — or you can create one at [console.x.ai](https://console.x.ai/))

### Installation

#### Option 1: No-sudo install from GitHub (recommended)

```bash
# Clone and build
git clone https://github.com/singhpratech/grokcodeclix.git ~/src/grokcodeclix
cd ~/src/grokcodeclix
npm install
npm run build

# Symlink into your PATH (no sudo needed)
mkdir -p ~/.local/bin
ln -sf "$PWD/dist/cli.js" ~/.local/bin/grok
chmod +x dist/cli.js

# Ensure ~/.local/bin is in PATH (add to ~/.bashrc or ~/.zshrc if missing)
export PATH="$HOME/.local/bin:$PATH"
```

Then `grok` works anywhere.

#### Option 2: npm global install (needs sudo if prefix is `/usr`)

```bash
sudo npm install -g github:singhpratech/grokcodeclix
```

#### Option 3: npm global without sudo (user prefix)

```bash
mkdir -p ~/.npm-global
npm config set prefix "$HOME/.npm-global"
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
npm install -g github:singhpratech/grokcodeclix
```

#### Updating

```bash
cd ~/src/grokcodeclix
git pull
npm install
npm run build
# The symlink already points at dist/cli.js — no further action needed.
```

### Setup

#### Quick Start (Recommended)

Just run the auth command - it will guide you through everything:

```bash
grok auth
```

This will:
1. Open your browser to xAI Console
2. Guide you through creating an API key
3. Validate and save your key securely

```
╭──────────────────────────────────────────────────────────────────────╮
│  🔐 Grok Code CLI - Authentication                                   │
╰──────────────────────────────────────────────────────────────────────╯

  Welcome to Grok Code!

  To use Grok Code, you need an API key from xAI.
  We'll open your browser to the xAI console where you can:

    1. Sign in or create an account
    2. Go to API Keys section
    3. Create a new API key
    4. Copy the key and paste it here

❯ Open xAI Console in browser? [Y/n]: Y

  ⏳ Opening browser...
  ✓ Browser opened!

  ─────────────────────────────────────────────────────────────────
  Follow these steps in the browser:
  1. Sign in to your xAI account
  2. Click on "API Keys" in the sidebar
  3. Click "Create API Key"
  4. Copy the key (starts with "xai-")
  ─────────────────────────────────────────────────────────────────

❯ API Key: xai-••••••••••••••••••••

  ✓ API key validated!

╭──────────────────────────────────────────────────────────────────────╮
│  🎉 Authentication Successful!                                       │
│                                                                      │
│  API Key:    ✓ Saved securely                                       │
│  Models:     10 available                                           │
│  Get started: grok                                                  │
╰──────────────────────────────────────────────────────────────────────╯
```

#### Alternative: Environment Variable

```bash
# Add to your shell profile (~/.bashrc, ~/.zshrc, etc.)
export XAI_API_KEY=your_api_key_here
```

#### Start Coding

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
| **8 Powerful Tools** | Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch - everything you need |
| **Permission System** | Color-coded risk levels with granular session-based approvals |
| **Dynamic Model Support** | Automatically fetches latest models from xAI API |

### Session Management

| Feature | Description |
|---------|-------------|
| **Persistent History** | Auto-save conversations with full context preservation |
| **Resume Sessions** | Pick up exactly where you left off with `/resume` |
| **Named Backups** | `Ctrl+O` or `/backup [name]` snapshots the session to disk |
| **Undo Stack** | `Ctrl+B` or `/back` rewinds the last turn (up to 20 snapshots) |
| **Export Conversations** | Save chats to markdown for documentation |
| **Context Visualization** | Track token usage with visual progress bars |
| **Auto-compact** | Old messages are compacted automatically at 80% context |

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
| **32+ Slash Commands** | Comprehensive command set for every workflow |
| **Live `/` Popup** | Matching commands appear as you type, like Claude Code |
| **Custom Commands** | Create your own commands in `.grok/commands/` or `~/.grok/commands/` |
| **Project Memory** | `GROK.md` files walked up from cwd, plus a global `~/.grok/GROK.md` |
| **Image / Vision Support** | `@file.png` references, `/image`, and `/paste` from clipboard |
| **Syntax Highlighting** | Terminal markdown renderer with per-language code coloring |
| **Tiranga Theme** | Saffron · white · green palette 🇮🇳 (switchable via `/theme`) |
| **Plan Mode** | Read-only mode for safe exploration — toggle with `Shift+Tab` |
| **Undo Stack** | `Ctrl+B` / `/back` to revert the last turn |
| **Shell Escape** | `!command` runs directly via Bash, bypassing Grok |
| **Quick Memory Add** | `#note` appends to `GROK.md` on the fly |
| **Diagnostic Tools** | `/doctor` validates config, memory, custom commands, clipboard tools |
| **Smart Model Matching** | Type `grok41` or `4.1` — we'll figure it out |

---

## Dynamic Model Support

Grok Code **automatically fetches the latest models** from the xAI API. When xAI releases new models, they appear instantly in your CLI without any updates needed.

### Current Models (Auto-Updated)

```
Select model:
↑↓/Tab to navigate, Enter to select, Esc to cancel

❯ grok-4-1-fast-reasoning (current) - reasoning
  grok-4-1-fast-non-reasoning       - fast
  grok-4-0709
  grok-4-fast-reasoning              - reasoning
  grok-4-fast-non-reasoning          - fast
  grok-3
  grok-3-mini                        - small/fast
  grok-2-vision-1212                 - vision
  grok-code-fast-1
```

> **🧠 Reasoning Models:** Recommended for complex coding tasks - they provide step-by-step thinking for better accuracy.
>
> **⚡ Fast Models:** Great for quick responses and simpler tasks where speed matters more than deep analysis.

### Smart Model Matching

You don't need to type exact model names. Grok Code normalizes partial input against the live model list from the xAI API:

| You Type | Matches |
|----------|---------|
| `grok41` | grok-4-1-fast-reasoning |
| `grok 4 1` | grok-4-1-fast-reasoning |
| `grok4` | grok-4-0709 |
| `4.1` | grok-4-1-fast-reasoning |
| `reasoning` | grok-4-1-fast-reasoning |
| `fast` | grok-4-1-fast-non-reasoning |
| `vision` | grok-2-vision-1212 |
| `code` | grok-code-fast-1 |
| `mini` | grok-3-mini |

```bash
# All of these work:
/model grok41        # → grok-4-1-fast-reasoning
/model 4.1           # → grok-4-1-fast-reasoning
/model fast          # → grok-4-1-fast-non-reasoning
/model vision        # → grok-2-vision-1212
/model code          # → grok-code-fast-1
```

---

## Slash Commands

Grok Code includes **32+ built-in commands** for every workflow. Start typing `/` and a live popup shows matching commands as you type — just like Claude Code.

### Session Management

| Command | Alias | Description |
|---------|-------|-------------|
| `/clear` | `/c` | Clear conversation and start fresh |
| `/save` | `/s` | Save current conversation |
| `/back` | `/undo` | Undo the last turn (paired with **Ctrl+B**) |
| `/backup [name]` | | Save a named snapshot to `~/.config/grokcodecli/backups/` (**Ctrl+O**) |
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
| `/plan` | Toggle plan mode — blocks Write/Edit/Bash (**Shift+Tab**) |
| `/stream` | Toggle streaming mode on/off |
| `/output-style` | Set response style: **default** / **concise** / **verbose** |
| `/theme` | Change color theme: **tiranga** / **claude** / **mono** |
| `/permissions` | View permission settings and risk levels |
| `/login` | Authenticate with xAI (opens browser to console.x.ai) |
| `/logout` | Clear stored credentials |

### Status & Diagnostics

| Command | Description |
|---------|-------------|
| `/status` | Sectioned status: model, session, context, project, environment |
| `/context` | Visualize context usage with progress bar |
| `/cost` | Show token usage and estimated cost |
| `/usage` | Show detailed usage statistics |
| `/doctor` | Run comprehensive diagnostics check |
| `/version` | Show Grok Code version |
| `/release-notes` | Show recent changes (CHANGELOG.md or last 10 git commits) |
| `/bug` | Prefilled GitHub issue URL with your env info |

### Project Setup & Memory

| Command | Description |
|---------|-------------|
| `/init` | Scaffold `GROK.md` and `.grok/commands/` in the current project |
| `/memory [show\|edit]` | View `GROK.md` or open it in `$EDITOR` (reloads on save) |
| `/review [focus]` | Request AI code review with optional focus area |
| `/add-dir <path>` | Add a working directory to the session |
| `/pwd` | Show current working directories |

### Images & Custom Commands

| Command | Description |
|---------|-------------|
| `/image <path>` | Attach an image file to the next message (vision) |
| `/paste` | Paste image from clipboard (needs `xclip`/`wl-paste`/`pngpaste`) |
| `/commands` | List custom commands loaded from `.grok/commands/` and `~/.grok/commands/` |

### Input Prefixes

Type these at the start of your message for quick actions:

| Prefix | Action |
|--------|--------|
| `!<command>` | **Shell escape** — runs the command via Bash tool directly, bypassing Grok |
| `#<note>` | **Quick-add to memory** — appends a line to `GROK.md` (asks project or global) |
| `/<command>` | Run a slash command |
| `@<path.png>` | Inline image reference — auto-attached to the message |
| `?` | Show help |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Tab` | Autocomplete slash command |
| `Shift+Tab` | Toggle plan mode |
| `Ctrl+B` | Undo last turn (back) |
| `Ctrl+O` | Save backup snapshot |
| `Ctrl+L` | Clear screen |
| `Esc` | Stop streaming response |
| `Ctrl+C` | Abort current action / exit |
| `Ctrl+D` | Exit |

---

## Available Tools

Grok Code has access to **8 powerful tools** that enable it to interact with your codebase and the web:

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

### 🔍 WebSearch Tool (Low Risk)

Search the web for information, documentation, tutorials, and more.

```
Capabilities:
  ✓ Real-time web search
  ✓ Returns titles, URLs, and snippets
  ✓ No API key required (uses DuckDuckGo)
  ✓ Sources section for citations

Limits:
  → Maximum 20 results
  → Query length: 500 characters
```

**Example Usage:**
```
You: Search for React hooks best practices
Grok: [Uses WebSearch tool]

🔍 Search Results for: "React hooks best practices"
Found 10 results

1. React Hooks Best Practices - Official Docs
   https://react.dev/reference/react
   Complete guide to React Hooks...

2. 10 React Hooks Best Practices
   https://blog.example.com/react-hooks
   Learn the most important patterns...

Sources:
  • [React Hooks Best Practices](https://react.dev/reference/react)
  • [10 React Hooks Best Practices](https://blog.example.com/react-hooks)
```

---

## Permission System

Grok Code uses a **granular permission system** to keep you in control:

### Permission Prompt

When Grok wants to use a tool, you see a Claude-Code-style numbered question with a tool-specific wording:

```
● Bash(npm install express)

  Do you want to run this command?
❯ 1. Yes
  2. Yes, and don't ask again this session
  3. No, and tell Grok what to do differently (esc)
```

The question adapts to the tool: `"Do you want to make this edit?"` for Edit, `"Do you want to create/overwrite this file?"` for Write, etc.

### Risk Levels

| Level | Color | Tools | Description |
|-------|-------|-------|-------------|
| **Read** | Green | Read, Glob, Grep, WebFetch, WebSearch | Safe operations that only read data |
| **Write** | Yellow | Write, Edit | Modifies files but reversible |
| **Execute** | Red | Bash | Runs commands with system access |

### Permission Responses

| Choice | Action | Scope |
|--------|--------|-------|
| `1. Yes` | Allow | This request only |
| `2. Yes, and don't ask again` | Allow | All similar requests this session |
| `3. No, and tell Grok…` or `Esc` | Deny | This request only |

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

## Memory System

Grok Code uses the same memory hierarchy as Claude Code — a `GROK.md` file that's automatically injected into the system prompt so Grok knows how *your* project works before you have to tell it.

### Memory Hierarchy

At startup, Grok Code walks this chain and concatenates every `GROK.md` it finds (nearest wins on conflicts):

1. **Global memory** — `~/.grok/GROK.md` — applies to every project on this machine
2. **Project memory** — `./GROK.md` walked up from `cwd` → `$HOME` — per-project context

Both are loaded into the system prompt under `# Project context`.

### Creating Memory Files

```bash
# One-shot initializer — creates GROK.md and .grok/commands/
grok
> /init
```

The generated `GROK.md` looks like this:

```markdown
# myproject

## What this project does
<!-- Short description of the project's purpose -->

## Tech stack
<!-- Main languages, frameworks, libraries -->

## Project structure
<!-- Key directories and what lives in them -->

## Coding conventions
<!-- Style rules: naming, formatting, file layout, imports -->

## Notes for Grok
- Read files before editing
- Match existing code style
- Run tests after changes
```

### Quick-Add to Memory

Start any message with `#` to append a note — Grok Code asks whether you want it in project memory or global memory:

```
> #always prefer 2-space indent in this repo
  Add to which memory?
❯ Project memory   — ./GROK.md
  Global memory    — ~/.grok/GROK.md

  ✓ Saved to GROK.md
```

The system prompt reloads immediately — no restart needed.

### View or Edit Memory

```
/memory              # show contents
/memory show         # same as above
/memory edit         # open GROK.md in $EDITOR ($VISUAL / nano fallback)
```

---

## Vision & Image Support

Grok Code can see images — screenshots, diagrams, error modals, whiteboard photos — using Grok's multimodal vision. Three ways to attach:

### 1. Inline `@path` Reference

Drop a file path in your message:

```
> @screenshot.png what error is this showing?

  📎 Attached screenshot.png (124.5KB)
● (Grok analyzes the image and responds)
```

Relative and absolute paths both work. Supported formats: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp` (up to 20MB).

### 2. `/image <path>` Slash Command

Attach an image to your *next* message:

```
> /image ~/Pictures/design-mockup.png
  📎 Attached ~/Pictures/design-mockup.png (284.1KB)

> implement this layout in React
```

### 3. `/paste` from Clipboard

Take a screenshot with your OS screenshot tool (which copies to clipboard), then:

```
> /paste
  📎 Pasted image from clipboard (98.2KB)

> what does this error message mean?
```

**Clipboard tool required:**
- **Linux (X11)**: `sudo apt install xclip`
- **Linux (Wayland)**: `sudo apt install wl-clipboard`
- **macOS**: `brew install pngpaste`
- **Windows**: uses PowerShell's `Windows.Forms.Clipboard` (no install needed)

Run `/doctor` to check whether your clipboard tool is installed.

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

### Config File Locations

Grok Code uses a layered config system:

| Location | Scope | What it holds |
|----------|-------|---------------|
| `~/.config/grokcodecli-nodejs/config.json` | User | API key, default model, temperature, auto-approve, etc. |
| `~/.grok/GROK.md` | User (global memory) | Global project notes injected into every session |
| `./GROK.md` (walked up to `$HOME`) | Project | Project-specific notes for Grok |
| `./.grok/commands/` | Project | Custom slash commands for this repo |
| `~/.grok/commands/` | User | Custom slash commands available everywhere |
| `~/.config/grokcodecli/backups/` | User | Named snapshots from `/backup` / `Ctrl+O` |

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | string | - | Your xAI API key |
| `model` | string | `grok-4-1-fast-reasoning` | Default Grok model |
| `temperature` | number | `0.7` | Response creativity (0.0 - 1.0) |
| `maxTokens` | number | `16384` | Maximum response tokens |
| `autoApprove` | string[] | `[]` | Tools to auto-approve (e.g. `["Read","Glob","Grep"]` or `["*"]`) |

### Example Configuration

```json
{
  "apiKey": "xai-your-api-key-here",
  "model": "grok-4-1-fast-reasoning",
  "temperature": 0.7,
  "maxTokens": 16384,
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
grok [options] [prompt...]

Options:
  -V, --version               Show version number
  -m, --model <model>         Grok model to use (default: grok-4-1-fast-reasoning)
  -r, --resume [sessionId]    Resume a previous conversation
  -p, --print                 Print response and exit (non-interactive)
  -y, --yes                   Auto-approve all tool calls (skip prompts)
  -h, --help                  Show help

Subcommands:
  grok auth                   Authenticate with xAI API (browser or paste)
  grok config [--show|--reset] Manage configuration
```

### Examples

```bash
# Start a new interactive session
grok

# Resume the last session
grok --resume

# Resume a specific session by (partial) id
grok --resume abc123

# One-shot prompt (non-interactive — auto-approves all tool calls)
grok "read package.json and tell me the version"

# Pipe input
git diff | grok "review this diff for bugs"

# Use a specific model
grok --model grok-4-1-fast-non-reasoning

# Scripting — bypass permission prompts
grok -y "fix the typo in README.md"
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
│   │   └── client.ts          # xAI Grok API client (reasoning, search, vision)
│   │
│   ├── conversation/
│   │   ├── chat.ts            # Main interactive loop (~1900 lines)
│   │   └── history.ts         # Session persistence
│   │
│   ├── config/
│   │   └── manager.ts         # Configuration + auth flow
│   │
│   ├── permissions/
│   │   └── manager.ts         # Permission system (Claude-Code-style prompts)
│   │
│   ├── tools/
│   │   ├── registry.ts        # Tool registration & execution
│   │   ├── read.ts            # File reading
│   │   ├── write.ts           # File writing (with diff display)
│   │   ├── edit.ts            # File editing (with diff display)
│   │   ├── bash.ts            # Command execution
│   │   ├── glob.ts            # File pattern matching
│   │   ├── grep.ts            # Content search
│   │   ├── webfetch.ts        # HTTP requests
│   │   └── websearch.ts       # DuckDuckGo web search
│   │
│   ├── utils/
│   │   ├── markdown.ts        # Terminal markdown renderer
│   │   ├── diff.ts            # LCS line diff for Edit/Write
│   │   ├── image.ts           # Image loading + clipboard paste
│   │   ├── selector.ts        # Interactive arrow-key selector
│   │   ├── security.ts        # Path/command validation
│   │   └── ui.ts              # UI helpers
│   │
│   └── commands/
│       └── loader.ts          # Custom command loader
│
├── dist/                      # Compiled JavaScript
├── smoke-test.mjs             # 114 offline smoke tests
├── preview.mjs                # Visual UI preview (no API key needed)
├── package.json
├── tsconfig.json
└── README.md
```

### Code Statistics

| Metric | Value |
|--------|-------|
| Total Lines | ~5,200 |
| TypeScript Files | 18 |
| Tools | 8 |
| Slash Commands | 32+ |
| Smoke Tests | 114 (all passing) |

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
| AI Model | xAI Grok (4.1, 4, 3, vision) | Anthropic Claude |
| Slash Commands | 32+ | 35+ |
| Tools | 8 (Read/Write/Edit/Bash/Glob/Grep/WebFetch/WebSearch) | 10+ |
| Live `/` command popup | ✓ | ✓ |
| Custom Commands | ✓ (`.grok/commands/`, `~/.grok/commands/`) | ✓ |
| Project Memory (GROK.md / CLAUDE.md) | ✓ (global + project, walked up) | ✓ |
| Quick-add to memory (`#` prefix) | ✓ | ✓ |
| Shell escape (`!` prefix) | ✓ | ✓ |
| Image / Vision Support | ✓ (`/image`, `/paste`, `@file.png`) | ✓ |
| Permission System (numbered prompts) | ✓ | ✓ |
| Plan Mode (Shift+Tab) | ✓ | ✓ |
| Undo / Back (Ctrl+B) | ✓ | ✓ |
| Backup Snapshot (Ctrl+O) | ✓ | — |
| Session Persistence & `/resume` | ✓ | ✓ |
| Streaming + Reasoning Mode | ✓ | ✓ |
| Security Hardening | ✓ | ✓ |
| Custom color themes | ✓ (tiranga / claude / mono) | — |
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

### Shipped

- [x] Image / vision support — `/image`, `/paste`, `@file.png` references
- [x] Memory hierarchy — `~/.grok/GROK.md` + project `GROK.md` walked up
- [x] Custom commands — `.grok/commands/` and `~/.grok/commands/`
- [x] Plan mode — `Shift+Tab` or `/plan`
- [x] Undo / back — `Ctrl+B` or `/back`
- [x] Backup snapshots — `Ctrl+O` or `/backup`
- [x] Shell escape — `!command` prefix
- [x] Quick memory add — `#note` prefix
- [x] Live `/` command popup
- [x] Tiranga color theme (saffron · white · green)
- [x] Claude-Code-style welcome banner, tool display, and permission prompts

### Planned

- [ ] Live markdown re-render after streaming (repaint for pretty code blocks)
- [ ] MCP (Model Context Protocol) support
- [ ] IDE integrations (VS Code, JetBrains)
- [ ] Multi-file editing mode
- [ ] Published on npm as `grokcodecli`
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
