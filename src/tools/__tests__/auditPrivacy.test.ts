/**
 * One sweep across every tool, asserting that nothing a firm would consider
 * client data reaches the audit log.
 *
 * The audit log is a compliance feature: it exists so a firm can answer "who
 * asked this system about which matter, and when." It is a plain file on the
 * user's machine, it is never rotated by us, and it is the one artifact we
 * point at when a firm asks about ABA Opinion 512. A tool that writes note
 * bodies, custom field values, folder names or search queries into it turns
 * that feature into a second, uncontrolled copy of the case file.
 *
 * Per-tool tests check per-tool behaviour and are easy to forget when a new
 * tool lands. This one fails for any tool, including one written next year.
 */
import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

// The registry pulls in authTools -> tokenStorage -> the native keyring binding.
vi.mock("@napi-rs/keyring", () => ({
  Entry: class {
    getPassword() { return null; }
    setPassword() {}
    deletePassword() {}
  },
}));

const { mockClioGet, mockClioPost, mockClioPatch, mockClioGetAllPages, mockAppendAuditLog, MockClioApiError } =
  vi.hoisted(() => {
    class MockClioApiError extends Error {
      statusCode: number;
      constructor(statusCode: number, message: string) {
        super(message);
        this.statusCode = statusCode;
        this.name = "ClioApiError";
      }
    }
    return {
      mockClioGet: vi.fn(),
      mockClioPost: vi.fn(),
      mockClioPatch: vi.fn(),
      mockClioGetAllPages: vi.fn(),
      mockAppendAuditLog: vi.fn().mockResolvedValue(undefined),
      MockClioApiError,
    };
  });

vi.mock("../../utils/clioClient.js", () => ({
  clioGet: mockClioGet,
  clioGetWithFieldFallback: async (path: string, params: any) => ({ body: await mockClioGet(path, params) }),
  clioPost: mockClioPost,
  clioPatch: mockClioPatch,
  clioGetAllPages: mockClioGetAllPages,
  ClioApiError: MockClioApiError,
  extractNextPageToken: () => null,
}));

vi.mock("../../utils/auditLog.js", () => ({
  appendAuditLog: mockAppendAuditLog,
}));

import { registerMatterTools } from "../matters.js";
import { registerContactTools } from "../contacts.js";
import { registerNoteTools } from "../notes.js";
import { registerFolderTools } from "../folders.js";
import { registerCustomFieldTools } from "../customFields.js";
import { registerRelationshipTools } from "../relationships.js";
import { registerActivitySummaryTools } from "../activitySummary.js";

const handlers: Record<string, Function> = {};
const fakeServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    handlers[name] = handler;
  }),
};

beforeAll(() => {
  registerMatterTools(fakeServer as any);
  registerContactTools(fakeServer as any);
  registerNoteTools(fakeServer as any);
  registerFolderTools(fakeServer as any);
  registerCustomFieldTools(fakeServer as any);
  registerRelationshipTools(fakeServer as any);
  registerActivitySummaryTools(fakeServer as any);
});

/**
 * Distinctive strings passed as tool arguments. If any of these reaches an
 * audit entry, real client data would too. They are shaped like the things a
 * consumer-protection firm actually stores: loss amounts, incident dates, the
 * name of a suspected thief, intake narrative, and a client-named folder.
 */
const CANARIES = [
  "LOSSAMOUNT47300",
  "SUSPECTEDTHIEFNAME",
  "INTAKENARRATIVE",
  "CLIENTFOLDERNAME",
  "SEARCHQUERYCANARY",
];

/** Every tool that takes free text or a value, with args carrying a canary. */
const CASES: { tool: string; args: Record<string, unknown> }[] = [
  { tool: "create_matter", args: { client_id: 1, description: "INTAKENARRATIVE", status: "open", billable: true, custom_field_values: [{ custom_field_id: 10, value: "LOSSAMOUNT47300" }] } },
  { tool: "update_matter", args: { matter_id: 42, description: "INTAKENARRATIVE", custom_field_values: [{ custom_field_id: 10, value: "SUSPECTEDTHIEFNAME" }] } },
  { tool: "list_contacts", args: { limit: 25 } },
  { tool: "update_contact", args: { contact_id: 5, expected_etag: "v1", changes: { title: "INTAKENARRATIVE", custom_field_values: [{custom_field_id: 10, value: "LOSSAMOUNT47300"}] } } },
  { tool: "search_contacts", args: { query: "SEARCHQUERYCANARY", limit: 25 } },
  { tool: "create_note", args: { matter_id: 42, subject: "INTAKENARRATIVE", body: "SUSPECTEDTHIEFNAME" } },
  { tool: "list_notes", args: { matter_id: 42, limit: 25 } },
  { tool: "list_folders", args: { matter_id: 42, query: "CLIENTFOLDERNAME", limit: 25 } },
  { tool: "folder_exists", args: { matter_id: 42, name: "CLIENTFOLDERNAME" } },
  { tool: "create_folder", args: { matter_id: 42, name: "CLIENTFOLDERNAME", if_not_exists: false } },
  { tool: "list_matters", args: { limit: 25 } },
  { tool: "get_matter", args: { matter_id: 42 } },
  { tool: "get_contact", args: { contact_id: 5 } },
  { tool: "list_custom_fields", args: { include_deleted: false } },
  { tool: "create_custom_field", args: { name: "INTAKENARRATIVE", parent_type: "Matter", field_type: "text_line", required: false, displayed: true } },
  { tool: "list_matter_relationships", args: { matter_id: 42, limit: 100 } },
  { tool: "matter_activity_summary", args: { lookback_days: 90, calendar_days_ahead: 90, limit: 10 } },
];

