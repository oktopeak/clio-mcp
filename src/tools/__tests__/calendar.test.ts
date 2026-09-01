import { vi, describe, it, expect, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const { mockClioGet, mockAppendAuditLog } = vi.hoisted(() => ({
  mockClioGet: vi.fn(),
  mockAppendAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/clioClient.js", () => ({
  clioGet: mockClioGet,
  clioPost: vi.fn(),
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

import { toIso, registerCalendarTools } from "../calendar.js";

function buildHandlers(): Record<string, Function> {
  const handlers: Record<string, Function> = {};
  const mockServer = {
    registerTool: vi.fn((name: string, _schema: unknown, handler: Function) => {
      handlers[name] = handler;
    }),
  } as unknown as McpServer;
  registerCalendarTools(mockServer);
  return handlers;
}

const FAKE_ENTRY = {
  id: 1,
  summary: "Deposition",
  description: null,
  start_at: "2026-06-01T09:00:00Z",
  end_at: "2026-06-01T10:00:00Z",
  matter: { id: 42, display_number: "00042-001" },
  attendees: [],
};

describe("list_calendar_entries", () => {
  let handlers: Record<string, Function>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAppendAuditLog.mockResolvedValue(undefined);
    handlers = buildHandlers();
  });

  it("returns has_more: false and next_page_token: null on a short final page", async () => {
    mockClioGet.mockResolvedValue({ data: [FAKE_ENTRY], meta: { records: 1, paging: {} } });
    const result = await handlers["list_calendar_entries"]({ from: "2026-06-01", to: "2026-06-30", limit: 25 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.has_more).toBe(false);
    expect(parsed.next_page_token).toBeNull();
  });

  it("returns has_more: true and the extracted token when a next page cursor is present", async () => {
    const twoEntries = [FAKE_ENTRY, { ...FAKE_ENTRY, id: 2 }];
    mockClioGet.mockResolvedValue({
      data: twoEntries,
      meta: { records: 10, paging: { next: "https://app.clio.com/api/v4/calendar_entries.json?page_token=abc123" } },
    });
    const result = await handlers["list_calendar_entries"]({ from: "2026-06-01", to: "2026-06-30", limit: 2 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.has_more).toBe(true);
    expect(parsed.next_page_token).toBe("abc123");
  });

  it("forwards page_token into the outgoing request params when supplied", async () => {
    mockClioGet.mockResolvedValue({ data: [FAKE_ENTRY], meta: { records: 1 } });
    await handlers["list_calendar_entries"]({ from: "2026-06-01", to: "2026-06-30", limit: 25, page_token: "xyz" });
    expect(mockClioGet).toHaveBeenCalledWith(
      "/calendar_entries.json",
      expect.objectContaining({ page_token: "xyz" }),
    );
  });

  it("returns a JSON result with has_more: false when the page is empty, not a plain-text sentinel", async () => {
    mockClioGet.mockResolvedValue({ data: [], meta: { records: 0, paging: {} } });
    const result = await handlers["list_calendar_entries"]({ from: "2026-06-01", to: "2026-06-30", limit: 25 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.entries).toEqual([]);
    expect(parsed.has_more).toBe(false);
    expect(parsed.next_page_token).toBeNull();
  });
});

const FAKE_CALENDAR = { id: 7, name: "Firm Calendar", type: "UserCalendar", color: "#ff0000" };

describe("list_calendars", () => {
  let handlers: Record<string, Function>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAppendAuditLog.mockResolvedValue(undefined);
    handlers = buildHandlers();
  });

  it("returns has_more: false and next_page_token: null on a short final page", async () => {
    mockClioGet.mockResolvedValue({ data: [FAKE_CALENDAR], meta: { records: 1, paging: {} } });
    const result = await handlers["list_calendars"]({ limit: 25 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.has_more).toBe(false);
    expect(parsed.next_page_token).toBeNull();
  });

  it("returns has_more: true and the extracted token when a next page cursor is present", async () => {
    const twoCalendars = [FAKE_CALENDAR, { ...FAKE_CALENDAR, id: 8 }];
    mockClioGet.mockResolvedValue({
      data: twoCalendars,
      meta: { records: 10, paging: { next: "https://app.clio.com/api/v4/calendars.json?page_token=abc123" } },
    });
    const result = await handlers["list_calendars"]({ limit: 2 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.has_more).toBe(true);
    expect(parsed.next_page_token).toBe("abc123");
  });

  it("forwards page_token into the outgoing request params when supplied", async () => {
    mockClioGet.mockResolvedValue({ data: [FAKE_CALENDAR], meta: { records: 1 } });
    await handlers["list_calendars"]({ limit: 25, page_token: "xyz" });
    expect(mockClioGet).toHaveBeenCalledWith(
      "/calendars.json",
      expect.objectContaining({ page_token: "xyz" }),
    );
  });

  it("returns a JSON result with has_more: false when the page is empty, not a plain-text sentinel", async () => {
    mockClioGet.mockResolvedValue({ data: [], meta: { records: 0, paging: {} } });
    const result = await handlers["list_calendars"]({ limit: 25 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.calendars).toEqual([]);
    expect(parsed.has_more).toBe(false);
    expect(parsed.next_page_token).toBeNull();
  });
});

describe("toIso", () => {
  describe("date-only input", () => {
    it("expands to start of day by default", () => {
      expect(toIso("2026-06-01")).toBe("2026-06-01T00:00:00");
    });

    it("expands to end of day when endOfDay=true", () => {
      expect(toIso("2026-06-01", true)).toBe("2026-06-01T23:59:59");
    });
  });

  describe("date+HH:MM input", () => {
    it("pads seconds", () => {
      expect(toIso("2026-06-01T09:00")).toBe("2026-06-01T09:00:00");
    });

    it("endOfDay flag is ignored when time is present", () => {
      expect(toIso("2026-06-01T09:00", true)).toBe("2026-06-01T09:00:00");
    });
  });

  describe("date+HH:MM:SS input", () => {
    it("passes through unchanged", () => {
      expect(toIso("2026-06-01T09:00:00")).toBe("2026-06-01T09:00:00");
    });

    it("endOfDay flag is ignored when time is present", () => {
      expect(toIso("2026-06-01T09:00:00", true)).toBe("2026-06-01T09:00:00");
    });
  });
});
