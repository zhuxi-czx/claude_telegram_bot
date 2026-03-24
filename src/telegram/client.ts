import fs from "node:fs";
import path from "node:path";
import { log } from "../config.js";

const API_BASE = "https://api.telegram.org/bot";
const TIMEOUT_MS = 60_000;

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

export interface TgMessage {
  message_id: number;
  chat: { id: number; type: string; title?: string };
  from?: { id: number; first_name: string; username?: string };
  text?: string;
  photo?: { file_id: string; file_size?: number; width: number; height: number }[];
  voice?: { file_id: string; duration: number };
  reply_to_message?: TgMessage;
}

export interface TgSentMessage {
  message_id: number;
  chat: { id: number };
}

export class TelegramClient {
  private token: string;
  private baseUrl: string;

  constructor(token: string) {
    this.token = token;
    this.baseUrl = `${API_BASE}${token}`;
  }

  private async api<T>(method: string, body?: object, timeoutMs = TIMEOUT_MS): Promise<T> {
    const url = `${this.baseUrl}/${method}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await res.json() as { ok: boolean; result: T; description?: string };
      if (!data.ok) {
        throw new Error(`Telegram API error: ${data.description || "unknown"}`);
      }
      return data.result;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  async getUpdates(offset?: number): Promise<TgUpdate[]> {
    return this.api<TgUpdate[]>("getUpdates", {
      offset,
      timeout: 30,
      allowed_updates: ["message"],
    }, 45_000); // 30s server timeout + 15s buffer
  }

  async sendMessage(chatId: number, text: string, parseMode?: string): Promise<TgSentMessage> {
    return this.api<TgSentMessage>("sendMessage", {
      chat_id: chatId,
      text: text.slice(0, 4096),
      parse_mode: parseMode,
    });
  }

  async editMessage(chatId: number, messageId: number, text: string, parseMode?: string): Promise<void> {
    await this.api("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: text.slice(0, 4096),
      parse_mode: parseMode,
    }).catch((err) => {
      // "message is not modified" is not a real error
      if (String(err).includes("message is not modified")) return;
      throw err;
    });
  }

  async sendTyping(chatId: number): Promise<void> {
    await this.api("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  }

  async getFile(fileId: string): Promise<{ file_path: string }> {
    return this.api<{ file_path: string }>("getFile", { file_id: fileId });
  }

  async downloadFile(filePath: string, destDir: string): Promise<string> {
    const url = `https://api.telegram.org/file/bot${this.token}/${filePath}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);

    const buf = Buffer.from(await res.arrayBuffer());
    const ext = path.extname(filePath) || ".jpg";
    const filename = `tg_${Date.now()}${ext}`;
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, filename);
    fs.writeFileSync(dest, buf);
    log.info(`Photo downloaded: ${dest} (${buf.length} bytes)`);
    return dest;
  }

  async getMe(): Promise<{ id: number; first_name: string; username: string }> {
    return this.api("getMe");
  }
}
