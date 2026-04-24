import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { clioGet, ClioApiError } from "../utils/clioClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

const MATTER_LIST_FIELDS =
  "id,display_number,description,status,client{id,name},practice_area{id,name},open_date,close_date";

const MATTER_DETAIL_FIELDS =
  "id,display_number,description,status,client{id,name},practice_area{id,name},open_date,close_date,billable";

export function registerMatterTools(server: McpServer): void {
  server.registerTool(
    "list_matters",
    {
      description: "List matters from the connected Clio account",
      inputSchema: {
        status: z.enum(["Open", "Pending", "Closed"]).optional().describe("Filter by matter status"),
        limit: z.number().int().min(1).max(200).default(25).describe("Max results to return (1–200)"),
      },
    },
    async ({ status, limit }) => {
      try {
        const params: Record<string, string> = {
          fields: MATTER_LIST_FIELDS,
          limit: String(limit),
        };
        if (status) params["status"] = status;

        const data = await clioGet("/matters.json", params);
        const matters = data.data as any[];

        await appendAuditLog({ tool: "list_matters", args: { status, limit }, outcome: "success", result_count: matters?.length ?? 0 });

        if (!matters || matters.length === 0) {
          return { content: [{ type: "text", text: "No matters found." }] };
        }

        const result = matters.map((m) => ({
          id: m.id,
          display_number: m.display_number,
          description: m.description,
          status: m.status,
          client: m.client?.name ?? null,
          practice_area: m.practice_area?.name ?? null,
          open_date: m.open_date,
          close_date: m.close_date ?? null,
        }));

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        await appendAuditLog({ tool: "list_matters", args: { status, limit }, outcome: "error", error_message: err.message });
        return {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "get_matter",
    {
      description: "Get full detail for a single matter by ID",
      inputSchema: {
        matter_id: z.number().int().describe("The Clio matter ID"),
      },
    },
    async ({ matter_id }) => {
      try {
        const data = await clioGet(`/matters/${matter_id}.json`, { fields: MATTER_DETAIL_FIELDS });
        const m = data.data;

        const result = {
          id: m.id,
          display_number: m.display_number,
          description: m.description,
          status: m.status,
          client: m.client ? { id: m.client.id, name: m.client.name } : null,
          practice_area: m.practice_area ? { id: m.practice_area.id, name: m.practice_area.name } : null,
          open_date: m.open_date,
          close_date: m.close_date ?? null,
          billable: m.billable,
        };

        await appendAuditLog({ tool: "get_matter", args: { matter_id }, outcome: "success", matter_id });

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        if (err instanceof ClioApiError && err.statusCode === 404) {
          await appendAuditLog({ tool: "get_matter", args: { matter_id }, outcome: "success", matter_id });
          return { content: [{ type: "text", text: `Matter ${matter_id} not found.` }] };
        }
        await appendAuditLog({ tool: "get_matter", args: { matter_id }, outcome: "error", error_message: err.message, matter_id });
        return {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );
}
