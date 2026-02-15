/**
 * Gate policy: classify actions as safe/dangerous and manage approval state.
 *
 * Ported from DannySoul bot/app.py GUI_APPROVAL_MODE + approval gate logic.
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Action classification
// ---------------------------------------------------------------------------

const DANGEROUS_ACTIONS = new Set([
  "type",
  "key",
  "hotkey",
  "click",
  "move",
  "quit",
  "approve",
  "peekaboo_agent",
  "git_push",
  "git_commit",
  "file_delete",
  "deploy",
  "restart",
]);

const SAFE_ACTIONS = new Set([
  "open",
  "activate",
  "notify",
  "screenshot",
  "wait",
  "git_status",
  "git_diff",
  "file_read",
  "file_list",
]);

export type ApprovalMode = "always" | "dangerous" | "never";

export function requiresApproval(action: string, mode: ApprovalMode): boolean {
  if (mode === "never") return false;
  if (mode === "always") return true;
  // mode === "dangerous"
  return DANGEROUS_ACTIONS.has(action);
}

export function classifyAction(action: string): "safe" | "dangerous" | "unknown" {
  if (SAFE_ACTIONS.has(action)) return "safe";
  if (DANGEROUS_ACTIONS.has(action)) return "dangerous";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Pending gate store (in-memory with TTL)
// ---------------------------------------------------------------------------

export type GateType = "patch" | "gui_plan" | "ship" | "tool_call";

export type PendingGate = {
  id: string;
  sessionId: string;
  gateType: GateType;
  action: string;
  detail: string;
  payload: unknown;
  createdAt: number;
  ttlMs: number;
};

export class PendingStore {
  private gates: Map<string, PendingGate> = new Map();
  // Maps sessionId to latest pending gate ID for quick lookup
  private bySession: Map<string, string> = new Map();

  create(params: {
    sessionId: string;
    gateType: GateType;
    action: string;
    detail: string;
    payload: unknown;
    ttlMs: number;
  }): PendingGate {
    // Evict expired gates
    this.evictExpired();

    // Cancel any existing pending gate for this session
    const existingId = this.bySession.get(params.sessionId);
    if (existingId) {
      this.gates.delete(existingId);
    }

    const gate: PendingGate = {
      id: `gate_${randomUUID().replace(/-/g, "")}`,
      sessionId: params.sessionId,
      gateType: params.gateType,
      action: params.action,
      detail: params.detail,
      payload: params.payload,
      createdAt: Date.now(),
      ttlMs: params.ttlMs,
    };

    this.gates.set(gate.id, gate);
    this.bySession.set(params.sessionId, gate.id);
    return gate;
  }

  getForSession(sessionId: string): PendingGate | null {
    this.evictExpired();
    const gateId = this.bySession.get(sessionId);
    if (!gateId) return null;
    return this.gates.get(gateId) ?? null;
  }

  approve(sessionId: string): PendingGate | null {
    const gate = this.getForSession(sessionId);
    if (!gate) return null;
    this.gates.delete(gate.id);
    this.bySession.delete(sessionId);
    return gate;
  }

  deny(sessionId: string): PendingGate | null {
    return this.approve(sessionId); // Same cleanup, different semantics
  }

  listPending(): PendingGate[] {
    this.evictExpired();
    return Array.from(this.gates.values());
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [id, gate] of this.gates) {
      if (now - gate.createdAt > gate.ttlMs) {
        this.gates.delete(id);
        if (this.bySession.get(gate.sessionId) === id) {
          this.bySession.delete(gate.sessionId);
        }
      }
    }
  }
}