function loggedText(): string {
  return mockAppendAuditLog.mock.calls.map(([entry]) => JSON.stringify(entry?.args ?? {})).join(" ");
}

describe("audit log never records client data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Shapes are irrelevant here; only what gets logged matters. Reads resolve
    // empty and writes echo a bare record.
    mockClioGet.mockResolvedValue({ data: { id: 42, custom_field_values: [] }, meta: { records: 0 } });
    mockClioGetAllPages.mockResolvedValue([]);
    mockClioPost.mockResolvedValue({ data: { id: 1 } });
    mockClioPatch.mockResolvedValue({ data: { id: 42 } });
  });

  for (const { tool, args } of CASES) {
    it(`${tool} logs the call without its content`, async () => {
      if (tool === "list_contacts") mockClioGet.mockResolvedValue({data:[],meta:{}});
      if (tool === "update_contact") mockClioGet.mockResolvedValue({data:{id:5,etag:"v1",type:"Person",first_name:"Ana",last_name:"Silva",custom_field_values:[]}});
      await handlers[tool](args);
      expect(mockAppendAuditLog).toHaveBeenCalled();
      const text = loggedText();
      for (const canary of CANARIES) {
        expect(text, `${tool} leaked ${canary} into the audit log`).not.toContain(canary);
      }
    });
  }

  it("still logs enough to answer who touched which matter", async () => {
    await handlers["update_matter"]({ matter_id: 42, custom_field_values: [{ custom_field_id: 10, value: "LOSSAMOUNT47300" }] });
    const entry = mockAppendAuditLog.mock.calls.at(-1)![0];
    expect(entry.matter_id).toBe(42);
    // Which fields were written is the auditable fact; what they were set to is not.
    expect(entry.args.custom_field_ids).toEqual([10]);
  });

  it("keeps content out of the log on the error path too", async () => {
    mockClioPatch.mockRejectedValue(new MockClioApiError(422, "validation failed"));
    await handlers["update_matter"]({ matter_id: 42, custom_field_values: [{ custom_field_id: 10, value: "LOSSAMOUNT47300" }] });
    expect(loggedText()).not.toContain("LOSSAMOUNT47300");
  });

  it("covers every tool that registered a handler", () => {
    // A new tool taking free text should force a decision here rather than
    // slipping through because nobody remembered to add a case.
    const audited = new Set(CASES.map((c) => c.tool));
    const registered = Object.keys(handlers);
    const missing = registered.filter((t) => !audited.has(t));
    expect(missing, `add these tools to CASES: ${missing.join(", ")}`).toEqual([]);
  });
});


/**
 * The sweep above is a hand-written list, and a hand-written list is exactly
 * what a new tool slips past: a tool added without a CASES entry is simply not
 * swept, and CI stays green. This one takes every tool the registry actually
 * exposes, builds arguments straight from its own inputSchema with a canary in
 * every string it accepts, and calls it. Nothing to remember to update.
 */
