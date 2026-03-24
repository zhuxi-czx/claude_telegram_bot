import { EventEmitter } from "node:events";
import { log } from "../config.js";
import type { TelegramClient, TgMessage } from "./client.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TelegramPoller extends EventEmitter {
  private client: TelegramClient;
  private running = false;
  private offset = 0;
  private consecutiveErrors = 0;

  constructor(client: TelegramClient) {
    super();
    this.client = client;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    log.info("Telegram poller started");
    this.poll();
  }

  async stop(): Promise<void> {
    this.running = false;
    log.info("Telegram poller stopped");
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.client.getUpdates(this.offset);
        this.consecutiveErrors = 0;

        for (const update of updates) {
          this.offset = update.update_id + 1;
          if (update.message) {
            this.emit("message", update.message);
          }
        }
      } catch (err) {
        this.consecutiveErrors++;
        log.error("Poll error:", err);

        if (this.consecutiveErrors >= 3) {
          this.consecutiveErrors = 0;
          await sleep(30_000);
        } else {
          await sleep(3_000);
        }
      }
    }
  }
}
