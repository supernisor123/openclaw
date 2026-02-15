/**
 * DialogueSession: state management for multi-agent conversations.
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DialogueMode = "direct" | "ping-pong" | "triangle";

export type DialogueMessage = {
  from: string; // agent ID or "user"
  to: string | null; // null = broadcast to all participants
  content: string;
  timestamp: number; // epoch ms
  turnNumber: number;
};

export type DialogueSession = {
  id: string; // "dlg_" + uuid
  mode: DialogueMode;
  participants: string[]; // agent IDs
  initiator: string; // "user" or agent ID
  topic: string; // conversation topic summary
  messages: DialogueMessage[];
  status: "active" | "concluded" | "timeout";
  createdAt: number;
  maxTurns: number;
};

// ---------------------------------------------------------------------------
// Session store (in-memory)
// ---------------------------------------------------------------------------

export class DialogueStore {
  private sessions: Map<string, DialogueSession> = new Map();
  // Maps OpenClaw session key → dialogue session ID
  private bySessionKey: Map<string, string> = new Map();

  create(params: {
    sessionKey: string;
    mode: DialogueMode;
    participants: string[];
    initiator: string;
    topic: string;
    maxTurns: number;
  }): DialogueSession {
    // End any existing dialogue for this session key
    const existingId = this.bySessionKey.get(params.sessionKey);
    if (existingId) {
      const existing = this.sessions.get(existingId);
      if (existing && existing.status === "active") {
        existing.status = "concluded";
      }
    }

    const session: DialogueSession = {
      id: `dlg_${randomUUID().replace(/-/g, "")}`,
      mode: params.mode,
      participants: params.participants,
      initiator: params.initiator,
      topic: params.topic,
      messages: [],
      status: "active",
      createdAt: Date.now(),
      maxTurns: params.maxTurns,
    };

    this.sessions.set(session.id, session);
    this.bySessionKey.set(params.sessionKey, session.id);
    return session;
  }

  getActiveForSession(sessionKey: string): DialogueSession | null {
    const id = this.bySessionKey.get(sessionKey);
    if (!id) return null;
    const session = this.sessions.get(id);
    if (!session || session.status !== "active") return null;
    return session;
  }

  addMessage(
    sessionId: string,
    from: string,
    content: string,
    to: string | null = null,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.messages.push({
      from,
      to,
      content,
      timestamp: Date.now(),
      turnNumber: session.messages.length + 1,
    });

    // Check max turns
    if (session.messages.length >= session.maxTurns) {
      session.status = "concluded";
    }
  }

  conclude(sessionId: string): DialogueSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    session.status = "concluded";
    return session;
  }

  concludeForSession(sessionKey: string): DialogueSession | null {
    const id = this.bySessionKey.get(sessionKey);
    if (!id) return null;
    return this.conclude(id);
  }

  listActive(): DialogueSession[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.status === "active",
    );
  }
}
