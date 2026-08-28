import { vi, describe, it, expect } from "vitest";

vi.mock("@napi-rs/keyring", () => ({
  Entry: class {
    getPassword() { return null; }
    setPassword() {}
    deletePassword() {}
  },
}));

import { redactAuditArgs, AUDIT_ARG_ALLOWLIST, REDACTED } from "../auditLog.js";
import { TOOL_META, REGISTRARS } from "../../tools/index.js";
import { registerAuthTools } from "../../auth/authTools.js";

/** Free-text argument names that must never be allowlisted for any tool. */
const FREE_TEXT_KEYS = [
  "query", "description", "name", "note", "subject", "body", "summary",
  "location", "reference", "client_reference", "file_path",
];

/** Capture every tool's real inputSchema keys by running the registrars against a fake server. */
function collectSchemaKeys(): Record<string, string[]> {
  const keys: Record<string, string[]> = {};
  const fake = {
    registerTool: (name: string, config: any) => {
      keys[name] = Object.keys(config?.inputSchema ?? {});
    },
    registerResource: () => {},
  };
  registerAuthTools(fake as any);
  for (const r of REGISTRARS) r(fake as any);
  return keys;
}

describe("AUDIT_ARG_ALLOWLIST", () => {
  const schemaKeys = collectSchemaKeys();

  it("has an entry for every tool in TOOL_META (plus oauth_callback)", () => {
    for (const name of Object.keys(TOOL_META)) {
      expect(AUDIT_ARG_ALLOWLIST[name], `allowlist is missing "${name}"`).toBeDefined();
    }
    expect(AUDIT_ARG_ALLOWLIST.oauth_callback).toEqual([]);
  });

  it("only lists keys that exist in the tool's real inputSchema", () => {
    for (const [tool, allowed] of Object.entries(AUDIT_ARG_ALLOWLIST)) {
      if (tool === "oauth_callback") continue;
      expect(schemaKeys[tool], `no registrar produced "${tool}"`).toBeDefined();
      for (const k of allowed) {
        expect(schemaKeys[tool], `${tool}.${k} is allowlisted but not in its inputSchema`).toContain(k);
      }
    }
  });

  it("never allowlists a free-text key for any tool", () => {
    for (const [tool, allowed] of Object.entries(AUDIT_ARG_ALLOWLIST)) {
      for (const k of allowed) {
        expect(FREE_TEXT_KEYS, `${tool}.${k} is free text and must not be logged`).not.toContain(k);
      }
    }
  });
});

describe("redactAuditArgs", () => {
  it("keeps allowlisted keys and redacts the rest", () => {
    const out = redactAuditArgs("search_contacts", { query: "Jane Doe", limit: 20, page_token: "abc" });
    expect(out).toEqual({ query: REDACTED, limit: 20, page_token: "abc" });
  });

  it("drops keys whose value is undefined instead of redacting them", () => {
    const out = redactAuditArgs("list_matters", { status: "open", limit: undefined });
    expect(out).toEqual({ status: "open" });
    expect("limit" in out).toBe(false);
  });

  it.each([
    ["log_time_entry", { matter_id: 1, date: "2026-01-01", quantity_in_hours: 0.5, note: "Called opposing counsel" }, ["note"]],
    ["create_note", { matter_id: 1, subject: "Strategy", body: "Client wants to settle" }, ["subject", "body"]],
    ["create_task", { matter_id: 1, name: "File motion", description: "By Friday", priority: "High" }, ["name", "description"]],
    ["create_calendar_entry", { summary: "Deposition of J. Doe", start_at: "2026-01-01", end_at: "2026-01-01", calendar_owner_id: 5, description: "Room 4", location: "Court" }, ["summary", "description", "location"]],
    ["create_matter", { client_id: 9, description: "Doe v. Roe", client_reference: "DR-1", status: "open" }, ["description", "client_reference"]],
    ["upload_document", { file_path: "/Users/x/secret.pdf", matter_id: 1, name: "secret.pdf", content_type: "application/pdf" }, ["file_path", "name"]],
    ["list_users", { name: "Smith", limit: 10 }, ["name"]],
    ["list_documents", { matter_id: 1, query: "settlement agreement" }, ["query"]],
  ] as const)("%s never logs %j", (tool, args, redactedKeys) => {
    const out = redactAuditArgs(tool, { ...args });
    for (const k of redactedKeys) expect(out[k], `${tool}.${k}`).toBe(REDACTED);
    for (const k of Object.keys(args)) {
      if (!(redactedKeys as readonly string[]).includes(k)) expect(out[k]).toEqual((args as any)[k]);
    }
  });

  it("redacts every key for a tool it does not know", () => {
    const out = redactAuditArgs("brand_new_tool", { matter_id: 1, anything: "x" });
    expect(out).toEqual({ matter_id: REDACTED, anything: REDACTED });
  });

  it("masks secret-named keys even when they would be allowed", () => {
    const out = redactAuditArgs("get_matter", { matter_id: 1, token: "abc" }, { get_matter: ["matter_id", "token"] });
    expect(out).toEqual({ matter_id: 1, token: REDACTED });
  });

  it("masks secret-named keys nested inside an allowed object", () => {
    const out = redactAuditArgs("x", { cfg: { client_secret: "s", ok: 1 } }, { x: ["cfg"] });
    expect(out).toEqual({ cfg: { client_secret: REDACTED, ok: 1 } });
  });
});
