# Claude Telegram Bot

> **Claude Code Bridge Series** by [zhuxi](https://github.com/zhuxi-czx) — Bridge Claude Code to any platform
>
> [WeChat](https://github.com/zhuxi-czx/claude_wechat_bot) · [**Telegram**](https://github.com/zhuxi-czx/claude_telegram_bot) · [Discord](https://github.com/zhuxi-czx/claude_discord_bot) · [Awesome Claude Code](https://github.com/zhuxi-czx/-awesome-claude-code)

Bridge [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) CLI to Telegram — turn your Telegram into an AI-powered assistant.

```
Telegram User ←→ Telegram Bot API ←→ claude-telegram-bot ←→ Claude Code CLI (local)
```

## Features

- Text conversations with multi-turn context
- Image recognition — send photos for Claude to analyze
- Streaming replies — message updates in real-time as Claude generates
- Typing indicator while processing
- Runtime commands — switch models, set prompts from Telegram

## Prerequisites

1. [Node.js](https://nodejs.org/) >= 18
2. [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) installed and authenticated:
   ```bash
   npm install -g @anthropic-ai/claude-code
   claude    # Complete login, then exit
   ```
3. A Telegram Bot Token — talk to [@BotFather](https://t.me/BotFather) on Telegram:
   - Send `/newbot`
   - Follow the prompts
   - Copy the token

## Quick Start

```bash
# Clone
git clone https://github.com/zhuxi-czx/claude_telegram_bot.git
cd claude_telegram_bot

# Install dependencies
npm install

# Configure
cp .env.example .env
# Edit .env and paste your TELEGRAM_BOT_TOKEN

# Trust working directory for Claude Code (first time only)
claude    # Select trust, then Ctrl+C to exit

# Start
npm run dev
```

That's it. Open your bot on Telegram and start chatting.

## Background Running

```bash
# Run in background
nohup npx tsx src/cli.ts start > bot.log 2>&1 & disown

# View logs
tail -f bot.log

# Check status
pgrep -f "tsx src/cli.ts" && echo "running" || echo "stopped"

# Stop
kill $(pgrep -f "tsx src/cli.ts")
```

## Telegram Commands

| Command | Description |
|---|---|
| `/model` | Show current model |
| `/model opus` | Switch model (opus / sonnet / haiku) |
| `/budget` | Show current budget |
| `/budget 2.0` | Set max budget per query (USD) |
| `/system <text>` | Set system prompt |
| `/system clear` | Clear system prompt |
| `/stop` | Abort current query |
| `/reset` | Clear conversation history |
| `/help` | Show all commands |

## Configuration

Edit `.env` file:

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | *required* | Bot token from @BotFather |
| `CLAUDE_MODEL` | `sonnet` | Model: `opus` / `sonnet` / `haiku` |
| `CLAUDE_SYSTEM_PROMPT` | - | Custom system prompt |
| `CLAUDE_MAX_BUDGET` | `1.0` | Max cost per query (USD) |
| `CLAUDE_PERMISSION_MODE` | `default` | Claude CLI permission mode |
| `CLAUDE_TIMEOUT_MS` | `600000` | Query timeout (ms, default 10 min) |
| `CLAUDE_MAX_CONCURRENT` | `3` | Max concurrent Claude processes |
| `STATE_DIR` | `./data` | Data directory |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

### About Claude Permission Mode

`CLAUDE_PERMISSION_MODE` controls what tools Claude can use:

- `default` — Standard permissions. Make sure to trust the project directory first by running `claude` in it
- `auto` — More permissive, auto-approves tool use

If Claude replies with permission errors, try `CLAUDE_PERMISSION_MODE=auto`.

## How It Works

1. Bot connects to Telegram via long-polling (`getUpdates`)
2. User messages are forwarded to `claude -p` (Claude Code CLI) as subprocesses
3. Claude's response is sent back, with real-time message editing for streaming
4. Photos are downloaded and passed to Claude for visual analysis
5. Per-user sessions are maintained via `--resume` for multi-turn conversations

## Related Projects

- [claude_wechat_bot](https://github.com/zhuxi-czx/claude_wechat_bot) — Bridge Claude Code to WeChat
- [claude_discord_bot](https://github.com/zhuxi-czx/claude_discord_bot) — Bridge Claude Code to Discord

## Feedback

- [GitHub Issues](https://github.com/zhuxi-czx/claude_telegram_bot/issues)
- Email: [zhuxi.czx@gmail.com](mailto:zhuxi.czx@gmail.com)

## License

MIT License - Copyright (c) 2026 [zhuxi](https://github.com/zhuxi-czx)
