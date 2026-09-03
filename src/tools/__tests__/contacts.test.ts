import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

const { mockClioGet, mockAppendAuditLog, MockClioApiError } = vi.hoisted(() => {
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
    mockAppendAuditLog: vi.fn().mockResolvedValue(undefined),
    MockClioApiError,
  };
});

vi.mock("../../utils/clioClient.js", () => ({
  clioGet: mockClioGet,
  ClioApiError: MockClioApiError,
  extractNextPageToken: vi.fn((meta: any) => {
    const nextUrl = meta?.paging?.next;
    if (!nextUrl) return null;
    try {
      return new URL(nextUrl).searchParams.get("page_token");
    } catch {
      return null;
    }
  }),
}));

vi.mock("../../utils/auditLog.js", () => ({
  appendAuditLog: mockAppendAuditLog,
}));

import { registerContactTools } from "../contacts.js";

const handlers: Record<string, Function> = {};
const fakeServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    handlers[name] = handler;
  }),
};

beforeAll(() => {
  registerContactTools(fakeServer as any);
});

const MOCK_CONTACT = {
  id: 5,
  name: "Acme Corp",
  first_name: null,
  last_name: null,
  title: null,
  type: "Company",
  company: null,
  email_addresses: [],
  phone_numbers: [],
  addresses: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const PICKLIST_VALUE = {
  id: "picklist-55003",
  field_name: "Intake Source",
  field_type: "picklist",
  value: "9002",
  custom_field: { id: 55003 },
  picklist_option: { id: 9002, option: "Referral" },
};

describe("search_contacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requests picklist_option so labels are available", async () => {
    mockClioGet.mockResolvedValue({ data: [MOCK_CONTACT], meta: { records: 1 } });
    await handlers["search_contacts"]({ query: "Acme", limit: 25 });
    expect(mockClioGet.mock.calls[0][1].fields).toContain("picklist_option");
  });

  it("maps custom fields by name with a resolved picklist label", async () => {
    mockClioGet.mockResolvedValue({
      data: [{ ...MOCK_CONTACT, custom_field_values: [PICKLIST_VALUE] }],
      meta: { records: 1 },
    });
    const result = await handlers["search_contacts"]({ query: "Acme", limit: 25 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.contacts[0].custom_fields).toEqual([
      { id: "picklist-55003", field_id: 55003, name: "Intake Source", type: "picklist", value: "9002", display_value: "Referral" },
    ]);
  });

  it("falls back to an empty array when a contact has no custom fields", async () => {
    mockClioGet.mockResolvedValue({ data: [MOCK_CONTACT], meta: { records: 1 } });
    const result = await handlers["search_contacts"]({ query: "Acme", limit: 25 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.contacts[0].custom_fields).toEqual([]);
  });

  it("adds a permission-hint warning when a custom field value is stripped to its id", async () => {
    mockClioGet.mockResolvedValue({
      data: [{ ...MOCK_CONTACT, custom_field_values: [{ id: "text_line-999" }] }],
      meta: { records: 1 },
    });
    const result = await handlers["search_contacts"]({ query: "Acme", limit: 25 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.custom_fields_warning).toMatch(/custom field permission/);
  });

  it("omits the warning when custom field values are normally populated", async () => {
    mockClioGet.mockResolvedValue({
      data: [{ ...MOCK_CONTACT, custom_field_values: [PICKLIST_VALUE] }],
      meta: { records: 1 },
    });
    const result = await handlers["search_contacts"]({ query: "Acme", limit: 25 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.custom_fields_warning).toBeUndefined();
  });
});

describe("get_contact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps custom fields in the returned contact detail", async () => {
    mockClioGet.mockResolvedValue({
      data: {
        ...MOCK_CONTACT,
        custom_field_values: [
          { id: "text_line-2", field_name: "Intake Status", field_type: "text_line", value: "Active", custom_field: { id: 2 } },
        ],
      },
    });
    const result = await handlers["get_contact"]({ contact_id: 5 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.custom_fields).toEqual([
      { id: "text_line-2", field_id: 2, name: "Intake Status", type: "text_line", value: "Active", display_value: "Active" },
    ]);
  });

  it("falls back to an empty array when the API response omits custom fields", async () => {
    mockClioGet.mockResolvedValue({ data: MOCK_CONTACT });
    const result = await handlers["get_contact"]({ contact_id: 5 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.custom_fields).toEqual([]);
  });

  it("adds a permission-hint warning when a custom field value is stripped to its id", async () => {
    mockClioGet.mockResolvedValue({
      data: { ...MOCK_CONTACT, custom_field_values: [{ id: "picklist-999" }] },
    });
    const result = await handlers["get_contact"]({ contact_id: 5 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.custom_fields_warning).toMatch(/custom field permission/);
  });

  it("returns a not-found message for a 404 without throwing", async () => {
    mockClioGet.mockRejectedValue(new MockClioApiError(404, "Contact not found"));
    const result = await handlers["get_contact"]({ contact_id: 999 }) as any;
    expect(result.content[0].text).toBe("Contact 999 not found.");
  });
});
