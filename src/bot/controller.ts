import crypto from "node:crypto";
import path from "node:path";
import { log } from "../config.js";
import type { Config } from "../config.js";
import type { TelegramClient, TgMessage } from "../telegram/client.js";
import type { TelegramPoller } from "../telegram/poller.js";
import type { ClaudeBridge } from "../claude/bridge.js";
import type { SessionManager } from "../claude/session.js";
import { chunkText } from "./chunker.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Minimum interval between streaming edits (ms). */
const STREAM_EDIT_INTERVAL_MS = 3_000;

export class BotController {
  private client: TelegramClient;
  private poller: TelegramPoller;
  private bridge: ClaudeBridge;
  private sessions: SessionManager;
  private config: Config;
  private userQueues = new Map<string, Promise<void>>();
  private activeQuerySessions = new Map<string, string>();

  constructor(
    client: TelegramClient,
    poller: TelegramPoller,
    bridge: ClaudeBridge,
    sessions: SessionManager,
    config: Config,
  ) {
    this.client = client;
    this.poller = poller;
    this.bridge = bridge;
    this.sessions = sessions;
    this.config = config;
  }

  async start(): Promise<void> {
    this.poller.on("message", (msg: TgMessage) => {
      this.enqueueMessage(msg);
    });
    this.poller.start();
    log.info("Bot controller started");
  }

  async stop(): Promise<void> {
    await this.poller.stop();
    this.bridge.abortAll();
    log.info("Bot controller stopped");
  }

  private enqueueMessage(msg: TgMessage): void {
    const chatId = String(msg.chat.id);
    const prev = this.userQueues.get(chatId) || Promise.resolve();
    const next = prev.then(() => this.handleMessage(msg)).catch((err) => {
      log.error(`Error handling message from ${chatId}:`, err);
    });
    this.userQueues.set(chatId, next);
  }

  private async handleMessage(msg: TgMessage): Promise<void> {
    const chatId = msg.chat.id;
    const userId = String(msg.from?.id || chatId);

    // Extract text
    let text = msg.text || "";

    // Download photo if present
    let imagePath: string | null = null;
    if (msg.photo && msg.photo.length > 0) {
      try {
        // Get largest photo
        const photo = msg.photo[msg.photo.length - 1];
        const file = await this.client.getFile(photo.file_id);
        const tempDir = path.join(this.config.stateDir, "media");
        imagePath = await this.client.downloadFile(file.file_path, tempDir);
      } catch (err) {
        log.error("Photo download failed:", err);
      }
    }

    // Build prompt with image reference
    if (imagePath) {
      if (text) {
        text = `${text}\n\n[The user sent an image. Read and analyze this image file: ${imagePath}]`;
      } else {
        text = `[The user sent an image. Read and analyze this image file: ${imagePath}]`;
      }
    }

    if (!text) return;

    log.info(`Message from ${userId}: ${text.slice(0, 100)}${text.length > 100 ? "..." : ""}`);

    // Handle /stop
    if (text === "/stop") {
      const active = this.activeQuerySessions.get(userId);
      if (active) {
        this.bridge.abort(active);
        await this.client.sendMessage(chatId, "Query stopped.");
      } else {
        await this.client.sendMessage(chatId, "No active query to stop.");
      }
      return;
    }

    // Handle commands
    const cmdResult = this.handleCommand(text);
    if (cmdResult !== null) {
      await this.client.sendMessage(chatId, cmdResult);
      if (text === "/reset") {
        this.sessions.clearSession(userId);
      }
      if (text.startsWith("/project ") && text.slice(9).trim() !== "") {
        this.sessions.clearAllSessions();
      }
      return;
    }

    // Send typing indicator
    await this.client.sendTyping(chatId);

    try {
      const existingSessionId = this.sessions.getSessionId(userId);
      const resume = !!existingSessionId;
      const sessionId = existingSessionId || this.sessions.getOrCreateSessionId(userId);
      this.activeQuerySessions.set(userId, sessionId);

      // Stream response with message editing
      const result = await this.streamQuery(chatId, userId, text, sessionId, resume);

      this.activeQuerySessions.delete(userId);

      if (result.session_id) {
        this.sessions.setSessionId(userId, result.session_id);
      }

      log.info(`Reply sent to ${userId}, cost=$${result.total_cost_usd || 0}`);
    } catch (err) {
      this.activeQuerySessions.delete(userId);
      log.error(`Claude query failed for ${userId}:`, err);
      const errMsg = err instanceof Error ? err.message : String(err);
      const userMsg = !errMsg || errMsg === "undefined"
        ? "Claude processing timed out. Please try a simpler question."
        : errMsg.slice(0, 200);
      await this.client.sendMessage(chatId, `Sorry, an error occurred: ${userMsg}`).catch(() => {});
    }
  }

