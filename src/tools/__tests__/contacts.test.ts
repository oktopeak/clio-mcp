import z from "zod";
import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

const { mockClioGet, mockClioGetAllPages, mockAppendAuditLog, MockClioApiError } = vi.hoisted(() => {
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
    mockClioGetAllPages: vi.fn().mockResolvedValue([]),
    mockAppendAuditLog: vi.fn().mockResolvedValue(undefined),
    MockClioApiError,
  };
});

vi.mock("../../utils/clioClient.js", () => ({
  clioGet: mockClioGet,
  clioGetAllPages: mockClioGetAllPages,
  clioGetWithFieldFallback: async (path: string, params: any) => ({ body: await mockClioGet(path, params) }),
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
const schemas: Record<string, any> = {};
const fakeServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    handlers[name] = handler;
    schemas[name] = _schema.inputSchema;
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
  sales_tax_number: null,
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

  // Deliberately invalid, synthetic tax identifiers; never use client data in fixtures.
  it("returns the native tax number and ETag for a contact edit", async () => {
    mockClioGet.mockResolvedValue({ data: { ...MOCK_CONTACT, etag: "v1", sales_tax_number: "000000000" } });
    const result = await handlers["get_contact"]({ contact_id: 5 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(mockClioGet.mock.calls[0][1].fields).toContain("sales_tax_number");
    expect(parsed).toMatchObject({ etag: "v1", sales_tax_number: "000000000" });
  });

  it("falls back to an empty array when the API response omits custom fields", async () => {
    mockClioGet.mockResolvedValue({ data: MOCK_CONTACT });
    const result = await handlers["get_contact"]({ contact_id: 5 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.custom_fields).toEqual([]);
  });

  it("returns a not-found message for a 404 without throwing", async () => {
    mockClioGet.mockRejectedValue(new MockClioApiError(404, "Contact not found"));
    const result = await handlers["get_contact"]({ contact_id: 999 }) as any;
    expect(result.content[0].text).toBe("Contact 999 not found.");
  });
});


describe("custom field warnings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClioGetAllPages.mockResolvedValue([]);
  });

  it("search_contacts warns when a value came back as an id and nothing else", async () => {
    mockClioGet.mockResolvedValue({
      data: [{ ...MOCK_CONTACT, custom_field_values: [{ id: "text_line-999" }] }],
      meta: { records: 1 },
    });
    const result = await handlers["search_contacts"]({ query: "Acme", limit: 25 }) as any;
    expect(JSON.parse(result.content[0].text).custom_fields_warning).toBeDefined();
  });

  it("get_contact warns on the same shape and stays a success", async () => {
    mockClioGet.mockResolvedValue({ data: { ...MOCK_CONTACT, custom_field_values: [{ id: "picklist-999" }] } });
    const result = await handlers["get_contact"]({ contact_id: 5 }) as any;
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text).custom_fields_warning).toBeDefined();
  });

  it("says nothing when the values came back normally", async () => {
    mockClioGet.mockResolvedValue({ data: { ...MOCK_CONTACT, custom_field_values: [PICKLIST_VALUE] } });
    const result = await handlers["get_contact"]({ contact_id: 5 }) as any;
    expect(JSON.parse(result.content[0].text).custom_fields_warning).toBeUndefined();
  });
});


describe("contact enumeration and edit identifiers", () => {
  beforeEach(() => { vi.clearAllMocks(); mockClioGet.mockReset(); mockClioGetAllPages.mockResolvedValue([]); });
  it("follows short pages and forwards the cursor without a query", async () => {
    mockClioGet.mockResolvedValueOnce({ data: [MOCK_CONTACT], meta: {paging: {
      next: "https://eu.app.clio.com/api/v4/contacts.json?page_token=p2"}}})
      .mockResolvedValueOnce({data: [], meta: {}});
    const first = JSON.parse((await handlers.list_contacts({limit:25})).content[0].text);
    expect(first).toMatchObject({has_more:true,next_page_token:"p2"});
    expect(mockClioGet.mock.calls[0][1]).not.toHaveProperty("query");
    const second = JSON.parse((await handlers.list_contacts({limit:25,page_token:"p2"})).content[0].text);
    expect(mockClioGet.mock.calls[1][1]).toMatchObject({page_token:"p2",limit:"25"});
    expect(second).toMatchObject({contacts:[],has_more:false,next_page_token:null});
  });
  it("retains a search cursor even on a short page", async () => {
    mockClioGet.mockResolvedValue({data:[MOCK_CONTACT],meta:{paging:{next:"https://eu.app.clio.com/api/v4/contacts.json?page_token=p2"}}});
    expect(JSON.parse((await handlers.search_contacts({query:"Acme",limit:25})).content[0].text).next_page_token).toBe("p2");
  });
  it("defaults and bounds listing inputs", () => {
    const schema=z.object(schemas.list_contacts);
    expect(schema.parse({})).toEqual({limit:25});
    for (const input of [{limit:0},{limit:201},{page_token:""}]) expect(schema.safeParse(input).success).toBe(false);
  });
  it("returns ETag and nested IDs while preserving labels", async () => {
    mockClioGet.mockResolvedValue({data:{...MOCK_CONTACT,etag:'"v1"',
      email_addresses:[{id:10,name:"Work",address:"a@example.test"}],
      phone_numbers:[{id:11,name:"Mobile",number:"+351 210 000 000"}],
      addresses:[{id:12,name:"Home",city:"Lisboa"}]}});
    const data=JSON.parse((await handlers.get_contact({contact_id:5})).content[0].text);
    expect(data).toMatchObject({etag:'"v1"',emails:[{id:10,label:"Work",address:"a@example.test"}],
      phone_numbers:[{id:11,label:"Mobile"}],addresses:[{id:12,label:"Home",city:"Lisboa"}]});
    expect(mockClioGet.mock.calls[0][1].fields).toContain("email_addresses{id,address,name}");
  });
  it("keeps upstream contact data out of listing errors and audit entries", async () => {
    mockClioGet.mockRejectedValue(new MockClioApiError(403,"PRIVATE_CONTACT"));
    const result=await handlers.list_contacts({limit:25});
    expect(result.isError).toBe(true);
    expect(JSON.stringify([result,mockAppendAuditLog.mock.calls])).not.toContain("PRIVATE_CONTACT");
  });
});


it("records only a failure when a listing response cannot be mapped", async () => {
  vi.clearAllMocks(); mockClioGet.mockReset();
  mockClioGet.mockResolvedValue({data:{unexpected:"PRIVATE_CONTACT"},meta:{}});
  const r=await handlers.list_contacts({limit:25});
  expect(r.isError).toBe(true);
  expect(mockAppendAuditLog).toHaveBeenCalledTimes(1);
  expect(mockAppendAuditLog).toHaveBeenCalledWith(expect.objectContaining({outcome:"error"}));
});
