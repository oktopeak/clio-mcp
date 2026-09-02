import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

const { mockClioGet, mockAppendAuditLog, mockExtractNextPageToken } = vi.hoisted(() => ({
  mockClioGet: vi.fn(),
  mockAppendAuditLog: vi.fn().mockResolvedValue(undefined),
  mockExtractNextPageToken: vi.fn((meta: any) => {
    const nextUrl = meta?.paging?.next;
    if (!nextUrl) return null;
    try {
      return new URL(nextUrl).searchParams.get("page_token");
    } catch {
      return null;
    }
  }),
}));

vi.mock("../../utils/clioClient.js", () => ({
  clioGet: mockClioGet,
  extractNextPageToken: mockExtractNextPageToken,
}));

vi.mock("../../utils/auditLog.js", () => ({
  appendAuditLog: mockAppendAuditLog,
}));

import { registerRelationshipTools } from "../relationships.js";

const handlers: Record<string, Function> = {};
const fakeServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    handlers[name] = handler;
  }),
};

beforeAll(() => {
  registerRelationshipTools(fakeServer as any);
});

const MOCK_RELATIONSHIP = {
  id: 11,
  description: "Opposing Counsel",
  type: null,
  contact: {
    id: 5,
    name: "Jane Roe",
    type: "Person",
    primary_email_address: "jroe@example.com",
    primary_phone_number: "555-0100",
  },
  matter: { id: 42, display_number: "00042-001" },
};

describe("list_matter_relationships", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClioGet.mockResolvedValue({ data: [MOCK_RELATIONSHIP], meta: { records: 1 } });
  });

  describe("request params", () => {
    it("calls the relationships endpoint filtered by matter", async () => {
      await handlers["list_matter_relationships"]({ matter_id: 42, limit: 100 });
      expect(mockClioGet.mock.calls[0][0]).toBe("/relationships.json");
      expect(mockClioGet.mock.calls[0][1].matter_id).toBe("42");
    });

    it("requests contact detail so the caller does not need a second lookup per person", async () => {
      await handlers["list_matter_relationships"]({ matter_id: 42, limit: 100 });
      expect(mockClioGet.mock.calls[0][1].fields).toContain("contact{id,name");
    });

    it("passes page_token through", async () => {
      await handlers["list_matter_relationships"]({ matter_id: 42, limit: 100, page_token: "abc" });
      expect(mockClioGet.mock.calls[0][1].page_token).toBe("abc");
    });
  });

  describe("response mapping", () => {
    it("returns the role and the contact behind it", async () => {
      const result = await handlers["list_matter_relationships"]({ matter_id: 42, limit: 100 }) as any;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.relationships[0]).toEqual({
        id: 11,
        role: "Opposing Counsel",
        contact: { id: 5, name: "Jane Roe", type: "Person", email: "jroe@example.com", phone: "555-0100" },
      });
    });

    it("falls back to type when the firm's label lives there instead of description", async () => {
      mockClioGet.mockResolvedValue({
        data: [{ ...MOCK_RELATIONSHIP, description: null, type: "Expert" }],
        meta: { records: 1 },
      });
      const result = await handlers["list_matter_relationships"]({ matter_id: 42, limit: 100 }) as any;
      expect(JSON.parse(result.content[0].text).relationships[0].role).toBe("Expert");
    });

    it("tolerates a relationship with no contact attached", async () => {
      mockClioGet.mockResolvedValue({ data: [{ ...MOCK_RELATIONSHIP, contact: null }], meta: { records: 1 } });
      const result = await handlers["list_matter_relationships"]({ matter_id: 42, limit: 100 }) as any;
      expect(JSON.parse(result.content[0].text).relationships[0].contact).toBeNull();
    });

    it("says so plainly when a matter has no related contacts", async () => {
      mockClioGet.mockResolvedValue({ data: [], meta: { records: 0 } });
      const result = await handlers["list_matter_relationships"]({ matter_id: 42, limit: 100 }) as any;
      expect(result.content[0].text).toBe("No related contacts found on matter 42.");
    });
  });

  describe("pagination", () => {
    it("surfaces the next cursor when a full page came back", async () => {
      mockClioGet.mockResolvedValue({
        data: [MOCK_RELATIONSHIP],
        meta: { records: 5, paging: { next: "https://app.clio.com/api/v4/relationships.json?page_token=nxt" } },
      });
      const result = await handlers["list_matter_relationships"]({ matter_id: 42, limit: 1 }) as any;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.has_more).toBe(true);
      expect(parsed.next_page_token).toBe("nxt");
    });

    it("reports no more pages on a short page", async () => {
      const result = await handlers["list_matter_relationships"]({ matter_id: 42, limit: 100 }) as any;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.has_more).toBe(false);
      expect(parsed.next_page_token).toBeNull();
    });
  });

  describe("audit log", () => {
    it("logs the matter it read, and no contact names", async () => {
      await handlers["list_matter_relationships"]({ matter_id: 42, limit: 100 });
      const entry = mockAppendAuditLog.mock.calls[0][0];
      expect(entry).toMatchObject({ tool: "list_matter_relationships", outcome: "success", matter_id: 42 });
      expect(JSON.stringify(entry.args)).not.toContain("Jane Roe");
    });

    it("logs errors and returns them as a result", async () => {
      mockClioGet.mockRejectedValue(new Error("boom"));
      const result = await handlers["list_matter_relationships"]({ matter_id: 42, limit: 100 }) as any;
      expect(result.isError).toBe(true);
      expect(mockAppendAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ tool: "list_matter_relationships", outcome: "error" })
      );
    });
  });
});