  /**
   * Stream Claude's response, editing the Telegram message in-place.
   */
  private async streamQuery(
    chatId: number,
    userId: string,
    prompt: string,
    sessionId: string,
    resume: boolean,
  ): Promise<import("../claude/types.js").ClaudeResult> {
    const gen = this.bridge.queryStream(prompt, sessionId, resume);
    let fullText = "";
    let sentMessageId: number | null = null;
    let lastEditTime = 0;

    // Typing keepalive
    const typingTimer = setInterval(() => {
      this.client.sendTyping(chatId).catch(() => {});
    }, 5_000);

    try {
      while (true) {
        const { value, done } = await gen.next();

        if (done) {
          clearInterval(typingTimer);
          const result = value;

          if (result.is_error) {
            await this.client.sendMessage(chatId, `Error: ${result.result || "Claude returned an error with no details. Check terminal logs."}`);
            return result;
          }

          const finalText = result.result || fullText ||
            "No response from Claude. Please check:\n1. Run `claude -p \"hi\"` to verify Claude Code works\n2. Check model and API key configuration\n3. Check API quota";

          const chunks = chunkText(finalText, 4096);

          if (sentMessageId) {
            // Edit existing message with final text
            await this.client.editMessage(chatId, sentMessageId, chunks[0]);
          } else {
            await this.client.sendMessage(chatId, chunks[0]);
          }

          // Additional chunks as new messages
          for (let i = 1; i < chunks.length; i++) {
            await sleep(500);
            await this.client.sendMessage(chatId, chunks[i]);
          }

          return result;
        }

        // Accumulate text
        fullText += value;

        // Edit message in-place for streaming
        const now = Date.now();
        if (now - lastEditTime >= STREAM_EDIT_INTERVAL_MS && fullText.length > 10) {
          if (!sentMessageId) {
            // Send first message
            const sent = await this.client.sendMessage(chatId, fullText + " ...");
            sentMessageId = sent.message_id;
          } else {
            // Edit existing message
            await this.client.editMessage(chatId, sentMessageId, fullText + " ...").catch(() => {});
          }
          lastEditTime = Date.now();
        }
      }
    } finally {
      clearInterval(typingTimer);
    }
  }

  private handleCommand(text: string): string | null {
    if (text === "/help" || text === "/start") {
      return [
        "Claude Telegram Bot Commands:",
        "",
        "/model - Show current model",
        "/model <name> - Switch model (opus/sonnet/haiku)",
        "/budget - Show current budget",
        "/budget <n> - Set max budget per query (USD)",
        "/project - Show current project directory",
        "/project <path> - Set Claude's working directory",
        "/project clear - Clear project directory",
        "/system <text> - Set system prompt",
        "/system clear - Clear system prompt",
        "/stop - Abort current query",
        "/reset - Clear conversation history",
        "/help - Show this message",
        "",
        "Send any text or image to chat with Claude.",
      ].join("\n");
    }

    if (text === "/reset") return "Session cleared. Starting fresh.";

    if (text === "/model") return `Current model: ${this.bridge.config.model}`;
    if (text.startsWith("/model ")) {
      const model = text.slice(7).trim();
      if (!model) return `Current model: ${this.bridge.config.model}`;
      this.bridge.config.model = model;
      return `Model switched to: ${model}`;
    }

    if (text === "/budget") return `Current max budget: $${this.bridge.config.maxBudget} per query`;
    if (text.startsWith("/budget ")) {
      const val = parseFloat(text.slice(8).trim());
      if (isNaN(val) || val <= 0) return "Invalid value. Use: /budget 2.0";
      this.bridge.config.maxBudget = val;
      return `Max budget set to: $${val} per query`;
    }

    if (text === "/project") {
      return this.bridge.config.workingDir
        ? `Current project directory: ${this.bridge.config.workingDir}`
        : "No project directory set. Claude runs in bot's working directory.";
    }
    if (text.startsWith("/project ")) {
      const dir = text.slice(9).trim();
      if (dir === "clear") {
        this.bridge.config.workingDir = undefined;
        return "Project directory cleared. Claude will run in bot's working directory.\nAll sessions cleared.";
      }
      this.bridge.config.workingDir = dir;
      return `Project directory set to: ${dir}\nAll sessions cleared — conversations will start fresh in the new project.`;
    }

    if (text === "/system") {
      return this.bridge.config.systemPrompt
        ? `Current system prompt:\n${this.bridge.config.systemPrompt}`
        : "No system prompt set.";
    }
    if (text.startsWith("/system ")) {
      const prompt = text.slice(8).trim();
      if (prompt === "clear") {
        this.bridge.config.systemPrompt = undefined;
        return "System prompt cleared.";
      }
      this.bridge.config.systemPrompt = prompt;
      return `System prompt set to:\n${prompt}`;
    }

    // Don't treat other /commands as unknown — pass to Claude
    if (text.startsWith("/") && !text.startsWith("/ ")) {
      return null; // Let Claude handle unknown commands
    }

    return null;
  }
}
