import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { clioGet } from "../utils/clioClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

const ACTIVITY_FIELDS = "id,date,quantity_in_hours,price,total,note,matter{id,display_number},user{id,name}";

export function registerActivityTools(server: McpServer): void {
  server.registerTool(
    "list_time_entries",
    {
      description: "List time entries (billable hours) from Clio",
      inputSchema: {
        matter_id: z.number().int().positive().optional().describe("Filter by matter ID"),
        start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("ISO date (YYYY-MM-DD) — entries on or after this date"),
        end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("ISO date (YYYY-MM-DD) — entries on or before this date"),
        limit: z.number().int().min(1).max(200).default(25).describe("Max results to return (1–200)"),
      },
    },
    async ({ matter_id, start_date, end_date, limit }) => {
      try {
        const params: Record<string, string> = {
          fields: ACTIVITY_FIELDS,
          limit: String(limit),
          type: "TimeEntry",
        };
        if (matter_id) params["matter_id"] = String(matter_id);
        if (start_date) params["start_date"] = start_date;
        if (end_date) params["end_date"] = end_date;

        const data = await clioGet("/activities.json", params);
        const entries = data.data as any[];

        await appendAuditLog({
          tool: "list_time_entries",
          args: { matter_id, start_date, end_date, limit },
          outcome: "success",
          result_count: entries?.length ?? 0,
          ...(matter_id && { matter_id }),
        });

        if (!entries || entries.length === 0) {
          return { content: [{ type: "text", text: "No time entries found." }] };
        }

        const result = entries.map((e) => ({
          id: e.id,
          date: e.date,
          quantity_in_hours: e.quantity_in_hours,
          rate: e.price ?? null,
          total: e.total,
          description: e.note ?? null,
          matter: e.matter ? { id: e.matter.id, display_number: e.matter.display_number } : null,
          user: e.user ? { id: e.user.id, name: e.user.name } : null,
        }));

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        await appendAuditLog({
          tool: "list_time_entries",
          args: { matter_id, start_date, end_date, limit },
          outcome: "error",
          error_message: err.message,
          ...(matter_id && { matter_id }),
        });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
