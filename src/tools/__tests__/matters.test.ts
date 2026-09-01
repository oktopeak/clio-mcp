import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

const { mockClioPost, mockClioGet, mockClioPatch, mockAppendAuditLog, MockClioApiError } = vi.hoisted(() => {
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
    mockClioPatch: vi.fn(),
    mockAppendAuditLog: vi.fn(),
    MockClioApiError,
  };
});

vi.mock("../../utils/clioClient.js", () => ({
  clioPost: mockClioPost,
  clioGet: mockClioGet,
  clioPatch: mockClioPatch,
  ClioApiError: MockClioApiError,
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

    it("sends custom_field_values when provided", async () => {
      const cfv = [{ custom_field: { id: 10 }, value: "Referral" }];
      await handlers["create_matter"]({ ...MIN_ARGS, custom_field_values: cfv });
      const body = mockClioPost.mock.calls[0][1] as any;
      expect(body.data.custom_field_values).toEqual(cfv);
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

    it("omits custom_field_values when not provided", async () => {
      await handlers["create_matter"](MIN_ARGS);
      const body = mockClioPost.mock.calls[0][1] as any;
      expect(body.data).not.toHaveProperty("custom_field_values");
    });
  });

  // ─── Response mapping ──────────────────────────────────────────────────────

  describe("response mapping", () => {
    it("includes custom_field_values from the API response in the returned matter", async () => {
      mockClioPost.mockResolvedValue({
        data: { ...MOCK_MATTER, custom_field_values: [{ custom_field: { id: 10, name: "Referral Source" }, value: "Web" }] },
      });
      const result = await handlers["create_matter"](MIN_ARGS) as any;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.matter.custom_field_values).toEqual([{ custom_field: { id: 10, name: "Referral Source" }, value: "Web" }]);
    });

    it("falls back to an empty array when the API response omits custom_field_values", async () => {
      const result = await handlers["create_matter"](MIN_ARGS) as any;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.matter.custom_field_values).toEqual([]);
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

describe("list_matters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps custom_field_values from each matter in the API response", async () => {
    mockClioGet.mockResolvedValue({
      data: [{ ...MOCK_MATTER, custom_field_values: [{ custom_field: { id: 1, name: "X" }, value: 1 }] }],
    });
    const result = await handlers["list_matters"]({ limit: 25 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed[0].custom_field_values).toEqual([{ custom_field: { id: 1, name: "X" }, value: 1 }]);
  });

  it("falls back to an empty array when a matter has no custom_field_values", async () => {
    mockClioGet.mockResolvedValue({ data: [MOCK_MATTER] });
    const result = await handlers["list_matters"]({ limit: 25 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed[0].custom_field_values).toEqual([]);
  });
});

describe("get_matter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps custom_field_values in the returned matter detail", async () => {
    mockClioGet.mockResolvedValue({
      data: { ...MOCK_MATTER, custom_field_values: [{ custom_field: { id: 2, name: "Y" }, value: true }] },
    });
    const result = await handlers["get_matter"]({ matter_id: 42 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.custom_field_values).toEqual([{ custom_field: { id: 2, name: "Y" }, value: true }]);
  });
});

describe("update_matter", () => {
  const MIN_UPDATE_ARGS = { matter_id: 42 };

  beforeEach(() => {
    vi.clearAllMocks();
    mockClioPatch.mockResolvedValue({ data: MOCK_MATTER });
  });

  describe("guard clause", () => {
    it("returns an error and does not call clioPatch when no fields are provided", async () => {
      const result = await handlers["update_matter"](MIN_UPDATE_ARGS) as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Error: at least one field to update must be provided");
      expect(mockClioPatch).not.toHaveBeenCalled();
    });
  });

  describe("request body mapping", () => {
    it("sends client as a nested object when client_id is provided", async () => {
      await handlers["update_matter"]({ ...MIN_UPDATE_ARGS, client_id: 5 });
      const body = mockClioPatch.mock.calls[0][1] as any;
      expect(body.data).toEqual({ client: { id: 5 } });
    });

    it("sends description when provided", async () => {
      await handlers["update_matter"]({ ...MIN_UPDATE_ARGS, description: "Updated desc" });
      expect(mockClioPatch.mock.calls[0][1].data).toEqual({ description: "Updated desc" });
    });

    it("sends practice_area as a nested object when practice_area_id is provided", async () => {
      await handlers["update_matter"]({ ...MIN_UPDATE_ARGS, practice_area_id: 9 });
      expect(mockClioPatch.mock.calls[0][1].data).toEqual({ practice_area: { id: 9 } });
    });

    it("sends status when provided", async () => {
      await handlers["update_matter"]({ ...MIN_UPDATE_ARGS, status: "closed" });
      expect(mockClioPatch.mock.calls[0][1].data).toEqual({ status: "closed" });
    });

    it("sends open_date when provided", async () => {
      await handlers["update_matter"]({ ...MIN_UPDATE_ARGS, open_date: "2025-02-01" });
      expect(mockClioPatch.mock.calls[0][1].data).toEqual({ open_date: "2025-02-01" });
    });

    it("sends billable: false explicitly (falsy value still sent)", async () => {
      await handlers["update_matter"]({ ...MIN_UPDATE_ARGS, billable: false });
      expect(mockClioPatch.mock.calls[0][1].data).toEqual({ billable: false });
    });

    it("sends responsible_attorney as a nested object when responsible_attorney_id is provided", async () => {
      await handlers["update_matter"]({ ...MIN_UPDATE_ARGS, responsible_attorney_id: 3 });
      expect(mockClioPatch.mock.calls[0][1].data).toEqual({ responsible_attorney: { id: 3 } });
    });

    it("sends originating_attorney as a nested object when originating_attorney_id is provided", async () => {
      await handlers["update_matter"]({ ...MIN_UPDATE_ARGS, originating_attorney_id: 4 });
      expect(mockClioPatch.mock.calls[0][1].data).toEqual({ originating_attorney: { id: 4 } });
    });

    it("sends client_reference when provided", async () => {
      await handlers["update_matter"]({ ...MIN_UPDATE_ARGS, client_reference: "EXT-2" });
      expect(mockClioPatch.mock.calls[0][1].data).toEqual({ client_reference: "EXT-2" });
    });

    it("sends custom_field_values when provided, including an explicit empty array", async () => {
      const cfv = [{ custom_field: { id: 10 }, value: "Referral" }];
      await handlers["update_matter"]({ ...MIN_UPDATE_ARGS, custom_field_values: cfv });
      expect(mockClioPatch.mock.calls[0][1].data).toEqual({ custom_field_values: cfv });

      mockClioPatch.mockClear();
      await handlers["update_matter"]({ ...MIN_UPDATE_ARGS, custom_field_values: [] });
      expect(mockClioPatch.mock.calls[0][1].data).toEqual({ custom_field_values: [] });
    });

    it("sends only the field(s) provided, omitting all others", async () => {
      await handlers["update_matter"]({ ...MIN_UPDATE_ARGS, status: "pending" });
      expect(mockClioPatch.mock.calls[0][1].data).toEqual({ status: "pending" });
    });

    it("calls clioPatch with the correct matter path", async () => {
      await handlers["update_matter"]({ ...MIN_UPDATE_ARGS, status: "pending" });
      expect(mockClioPatch.mock.calls[0][0]).toBe("/matters/42.json");
    });
  });

  describe("response mapping", () => {
    it("returns the updated matter fields including custom_field_values", async () => {
      mockClioPatch.mockResolvedValue({
        data: { ...MOCK_MATTER, custom_field_values: [{ custom_field: { id: 1, name: "X" }, value: "Y" }] },
      });
      const result = await handlers["update_matter"]({ ...MIN_UPDATE_ARGS, status: "closed" }) as any;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.matter.id).toBe(42);
      expect(parsed.matter.custom_field_values).toEqual([{ custom_field: { id: 1, name: "X" }, value: "Y" }]);
    });
  });

  describe("audit log", () => {
    it("logs success with matter_id", async () => {
      await handlers["update_matter"]({ ...MIN_UPDATE_ARGS, status: "closed" });
      expect(mockAppendAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ tool: "update_matter", outcome: "success", matter_id: 42 }),
      );
    });

    it("logs error with error_message and matter_id on failure", async () => {
      mockClioPatch.mockRejectedValue(new Error("network failure"));
      await handlers["update_matter"]({ ...MIN_UPDATE_ARGS, status: "closed" });
      expect(mockAppendAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ tool: "update_matter", outcome: "error", error_message: "network failure", matter_id: 42 }),
      );
    });
  });

  describe("error handling", () => {
    it("returns Validation error prefix and isError for ClioApiError 422", async () => {
      mockClioPatch.mockRejectedValue(new MockClioApiError(422, "Invalid status"));
      const result = await handlers["update_matter"]({ ...MIN_UPDATE_ARGS, status: "closed" }) as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/^Validation error:/);
    });

    it("returns Error prefix and isError for a 404 ClioApiError", async () => {
      mockClioPatch.mockRejectedValue(new MockClioApiError(404, "Matter not found"));
      const result = await handlers["update_matter"]({ ...MIN_UPDATE_ARGS, status: "closed" }) as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/^Error:/);
    });

    it("returns Error prefix and isError for generic errors", async () => {
      mockClioPatch.mockRejectedValue(new Error("network failure"));
      const result = await handlers["update_matter"]({ ...MIN_UPDATE_ARGS, status: "closed" }) as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/^Error:/);
    });
  });
});
