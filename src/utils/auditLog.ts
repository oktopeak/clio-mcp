/**
 * Audit log.
 *
 * Every tool call is recorded through `appendAuditLog`. Where the record goes
 * is decided by the configured sink: by default a JSONL file under
 * `~/.clio-mcp/audit.log`, or whatever a host passes to `configureAudit`
 * (a database, a per-tenant store, an in-memory buffer in tests).
 *
 * What gets recorded is decided by an allowlist, not a denylist: for each tool
 * only the argument keys listed in AUDIT_ARG_ALLOWLIST are written verbatim
 * (ids, limits, dates, page tokens, enums, booleans). Every other key that was
 * present is replaced with "[redacted]", so the log shows *which* arguments
 * were passed without ever containing client names, note text, search
 * queries, file paths or descriptions. Unknown tool names get every key
 * redacted.
 */
import fs from "fs/promises";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { loadTokens } from "../auth/tokenStorage.js";
import { getSessionContext, isStdioMode } from "./sessionContext.js";

const STDIO_SESSION_ID = randomUUID();

const AUDIT_DIR = path.join(os.homedir(), ".clio-mcp");
export const DEFAULT_AUDIT_FILE = path.join(AUDIT_DIR, "audit.log");

export const REDACTED = "[redacted]";

/** Keys that are always masked, whatever the allowlist says (legacy secret guard). */
const SECRET_KEYS = new Set([
  "access_token", "refresh_token", "client_secret", "password", "token", "encryption_key",
]);

let machineIpCache: string | undefined | null = null;
function detectMachineIp(): string | undefined {
  if (machineIpCache !== null) return machineIpCache;
  machineIpCache = undefined;
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        machineIpCache = addr.address;
        return machineIpCache;
      }
    }
  }
  return machineIpCache;
}

export interface AuditEntry {
  timestamp: string;
  session_id: string;
  /** LAN IPv4 of the host. Recorded in stdio mode only (meaningless inside a container). */
  machine_ip?: string;
  /** Identity of the caller as known to the host (hosted deployments). */
  user_id?: string;
  /** Correlates the entry with the host's request log (hosted deployments). */
  request_id?: string;
  tool: string;
  /** Allowlisted arguments verbatim; everything else present becomes "[redacted]". */
  args: Record<string, unknown>;
  outcome: "success" | "error" | "not_found";
  error_message?: string;
  clio_user_id?: string;
  matter_id?: number;
  result_count?: number;
}

export interface AuditFilter {
  date_from?: string;
  date_to?: string;
  matter_id?: number;
  limit?: number;
  offset?: number;
  /** Restrict to one caller. Injected automatically from the session context when it carries a userId. */
  user_id?: string;
  session_id?: string;
}
/** @deprecated Use AuditFilter. Kept for 2.x compatibility. */
export type AuditLogFilter = AuditFilter;

export interface AuditReadResult {
  entries: AuditEntry[];
  total_matched: number;
}

export interface ReadAuditLogResult extends AuditReadResult {
  truncated: boolean;
}

export interface AuditSink {
  append(entry: AuditEntry): Promise<void>;
  read(filter: AuditFilter & { limit: number; offset: number }): Promise<AuditReadResult>;
}

/** tool name -> argument keys that may be written to the log verbatim. */
export type RedactPolicy = Readonly<Record<string, readonly string[]>>;

/**
 * Audit keys that are DERIVED from an argument rather than being one.
 *
 * A tool may log a summary of an input instead of the input itself. `update_matter`
 * accepts `custom_field_values`, which carry the values a firm vets cases on, and
 * logs `custom_field_ids`, which say which fields were touched without saying what
 * they were set to. Such a key by definition cannot appear in the tool's
 * inputSchema, so the "allowlisted keys must be real inputs" invariant has to be
 * told about it.
 *
 * Adding a key here is deliberate and reviewable. Everything in this set must be
 * ids or counts; `auditRedaction.test.ts` enforces that separately, so this stays
 * a narrow exception rather than a way around the guard.
 */
export const DERIVED_AUDIT_KEYS: ReadonlySet<string> = new Set(["custom_field_ids"]);

