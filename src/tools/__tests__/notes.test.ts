import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

const { mockClioGet, mockClioPost, mockAppendAuditLog, mockExtractNextPageToken } = vi.hoisted(() => ({
  mockClioGet: vi.fn(),
  mockClioPost: vi.fn(),
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
  clioPost: mockClioPost,
  extractNextPageToken: mockExtractNextPageToken,
}));

vi.mock("../../utils/auditLog.js", () => ({
  appendAuditLog: mockAppendAuditLog,
}));

import { registerNoteTools } from "../notes.js";

const handlers: Record<string, Function> = {};
const fakeServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    handlers[name] = handler;
  }),
};

beforeAll(() => {
  registerNoteTools(fakeServer as any);
});

const MOCK_NOTE = {
  id: 7,
  subject: "Client call",
  detail: "Discussed settlement terms.",
  type: "Matter",
  matter: { id: 42, display_number: "00042-001" },
  contact: null,
  author: { id: 3, name: "Jane Attorney" },
  created_at: "2026-05-01T10:00:00Z",
  updated_at: "2026-05-01T10:00:00Z",
};

describe("list_notes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("guard clause", () => {
    it("returns an error and does not call clioGet when neither matter_id nor contact_id is provided", async () => {
      const result = await handlers["list_notes"]({ limit: 25 }) as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Error: provide at least one of matter_id or contact_id");
      expect(mockClioGet).not.toHaveBeenCalled();
    });
  });

  describe("request params", () => {
    beforeEach(() => {
      mockClioGet.mockResolvedValue({ data: [MOCK_NOTE], meta: { records: 1 } });
    });

    it("filters by matter_id and sends type=Matter", async () => {
      await handlers["list_notes"]({ matter_id: 42, limit: 25 });
      const params = mockClioGet.mock.calls[0][1] as Record<string, string>;
      expect(params.matter_id).toBe("42");
      expect(params.type).toBe("Matter");
      expect(params).not.toHaveProperty("contact_id");
    });

    it("filters by contact_id and sends type=Contact", async () => {
      await handlers["list_notes"]({ contact_id: 5, limit: 25 });
      const params = mockClioGet.mock.calls[0][1] as Record<string, string>;
      expect(params.contact_id).toBe("5");
      expect(params.type).toBe("Contact");
      expect(params).not.toHaveProperty("matter_id");
    });

    it("sends type=Matter when both matter_id and contact_id are provided", async () => {
      await handlers["list_notes"]({ matter_id: 42, contact_id: 5, limit: 25 });
      const params = mockClioGet.mock.calls[0][1] as Record<string, string>;
      expect(params.type).toBe("Matter");
    });

    it("includes page_token when provided", async () => {
      await handlers["list_notes"]({ matter_id: 42, limit: 25, page_token: "abc" });
      const params = mockClioGet.mock.calls[0][1] as Record<string, string>;
      expect(params.page_token).toBe("abc");
    });

    it("calls the notes endpoint", async () => {
      await handlers["list_notes"]({ matter_id: 42, limit: 25 });
      expect(mockClioGet.mock.calls[0][0]).toBe("/notes.json");
    });
  });

  describe("response mapping", () => {
    it("maps subject, detail, author, matter, and dates", async () => {
      mockClioGet.mockResolvedValue({ data: [MOCK_NOTE], meta: { records: 1 } });
      const result = await handlers["list_notes"]({ matter_id: 42, limit: 25 }) as any;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.notes[0]).toEqual({
        id: 7,
        subject: "Client call",
        detail: "Discussed settlement terms.",
        author: { id: 3, name: "Jane Attorney" },
        matter: { id: 42, display_number: "00042-001" },
        contact: null,
        created_at: "2026-05-01T10:00:00Z",
        updated_at: "2026-05-01T10:00:00Z",
      });
    });

    it("maps contact when the note is attached to a contact", async () => {
      mockClioGet.mockResolvedValue({
        data: [{ ...MOCK_NOTE, matter: null, contact: { id: 5, name: "Acme Corp" } }],
        meta: { records: 1 },
      });
      const result = await handlers["list_notes"]({ contact_id: 5, limit: 25 }) as any;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.notes[0].matter).toBeNull();
      expect(parsed.notes[0].contact).toEqual({ id: 5, name: "Acme Corp" });
    });

    it("returns 'No notes found.' when the API response is empty", async () => {
      mockClioGet.mockResolvedValue({ data: [], meta: { records: 0 } });
      const result = await handlers["list_notes"]({ matter_id: 42, limit: 25 }) as any;
      expect(result.content[0].text).toBe("No notes found.");
    });
  });

  describe("pagination", () => {
    it("returns has_more and next_page_token when more results are available", async () => {
      mockClioGet.mockResolvedValue({
        data: [MOCK_NOTE],
        meta: { records: 5, paging: { next: "https://app.clio.com/api/v4/notes.json?page_token=next123" } },
      });
      const result = await handlers["list_notes"]({ matter_id: 42, limit: 1 }) as any;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.has_more).toBe(true);
      expect(parsed.next_page_token).toBe("next123");
    });

    it("does not paginate when results are fewer than the limit", async () => {
      mockClioGet.mockResolvedValue({ data: [MOCK_NOTE], meta: { records: 1 } });
      const result = await handlers["list_notes"]({ matter_id: 42, limit: 25 }) as any;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.has_more).toBe(false);
      expect(parsed.next_page_token).toBeNull();
    });
  });

  describe("audit log", () => {
    it("logs success with matter_id and result_count", async () => {
      mockClioGet.mockResolvedValue({ data: [MOCK_NOTE], meta: { records: 1 } });
      await handlers["list_notes"]({ matter_id: 42, limit: 25 });
      expect(mockAppendAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ tool: "list_notes", outcome: "success", result_count: 1, matter_id: 42 }),
      );
    });

    it("logs error with error_message on failure", async () => {
      mockClioGet.mockRejectedValue(new Error("network failure"));
      await handlers["list_notes"]({ matter_id: 42, limit: 25 });
      expect(mockAppendAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ tool: "list_notes", outcome: "error", error_message: "network failure" }),
      );
    });
  });

  describe("error handling", () => {
    it("returns Error prefix and isError for generic errors", async () => {
      mockClioGet.mockRejectedValue(new Error("network failure"));
      const result = await handlers["list_notes"]({ matter_id: 42, limit: 25 }) as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/^Error:/);
    });
  });
});
