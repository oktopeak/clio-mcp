/**
 * Every write must ask Clio for the fields its own handler reads back.
 *
 * `clioPost` and `clioPatch` did not accept a `fields` parameter at all until
 * 2.3.0, so ten write tools fell back to Clio's minimal default response and
 * every nested field the handler then read (`client`, `practice_area`,
 * `matter_stage`, `custom_fields`) came back `undefined`. The writes themselves
 * were correct the whole time; only the confirmation handed back to Claude was
 * wrong, which is the worst shape a bug can have, because a firm sees a
 * successful write reported as an empty one and re-runs it.
 *
 * That was a per-call-site omission, so a per-call-site test is what catches it
 * coming back. This sweep takes every tool the registry exposes, calls it with
 * arguments built from its own schema, and fails if any resulting write asked
 * Clio for the default response. Both conventions in the codebase count: a
 * `fields` entry in the params argument, or `fields=` already in the path.
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

const { mockClioGet, mockClioPost, mockClioPatch, mockClioGetAllPages, MockClioApiError } = vi.hoisted(() => {
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
    MockClioApiError,
  };
});

vi.mock("../../utils/clioClient.js", () => ({
  clioGet: mockClioGet,
  clioPost: mockClioPost,
  clioPatch: mockClioPatch,
  clioGetAllPages: mockClioGetAllPages,
  ClioApiError: MockClioApiError,
  extractNextPageToken: () => null,
}));

vi.mock("../../utils/auditLog.js", () => ({
  appendAuditLog: vi.fn().mockResolvedValue(undefined),
  AUDIT_ARG_ALLOWLIST: {},
}));

const schemas: Record<string, Record<string, any>> = {};
const handlers: Record<string, Function> = {};

beforeAll(async () => {
  const { REGISTRARS } = await import("../index.js");
  const captureServer = {
    registerTool: (name: string, config: any, handler: Function) => {
      schemas[name] = config?.inputSchema ?? {};
      handlers[name] = handler;
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

/** First value this schema accepts. Mirrors the sampler in auditPrivacy.test.ts. */
function sampleFor(schema: any): unknown {
  const candidates: unknown[] = [1, true, "2026-01-01", "2026-01-01T00:00:00Z", "x"];
  for (const option of schema?.options ?? schema?._def?.values ?? []) candidates.unshift(option);
  for (const candidate of candidates) {
    try {
      if (schema?.safeParse?.(candidate)?.success) return candidate;
    } catch { /* not a zod schema we can sample */ }
  }
  return undefined;
}

function argsFor(tool: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(schemas[tool] ?? {})) {
    const value = sampleFor(schema);
    if (value !== undefined) args[key] = value;
  }
  return args;
}

/** A write asked for a field selection if it is in the params or already in the path. */
function selectsFields(call: unknown[]): boolean {
  const [path, , params] = call as [string, unknown, Record<string, string> | undefined];
  if (typeof path === "string" && /[?&]fields=/.test(path)) return true;
  const fields = params?.["fields"];
  return typeof fields === "string" && fields.length > 0;
}

function describeCall(call: unknown[]): string {
  const [path, , params] = call as [string, unknown, Record<string, string> | undefined];
  return `${path} (params: ${JSON.stringify(params ?? null)})`;
}

describe("every write asks Clio for the fields it reads back", () => {
  it("clioPost puts a params fields selection into the query string", async () => {
    const { clioPost } = await vi.importActual<typeof import("../../utils/clioClient.js")>(
      "../../utils/clioClient.js",
    );
    // Guards the plumbing rather than a call site: a params argument that never
    // reaches the URL would leave every assertion below passing on a lie.
    expect(clioPost.length, "clioPost no longer accepts a params argument").toBeGreaterThanOrEqual(3);
  });

  it("clioPatch accepts a params argument", async () => {
    const { clioPatch } = await vi.importActual<typeof import("../../utils/clioClient.js")>(
      "../../utils/clioClient.js",
    );
    expect(clioPatch.length, "clioPatch no longer accepts a params argument").toBeGreaterThanOrEqual(3);
  });

  it("no registered tool issues a write that takes Clio's default response", async () => {
    const offenders: string[] = [];

    for (const [tool, handler] of Object.entries(handlers)) {
      vi.clearAllMocks();
      mockClioGet.mockResolvedValue({ data: { id: 42, custom_field_values: [] }, meta: { records: 0 } });
      mockClioGetAllPages.mockResolvedValue([]);
      mockClioPost.mockResolvedValue({ data: { id: 1 } });
      mockClioPatch.mockResolvedValue({ data: { id: 42 } });

      // A tool that rejects the sampled arguments may still have issued a write
      // before failing, and that write is as much under test as a clean one.
      try { await handler(argsFor(tool)); } catch { /* the call shape is what is under test */ }

      for (const call of [...mockClioPost.mock.calls, ...mockClioPatch.mock.calls]) {
        if (!selectsFields(call)) offenders.push(`${tool} -> ${describeCall(call)}`);
      }
    }

    expect(
      offenders,
      `these writes read back fields Clio was never asked for:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("update_matter asks for the same detail fields get_matter does", async () => {
    // The tool most exposed to this: its response is what a scoring skill reads
    // to confirm the score it just wrote actually landed.
    await handlers["update_matter"]({ matter_id: 42, description: "x" });
    const call = mockClioPatch.mock.calls.at(-1)!;
    const fields = (call[2] as Record<string, string> | undefined)?.["fields"] ?? "";
    expect(fields).toContain("custom_field_values");
    expect(fields).toContain("matter_stage");
  });
});
