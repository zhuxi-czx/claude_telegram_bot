#!/usr/bin/env node

import path from "node:path";
import { loadConfig, setLogLevel, log } from "./config.js";
import { StateStore } from "./state/store.js";
import { TelegramClient } from "./telegram/client.js";
import { TelegramPoller } from "./telegram/poller.js";
import { ClaudeBridge } from "./claude/bridge.js";
import { SessionManager } from "./claude/session.js";
import { BotController } from "./bot/controller.js";

const BANNER = `Claude Telegram Bot v1.0.0 — by zhuxi <zhuxi.czx@gmail.com>`;

const HELP = `
${BANNER}

Usage:
  claude-telegram-bot start    Start the bot
  claude-telegram-bot help     Show this help

Setup:
  1. Talk to @BotFather on Telegram to create a bot and get a token
  2. Set TELEGRAM_BOT_TOKEN in .env file
  3. Run: npm run dev

Environment variables (or .env file):
  TELEGRAM_BOT_TOKEN    Bot token from @BotFather (required)
  CLAUDE_MODEL          Model to use (default: sonnet)
  CLAUDE_SYSTEM_PROMPT  Custom system prompt
  LOG_LEVEL             debug/info/warn/error (default: info)
`;

async function cmdStart(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  console.log(BANNER);

  const client = new TelegramClient(config.telegram.token);

  // Verify bot token
  try {
    const me = await client.getMe();
    log.info(`Bot authenticated: @${me.username} (${me.first_name})`);
  } catch (err) {
    console.error("Failed to authenticate with Telegram. Check your TELEGRAM_BOT_TOKEN.");
    process.exit(1);
  }

  const store = new StateStore(config.stateDir);

  // Grant Claude access to media directory
  const mediaDir = path.resolve(config.stateDir, "media");
  config.claude.addDirs = [mediaDir];

  const sessions = new SessionManager(store);
  const bridge = new ClaudeBridge(config.claude);
  const poller = new TelegramPoller(client);
  const controller = new BotController(client, poller, bridge, sessions, config);

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Received ${signal}, shutting down...`);
    await controller.stop();
    store.flush();
    log.info("Goodbye!");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await controller.start();
  log.info("Bot is running. Press Ctrl+C to stop.");
}

async function main(): Promise<void> {
  const command = process.argv[2] || "start";

  switch (command) {
    case "start":
      await cmdStart();
      break;
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
