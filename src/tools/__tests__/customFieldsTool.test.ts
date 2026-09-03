import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

const { mockClioGetAllPages, mockClioPost, mockAppendAuditLog, MockClioApiError } = vi.hoisted(() => {
  class MockClioApiError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
      this.name = "ClioApiError";
    }
  }
  return {
    mockClioGetAllPages: vi.fn(),
    mockClioPost: vi.fn(),
    mockAppendAuditLog: vi.fn().mockResolvedValue(undefined),
    MockClioApiError,
  };
});

vi.mock("../../utils/clioClient.js", () => ({
  clioGetAllPages: mockClioGetAllPages,
  clioPost: mockClioPost,
  ClioApiError: MockClioApiError,
}));

vi.mock("../../utils/auditLog.js", () => ({
  appendAuditLog: mockAppendAuditLog,
}));

import { registerCustomFieldTools } from "../customFields.js";

const handlers: Record<string, Function> = {};
const fakeServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    handlers[name] = handler;
  }),
};

beforeAll(() => {
  registerCustomFieldTools(fakeServer as any);
});

const PICKLIST_FIELD = {
  id: 55003,
  name: "Case Type",
  field_type: "picklist",
  parent_type: "Matter",
  required: false,
  displayed: true,
  deleted: false,
  picklist_options: [
    { id: 9001, option: "Credit Reporting" },
    { id: 9002, option: "Identity Theft" },
  ],
};

const TEXT_FIELD = {
  id: 55001,
  name: "Docket Number",
  field_type: "text_line",
  parent_type: "Matter",
  required: false,
  displayed: true,
  deleted: false,
};

describe("list_custom_fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClioGetAllPages.mockResolvedValue([TEXT_FIELD, PICKLIST_FIELD]);
  });

  describe("request params", () => {
    it("calls the custom fields endpoint", async () => {
      await handlers["list_custom_fields"]({ include_deleted: false });
      expect(mockClioGetAllPages.mock.calls[0][0]).toBe("/custom_fields.json");
    });

    it("filters by parent_type when given", async () => {
      await handlers["list_custom_fields"]({ parent_type: "Matter", include_deleted: false });
      expect(mockClioGetAllPages.mock.calls[0][1].parent_type).toBe("Matter");
    });

    it("omits parent_type so both matter and contact fields come back", async () => {
      await handlers["list_custom_fields"]({ include_deleted: false });
      expect(mockClioGetAllPages.mock.calls[0][1]).not.toHaveProperty("parent_type");
    });

    it("requests picklist options, which are what a write to the field needs", async () => {
      await handlers["list_custom_fields"]({ include_deleted: false });
      expect(mockClioGetAllPages.mock.calls[0][1].fields).toContain("picklist_options{id,option}");
    });

    it("reads every page, since a partial list sends callers hunting for a field that exists", async () => {
      await handlers["list_custom_fields"]({ include_deleted: false });
      // clioGetAllPages is the paginate-to-completion helper; using clioGet here
      // would silently cap the definitions at one page.
      expect(mockClioGetAllPages).toHaveBeenCalledTimes(1);
    });
  });

  describe("response mapping", () => {
    it("returns id, name, type and parent_type per field", async () => {
      const result = await handlers["list_custom_fields"]({ include_deleted: false }) as any;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.custom_fields[0]).toMatchObject({
        id: 55001,
        name: "Docket Number",
        type: "text_line",
        parent_type: "Matter",
      });
    });

    it("includes picklist options for picklist fields", async () => {
      const result = await handlers["list_custom_fields"]({ include_deleted: false }) as any;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.custom_fields[1].picklist_options).toEqual([
        { id: 9001, option: "Credit Reporting" },
        { id: 9002, option: "Identity Theft" },
      ]);
    });

    it("omits picklist_options entirely for non-picklist fields", async () => {
      const result = await handlers["list_custom_fields"]({ include_deleted: false }) as any;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.custom_fields[0]).not.toHaveProperty("picklist_options");
    });
  });

  describe("deleted fields", () => {
    beforeEach(() => {
      mockClioGetAllPages.mockResolvedValue([TEXT_FIELD, { ...PICKLIST_FIELD, deleted: true }]);
    });

    it("hides deleted fields by default", async () => {
      const result = await handlers["list_custom_fields"]({ include_deleted: false }) as any;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.custom_fields).toHaveLength(1);
      expect(parsed.custom_fields[0].id).toBe(55001);
    });

    it("includes and marks them when asked, since historical records still carry their values", async () => {
      const result = await handlers["list_custom_fields"]({ include_deleted: true }) as any;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.custom_fields).toHaveLength(2);
      expect(parsed.custom_fields[1].deleted).toBe(true);
    });
  });

  describe("empty and error handling", () => {
    it("says so plainly when the account has no custom fields", async () => {
      mockClioGetAllPages.mockResolvedValue([]);
      const result = await handlers["list_custom_fields"]({ include_deleted: false }) as any;
      expect(result.content[0].text).toBe("No custom fields are configured on this account.");
    });

    it("returns an error result rather than throwing", async () => {
      mockClioGetAllPages.mockRejectedValue(new Error("boom"));
      const result = await handlers["list_custom_fields"]({ include_deleted: false }) as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Error: boom");
    });

    it("adds a developer application permission hint on a 403", async () => {
      mockClioGetAllPages.mockRejectedValue(new MockClioApiError(403, "User is forbidden"));
      const result = await handlers["list_custom_fields"]({ include_deleted: false }) as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("User is forbidden");
      expect(result.content[0].text).toContain("Developer Applications");
    });
  });

  describe("audit log", () => {
    it("logs the call with its filters", async () => {
      await handlers["list_custom_fields"]({ parent_type: "Matter", include_deleted: false });
      expect(mockAppendAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ tool: "list_custom_fields", outcome: "success", result_count: 2 })
      );
    });

    it("logs failures too", async () => {
      mockClioGetAllPages.mockRejectedValue(new Error("boom"));
      await handlers["list_custom_fields"]({ include_deleted: false });
      expect(mockAppendAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ tool: "list_custom_fields", outcome: "error" })
      );
    });
  });
});

