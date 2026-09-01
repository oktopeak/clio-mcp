import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

const { mockClioPost, mockClioGet, mockClioGetAllPages, mockAppendAuditLog, MockClioApiError } = vi.hoisted(() => {
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
    mockClioGetAllPages: vi.fn(),
    mockAppendAuditLog: vi.fn(),
    MockClioApiError,
  };
});

vi.mock("../../utils/clioClient.js", () => ({
  clioPost: mockClioPost,
  clioGet: mockClioGet,
  clioGetAllPages: mockClioGetAllPages,
  extractNextPageToken: (meta: any) => {
    const nextUrl = meta?.paging?.next;
    if (!nextUrl) return null;
    try { return new URL(nextUrl).searchParams.get("page_token"); }
    catch { return null; }
  },
  ClioApiError: MockClioApiError,
}));

vi.mock("../../utils/auditLog.js", () => ({
  appendAuditLog: mockAppendAuditLog,
}));

import { registerFolderTools } from "../folders.js";

const handlers: Record<string, Function> = {};
const fakeServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    handlers[name] = handler;
  }),
};

beforeAll(() => {
  registerFolderTools(fakeServer as any);
});

const MOCK_FOLDER = {
  id: 100,
  name: "Discovery",
  parent: { id: 42, type: "Matter" },
  created_at: "2026-05-21T00:00:00Z",
  matter: { id: 42, display_number: "00042-001" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── create_folder / resolveParentRef ───────────────────────────────────────

describe("create_folder", () => {
  beforeEach(() => {
    mockClioPost.mockResolvedValue({ data: MOCK_FOLDER });
  });

  it("sends parent type Matter when matter_id is provided", async () => {
    await handlers["create_folder"]({ name: "Discovery", matter_id: 42 });
    const body = mockClioPost.mock.calls[0][1] as any;
    expect(body.data.parent).toEqual({ id: 42, type: "Matter" });
    expect(body.data.name).toBe("Discovery");
  });

  it("sends parent type Folder when parent_folder_id is provided", async () => {
    await handlers["create_folder"]({ name: "Sub", parent_folder_id: 100 });
    const body = mockClioPost.mock.calls[0][1] as any;
    expect(body.data.parent).toEqual({ id: 100, type: "Folder" });
  });

  it("errors when both matter_id and parent_folder_id are provided", async () => {
    const result = await handlers["create_folder"]({ name: "X", matter_id: 42, parent_folder_id: 100 }) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/exactly one of/);
    expect(mockClioPost).not.toHaveBeenCalled();
  });

  it("errors when neither matter_id nor parent_folder_id are provided", async () => {
    const result = await handlers["create_folder"]({ name: "X" }) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/exactly one of/);
    expect(mockClioPost).not.toHaveBeenCalled();
  });

  it("logs success with matter_id on successful creation", async () => {
    await handlers["create_folder"]({ name: "Discovery", matter_id: 42 });
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "success", matter_id: 42 }),
    );
  });

  it("returns Validation error prefix for ClioApiError 422", async () => {
    mockClioPost.mockRejectedValue(new MockClioApiError(422, "Name has already been taken"));
    const result = await handlers["create_folder"]({ name: "Discovery", matter_id: 42 }) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^Validation error:/);
  });

  it("returns Error prefix for generic errors", async () => {
    mockClioPost.mockRejectedValue(new Error("network failure"));
    const result = await handlers["create_folder"]({ name: "Discovery", matter_id: 42 }) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^Error:/);
  });
});

// ─── folder_exists ───────────────────────────────────────────────────────────

