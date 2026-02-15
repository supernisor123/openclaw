/**
 * Manages multiple concurrent Claude Code sessions.
 */

import { ClaudeRunner, type ClaudeSession, type ClaudeStreamEvent } from "./claude-runner.js";

export type SessionEventHandler = (
  session: ClaudeSession,
  event: ClaudeStreamEvent,
) => void;

export class SessionManager {
  private runners: Map<string, ClaudeRunner> = new Map();
  // Maps chatId → list of session IDs for that chat
  private byChatId: Map<string, Set<string>> = new Map();
  private maxConcurrent: number;

  constructor(maxConcurrent: number = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  get activeCount(): number {
    return this.runners.size;
  }

  /**
   * Start a new Claude Code session.
   */
  start(
    params: {
      chatId: string;
      workdir: string;
      prompt: string;
      model: string;
      allowedTools?: string[];
      dangerouslySkipPermissions?: boolean;
    },
    onEvent: SessionEventHandler,
    onClose: (session: ClaudeSession, code: number | null) => void,
  ): ClaudeSession | { error: string } {
    // Check concurrent limit
    if (this.runners.size >= this.maxConcurrent) {
      return {
        error: `Max concurrent sessions reached (${this.maxConcurrent}). Use /claude stop to free a slot.`,
      };
    }

    const runner = new ClaudeRunner(params);
    const session = runner.session;

    this.runners.set(session.id, runner);

    // Track by chatId
    if (!this.byChatId.has(params.chatId)) {
      this.byChatId.set(params.chatId, new Set());
    }
    this.byChatId.get(params.chatId)!.add(session.id);

    // Wire up events
    runner.on("event", (event: ClaudeStreamEvent) => {
      onEvent(runner.session, event);
    });

    runner.on("close", (code: number | null) => {
      this.runners.delete(session.id);
      const chatSessions = this.byChatId.get(params.chatId);
      if (chatSessions) {
        chatSessions.delete(session.id);
        if (chatSessions.size === 0) this.byChatId.delete(params.chatId);
      }
      onClose(runner.session, code);
    });

    return session;
  }

  /**
   * Stop a specific session.
   */
  stop(sessionId: string): boolean {
    const runner = this.runners.get(sessionId);
    if (!runner) return false;
    runner.stop();
    return true;
  }

  /**
   * Stop all sessions for a chat.
   */
  stopForChat(chatId: string): number {
    const sessionIds = this.byChatId.get(chatId);
    if (!sessionIds) return 0;

    let stopped = 0;
    for (const id of sessionIds) {
      if (this.stop(id)) stopped++;
    }
    return stopped;
  }

  /**
   * Send input to a session's stdin.
   */
  sendInput(sessionId: string, text: string): boolean {
    const runner = this.runners.get(sessionId);
    if (!runner) return false;
    runner.sendInput(text);
    return true;
  }

  /**
   * List all active sessions.
   */
  listActive(): ClaudeSession[] {
    return Array.from(this.runners.values()).map((r) => r.session);
  }

  /**
   * List sessions for a specific chat.
   */
  listForChat(chatId: string): ClaudeSession[] {
    const sessionIds = this.byChatId.get(chatId);
    if (!sessionIds) return [];
    return Array.from(sessionIds)
      .map((id) => this.runners.get(id))
      .filter(Boolean)
      .map((r) => r!.session);
  }
}
