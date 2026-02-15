/**
 * Append-only JSONL writer with automatic file rotation.
 *
 * Ported from DannySoul bot/soul/events.py EventLog class.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import type { AuditEvent } from "./event-schema.js";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10MB
const LOG_FILENAME = "events.jsonl";

export class JsonlWriter {
  private readonly logDir: string;
  private readonly maxFileBytes: number;

  constructor(logDir: string, maxFileBytes?: number) {
    this.logDir = logDir;
    this.maxFileBytes = maxFileBytes ?? DEFAULT_MAX_BYTES;
    mkdirSync(this.logDir, { recursive: true });
  }

  private get logPath(): string {
    return join(this.logDir, LOG_FILENAME);
  }

  /**
   * Append an event as a JSON line to the log file.
   */
  append(event: AuditEvent): void {
    this.maybeRotate();
    const line = JSON.stringify(event) + "\n";
    appendFileSync(this.logPath, line, "utf-8");
  }

  /**
   * Read the last N events from the current log file.
   */
  readTail(n: number = 20): AuditEvent[] {
    const path = this.logPath;
    if (!existsSync(path)) return [];

    try {
      const size = statSync(path).size;
      if (size === 0) return [];

      // For small files, read the whole thing
      const content = readFileSync(path, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());
      const tail = lines.slice(-n);

      const events: AuditEvent[] = [];
      for (const line of tail) {
        try {
          events.push(JSON.parse(line) as AuditEvent);
        } catch {
          // Skip malformed lines
        }
      }
      return events;
    } catch {
      return [];
    }
  }

  /**
   * Rotate the log file if it exceeds maxFileBytes.
   *
   * events.jsonl → events.jsonl.1, .1 → .2, etc.
   */
  private maybeRotate(): void {
    const path = this.logPath;
    if (!existsSync(path)) return;

    try {
      if (statSync(path).size < this.maxFileBytes) return;
    } catch {
      return;
    }

    // Find highest existing rotation index
    let idx = 1;
    while (existsSync(join(this.logDir, `${LOG_FILENAME}.${idx}`))) {
      idx++;
    }

    // Shift from highest to lowest
    while (idx > 1) {
      const src = join(this.logDir, `${LOG_FILENAME}.${idx - 1}`);
      const dst = join(this.logDir, `${LOG_FILENAME}.${idx}`);
      if (existsSync(src)) {
        renameSync(src, dst);
      }
      idx--;
    }

    // Move current → .1
    renameSync(path, join(this.logDir, `${LOG_FILENAME}.1`));
  }
}
