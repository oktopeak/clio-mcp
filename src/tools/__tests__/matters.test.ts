import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

const { mockClioPost, mockClioGet, mockAppendAuditLog, MockClioApiError } = vi.hoisted(() => {
  class MockClioApiError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
      this.name = "ClioApiError";
    }
  }
  return {
    mockClioPost: vi.fn(),
    mockClioGet: vi.fn(),
    mockAppendAuditLog: vi.fn(),
    MockClioApiError,
  };
});

vi.mock("../../utils/clioClient.js", () => ({
  clioPost: mockClioPost,
  clioGet: mockClioGet,
  ClioApiError: MockClioApiError,
  extractNextPageToken: (meta: any) => {
    const nextUrl = meta?.paging?.next;
    if (!nextUrl) return null;
    try { return new URL(nextUrl).searchParams.get("page_token"); }
    catch { return null; }
  },
}));

vi.mock("../../utils/auditLog.js", () => ({
  appendAuditLog: mockAppendAuditLog,
}));

import { registerMatterTools } from "../matters.js";

const handlers: Record<string, Function> = {};
const fakeServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    handlers[name] = handler;
  }),
};

beforeAll(() => {
  registerMatterTools(fakeServer as any);
});

// Minimal valid args with defaults applied (matching Zod defaults: status "open", billable true)
const MIN_ARGS = { client_id: 1, description: "Test matter", status: "open" as const, billable: true };

const MOCK_MATTER = {
  id: 42,
  display_number: "00042-001",
  description: "Test matter",
  status: "open",
  billable: true,
  client: { id: 1, name: "Acme Corp" },
  practice_area: null,
  responsible_attorney: null,
  originating_attorney: null,
  client_reference: null,
  open_date: "2026-05-21",
};

describe("list_matters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a JSON result with has_more: false when the page is empty, not a plain-text sentinel", async () => {
    mockClioGet.mockResolvedValue({ data: [], meta: { records: 0, paging: {} } });
    const result = await handlers["list_matters"]({ limit: 25 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.matters).toEqual([]);
    expect(parsed.has_more).toBe(false);
    expect(parsed.next_page_token).toBeNull();
  });
});