export const AUDIT_ARG_ALLOWLIST: RedactPolicy = {
  // auth and OAuth callback: no arguments
  auth_status: [],
  authenticate: [],
  logout: [],
  oauth_callback: [],
  // matters
  list_matters: ["status", "limit"],
  get_matter: ["matter_id"],
  create_matter: ["client_id", "practice_area_id", "status", "open_date", "billable", "responsible_attorney_id", "originating_attorney_id", "custom_field_ids"],
  update_matter: ["matter_id", "client_id", "practice_area_id", "status", "open_date", "billable", "responsible_attorney_id", "originating_attorney_id", "custom_field_ids"],
  matter_activity_summary: ["lookback_days", "calendar_days_ahead", "practice_area_id", "stale_after_days", "limit"],
  // custom fields (definitions only; a field's VALUES are client data)
  list_custom_fields: ["parent_type", "include_deleted"],
  // relationships (never the contact name or role label)
  list_matter_relationships: ["matter_id", "limit", "page_token"],
  // contacts (never the query string)
  search_contacts: ["limit", "page_token"],
  get_contact: ["contact_id"],
  // documents (never the query, the file path or the file name)
  list_documents: ["matter_id", "parent_id", "limit", "page_token"],
  get_document: ["document_id"],
  upload_document: ["matter_id", "content_type"],
  // folders (never the folder name or the search query, which are usually client names)
  list_folders: ["matter_id", "parent_id", "limit", "page_token"],
  folder_exists: ["matter_id", "parent_folder_id"],
  create_folder: ["matter_id", "parent_folder_id", "if_not_exists"],
  // tasks (never name or description)
  list_tasks: ["matter_id", "status", "due_date_start", "due_date_end", "limit"],
  create_task: ["matter_id", "priority", "due_date", "assignee_id"],
  update_task: ["task_id", "priority", "due_date", "status", "assignee_id"],
  complete_task: ["task_id"],
  // calendar (never summary, description or location)
  list_calendar_entries: ["from", "to"],
  list_calendars: [],
  create_calendar_entry: ["start_at", "end_at", "calendar_owner_id", "all_day", "matter_id", "send_email_notification", "attendee_ids"],
  // time entries and activities (never the note or reference text)
  list_time_entries: ["matter_id", "start_date", "end_date", "limit"],
  log_time_entry: ["matter_id", "date", "quantity_in_hours", "price", "non_billable", "no_charge", "activity_description_id", "user_id"],
  create_activity: ["type", "date", "matter_id", "quantity_in_hours", "price", "non_billable", "no_charge", "activity_description_id", "user_id", "tax_setting"],
  // billing
  get_billing_summary: ["matter_id"],
  // notes (never subject or body)
  create_note: ["matter_id"],
  list_notes: ["matter_id", "contact_id", "created_since", "updated_since", "limit", "page_token"],
  // users (never the name filter)
  list_users: ["subscription_type", "enabled", "limit"],
  get_user: ["user_id"],
  // audit
  export_audit_log: ["date_from", "date_to", "matter_id", "limit", "offset"],
};

function redactSecretsDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.has(k.toLowerCase()) ? REDACTED : redactSecretsDeep(v);
  }
  return out;
}

/**
 * Apply the allowlist for `tool` to `args`. Keys with an `undefined` value are
 * dropped (they were not passed). Allowed keys keep their value (secret-named
 * nested keys are still masked); every other key becomes "[redacted]".
 */
export function redactAuditArgs(
  tool: string,
  args: Record<string, unknown>,
  policy: RedactPolicy = auditConfig.redact
): Record<string, unknown> {
  const allowed = policy[tool];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    if (v === undefined) continue;
    if (SECRET_KEYS.has(k.toLowerCase())) { out[k] = REDACTED; continue; }
    if (!allowed || !allowed.includes(k)) { out[k] = REDACTED; continue; }
    out[k] = redactSecretsDeep(v);
  }
  return out;
}

