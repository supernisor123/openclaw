/**
 * Output streamer: converts Claude CLI stream-json events into
 * Telegram-friendly message batches.
 *
 * Features:
 * - Merges consecutive assistant text events
 * - Truncates long tool output
 * - Batches low-priority events to avoid Telegram rate limits
 * - Highlights important events (errors, tool calls)
 */

import type { ClaudeStreamEvent } from "./claude-runner.js";

export type OutputMessage = {
  text: string;
  priority: "high" | "normal" | "low";
};

export class OutputStreamer {
  private buffer: string[] = [];
  private lastFlush: number = Date.now();
  private readonly batchIntervalMs: number;
  private readonly maxCharsPerMessage: number;

  constructor(batchIntervalMs: number = 2000, maxCharsPerMessage: number = 3000) {
    this.batchIntervalMs = batchIntervalMs;
    this.maxCharsPerMessage = maxCharsPerMessage;
  }

  /**
   * Process a stream event and return messages ready to send.
   * Returns empty array if messages should be batched.
   */
  processEvent(event: ClaudeStreamEvent): OutputMessage[] {
    const messages: OutputMessage[] = [];

    switch (event.type) {
      case "assistant": {
        if (event.content) {
          this.buffer.push(event.content);
        }
        // Check if buffer should be flushed
        if (this.shouldFlush()) {
          const flushed = this.flush();
          if (flushed) {
            messages.push({ text: flushed, priority: "normal" });
          }
        }
        break;
      }

      case "tool_use": {
        // Flush any pending text first
        const pending = this.flush();
        if (pending) {
          messages.push({ text: pending, priority: "normal" });
        }

        const toolName = event.tool ?? "unknown";
        const inputSummary = this.summarizeToolInput(event.toolInput);
        messages.push({
          text: `🔧 **${toolName}**\n${inputSummary}`,
          priority: "low",
        });
        break;
      }

      case "tool_result": {
        const resultText = this.truncateOutput(String(event.result ?? ""));
        if (resultText) {
          messages.push({
            text: `📋 ${resultText}`,
            priority: "low",
          });
        }
        break;
      }

      case "error": {
        const pending2 = this.flush();
        if (pending2) {
          messages.push({ text: pending2, priority: "normal" });
        }
        messages.push({
          text: `❌ **Error**: ${event.error ?? "Unknown error"}`,
          priority: "high",
        });
        break;
      }

      case "result": {
        const pending3 = this.flush();
        if (pending3) {
          messages.push({ text: pending3, priority: "normal" });
        }
        messages.push({
          text: `✅ **Done**`,
          priority: "high",
        });
        break;
      }
    }

    return messages;
  }

  /**
   * Force-flush any remaining buffered content.
   */
  forceFlush(): OutputMessage | null {
    const text = this.flush();
    if (!text) return null;
    return { text, priority: "normal" };
  }

  private shouldFlush(): boolean {
    const totalLen = this.buffer.reduce((sum, s) => sum + s.length, 0);
    const elapsed = Date.now() - this.lastFlush;
    return totalLen >= this.maxCharsPerMessage || elapsed >= this.batchIntervalMs;
  }

  private flush(): string | null {
    if (this.buffer.length === 0) return null;
    const text = this.buffer.join("");
    this.buffer = [];
    this.lastFlush = Date.now();
    return this.truncateOutput(text);
  }

  private truncateOutput(text: string): string {
    if (text.length <= this.maxCharsPerMessage) return text;
    return text.slice(0, this.maxCharsPerMessage - 20) + "\n... (truncated)";
  }

  private summarizeToolInput(input: unknown): string {
    if (!input) return "";
    if (typeof input === "string") return this.truncateOutput(input);
    try {
      const str = JSON.stringify(input, null, 2);
      return this.truncateOutput(str);
    } catch {
      return "(unable to serialize input)";
    }
  }
}
