# Grok Code CLI

A CLI coding assistant powered by xAI's Grok models. Similar to Claude Code, but for Grok.

## Features

- Interactive chat with Grok AI for coding assistance
- File operations (read, write, edit)
- Bash command execution
- File search with glob patterns
- Content search with grep
- **Web fetching** - Fetch and parse web content
- **Streaming responses** - Real-time response streaming
- **Conversation history** - Persistent sessions with resume support
- **Permission prompts** - Approve/deny tool execution

## Installation

```bash
npm install -g grokcodecli
```

Or install from source:

```bash
git clone https://github.com/singhpratech/grokcodeclix.git
cd grokcodeclix
npm install
npm run build
npm link
```

## Setup

1. Get your API key from [xAI Console](https://console.x.ai/)

2. Run authentication:
```bash
grok auth
```

Or set the environment variable:
```bash
export XAI_API_KEY=your_api_key_here
```

## Usage

Start an interactive chat session:

```bash
grok
```

Resume the last conversation:

```bash
grok --resume
```

Resume a specific session:

```bash
grok --resume <session-id>
```

With a specific model:

```bash
grok chat --model grok-3
```

### Commands

| Command | Description |
|---------|-------------|
| `grok` | Start interactive chat (default) |
| `grok --resume` | Resume last conversation |
| `grok auth` | Set up API authentication |
| `grok config` | View/manage configuration |
| `grok config --show` | Show current settings |
| `grok config --reset` | Reset to defaults |

### In-Chat Commands

| Command | Description |
|---------|-------------|
| `/clear` | Clear conversation and start fresh |
| `/history` | Show saved conversations |
| `/save` | Save current conversation |
| `/compact` | Reduce context size (keeps last 20 messages) |
| `/stream` | Toggle streaming mode |
| `/help` | Show help |
| `exit` | Quit the CLI (auto-saves) |

## Available Tools

Grok Code has access to these tools:

- **Read** - Read file contents with line numbers
- **Write** - Create or overwrite files
- **Edit** - Edit files by string replacement
- **Bash** - Execute shell commands
- **Glob** - Find files by pattern (e.g., `**/*.ts`)
- **Grep** - Search file contents with regex
- **WebFetch** - Fetch and parse web content

## Permission System

When Grok wants to use a tool, you'll see a permission prompt:

```
┌─────────────────────────────────────────────────────┐
│ ⚡ Permission Request: Bash                         │
├─────────────────────────────────────────────────────┤
│ Execute command: npm install                        │
├─────────────────────────────────────────────────────┤
│ command: npm install                                │
└─────────────────────────────────────────────────────┘

  [y] Yes, allow once
  [a] Allow for this session
  [n] No, deny
  [!] Deny and block for session
```

Tool risk levels:
- 📖 **Read** (green) - Read-only operations
- ✏️ **Write** (yellow) - File modifications
- ⚡ **Execute** (red) - Shell commands

## Configuration

Config file location: `~/.config/grokcodecli/config.json`

Options:
- `model` - Grok model to use (default: `grok-3`)
- `temperature` - Response creativity (default: `0.7`)
- `maxTokens` - Max response length (default: `16384`)
- `autoApprove` - Tools to auto-approve (default: `[]`)

## Conversation History

Sessions are saved to: `~/.config/grokcodecli/history/`

Each session stores:
- Conversation messages
- Working directory
- Timestamps
- Auto-generated title

## Supported Models

- `grok-3` (recommended)
- `grok-2`
- `grok-1`

## License

MIT

## Contributing

Pull requests welcome! Please read the contributing guidelines first.

---

*This project was fully vibe-coded with [Claude](https://claude.ai) by Anthropic.*