/** The default sink: one JSON object per line, appended to a file. */
export function createFileAuditSink(file: string = DEFAULT_AUDIT_FILE): AuditSink {
  return {
    async append(entry) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, JSON.stringify(entry) + "\n", "utf8");
    },
    async read(filter) {
      let raw: string;
      try {
        raw = await fs.readFile(file, "utf8");
      } catch (err: any) {
        if (err.code === "ENOENT") return { entries: [], total_matched: 0 };
        throw err;
      }
      const matched: AuditEntry[] = [];
      for (const line of raw.split("\n")) {
        if (!line) continue;
        let entry: Partial<AuditEntry>;
        try { entry = JSON.parse(line); } catch { continue; }
        if (filter.date_from && (!entry.timestamp || entry.timestamp.slice(0, 10) < filter.date_from)) continue;
        if (filter.date_to && (!entry.timestamp || entry.timestamp.slice(0, 10) > filter.date_to)) continue;
        if (filter.matter_id !== undefined && entry.matter_id !== filter.matter_id) continue;
        if (filter.user_id !== undefined && entry.user_id !== filter.user_id) continue;
        if (filter.session_id !== undefined && entry.session_id !== filter.session_id) continue;
        matched.push(entry as AuditEntry);
      }
      return {
        entries: matched.slice(filter.offset, filter.offset + filter.limit),
        total_matched: matched.length,
      };
    },
  };
}

interface AuditConfig {
  sink: AuditSink;
  redact: RedactPolicy;
  /** Force machine_ip on/off. Defaults to "only in stdio mode". */
  includeMachineIp?: boolean;
}

const auditConfig: AuditConfig = {
  sink: createFileAuditSink(),
  redact: AUDIT_ARG_ALLOWLIST,
};

/** Replace the sink and/or the redaction policy. Hosts call this once at startup. */
export function configureAudit(options: Partial<AuditConfig>): void {
  if (options.sink) auditConfig.sink = options.sink;
  if (options.redact) auditConfig.redact = options.redact;
  if ("includeMachineIp" in options) auditConfig.includeMachineIp = options.includeMachineIp;
}

/** Back to the file sink and the built-in allowlist. Used by tests. */
export function resetAudit(): void {
  auditConfig.sink = createFileAuditSink();
  auditConfig.redact = AUDIT_ARG_ALLOWLIST;
  delete auditConfig.includeMachineIp;
}

export async function appendAuditLog(
  entry: Omit<AuditEntry, "timestamp" | "session_id" | "machine_ip" | "clio_user_id" | "user_id" | "request_id">
    & { clio_user_id?: string; result_count?: number }
): Promise<void> {
  try {
    const ctx = getSessionContext();
    const stdio = isStdioMode();
    const session_id = ctx?.sessionId ?? STDIO_SESSION_ID;

    let clio_user_id = entry.clio_user_id ?? ctx?.clioUserId;
    if (!clio_user_id) {
      if (ctx) {
        try { clio_user_id = (await ctx.getTokens())?.clio_user_id; } catch { /* non-fatal */ }
      } else if (stdio) {
        try { clio_user_id = (await loadTokens())?.clio_user_id; } catch { /* non-fatal */ }
      }
    }

    const includeIp = auditConfig.includeMachineIp ?? stdio;
    const machine_ip = includeIp ? detectMachineIp() : undefined;

    const full: AuditEntry = {
      timestamp: new Date().toISOString(),
      session_id,
      ...(machine_ip !== undefined && { machine_ip }),
      ...(ctx?.userId && { user_id: ctx.userId }),
      ...(ctx?.requestId && { request_id: ctx.requestId }),
      tool: entry.tool,
      args: redactAuditArgs(entry.tool, entry.args),
      outcome: entry.outcome,
      ...(entry.error_message && { error_message: entry.error_message }),
      ...(clio_user_id && { clio_user_id }),
      ...(entry.matter_id !== undefined && { matter_id: entry.matter_id }),
      ...(entry.result_count !== undefined && { result_count: entry.result_count }),
    };

    await auditConfig.sink.append(full);
  } catch (err: any) {
    console.error(`[audit] WARNING: Failed to write audit log: ${err.message}`);
  }
}

/**
 * Read entries through the configured sink. When the session context carries a
 * userId (hosted deployments) the read is scoped to that user unless the
 * filter names one explicitly.
 */
export async function readAuditLog(filter: AuditFilter = {}): Promise<ReadAuditLogResult> {
  const limit = Math.min(filter.limit ?? 500, 1000);
  const offset = filter.offset ?? 0;
  const ctx = getSessionContext();
  const user_id = filter.user_id ?? ctx?.userId;

  const result = await auditConfig.sink.read({
    ...filter,
    ...(user_id !== undefined && { user_id }),
    limit,
    offset,
  });

  return {
    entries: result.entries,
    total_matched: result.total_matched,
    truncated: offset + result.entries.length < result.total_matched,
  };
}
