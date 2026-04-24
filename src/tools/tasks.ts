import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { clioGet } from "../utils/clioClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

const TASK_FIELDS = "id,name,priority,due_at,status,assignee{id,name},matter{id,display_number}";

const STATUS_MAP: Record<string, string> = { Pending: "incomplete", Complete: "complete" };

export function registerTaskTools(server: McpServer): void {
  server.registerTool(
    "list_tasks",
    {
      description: "List tasks from Clio with optional filters",
      inputSchema: {
        matter_id: z.number().int().positive().optional().describe("Filter tasks by matter ID"),
        status: z.enum(["Pending", "Complete"]).optional().describe("Filter by task status"),
        due_date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("ISO date (YYYY-MM-DD) — tasks due on or after this date"),
        due_date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("ISO date (YYYY-MM-DD) — tasks due on or before this date"),
        limit: z.number().int().min(1).max(200).default(25).describe("Max results to return (1–200)"),
      },
    },
    async ({ matter_id, status, due_date_start, due_date_end, limit }) => {
      try {
        const params: Record<string, string> = { fields: TASK_FIELDS, limit: String(limit) };
        if (matter_id) params["matter_id"] = String(matter_id);
        if (status) params["status"] = STATUS_MAP[status];
        if (due_date_start) params["due_at_from"] = due_date_start;
        if (due_date_end) params["due_at_to"] = due_date_end;

        const data = await clioGet("/tasks.json", params);
        const tasks = data.data as any[];

        await appendAuditLog({
          tool: "list_tasks",
          args: { matter_id, status, due_date_start, due_date_end, limit },
          outcome: "success",
          ...(matter_id && { matter_id }),
        });

        if (!tasks || tasks.length === 0) {
          return { content: [{ type: "text", text: "No tasks found." }] };
        }

        const result = tasks.map((t) => ({
          id: t.id,
          name: t.name,
          priority: t.priority,
          due_date: t.due_at ? t.due_at.substring(0, 10) : null,
          status: t.status,
          assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
          matter: t.matter ? { id: t.matter.id, display_number: t.matter.display_number } : null,
        }));

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        await appendAuditLog({
          tool: "list_tasks",
          args: { matter_id, status, due_date_start, due_date_end, limit },
          outcome: "error",
          error_message: err.message,
          ...(matter_id && { matter_id }),
        });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
