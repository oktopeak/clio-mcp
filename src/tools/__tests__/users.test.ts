import { vi, describe, it, expect, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const { mockClioGet, mockAppendAuditLog } = vi.hoisted(() => ({
  mockClioGet: vi.fn(),
  mockAppendAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/clioClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/clioClient.js")>();
  return { ...actual, clioGet: mockClioGet };
});

vi.mock("../../utils/auditLog.js", () => ({
  appendAuditLog: mockAppendAuditLog,
}));

import { ClioApiError } from "../../utils/clioClient.js";
import { registerUserTools } from "../users.js";

function buildHandlers(): Record<string, Function> {
  const handlers: Record<string, Function> = {};
  const mockServer = {
    registerTool: vi.fn((name: string, _schema: unknown, handler: Function) => {
      handlers[name] = handler;
    }),
  } as unknown as McpServer;
  registerUserTools(mockServer);
  return handlers;
}

describe("list_users", () => {
  let handlers: Record<string, Function>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAppendAuditLog.mockResolvedValue(undefined);
    handlers = buildHandlers();
  });

  it("converts boolean enabled=true to string 'true' in API params", async () => {
    mockClioGet.mockResolvedValue({ data: [] });
    await handlers["list_users"]({ enabled: true, limit: 10 });
    expect(mockClioGet).toHaveBeenCalledWith(
      "/users.json",
      expect.objectContaining({ enabled: "true" })
    );
  });

  it("converts boolean enabled=false to string 'false' in API params", async () => {
    mockClioGet.mockResolvedValue({ data: [] });
    await handlers["list_users"]({ enabled: false, limit: 10 });
    expect(mockClioGet).toHaveBeenCalledWith(
      "/users.json",
      expect.objectContaining({ enabled: "false" })
    );
  });

  it("does NOT send enabled in API params when enabled is undefined", async () => {
    mockClioGet.mockResolvedValue({ data: [] });
    await handlers["list_users"]({ limit: 10 });
    const calledParams = mockClioGet.mock.calls[0][1] as Record<string, string>;
    expect(calledParams).not.toHaveProperty("enabled");
  });

  it("passes name filter to API params when provided", async () => {
    mockClioGet.mockResolvedValue({ data: [] });
    await handlers["list_users"]({ name: "Jane", limit: 10 });
    expect(mockClioGet).toHaveBeenCalledWith(
      "/users.json",
      expect.objectContaining({ name: "Jane" })
    );
  });

  it("passes subscription_type filter to API params when provided", async () => {
    mockClioGet.mockResolvedValue({ data: [] });
    await handlers["list_users"]({ subscription_type: "attorney", limit: 10 });
    expect(mockClioGet).toHaveBeenCalledWith(
      "/users.json",
      expect.objectContaining({ subscription_type: "attorney" })
    );
  });

  it("omits name and subscription_type from params when not provided", async () => {
    mockClioGet.mockResolvedValue({ data: [] });
    await handlers["list_users"]({ limit: 10 });
    const calledParams = mockClioGet.mock.calls[0][1] as Record<string, string>;
    expect(calledParams).not.toHaveProperty("name");
    expect(calledParams).not.toHaveProperty("subscription_type");
  });

  it("logs outcome 'success' with correct result_count on successful fetch", async () => {
    const fakeUsers = [
      { id: 1, name: "Alice", email: "a@x.com", initials: "A", subscription_type: "attorney", enabled: true },
      { id: 2, name: "Bob", email: "b@x.com", initials: "B", subscription_type: "nonattorney", enabled: true },
    ];
    mockClioGet.mockResolvedValue({ data: fakeUsers });
    await handlers["list_users"]({ limit: 50 });
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_users", outcome: "success", result_count: 2 })
    );
  });

  it("returns a JSON result with has_more: false and logs result_count 0 when API returns empty array", async () => {
    mockClioGet.mockResolvedValue({ data: [] });
    const result = await handlers["list_users"]({ limit: 10 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.users).toEqual([]);
    expect(parsed.has_more).toBe(false);
    expect(parsed.next_page_token).toBeNull();
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "success", result_count: 0 })
    );
  });

  it("logs outcome 'error' with error_message on API failure", async () => {
    mockClioGet.mockRejectedValue(new Error("Network timeout"));
    const result = await handlers["list_users"]({ limit: 10 });
    expect(result.isError).toBe(true);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_users", outcome: "error", error_message: "Network timeout" })
    );
  });

  it("returns has_more: false and next_page_token: null on a short final page", async () => {
    mockClioGet.mockResolvedValue({ data: [{ id: 1, name: "Alice" }], meta: { records: 1, paging: {} } });
    const result = await handlers["list_users"]({ limit: 25 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.has_more).toBe(false);
    expect(parsed.next_page_token).toBeNull();
  });

  it("returns has_more: true and the extracted token when a next page cursor is present", async () => {
    mockClioGet.mockResolvedValue({
      data: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }],
      meta: { records: 10, paging: { next: "https://app.clio.com/api/v4/users.json?page_token=abc123" } },
    });
    const result = await handlers["list_users"]({ limit: 2 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.has_more).toBe(true);
    expect(parsed.next_page_token).toBe("abc123");
  });

  it("forwards page_token into the outgoing request params when supplied", async () => {
    mockClioGet.mockResolvedValue({ data: [{ id: 1, name: "Alice" }], meta: { records: 1 } });
    await handlers["list_users"]({ limit: 25, page_token: "xyz" });
    expect(mockClioGet).toHaveBeenCalledWith(
      "/users.json",
      expect.objectContaining({ page_token: "xyz" }),
    );
  });
});

describe("get_user", () => {
  let handlers: Record<string, Function>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAppendAuditLog.mockResolvedValue(undefined);
    handlers = buildHandlers();
  });

  it("returns user data and logs outcome 'success' on found user", async () => {
    const fakeUser = {
      id: 42, name: "Alice", email: "a@x.com", initials: "A",
      subscription_type: "attorney", enabled: true,
      created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-02T00:00:00Z",
    };
    mockClioGet.mockResolvedValue({ data: fakeUser });
    const result = await handlers["get_user"]({ user_id: 42 });
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "get_user", args: { user_id: 42 }, outcome: "success" })
    );
    expect(result.content[0].text).toContain("Alice");
  });

  it("logs outcome 'not_found' with result_count 0 and returns not-found message on 404", async () => {
    mockClioGet.mockRejectedValue(new ClioApiError(404, "Not Found"));
    const result = await handlers["get_user"]({ user_id: 99 });
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "get_user",
        args: { user_id: 99 },
        outcome: "not_found",
        result_count: 0,
      })
    );
    expect(result.content[0].text).toBe("User 99 not found.");
    expect(result.isError).toBeUndefined();
  });

  it("logs outcome 'error' on non-404 ClioApiError", async () => {
    mockClioGet.mockRejectedValue(new ClioApiError(500, "Internal Server Error"));
    const result = await handlers["get_user"]({ user_id: 99 });
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "get_user",
        outcome: "error",
        error_message: "Internal Server Error",
      })
    );
    expect(result.isError).toBe(true);
  });

  it("logs outcome 'error' on generic non-ClioApiError failure", async () => {
    mockClioGet.mockRejectedValue(new Error("Connection refused"));
    const result = await handlers["get_user"]({ user_id: 99 });
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "get_user", outcome: "error", error_message: "Connection refused" })
    );
    expect(result.isError).toBe(true);
  });
});