describe("create_custom_field", () => {
  const BASE_INPUT = {
    name: "Docket Number",
    parent_type: "Matter" as const,
    field_type: "text_line",
    required: false,
    displayed: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockClioPost.mockResolvedValue({ data: TEXT_FIELD });
  });

  describe("request payload", () => {
    it("posts to the custom fields endpoint", async () => {
      await handlers["create_custom_field"](BASE_INPUT);
      expect(mockClioPost.mock.calls[0][0]).toBe("/custom_fields.json");
    });

    it("sends name, parent_type, field_type, required and displayed", async () => {
      await handlers["create_custom_field"](BASE_INPUT);
      expect(mockClioPost.mock.calls[0][1]).toEqual({
        data: {
          name: "Docket Number",
          parent_type: "Matter",
          field_type: "text_line",
          required: false,
          displayed: true,
        },
      });
    });

    it("omits picklist_options when none are given", async () => {
      await handlers["create_custom_field"](BASE_INPUT);
      expect(mockClioPost.mock.calls[0][1].data).not.toHaveProperty("picklist_options");
    });

    it("sends picklist_options as {option} entries for a picklist field", async () => {
      await handlers["create_custom_field"]({
        ...BASE_INPUT,
        field_type: "picklist",
        picklist_options: ["Credit Reporting", "Identity Theft"],
      });
      expect(mockClioPost.mock.calls[0][1].data.picklist_options).toEqual([
        { option: "Credit Reporting" },
        { option: "Identity Theft" },
      ]);
    });
  });

  describe("response mapping", () => {
    it("returns the created field's id, name, type and parent_type", async () => {
      const result = await handlers["create_custom_field"](BASE_INPUT) as any;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.custom_field).toMatchObject({
        id: 55001,
        name: "Docket Number",
        type: "text_line",
        parent_type: "Matter",
      });
    });

    it("includes picklist_options for a created picklist field", async () => {
      mockClioPost.mockResolvedValue({ data: PICKLIST_FIELD });
      const result = await handlers["create_custom_field"]({
        ...BASE_INPUT,
        field_type: "picklist",
        picklist_options: ["Credit Reporting", "Identity Theft"],
      }) as any;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.custom_field.picklist_options).toEqual([
        { id: 9001, option: "Credit Reporting" },
        { id: 9002, option: "Identity Theft" },
      ]);
    });
  });

  describe("error handling", () => {
    it("returns a validation error message on 422", async () => {
      mockClioPost.mockRejectedValue(new MockClioApiError(422, "Name has already been taken"));
      const result = await handlers["create_custom_field"](BASE_INPUT) as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Validation error: Name has already been taken");
    });

    it("adds a developer application permission hint on a 403", async () => {
      mockClioPost.mockRejectedValue(new MockClioApiError(403, "User is forbidden"));
      const result = await handlers["create_custom_field"](BASE_INPUT) as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("User is forbidden");
      expect(result.content[0].text).toContain("Developer Applications");
    });

    it("returns a generic error result rather than throwing", async () => {
      mockClioPost.mockRejectedValue(new Error("boom"));
      const result = await handlers["create_custom_field"](BASE_INPUT) as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Error: boom");
    });
  });

  describe("audit log", () => {
    it("logs the call with field metadata but no values", async () => {
      await handlers["create_custom_field"](BASE_INPUT);
      expect(mockAppendAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: "create_custom_field",
          outcome: "success",
          args: expect.objectContaining({ parent_type: "Matter", field_type: "text_line" }),
        })
      );
    });

    it("never logs the field's name", async () => {
      await handlers["create_custom_field"](BASE_INPUT);
      const entry = mockAppendAuditLog.mock.calls.at(-1)![0];
      expect(entry.args).not.toHaveProperty("name");
    });

    it("logs failures too", async () => {
      mockClioPost.mockRejectedValue(new Error("boom"));
      await handlers["create_custom_field"](BASE_INPUT);
      expect(mockAppendAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ tool: "create_custom_field", outcome: "error" })
      );
    });
  });
});
