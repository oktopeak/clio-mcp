import { vi, describe, it, expect, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const { mockClioGetAllPages, mockAppendAuditLog } = vi.hoisted(() => ({
  mockClioGetAllPages: vi.fn(),
  mockAppendAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/clioClient.js", () => ({
  clioGet: vi.fn(),
  clioGetAllPages: mockClioGetAllPages,
}));

vi.mock("../../utils/auditLog.js", () => ({
  appendAuditLog: mockAppendAuditLog,
}));

import { registerBillingTools } from "../billing.js";

function buildHandlers(): Record<string, Function> {
  const handlers: Record<string, Function> = {};
  const mockServer = {
    registerTool: vi.fn((name: string, _schema: unknown, handler: Function) => {
      handlers[name] = handler;
    }),
  } as unknown as McpServer;
  registerBillingTools(mockServer);
  return handlers;
}

describe("get_billing_summary", () => {
  let handlers: Record<string, Function>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAppendAuditLog.mockResolvedValue(undefined);
    handlers = buildHandlers();
  });

  it("fetches bills via clioGetAllPages rather than a single fixed-limit page", async () => {
    mockClioGetAllPages.mockResolvedValue([]);
    await handlers["get_billing_summary"]({ matter_id: 42 });
    expect(mockClioGetAllPages).toHaveBeenCalledWith(
      "/bills.json",
      expect.objectContaining({ matter_id: "42" }),
    );
    const params = mockClioGetAllPages.mock.calls[0][1] as Record<string, string>;
    expect(params).not.toHaveProperty("limit");
  });

  it("sums total_billed and total_outstanding across bills spanning what would be multiple pages", async () => {
    // clioGetAllPages already concatenates every page internally; this simulates
    // a matter with more bills than a single Clio page (e.g. > 200) by returning
    // a large concatenated array, and asserts the summary sums all of them, not
    // just a truncated first slice.
    const manyBills = Array.from({ length: 250 }, (_, i) => ({
      id: i,
      state: "paid",
      total: 100,
      balance: 10,
      issued_at: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    }));
    mockClioGetAllPages.mockResolvedValue(manyBills);

    const result = await handlers["get_billing_summary"]({ matter_id: 42 }) as any;
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.bill_count).toBe(250);
    expect(parsed.total_billed).toBe(25_000);
    expect(parsed.total_outstanding).toBe(2_500);
  });

  it("excludes draft and void bills from the summary", async () => {
    mockClioGetAllPages.mockResolvedValue([
      { id: 1, state: "paid", total: 100, balance: 0, issued_at: "2026-01-01" },
      { id: 2, state: "draft", total: 500, balance: 500, issued_at: "2026-02-01" },
      { id: 3, state: "void", total: 200, balance: 200, issued_at: "2026-03-01" },
    ]);
    const result = await handlers["get_billing_summary"]({ matter_id: 42 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.bill_count).toBe(1);
    expect(parsed.total_billed).toBe(100);
    expect(parsed.total_outstanding).toBe(0);
  });

  it("logs success with matter_id", async () => {
    mockClioGetAllPages.mockResolvedValue([]);
    await handlers["get_billing_summary"]({ matter_id: 42 });
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "get_billing_summary", outcome: "success", matter_id: 42 }),
    );
  });

  it("returns Error prefix and logs outcome 'error' on failure", async () => {
    mockClioGetAllPages.mockRejectedValue(new Error("network failure"));
    const result = await handlers["get_billing_summary"]({ matter_id: 42 }) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^Error:/);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "get_billing_summary", outcome: "error", error_message: "network failure", matter_id: 42 }),
    );
  });
});
