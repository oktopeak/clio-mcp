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

describe("search_contacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps custom_field_values from each contact in the API response", async () => {
    mockClioGet.mockResolvedValue({
      data: [{ ...MOCK_CONTACT, custom_field_values: [{ custom_field: { id: 1, name: "Referral Source" }, value: "Web" }] }],
      meta: { records: 1 },
    });
    const result = await handlers["search_contacts"]({ query: "Acme", limit: 25 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.contacts[0].custom_field_values).toEqual([{ custom_field: { id: 1, name: "Referral Source" }, value: "Web" }]);
  });

  it("falls back to an empty array when a contact has no custom_field_values", async () => {
    mockClioGet.mockResolvedValue({ data: [MOCK_CONTACT], meta: { records: 1 } });
    const result = await handlers["search_contacts"]({ query: "Acme", limit: 25 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.contacts[0].custom_field_values).toEqual([]);
  });
});

describe("get_contact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps custom_field_values in the returned contact detail", async () => {
    mockClioGet.mockResolvedValue({
      data: { ...MOCK_CONTACT, custom_field_values: [{ custom_field: { id: 2, name: "Intake Status" }, value: "Active" }] },
    });
    const result = await handlers["get_contact"]({ contact_id: 5 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.custom_field_values).toEqual([{ custom_field: { id: 2, name: "Intake Status" }, value: "Active" }]);
  });

  it("falls back to an empty array when the API response omits custom_field_values", async () => {
    mockClioGet.mockResolvedValue({ data: MOCK_CONTACT });
    const result = await handlers["get_contact"]({ contact_id: 5 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.custom_field_values).toEqual([]);
  });

  it("returns a not-found message for a 404 without throwing", async () => {
    mockClioGet.mockRejectedValue(new MockClioApiError(404, "Contact not found"));
    const result = await handlers["get_contact"]({ contact_id: 999 }) as any;
    expect(result.content[0].text).toBe("Contact 999 not found.");
  });
});