describe("audit sweep covers every registered tool", () => {
  const schemas: Record<string, Record<string, any>> = {};
  const allHandlers: Record<string, Function> = {};

  beforeAll(async () => {
    const { REGISTRARS } = await import("../index.js");
    const captureServer = {
      registerTool: (name: string, config: any, handler: Function) => {
        schemas[name] = config?.inputSchema?.shape ?? config?.inputSchema ?? {};
        allHandlers[name] = handler;
      },
      registerResource: () => {},
    };
    for (const r of REGISTRARS) r(captureServer as any);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockClioGet.mockResolvedValue({ data: { id: 42, custom_field_values: [] }, meta: { records: 0 } });
    mockClioGetAllPages.mockResolvedValue([]);
    mockClioPost.mockResolvedValue({ data: { id: 1 } });
    mockClioPatch.mockResolvedValue({ data: { id: 42 } });
  });

  /** First value this schema accepts, canary first so every string carries one. */
  function sampleFor(schema: any, withCanary: boolean): unknown {
    const candidates: unknown[] = withCanary
      ? [CANARIES[0], 1, true, "2026-01-01", "2026-01-01T00:00:00Z"]
      : [1, true, "2026-01-01", "2026-01-01T00:00:00Z", "x"];
    for (const option of schema?.options ?? schema?._def?.values ?? []) candidates.unshift(option);
    for (const candidate of candidates) {
      try {
        if (schema?.safeParse?.(candidate)?.success) return candidate;
      } catch { /* not a zod schema we can sample */ }
    }
    return undefined;
  }

  async function argsFor(tool: string): Promise<Record<string, unknown>> {
    const { AUDIT_ARG_ALLOWLIST } = await import("../../utils/auditLog.js");
    // Allowlisted keys are pass-through by design (ids, limits, enums, opaque
    // page tokens) and are reviewed by auditRedaction.test.ts, which separately
    // refuses to let a free-text key onto any allowlist. What this sweep guards
    // is everything else: an argument nobody thought about must be redacted.
    const allowed = new Set(AUDIT_ARG_ALLOWLIST[tool] ?? []);
    const args: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(schemas[tool] ?? {})) {
      const value = allowed.has(key) ? sampleFor(schema, false) : sampleFor(schema, true);
      if (value !== undefined) args[key] = value;
    }
    return args;
  }

  it("registers a handler for every tool the registry declares", async () => {
    const { TOOL_META } = await import("../index.js");
    const { AUTH_TOOLS } = await import("../index.js");
    for (const tool of Object.keys(TOOL_META)) {
      if (AUTH_TOOLS.has(tool)) continue; // no arguments, no client data
      expect(allHandlers[tool], `no registrar produced "${tool}"`).toBeDefined();
    }
  });

  it("no tool logs a canary passed through its own inputSchema", async () => {
    for (const [tool, handler] of Object.entries(allHandlers)) {
      vi.clearAllMocks();
      mockClioGet.mockResolvedValue({ data: { id: 42, custom_field_values: [] }, meta: { records: 0 } });
      mockClioGetAllPages.mockResolvedValue([]);
      mockClioPost.mockResolvedValue({ data: { id: 1 } });
      mockClioPatch.mockResolvedValue({ data: { id: 42 } });

      // A tool that rejects the sampled arguments still logs on the error path,
      // which is the path most likely to log carelessly.
      try { await handler(await argsFor(tool)); } catch { /* the log is what is under test */ }

      const logged = loggedText();
      for (const canary of CANARIES) {
        expect(logged, `${tool} leaked ${canary} into the audit log`).not.toContain(canary);
      }
    }
  });
});


describe("contact audit privacy on real handler paths", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAppendAuditLog.mockResolvedValue(undefined);
    mockClioGet.mockResolvedValue({data:{id:5,etag:"PRIVATE_ETAG",type:"Person",first_name:"Ana",last_name:"Silva",custom_field_values:[]}});
    mockClioPatch.mockResolvedValue({data:{id:5,etag:"next"}});
  });
  const input={contact_id:5,expected_etag:"PRIVATE_ETAG",changes:{title:"PRIVATE_TITLE",custom_field_values:[{custom_field_id:7,value:"PRIVATE_VALUE"}]}};
  it("records only IDs and outcome after a successful change", async () => {
    const result=await handlers.update_contact(input);
    expect(result.isError).toBeUndefined();
    expect(mockClioPatch).toHaveBeenCalledTimes(1);
    expect(mockAppendAuditLog).toHaveBeenCalledExactlyOnceWith({tool:"update_contact",args:{contact_id:5,custom_field_ids:[7]},outcome:"success"});
    expect(JSON.stringify(mockAppendAuditLog.mock.calls)).not.toContain("PRIVATE_");
  });
  it.each(["preflight","patch"])("removes private provider errors during %s", async stage => {
    (stage==="preflight"?mockClioGet:mockClioPatch).mockRejectedValue(new MockClioApiError(422,"PRIVATE_PROVIDER_EMAIL@example.test"));
    const r=await handlers.update_contact(input);
    expect(r.isError).toBe(true);expect(mockAppendAuditLog).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([r,mockAppendAuditLog.mock.calls])).not.toContain("PRIVATE_");
    expect(mockAppendAuditLog).toHaveBeenCalledWith(expect.objectContaining({outcome:"error",error_message:"validation_rejected"}));
  });
});
