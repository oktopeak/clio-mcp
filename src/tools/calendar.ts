import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { clioGet } from "../utils/clioClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

const CALENDAR_FIELDS = "id,summary,description,start_at,end_at,matter{id,display_number},attendees{id,name}";

export function registerCalendarTools(server: McpServer): void {
  server.registerTool(
    "list_calendar_entries",
    {
      description: "List calendar entries in Clio for a given date range",
      inputSchema: {
        start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("ISO date (YYYY-MM-DD) — range start, inclusive"),
        end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("ISO date (YYYY-MM-DD) — range end, inclusive"),
      },
    },
    async ({ start_date, end_date }) => {
      try {
        const data = await clioGet("/calendar_entries.json", {
          start_date,
          end_date,
          fields: CALENDAR_FIELDS,
        });
        const entries = data.data as any[];

        await appendAuditLog({ tool: "list_calendar_entries", args: { start_date, end_date }, outcome: "success", result_count: entries?.length ?? 0 });

        if (!entries || entries.length === 0) {
          return { content: [{ type: "text", text: "No calendar entries found." }] };
        }

        const result = entries.map((e) => ({
          id: e.id,
          summary: e.summary,
          description: e.description ?? null,
          start_at: e.start_at,
          end_at: e.end_at,
          matter: e.matter ? { id: e.matter.id, display_number: e.matter.display_number } : null,
          attendees: (e.attendees ?? []).map((a: any) => ({ id: a.id, name: a.name })),
        }));

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        await appendAuditLog({ tool: "list_calendar_entries", args: { start_date, end_date }, outcome: "error", error_message: err.message });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