describe("folder_exists", () => {
  it("finds a folder even when its parent.type is Folder, not Matter (regression for the parent-typing bug)", async () => {
    // Simulates a matter whose document root is itself a Folder node: the target
    // folder's parent.type is "Folder", which a naive parent.type==="Matter" filter
    // would have wrongly excluded.
    mockClioGetAllPages.mockResolvedValue([
      { id: 200, name: "Correspondence", parent: { id: 999, type: "Folder" } },
      { id: 201, name: "Discovery", parent: { id: 999, type: "Folder" } },
    ]);

    const result = await handlers["folder_exists"]({ matter_id: 42, name: "Discovery" }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.exists).toBe(true);
    expect(parsed.folder.id).toBe(201);
  });

  it("fully paginates via clioGetAllPages rather than reading a single page", async () => {
    mockClioGetAllPages.mockResolvedValue([{ id: 300, name: "Discovery", parent: { id: 42, type: "Matter" } }]);
    await handlers["folder_exists"]({ matter_id: 42, name: "Discovery" });
    expect(mockClioGetAllPages).toHaveBeenCalledWith(
      "/folders.json",
      expect.objectContaining({ matter_id: "42", query: "Discovery" }),
    );
  });

  it("never filters candidates by parent.type", async () => {
    mockClioGetAllPages.mockResolvedValue([{ id: 400, name: "Discovery", parent: { id: 999, type: "Folder" } }]);
    const result = await handlers["folder_exists"]({ matter_id: 42, name: "Discovery" }) as any;
    const params = mockClioGetAllPages.mock.calls[0][1] as any;
    expect(params).not.toHaveProperty("parent_type");
    expect(JSON.parse(result.content[0].text).exists).toBe(true);
  });

  it("returns exists:false when no exact name match is found (substring matches from Clio's query are not enough)", async () => {
    mockClioGetAllPages.mockResolvedValue([{ id: 500, name: "Discovery Drafts", parent: { id: 42, type: "Matter" } }]);
    const result = await handlers["folder_exists"]({ matter_id: 42, name: "Discovery" }) as any;
    expect(JSON.parse(result.content[0].text).exists).toBe(false);
  });

  it("scopes by parent_folder_id using parent_id param when given instead of matter_id", async () => {
    mockClioGetAllPages.mockResolvedValue([]);
    await handlers["folder_exists"]({ parent_folder_id: 100, name: "Discovery" });
    expect(mockClioGetAllPages).toHaveBeenCalledWith(
      "/folders.json",
      expect.objectContaining({ parent_id: "100", query: "Discovery" }),
    );
  });

  it("errors when neither matter_id nor parent_folder_id are provided", async () => {
    const result = await handlers["folder_exists"]({ name: "Discovery" }) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/exactly one of/);
  });
});

// ─── list_folders ────────────────────────────────────────────────────────────

describe("list_folders", () => {
  it("requires at least one of matter_id, parent_id, or query", async () => {
    const result = await handlers["list_folders"]({ limit: 25 }) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/provide at least one of/);
  });

  it("returns folders with parent shape and pagination fields", async () => {
    mockClioGet.mockResolvedValue({
      data: [MOCK_FOLDER],
      meta: { records: 1, paging: {} },
    });
    const result = await handlers["list_folders"]({ matter_id: 42, limit: 25 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.folders[0]).toMatchObject({ id: 100, name: "Discovery", parent: { id: 42, type: "Matter" } });
    expect(parsed.has_more).toBe(false);
    expect(parsed.next_page_token).toBeNull();
  });

  it("reports has_more and next_page_token when a next page cursor is present", async () => {
    const manyFolders = Array.from({ length: 2 }, (_, i) => ({ ...MOCK_FOLDER, id: i }));
    mockClioGet.mockResolvedValue({
      data: manyFolders,
      meta: { records: 10, paging: { next: "https://app.clio.com/api/v4/folders.json?page_token=abc123" } },
    });
    const result = await handlers["list_folders"]({ matter_id: 42, limit: 2 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.has_more).toBe(true);
    expect(parsed.next_page_token).toBe("abc123");
  });

  it("logs success with result_count", async () => {
    mockClioGet.mockResolvedValue({ data: [MOCK_FOLDER], meta: { records: 1 } });
    await handlers["list_folders"]({ matter_id: 42 });
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "success", result_count: 1, matter_id: 42 }),
    );
  });

  it("returns Error prefix on generic failure", async () => {
    mockClioGet.mockRejectedValue(new Error("network failure"));
    const result = await handlers["list_folders"]({ matter_id: 42 }) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^Error:/);
  });

  it("returns a JSON result with has_more: false when the page is empty, not a plain-text sentinel", async () => {
    mockClioGet.mockResolvedValue({ data: [], meta: { records: 0, paging: {} } });
    const result = await handlers["list_folders"]({ matter_id: 42, limit: 25 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.folders).toEqual([]);
    expect(parsed.has_more).toBe(false);
    expect(parsed.next_page_token).toBeNull();
  });
});
