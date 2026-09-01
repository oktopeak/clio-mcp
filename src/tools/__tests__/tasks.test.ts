import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

const { mockClioGet, mockClioPatch, mockAppendAuditLog } = vi.hoisted(() => ({
  mockClioGet: vi.fn(),
  mockClioPatch: vi.fn(),
  mockAppendAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/clioClient.js", () => ({
  clioGet: mockClioGet,
  clioPost: vi.fn(),
  clioPatch: mockClioPatch,
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

import { registerTaskTools } from "../tasks.js";

const TASK_FIXTURE = {
  id: 1,
  name: "Draft contract",
  priority: "Normal",
  status: "complete",
  due_at: "2026-01-15T00:00:00Z",
  completed_at: "2026-05-22T10:00:00Z",
  matter: { id: 99 },
};

const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();

beforeAll(() => {
  const fakeServer = {
    registerTool: (name: string, _schema: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => {
      handlers.set(name, handler);
    },
  };
  registerTaskTools(fakeServer as any);
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAppendAuditLog.mockResolvedValue(undefined);
});

// ─── list_tasks ───────────────────────────────────────────────────────────────

describe("list_tasks", () => {
  it("returns has_more: false and next_page_token: null on a short final page", async () => {
    mockClioGet.mockResolvedValue({ data: [TASK_FIXTURE], meta: { records: 1, paging: {} } });
    const handler = handlers.get("list_tasks")!;
    const result = await handler({ limit: 25 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.has_more).toBe(false);
    expect(parsed.next_page_token).toBeNull();
  });

  it("returns has_more: true and the extracted token when a next page cursor is present", async () => {
    const twoTasks = [TASK_FIXTURE, { ...TASK_FIXTURE, id: 2 }];
    mockClioGet.mockResolvedValue({
      data: twoTasks,
      meta: { records: 10, paging: { next: "https://app.clio.com/api/v4/tasks.json?page_token=abc123" } },
    });
    const handler = handlers.get("list_tasks")!;
    const result = await handler({ limit: 2 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.has_more).toBe(true);
    expect(parsed.next_page_token).toBe("abc123");
  });

  it("forwards page_token into the outgoing request params when supplied", async () => {
    mockClioGet.mockResolvedValue({ data: [TASK_FIXTURE], meta: { records: 1 } });
    const handler = handlers.get("list_tasks")!;
    await handler({ limit: 25, page_token: "xyz" });
    expect(mockClioGet).toHaveBeenCalledWith(
      "/tasks.json",
      expect.objectContaining({ page_token: "xyz" }),
    );
  });

  it("returns a JSON result with has_more: false when the page is empty, not a plain-text sentinel", async () => {
    mockClioGet.mockResolvedValue({ data: [], meta: { records: 0, paging: {} } });
    const handler = handlers.get("list_tasks")!;
    const result = await handler({ limit: 25 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.tasks).toEqual([]);
    expect(parsed.has_more).toBe(false);
    expect(parsed.next_page_token).toBeNull();
  });
});

// ─── update_task ──────────────────────────────────────────────────────────────

describe("update_task", () => {
  it("returns isError without calling clioPatch when all fields are undefined", async () => {
    const handler = handlers.get("update_task")!;
    const result = await handler({ task_id: 1 }) as any;
    expect(mockClioPatch).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });

  it("translates status 'Complete' via STATUS_MAP to 'complete'", async () => {
    mockClioPatch.mockResolvedValue({ data: TASK_FIXTURE });
    const handler = handlers.get("update_task")!;
    await handler({ task_id: 1, status: "Complete" });
    expect(mockClioPatch).toHaveBeenCalledWith(
      "/tasks/1.json",
      expect.objectContaining({ data: expect.objectContaining({ status: "complete" }) }),
    );
  });

  it("translates status 'In Progress' via STATUS_MAP to 'in_progress'", async () => {
    mockClioPatch.mockResolvedValue({ data: TASK_FIXTURE });
    const handler = handlers.get("update_task")!;
    await handler({ task_id: 1, status: "In Progress" });
    expect(mockClioPatch).toHaveBeenCalledWith(
      "/tasks/1.json",
      expect.objectContaining({ data: expect.objectContaining({ status: "in_progress" }) }),
    );
  });

  it("formats due_date as due_at with midnight UTC suffix", async () => {
    mockClioPatch.mockResolvedValue({ data: TASK_FIXTURE });
    const handler = handlers.get("update_task")!;
    await handler({ task_id: 1, due_date: "2026-01-15" });
    expect(mockClioPatch).toHaveBeenCalledWith(
      "/tasks/1.json",
      expect.objectContaining({ data: expect.objectContaining({ due_at: "2026-01-15T00:00:00Z" }) }),
    );
  });

  it("shapes assignee as { id, type: 'User' } when assignee_id is provided", async () => {
    mockClioPatch.mockResolvedValue({ data: TASK_FIXTURE });
    const handler = handlers.get("update_task")!;
    await handler({ task_id: 1, assignee_id: 42 });
    expect(mockClioPatch).toHaveBeenCalledWith(
      "/tasks/1.json",
      expect.objectContaining({ data: expect.objectContaining({ assignee: { id: 42, type: "User" } }) }),
    );
  });

  it("does not include assignee key when assignee_id is absent", async () => {
    mockClioPatch.mockResolvedValue({ data: TASK_FIXTURE });
    const handler = handlers.get("update_task")!;
    await handler({ task_id: 1, name: "New name" });
    const sentBody = mockClioPatch.mock.calls[0][1] as { data: Record<string, unknown> };
    expect(sentBody.data).not.toHaveProperty("assignee");
  });

  it("calls appendAuditLog with outcome 'success' on happy path", async () => {
    mockClioPatch.mockResolvedValue({ data: TASK_FIXTURE });
    const handler = handlers.get("update_task")!;
    await handler({ task_id: 1, name: "New name" });
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "update_task", outcome: "success" }),
    );
  });

  it("returns isError and logs outcome 'error' when clioPatch rejects", async () => {
    mockClioPatch.mockRejectedValue(new Error("network failure"));
    const handler = handlers.get("update_task")!;
    const result = await handler({ task_id: 1, name: "X" }) as any;
    expect(result.isError).toBe(true);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "update_task", outcome: "error", error_message: "network failure" }),
    );
  });
});

// ─── complete_task ────────────────────────────────────────────────────────────

describe("complete_task", () => {
  it("calls clioPatch with status 'complete' from STATUS_MAP", async () => {
    mockClioPatch.mockResolvedValue({ data: TASK_FIXTURE });
    const handler = handlers.get("complete_task")!;
    await handler({ task_id: 1 });
    expect(mockClioPatch).toHaveBeenCalledWith("/tasks/1.json", { data: { status: "complete" } });
  });

  it("returns task shape with id, name, status, and completed_at", async () => {
    mockClioPatch.mockResolvedValue({ data: TASK_FIXTURE });
    const handler = handlers.get("complete_task")!;
    const result = await handler({ task_id: 1 }) as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toMatchObject({
      success: true,
      task: { id: 1, name: "Draft contract", status: "complete", completed_at: "2026-05-22T10:00:00Z" },
    });
  });

  it("calls appendAuditLog with outcome 'success' on happy path", async () => {
    mockClioPatch.mockResolvedValue({ data: TASK_FIXTURE });
    const handler = handlers.get("complete_task")!;
    await handler({ task_id: 1 });
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "complete_task", outcome: "success" }),
    );
  });

  it("returns isError and logs outcome 'error' when clioPatch rejects", async () => {
    mockClioPatch.mockRejectedValue(new Error("timeout"));
    const handler = handlers.get("complete_task")!;
    const result = await handler({ task_id: 1 }) as any;
    expect(result.isError).toBe(true);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "complete_task", outcome: "error", error_message: "timeout" }),
    );
  });
});