describe("create_matter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClioPost.mockResolvedValue({ data: MOCK_MATTER });
  });

  // ─── Request body mapping ─────────────────────────────────────────────────

  describe("request body mapping", () => {
    it("sends client, description, status, billable, and open_date for minimal input", async () => {
      const _d = new Date();
      const today = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`;
      await handlers["create_matter"](MIN_ARGS);
      const body = mockClioPost.mock.calls[0][1] as any;
      expect(body.data).toMatchObject({
        client: { id: 1 },
        description: "Test matter",
        status: "open",
        billable: true,
        open_date: today,
      });
    });

    it("sends client as nested object with id", async () => {
      await handlers["create_matter"]({ ...MIN_ARGS, client_id: 99 });
      const body = mockClioPost.mock.calls[0][1] as any;
      expect(body.data.client).toEqual({ id: 99 });
    });

    it("sends practice_area as nested object when practice_area_id is provided", async () => {
      await handlers["create_matter"]({ ...MIN_ARGS, practice_area_id: 5 });
      const body = mockClioPost.mock.calls[0][1] as any;
      expect(body.data.practice_area).toEqual({ id: 5 });
    });

    it("sends responsible_attorney as nested object when responsible_attorney_id is provided", async () => {
      await handlers["create_matter"]({ ...MIN_ARGS, responsible_attorney_id: 7 });
      const body = mockClioPost.mock.calls[0][1] as any;
      expect(body.data.responsible_attorney).toEqual({ id: 7 });
    });

    it("sends originating_attorney as nested object when originating_attorney_id is provided", async () => {
      await handlers["create_matter"]({ ...MIN_ARGS, originating_attorney_id: 8 });
      const body = mockClioPost.mock.calls[0][1] as any;
      expect(body.data.originating_attorney).toEqual({ id: 8 });
    });

    it("sends the provided open_date instead of today", async () => {
      await handlers["create_matter"]({ ...MIN_ARGS, open_date: "2025-01-15" });
      const body = mockClioPost.mock.calls[0][1] as any;
      expect(body.data.open_date).toBe("2025-01-15");
    });

    it("sends today's date for open_date when omitted", async () => {
      const _d = new Date();
      const today = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`;
      await handlers["create_matter"](MIN_ARGS);
      const body = mockClioPost.mock.calls[0][1] as any;
      expect(body.data.open_date).toBe(today);
    });

    it("sends client_reference when provided", async () => {
      await handlers["create_matter"]({ ...MIN_ARGS, client_reference: "EXT-001" });
      const body = mockClioPost.mock.calls[0][1] as any;
      expect(body.data.client_reference).toBe("EXT-001");
    });
  });

  // ─── Optional field omission ──────────────────────────────────────────────

  describe("optional field omission", () => {
    it("omits practice_area when practice_area_id is not provided", async () => {
      await handlers["create_matter"](MIN_ARGS);
      const body = mockClioPost.mock.calls[0][1] as any;
      expect(body.data).not.toHaveProperty("practice_area");
    });

    it("omits responsible_attorney when responsible_attorney_id is not provided", async () => {
      await handlers["create_matter"](MIN_ARGS);
      const body = mockClioPost.mock.calls[0][1] as any;
      expect(body.data).not.toHaveProperty("responsible_attorney");
    });

    it("omits originating_attorney when originating_attorney_id is not provided", async () => {
      await handlers["create_matter"](MIN_ARGS);
      const body = mockClioPost.mock.calls[0][1] as any;
      expect(body.data).not.toHaveProperty("originating_attorney");
    });

    it("omits client_reference when not provided", async () => {
      await handlers["create_matter"](MIN_ARGS);
      const body = mockClioPost.mock.calls[0][1] as any;
      expect(body.data).not.toHaveProperty("client_reference");
    });
  });

  // ─── Audit log ───────────────────────────────────────────────────────────

  describe("audit log", () => {
    it("logs success with matter_id on successful creation", async () => {
      await handlers["create_matter"](MIN_ARGS);
      expect(mockAppendAuditLog).toHaveBeenCalledOnce();
      expect(mockAppendAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "success", matter_id: 42 }),
      );
    });

    it("logs error with error_message on generic failure", async () => {
      mockClioPost.mockRejectedValue(new Error("network failure"));
      await handlers["create_matter"](MIN_ARGS);
      expect(mockAppendAuditLog).toHaveBeenCalledOnce();
      expect(mockAppendAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "error", error_message: "network failure" }),
      );
    });

    it("logs error with error_message on ClioApiError 422", async () => {
      mockClioPost.mockRejectedValue(new MockClioApiError(422, "Client does not exist"));
      await handlers["create_matter"](MIN_ARGS);
      expect(mockAppendAuditLog).toHaveBeenCalledOnce();
      expect(mockAppendAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "error", error_message: "Client does not exist" }),
      );
    });
  });

  // ─── Error handling ───────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns Validation error prefix and isError for ClioApiError 422", async () => {
      mockClioPost.mockRejectedValue(new MockClioApiError(422, "Client does not exist"));
      const result = await handlers["create_matter"](MIN_ARGS) as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/^Validation error:/);
    });

    it("returns Error prefix and isError for generic errors", async () => {
      mockClioPost.mockRejectedValue(new Error("network failure"));
      const result = await handlers["create_matter"](MIN_ARGS) as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/^Error:/);
    });

    it("returns Error prefix and isError for non-422 ClioApiError", async () => {
      mockClioPost.mockRejectedValue(new MockClioApiError(500, "Internal server error"));
      const result = await handlers["create_matter"](MIN_ARGS) as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/^Error:/);
    });
  });
});
