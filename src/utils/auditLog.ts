import fs from "fs/promises";
import path from "path";
import os from "os";
import { loadTokens } from "../auth/tokenStorage.js";

const AUDIT_DIR = path.join(os.homedir(), ".clio-mcp");
const AUDIT_FILE = path.join(AUDIT_DIR, "audit.log");

const REDACTED_KEYS = new Set([
  "access_token", "refresh_token", "client_secret", "password", "token", "encryption_key",
]);

export interface AuditEntry {
  timestamp: string;
  tool: string;
  args: Record<string, unknown>;
  outcome: "success" | "error";
  error_message?: string;
  clio_user_id?: string;
  matter_id?: number;
}

function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (REDACTED_KEYS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redactArgs(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function appendAuditLog(
  entry: Omit<AuditEntry, "timestamp" | "clio_user_id"> & { clio_user_id?: string }
): Promise<void> {
  try {
    await fs.mkdir(AUDIT_DIR, { recursive: true });

    let clio_user_id = entry.clio_user_id;
    if (!clio_user_id) {
      try { clio_user_id = (await loadTokens())?.clio_user_id; } catch { /* non-fatal */ }
    }

    const full: AuditEntry = {
      timestamp: new Date().toISOString(),
      tool: entry.tool,
      args: redactArgs(entry.args),
      outcome: entry.outcome,
      ...(entry.error_message && { error_message: entry.error_message }),
      ...(clio_user_id && { clio_user_id }),
      ...(entry.matter_id !== undefined && { matter_id: entry.matter_id }),
    };

    await fs.appendFile(AUDIT_FILE, JSON.stringify(full) + "\n", "utf8");
  } catch (err: any) {
    console.error(`[audit] WARNING: Failed to write audit log: ${err.message}`);
  }
}
