import { vi, describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";

const { mockClioGetAllPages, mockAppendAuditLog } = vi.hoisted(() => ({
  mockClioGetAllPages: vi.fn(),
  mockAppendAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/clioClient.js", () => ({
  clioGetAllPages: mockClioGetAllPages,
}));

vi.mock("../../utils/auditLog.js", () => ({
  appendAuditLog: mockAppendAuditLog,
}));

import { registerActivitySummaryTools } from "../activitySummary.js";

const handlers: Record<string, Function> = {};
const fakeServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    handlers[name] = handler;
  }),
};

beforeAll(() => {
  registerActivitySummaryTools(fakeServer as any);
});

const NOW = new Date("2026-09-01T12:00:00Z");

const ARGS = { lookback_days: 90, calendar_days_ahead: 90, limit: 100 };

const MATTER_A = { id: 1, display_number: "00001-001", description: "Busy matter", status: "open", client: { id: 9, name: "Acme" } };
const MATTER_B = { id: 2, display_number: "00002-001", description: "Quiet matter", status: "open", client: { id: 8, name: "Beta" } };

/** Wires the five account-wide reads in the order the tool issues them. */
function mockCollections(opts: {
  matters?: any[];
  notes?: any[];
  activities?: any[];
  calendar?: any[];
  tasks?: any[];
}) {
  mockClioGetAllPages.mockImplementation(async (path: string) => {
    if (path === "/matters.json") return opts.matters ?? [];
    if (path === "/notes.json") return opts.notes ?? [];
    if (path === "/activities.json") return opts.activities ?? [];
    if (path === "/calendar_entries.json") return opts.calendar ?? [];
    if (path === "/tasks.json") return opts.tasks ?? [];
    throw new Error(`unexpected path ${path}`);
  });
}

async function run(args: Record<string, unknown> = {}) {
  const result = await handlers["matter_activity_summary"]({ ...ARGS, ...args }) as any;
  return { result, parsed: JSON.parse(result.content[0].text) };
}

