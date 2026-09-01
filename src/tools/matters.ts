import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { clioGet, clioPost, ClioApiError, extractNextPageToken } from "../utils/clioClient.js";
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
        status: z.enum(["open", "pending", "closed"]).optional().describe("Filter by matter status"),
        limit: z.number().int().min(1).max(200).default(25).describe("Max results to return (1-200)"),
        page_token: z.string().optional().describe("Cursor from a previous list_matters response to fetch the next page"),
      },
    },
    async ({ status, limit, page_token }) => {
      try {
        const params: Record<string, string> = {
          fields: MATTER_LIST_FIELDS,
          limit: String(limit),
        };
        if (status) params["status"] = status;
        if (page_token) params["page_token"] = page_token;

        const data = await clioGet("/matters.json", params);
        const matters = data.data as any[];
        const nextPageToken = matters.length >= limit ? extractNextPageToken(data.meta) : null;

        await appendAuditLog({ tool: "list_matters", args: { status, limit, page_token }, outcome: "success", result_count: matters?.length ?? 0 });

        const result = {
          matters: matters.map((m) => ({
            id: m.id,
            display_number: m.display_number,
            description: m.description,
            status: m.status,
            client: m.client?.name ?? null,
            practice_area: m.practice_area?.name ?? null,
            open_date: m.open_date,
            close_date: m.close_date ?? null,
          })),
          total_count: data.meta?.records ?? matters.length,
          has_more: nextPageToken !== null,
          next_page_token: nextPageToken,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        await appendAuditLog({ tool: "list_matters", args: { status, limit, page_token }, outcome: "error", error_message: err.message });
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

  server.registerTool(
    "create_matter",
    {
      description: "Create a new matter in the connected Clio account. Requires numeric IDs: look up client_id via search_contacts, attorney IDs via list_users or get_user.",
      inputSchema: {
        client_id: z.number().int().positive().describe("Clio contact ID of the client for this matter"),
        description: z.string().min(1).describe("Matter subject / description"),
        practice_area_id: z.number().int().positive().optional().describe("Clio practice area ID"),
        status: z.enum(["open", "pending", "closed"]).default("open").describe("Initial matter status"),
        open_date: z.string().date().optional().describe("Open date (YYYY-MM-DD); defaults to today if omitted"),
        billable: z.boolean().default(true).describe("Whether this matter is billable (default true)"),
        responsible_attorney_id: z.number().int().positive().optional().describe("Clio user ID of the responsible attorney"),
        originating_attorney_id: z.number().int().positive().optional().describe("Clio user ID of the originating attorney"),
        client_reference: z.string().optional().describe("External reference string for cross-linking with other systems"),
      },
    },
    async ({ client_id, description, practice_area_id, status, open_date,
             billable, responsible_attorney_id, originating_attorney_id, client_reference }) => {
      try {
        const _d = new Date();
        const todayLocal = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`;
        const matterData: Record<string, unknown> = {
          client: { id: client_id },
          description,
          status,
          billable,
          open_date: open_date ?? todayLocal,
        };
        if (practice_area_id) matterData["practice_area"] = { id: practice_area_id };
        if (responsible_attorney_id) matterData["responsible_attorney"] = { id: responsible_attorney_id };
        if (originating_attorney_id) matterData["originating_attorney"] = { id: originating_attorney_id };
        if (client_reference) matterData["client_reference"] = client_reference;

        const data = await clioPost("/matters.json", { data: matterData });
        const m = data.data;

        await appendAuditLog({
          tool: "create_matter",
          args: { client_id, description, practice_area_id, status, open_date,
                  billable, responsible_attorney_id, originating_attorney_id, client_reference },
          outcome: "success",
          matter_id: m.id,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              matter: {
                id: m.id,
                display_number: m.display_number,
                description: m.description,
                status: m.status,
                billable: m.billable ?? billable,
                client: m.client ? { id: m.client.id, name: m.client.name } : null,
                practice_area: m.practice_area ? { id: m.practice_area.id, name: m.practice_area.name } : null,
                responsible_attorney: m.responsible_attorney ? { id: m.responsible_attorney.id, name: m.responsible_attorney.name } : null,
                originating_attorney: m.originating_attorney ? { id: m.originating_attorney.id, name: m.originating_attorney.name } : null,
                client_reference: m.client_reference ?? client_reference ?? null,
                open_date: m.open_date,
              },
            }, null, 2),
          }],
        };
      } catch (err: any) {
        const auditArgs = { client_id, description, practice_area_id, status, open_date,
                            billable, responsible_attorney_id, originating_attorney_id, client_reference };
        if (err instanceof ClioApiError && err.statusCode === 422) {
          await appendAuditLog({ tool: "create_matter", args: auditArgs, outcome: "error", error_message: err.message });
          return {
            content: [{ type: "text", text: `Validation error: ${err.message}` }],
            isError: true,
          };
        }
        await appendAuditLog({ tool: "create_matter", args: auditArgs, outcome: "error", error_message: err.message });
        return {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );
}
