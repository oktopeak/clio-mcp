import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const { mockLoadTokens } = vi.hoisted(() => ({ mockLoadTokens: vi.fn() }));

vi.mock("../../auth/tokenStorage.js", () => ({
  loadTokens: mockLoadTokens,
}));

vi.mock("os", () => ({
  default: {
    homedir: () => "/tmp/test-home",
    networkInterfaces: () => ({
      eth0: [{ family: "IPv4", internal: false, address: "10.0.0.1" }],
    }),
  },
}));

import {
  appendAuditLog,
  readAuditLog,
  configureAudit,
  resetAudit,
  REDACTED,
} from "../auditLog.js";
import type { AuditEntry, AuditSink } from "../auditLog.js";
import { sessionStorage } from "../sessionContext.js";
import type { SessionContext } from "../sessionContext.js";

function memorySink() {
  const entries: AuditEntry[] = [];
  const reads: any[] = [];
  const sink: AuditSink = {
    async append(e) { entries.push(e); },
    async read(filter) {
      reads.push(filter);
      const m = entries.filter((e) => filter.user_id === undefined || e.user_id === filter.user_id);
      return { entries: m.slice(filter.offset, filter.offset + filter.limit), total_matched: m.length };
    },
  };
  return { sink, entries, reads };
}

function ctx(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: "sess-1",
    getAccessToken: async () => "tok",
    storeTokens: async () => {},
    getTokens: async () => null,
    clearTokens: async () => {},
    setPendingNonce: () => {},
    ...overrides,
  } as SessionContext;
}

const originalTransport = process.env.TRANSPORT;

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadTokens.mockResolvedValue(null);
  delete process.env.TRANSPORT; // = http
});

afterEach(() => {
  resetAudit();
  if (originalTransport === undefined) delete process.env.TRANSPORT;
  else process.env.TRANSPORT = originalTransport;
});

describe("appendAuditLog through a configured sink", () => {
  it("writes the identity fields from the session context and redacts args", async () => {
    const { sink, entries } = memorySink();
    configureAudit({ sink });
    await sessionStorage.run(
      ctx({ userId: "u-1", clioUserId: "c-9", requestId: "req-7" }),
      () => appendAuditLog({ tool: "search_contacts", args: { query: "Doe", limit: 5 }, outcome: "success", result_count: 2 })
    );
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.session_id).toBe("sess-1");
    expect(e.user_id).toBe("u-1");
    expect(e.clio_user_id).toBe("c-9");
    expect(e.request_id).toBe("req-7");
    expect(e.args).toEqual({ query: REDACTED, limit: 5 });
    expect(e.result_count).toBe(2);
    expect(e.machine_ip).toBeUndefined();
  });

  it("falls back to the context tokens for clio_user_id", async () => {
    const { sink, entries } = memorySink();
    configureAudit({ sink });
    await sessionStorage.run(
      ctx({ getTokens: async () => ({ access_token: "a", refresh_token: "r", expires_at: 0, clio_user_id: "from-tokens" }) }),
      () => appendAuditLog({ tool: "list_matters", args: {}, outcome: "success" })
    );
    expect(entries[0].clio_user_id).toBe("from-tokens");
  });

  it("never reads the shared token file outside stdio mode", async () => {
    const { sink, entries } = memorySink();
    configureAudit({ sink });
    await appendAuditLog({ tool: "list_matters", args: {}, outcome: "success" });
    expect(mockLoadTokens).not.toHaveBeenCalled();
    expect(entries[0].machine_ip).toBeUndefined();
    expect(entries[0].user_id).toBeUndefined();
  });

  it("in stdio mode records machine_ip and resolves clio_user_id from the token file", async () => {
    process.env.TRANSPORT = "stdio";
    mockLoadTokens.mockResolvedValue({ access_token: "a", refresh_token: "r", expires_at: 0, clio_user_id: "disk-user" });
    const { sink, entries } = memorySink();
    configureAudit({ sink });
    await appendAuditLog({ tool: "get_matter", args: { matter_id: 3 }, outcome: "success", matter_id: 3 });
    expect(mockLoadTokens).toHaveBeenCalledTimes(1);
    expect(entries[0].machine_ip).toBe("10.0.0.1");
    expect(entries[0].clio_user_id).toBe("disk-user");
    expect(entries[0].matter_id).toBe(3);
  });

  it("includeMachineIp overrides the transport default", async () => {
    const { sink, entries } = memorySink();
    configureAudit({ sink, includeMachineIp: true });
    await appendAuditLog({ tool: "list_matters", args: {}, outcome: "success" });
    expect(entries[0].machine_ip).toBe("10.0.0.1");
  });

  it("swallows sink failures with a warning instead of failing the tool call", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    configureAudit({ sink: { append: async () => { throw new Error("disk full"); }, read: async () => ({ entries: [], total_matched: 0 }) } });
    await expect(appendAuditLog({ tool: "list_matters", args: {}, outcome: "success" })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("disk full"));
    warn.mockRestore();
  });
});

describe("readAuditLog through a configured sink", () => {
  it("scopes the read to the context userId when present", async () => {
    const { sink, entries, reads } = memorySink();
    configureAudit({ sink });
    entries.push(
      { timestamp: "2026-01-01T00:00:00Z", session_id: "s", user_id: "u-1", tool: "list_matters", args: {}, outcome: "success" },
      { timestamp: "2026-01-01T00:00:00Z", session_id: "s", user_id: "u-2", tool: "list_matters", args: {}, outcome: "success" },
    );
    const result = await sessionStorage.run(ctx({ userId: "u-1" }), () => readAuditLog({ limit: 10 }));
    expect(reads[0].user_id).toBe("u-1");
    expect(result.entries).toHaveLength(1);
    expect(result.total_matched).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it("does not scope when there is no userId and clamps the limit to 1000", async () => {
    const { sink, reads } = memorySink();
    configureAudit({ sink });
    await readAuditLog({ limit: 5000, offset: 2 });
    expect(reads[0].user_id).toBeUndefined();
    expect(reads[0].limit).toBe(1000);
    expect(reads[0].offset).toBe(2);
  });

  it("computes truncated from the sink's total", async () => {
    const sink: AuditSink = {
      async append() {},
      async read() {
        return { entries: [{ timestamp: "t", session_id: "s", tool: "x", args: {}, outcome: "success" }], total_matched: 3 };
      },
    };
    configureAudit({ sink });
    const result = await readAuditLog({ limit: 1, offset: 0 });
    expect(result.truncated).toBe(true);
  });
});
