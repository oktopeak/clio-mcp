/**
 * Tool registry: the single place that knows every tool this connector ships,
 * which ones write to Clio, and how they are annotated for MCP clients.
 *
 * `registerAllTools` is used by the stdio entry point, the built-in HTTP
 * transport, and by hosts that embed the connector as a library. It wraps the
 * McpServer in a thin facade so the individual `register*Tools` modules stay
 * untouched: the facade decides whether a tool is registered at all (READ_ONLY,
 * auth mode, explicit exclusions) and injects `title` + `annotations` for every
 * tool that is.
 *
 * Fail-closed rule: a tool name that is missing from TOOL_META is treated as a
 * write tool. Add every new tool here; `registry.test.ts` enforces it.
 */
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAuthTools } from "../auth/authTools.js";
import { registerResources } from "../resources/index.js";
import { registerMatterTools } from "./matters.js";
import { registerContactTools } from "./contacts.js";
import { registerDocumentTools } from "./documents.js";
import { registerTaskTools } from "./tasks.js";
import { registerCalendarTools } from "./calendar.js";
import { registerActivityTools } from "./activities.js";
import { registerBillingTools } from "./billing.js";
import { registerNoteTools } from "./notes.js";
import { registerUserTools } from "./users.js";
import { registerAuditExportTool } from "./auditExport.js";

export interface ToolMeta {
  /** Human-readable name shown by MCP clients. */
  title: string;
  /** True when the tool never changes Clio data or local auth state. */
  readOnly: boolean;
  /** True when the tool can irreversibly change data. Defaults to !readOnly. */
  destructive?: boolean;
  /** True when repeating the call with the same args has no extra effect. Defaults to readOnly. */
  idempotent?: boolean;
}

/** Tools that write to Clio. Hidden entirely when READ_ONLY is on. */
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "create_matter",
  "upload_document",
  "create_task",
  "update_task",
  "complete_task",
  "create_calendar_entry",
  "log_time_entry",
  "create_activity",
  "create_note",
]);

/** Tools that manage the connector's own Clio login rather than Clio data. */
export const AUTH_TOOLS: ReadonlySet<string> = new Set(["auth_status", "authenticate", "logout"]);

/** The two auth tools that only make sense when the connector owns the login flow. */
const AUTH_FLOW_TOOLS: ReadonlySet<string> = new Set(["authenticate", "logout"]);

export const TOOL_META: Readonly<Record<string, ToolMeta>> = {
  // auth
  auth_status: { title: "Auth status", readOnly: true },
  authenticate: { title: "Authenticate with Clio", readOnly: false, destructive: false, idempotent: true },
  logout: { title: "Log out of Clio", readOnly: false, destructive: false, idempotent: true },
  // matters
  list_matters: { title: "List matters", readOnly: true },
  get_matter: { title: "Get matter", readOnly: true },
  create_matter: { title: "Create matter", readOnly: false },
  // contacts
  search_contacts: { title: "Search contacts", readOnly: true },
  get_contact: { title: "Get contact", readOnly: true },
  // documents
  list_documents: { title: "List documents", readOnly: true },
  get_document: { title: "Get document", readOnly: true },
  upload_document: { title: "Upload document", readOnly: false },
  // tasks
  list_tasks: { title: "List tasks", readOnly: true },
  create_task: { title: "Create task", readOnly: false },
  update_task: { title: "Update task", readOnly: false, idempotent: true },
  complete_task: { title: "Complete task", readOnly: false, idempotent: true },
  // calendar
  list_calendar_entries: { title: "List calendar entries", readOnly: true },
  list_calendars: { title: "List calendars", readOnly: true },
  create_calendar_entry: { title: "Create calendar entry", readOnly: false },
  // activities
  list_time_entries: { title: "List time entries", readOnly: true },
  log_time_entry: { title: "Log time entry", readOnly: false },
  create_activity: { title: "Create activity", readOnly: false },
  // billing
  get_billing_summary: { title: "Get billing summary", readOnly: true },
  // notes
  create_note: { title: "Create note", readOnly: false },
  // users
  list_users: { title: "List users", readOnly: true },
  get_user: { title: "Get user", readOnly: true },
  // audit
  export_audit_log: { title: "Export audit log", readOnly: true },
};

/** Registration order is stable so tool lists are deterministic across transports. */
export const REGISTRARS: ReadonlyArray<(server: McpServer) => void> = [
  registerMatterTools,
  registerContactTools,
  registerDocumentTools,
  registerTaskTools,
  registerCalendarTools,
  registerActivityTools,
  registerBillingTools,
  registerNoteTools,
  registerUserTools,
  registerAuditExportTool,
];

export interface RegisterAllToolsOptions {
  /** Hide every tool in WRITE_TOOLS. Same effect as READ_ONLY=true. */
  readOnly?: boolean;
  /**
   * "full" (default): auth_status, authenticate, logout.
   * "status": auth_status only; for hosts that run their own login flow.
   * "none": no auth tools at all.
   */
  auth?: "full" | "status" | "none";
  /** Register the compliance-notice and auth-status resources. Default true. */
  resources?: boolean;
  /** Extra tool names to leave unregistered, whatever their meta says. */
  exclude?: readonly string[];
}

/** READ_ONLY=true|1|yes turns the read-only gate on. Anything else leaves it off. */
export function isReadOnlyEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.READ_ONLY ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

/**
 * Register every tool (subject to the options) on `server` and return the
 * handles keyed by tool name. Tools that are skipped are simply never
 * registered, so they do not appear in tools/list and tools/call rejects them.
 */
export function registerAllTools(
  server: McpServer,
  opts: RegisterAllToolsOptions = {}
): Map<string, RegisteredTool> {
  const registered = new Map<string, RegisteredTool>();
  const excluded = new Set(opts.exclude ?? []);
  const authMode = opts.auth ?? "full";

  const shouldSkip = (name: string, isWrite: boolean): boolean => {
    if (excluded.has(name)) return true;
    if (opts.readOnly && isWrite) return true;
    if (authMode === "status" && AUTH_FLOW_TOOLS.has(name)) return true;
    return false;
  };

  const intercept = (name: string, config: any, cb: any): RegisteredTool | undefined => {
    const meta = TOOL_META[name];
    if (!meta) {
      console.error(`[registry] tool "${name}" is missing from TOOL_META; treating it as a write tool`);
    }
    const isWrite = WRITE_TOOLS.has(name) || (!meta ? true : false);
    if (shouldSkip(name, isWrite)) return undefined;

    const annotations = {
      readOnlyHint: meta?.readOnly ?? false,
      destructiveHint: meta?.destructive ?? isWrite,
      idempotentHint: meta?.idempotent ?? (meta?.readOnly ?? false),
      openWorldHint: true,
      ...(config?.annotations ?? {}),
    };
    const tool = server.registerTool(name, { title: meta?.title ?? name, ...config, annotations }, cb);
    registered.set(name, tool);
    return tool;
  };

  const facade = new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === "registerTool") return intercept;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  if (authMode !== "none") registerAuthTools(facade);
  if (opts.resources !== false) registerResources(facade);
  for (const registrar of REGISTRARS) registrar(facade);

  return registered;
}