describe("matter_activity_summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("request shape", () => {
    it("reads each collection once account-wide instead of once per matter", async () => {
      // The whole point of this tool: a per-matter loop over a few hundred
      // matters is a thousand-plus requests and walks into the rate limiter.
      mockCollections({ matters: [MATTER_A, MATTER_B] });
      await run();
      expect(mockClioGetAllPages).toHaveBeenCalledTimes(5);
      const paths = mockClioGetAllPages.mock.calls.map((c) => c[0]).sort();
      expect(paths).toEqual([
        "/activities.json",
        "/calendar_entries.json",
        "/matters.json",
        "/notes.json",
        "/tasks.json",
      ]);
    });

    it("asks Clio only for open matters", async () => {
      mockCollections({ matters: [MATTER_A] });
      await run();
      const matterCall = mockClioGetAllPages.mock.calls.find((c) => c[0] === "/matters.json")!;
      expect(matterCall[1].status).toBe("open");
    });

    it("bounds notes and time entries by the lookback window", async () => {
      mockCollections({ matters: [MATTER_A] });
      await run({ lookback_days: 30 });
      const notes = mockClioGetAllPages.mock.calls.find((c) => c[0] === "/notes.json")!;
      const acts = mockClioGetAllPages.mock.calls.find((c) => c[0] === "/activities.json")!;
      expect(notes[1].created_since).toBe("2026-08-02T12:00:00.000Z");
      expect(notes[1].type).toBe("matter");
      expect(acts[1].start_date).toBe("2026-08-02");
    });

    it("looks forward, not back, for the calendar", async () => {
      mockCollections({ matters: [MATTER_A] });
      await run({ calendar_days_ahead: 14 });
      const cal = mockClioGetAllPages.mock.calls.find((c) => c[0] === "/calendar_entries.json")!;
      expect(cal[1].from).toBe("2026-09-01T00:00:00Z");
      expect(cal[1].to).toBe("2026-09-15T23:59:59Z");
    });

    it("filters by practice area when given", async () => {
      mockCollections({ matters: [MATTER_A] });
      await run({ practice_area_id: 7 });
      const matterCall = mockClioGetAllPages.mock.calls.find((c) => c[0] === "/matters.json")!;
      expect(matterCall[1].practice_area_id).toBe("7");
    });
  });

  describe("per-matter rollup", () => {
    it("takes the newest note and time entry per matter", async () => {
      mockCollections({
        matters: [MATTER_A],
        notes: [
          { id: 1, date: "2026-08-01", matter: { id: 1 } },
          { id: 2, date: "2026-08-20", matter: { id: 1 } },
        ],
        activities: [
          { id: 3, date: "2026-08-10", matter: { id: 1 } },
          { id: 4, date: "2026-08-25", matter: { id: 1 } },
        ],
      });
      const { parsed } = await run();
      expect(parsed.matters[0].last_note_date).toBe("2026-08-20");
      expect(parsed.matters[0].last_time_entry_date).toBe("2026-08-25");
      expect(parsed.matters[0].days_since_last_activity).toBe(7);
    });

    it("prefers the note's own date over when it was typed up", async () => {
      mockCollections({
        matters: [MATTER_A],
        notes: [{ id: 1, date: "2026-07-01", created_at: "2026-08-30T00:00:00Z", matter: { id: 1 } }],
      });
      const { parsed } = await run();
      expect(parsed.matters[0].last_note_date).toBe("2026-07-01");
    });

    it("falls back to created_at when a note carries no date", async () => {
      mockCollections({
        matters: [MATTER_A],
        notes: [{ id: 1, created_at: "2026-08-30T00:00:00Z", matter: { id: 1 } }],
      });
      const { parsed } = await run();
      expect(parsed.matters[0].last_note_date).toBe("2026-08-30T00:00:00Z");
    });

    it("returns the soonest future calendar entry and ignores past ones", async () => {
      mockCollections({
        matters: [MATTER_A],
        calendar: [
          { id: 1, summary: "Old hearing", start_at: "2026-08-01T09:00:00Z", matter: { id: 1 } },
          { id: 2, summary: "Deposition", start_at: "2026-09-20T09:00:00Z", matter: { id: 1 } },
          { id: 3, summary: "Status conference", start_at: "2026-09-10T09:00:00Z", matter: { id: 1 } },
        ],
      });
      const { parsed } = await run();
      expect(parsed.matters[0].next_calendar_entry).toEqual({
        start_at: "2026-09-10T09:00:00Z",
        summary: "Status conference",
      });
    });

    it("counts only that matter's open tasks", async () => {
      mockCollections({
        matters: [MATTER_A, MATTER_B],
        tasks: [
          { id: 1, matter: { id: 1 } },
          { id: 2, matter: { id: 1 } },
          { id: 3, matter: { id: 2 } },
        ],
      });
      const { parsed } = await run();
      const byId = Object.fromEntries(parsed.matters.map((m: any) => [m.matter_id, m]));
      expect(byId[1].open_tasks_count).toBe(2);
      expect(byId[2].open_tasks_count).toBe(1);
    });

    it("does not leak one matter's activity into another", async () => {
      mockCollections({
        matters: [MATTER_A, MATTER_B],
        notes: [{ id: 1, date: "2026-08-30", matter: { id: 1 } }],
      });
      const { parsed } = await run();
      const byId = Object.fromEntries(parsed.matters.map((m: any) => [m.matter_id, m]));
      expect(byId[1].last_note_date).toBe("2026-08-30");
      expect(byId[2].last_note_date).toBeNull();
    });

    it("ignores records with no matter attached", async () => {
      mockCollections({
        matters: [MATTER_A],
        notes: [{ id: 1, date: "2026-08-30", matter: null }],
      });
      const { parsed } = await run();
      expect(parsed.matters[0].last_note_date).toBeNull();
    });
  });

  describe("staleness", () => {
    it("sorts the quietest matters first", async () => {
      mockCollections({
        matters: [MATTER_A, MATTER_B],
        notes: [
          { id: 1, date: "2026-08-30", matter: { id: 1 } },
          { id: 2, date: "2026-07-01", matter: { id: 2 } },
        ],
      });
      const { parsed } = await run();
      expect(parsed.matters.map((m: any) => m.matter_id)).toEqual([2, 1]);
    });

    it("treats a matter with nothing in the window as the stalest of all", async () => {
      // null is a stronger signal than any number the window can produce, so it
      // must sort above them rather than falling to the bottom as a falsy value.
      mockCollections({
        matters: [MATTER_A, MATTER_B],
        notes: [{ id: 1, date: "2026-06-05", matter: { id: 1 } }],
      });
      const { parsed } = await run();
      expect(parsed.matters[0].matter_id).toBe(2);
      expect(parsed.matters[0].days_since_last_activity).toBeNull();
    });

    it("keeps silent matters when filtering by stale_after_days", async () => {
      mockCollections({
        matters: [MATTER_A, MATTER_B],
        notes: [{ id: 1, date: "2026-08-30", matter: { id: 1 } }],
      });
      const { parsed } = await run({ stale_after_days: 14 });
      expect(parsed.matters).toHaveLength(1);
      expect(parsed.matters[0].matter_id).toBe(2);
      expect(parsed.matched).toBe(1);
    });

    it("caps the returned rows at limit but still reports how many matched", async () => {
      mockCollections({ matters: [MATTER_A, MATTER_B] });
      const { parsed } = await run({ limit: 1 });
      expect(parsed.matters).toHaveLength(1);
      expect(parsed.matched).toBe(2);
      expect(parsed.open_matters_scanned).toBe(2);
    });
  });

  describe("output hygiene", () => {
    it("returns dates and counts only, never note or time entry text", async () => {
      mockCollections({
        matters: [MATTER_A],
        notes: [{ id: 1, date: "2026-08-30", detail: "Client disclosed settlement position", matter: { id: 1 } }],
        activities: [{ id: 2, date: "2026-08-29", note: "Reviewed privileged memo", matter: { id: 1 } }],
      });
      const { result } = await run();
      expect(result.content[0].text).not.toContain("settlement position");
      expect(result.content[0].text).not.toContain("privileged memo");
    });
  });

  describe("audit log and errors", () => {
    it("logs the sweep with its window, not its findings", async () => {
      mockCollections({ matters: [MATTER_A] });
      await run();
      const entry = mockAppendAuditLog.mock.calls[0][0];
      expect(entry).toMatchObject({ tool: "matter_activity_summary", outcome: "success", result_count: 1 });
    });

    it("returns an error result rather than throwing when a read fails", async () => {
      mockClioGetAllPages.mockRejectedValue(new Error("rate limit exceeded"));
      const result = await handlers["matter_activity_summary"](ARGS) as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("rate limit exceeded");
      expect(mockAppendAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ tool: "matter_activity_summary", outcome: "error" })
      );
    });
  });
});
