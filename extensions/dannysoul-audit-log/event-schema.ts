/**
 * Event schema for the append-only audit log.
 *
 * Ported from DannySoul bot/soul/events.py
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const VALID_ACTORS = ["user", "bot", "node", "system"] as const;
export type Actor = (typeof VALID_ACTORS)[number];

export const VALID_KINDS = [
  "intent",
  "tool_call",
  "tool_result",
  "gate_requested",
  "gate_result",
  "error",
  "info",
] as const;
export type EventKind = (typeof VALID_KINDS)[number];

export type AuditEvent = {
  event_id: string; // "evt_" + uuid
  ts: string; // ISO 8601 UTC
  session_id: string; // OpenClaw session ID (generalized from chat_id)
  actor: Actor;
  kind: EventKind;
  tool: string; // tool name or ""
  detail: string; // human-readable description
  flow_id: string; // groups related events
  duration_ms: number; // 0 if n/a
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createEvent(params: {
  sessionId: string;
  actor: Actor;
  kind: EventKind;
  tool?: string;
  detail?: string;
  flowId?: string;
  durationMs?: number;
}): AuditEvent {
  return {
    event_id: `evt_${randomUUID().replace(/-/g, "")}`,
    ts: new Date().toISOString(),
    session_id: params.sessionId,
    actor: params.actor,
    kind: params.kind,
    tool: params.tool ?? "",
    detail: params.detail ?? "",
    flow_id: params.flowId ?? "",
    duration_ms: params.durationMs ?? 0,
  };
}

export function formatEventLine(event: AuditEvent): string {
  const ts = event.ts.slice(0, 19);
  const dur = event.duration_ms > 0 ? ` (${event.duration_ms}ms)` : "";
  const tool = event.tool ? `: ${event.tool}` : "";
  const detail = event.detail ? ` "${event.detail}"` : "";
  return `[${ts}] ${event.actor} ${event.kind}${tool}${dur}${detail}`;
}
