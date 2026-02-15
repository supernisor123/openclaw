/**
 * Claude Code CLI subprocess runner.
 *
 * Spawns `claude` CLI with --output-format stream-json and manages the lifecycle.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClaudeSessionStatus = "running" | "waiting" | "done" | "error";

export type ClaudeSession = {
  id: string;
  chatId: string;
  workdir: string;
  status: ClaudeSessionStatus;
  startedAt: Date;
  prompt: string;
  model: string;
  pid?: number;
};

export type ClaudeStreamEvent = {
  type: string; // "assistant" | "tool_use" | "tool_result" | "error" | "result"
  subtype?: string;
  content?: string;
  tool?: string;
  toolInput?: unknown;
  result?: unknown;
  error?: string;
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export class ClaudeRunner extends EventEmitter {
  private process: ChildProcess | null = null;
  private _session: ClaudeSession;
  private buffer: string = "";

  constructor(params: {
    chatId: string;
    workdir: string;
    prompt: string;
    model: string;
    allowedTools?: string[];
    dangerouslySkipPermissions?: boolean;
  }) {
    super();

    this._session = {
      id: `cs_${randomUUID().replace(/-/g, "")}`,
      chatId: params.chatId,
      workdir: params.workdir,
      status: "running",
      startedAt: new Date(),
      prompt: params.prompt,
      model: params.model,
    };

    this.spawn(params);
  }

  get session(): ClaudeSession {
    return { ...this._session };
  }

  private spawn(params: {
    workdir: string;
    prompt: string;
    model: string;
    allowedTools?: string[];
    dangerouslySkipPermissions?: boolean;
  }): void {
    const args: string[] = [
      "--output-format",
      "stream-json",
      "-p",
      params.prompt,
    ];

    if (params.model) {
      args.push("--model", params.model);
    }

    if (params.dangerouslySkipPermissions) {
      args.push("--dangerously-skip-permissions");
    }

    if (params.allowedTools?.length) {
      for (const tool of params.allowedTools) {
        args.push("--allowedTools", tool);
      }
    }

    this.process = spawn("claude", args, {
      cwd: params.workdir,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this._session.pid = this.process.pid;

    this.process.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        this.emit("event", {
          type: "error",
          error: text,
        } as ClaudeStreamEvent);
      }
    });

    this.process.on("close", (code) => {
      this._session.status = code === 0 ? "done" : "error";
      this.emit("close", code);
    });

    this.process.on("error", (err) => {
      this._session.status = "error";
      this.emit("event", {
        type: "error",
        error: String(err),
      } as ClaudeStreamEvent);
      this.emit("close", 1);
    });
  }

  /**
   * Process buffered stdout, parsing JSON lines.
   */
  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed) as ClaudeStreamEvent;
        this.emit("event", event);
      } catch {
        // Not JSON — emit as raw text
        this.emit("event", {
          type: "assistant",
          content: trimmed,
        } as ClaudeStreamEvent);
      }
    }
  }

  /**
   * Send input to the claude process stdin (for permission responses).
   */
  sendInput(text: string): void {
    if (this.process?.stdin?.writable) {
      this.process.stdin.write(text + "\n");
    }
  }

  /**
   * Kill the claude process.
   */
  stop(): void {
    if (this.process && !this.process.killed) {
      this.process.kill("SIGTERM");
      this._session.status = "done";
    }
  }
}
