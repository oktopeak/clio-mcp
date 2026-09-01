import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { clioGet, clioPost, clioPatch, ClioApiError, extractNextPageToken } from "../utils/clioClient.js";
import { appendAuditLog } from "../utils/auditLog.js";
import {
  CUSTOM_FIELD_VALUE_FIELDS,
  mapCustomFieldValues,
  buildCustomFieldWrites,
  customFieldIdsForAudit,
} from "../utils/customFields.js";

const MATTER_LIST_FIELDS =
  `id,display_number,description,status,client{id,name},practice_area{id,name},open_date,close_date,${CUSTOM_FIELD_VALUE_FIELDS}`;

const MATTER_DETAIL_FIELDS =
  `id,display_number,description,status,client{id,name},practice_area{id,name},open_date,close_date,billable,maildrop_address,${CUSTOM_FIELD_VALUE_FIELDS}`;

const CUSTOM_FIELD_VALUE_SCHEMA = z.object({
  custom_field_id: z.number().int().positive().describe("Clio custom field definition ID (see list_custom_fields)"),
  value: z
    .union([z.string().min(1), z.number().finite(), z.boolean()])
    .optional()
    .describe("Value to set. For a picklist field this is the option ID, which list_custom_fields returns under picklist_options."),
  clear: z.boolean().optional().describe("Remove this field's existing value instead of setting one"),
});

const CUSTOM_FIELD_VALUES_SCHEMA = z
  .array(CUSTOM_FIELD_VALUE_SCHEMA)
  .optional()
  .describe(
    'Custom fields to set, e.g. [{ "custom_field_id": 123, "value": "Foo" }]. Call list_custom_fields to discover IDs, types and picklist options. The connector works out whether each field needs to be created or updated.'
  );

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
            custom_fields: mapCustomFieldValues(m.custom_field_values),
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
          maildrop_address: m.maildrop_address ?? null,
          custom_fields: mapCustomFieldValues(m.custom_field_values),
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
        custom_field_values: CUSTOM_FIELD_VALUES_SCHEMA,
      },
    },
    async ({ client_id, description, practice_area_id, status, open_date,
             billable, responsible_attorney_id, originating_attorney_id, client_reference, custom_field_values }) => {
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
        // A matter being created has no existing values, so every write is a create.
        if (custom_field_values) matterData["custom_field_values"] = buildCustomFieldWrites(custom_field_values, []);

        const data = await clioPost("/matters.json", { data: matterData });
        const m = data.data;

        await appendAuditLog({
          tool: "create_matter",
          args: { client_id, practice_area_id, status, open_date,
                  billable, responsible_attorney_id, originating_attorney_id,
                  custom_field_ids: customFieldIdsForAudit(custom_field_values) },
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
                custom_fields: mapCustomFieldValues(m.custom_field_values),
              },
            }, null, 2),
          }],
        };
      } catch (err: any) {
        const auditArgs = { client_id, practice_area_id, status, open_date,
                            billable, responsible_attorney_id, originating_attorney_id,
                            custom_field_ids: customFieldIdsForAudit(custom_field_values) };
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

  server.registerTool(
    "update_matter",
    {
      description: "Update one or more fields on an existing Clio matter",
      inputSchema: {
        matter_id: z.number().int().positive().describe("ID of the matter to update"),
        client_id: z.number().int().positive().optional().describe("Clio contact ID of the client for this matter"),
        description: z.string().min(1).optional().describe("Matter subject / description"),
        practice_area_id: z.number().int().positive().optional().describe("Clio practice area ID"),
        status: z.enum(["open", "pending", "closed"]).optional().describe("New matter status"),
        open_date: z.string().date().optional().describe("Open date (YYYY-MM-DD)"),
        billable: z.boolean().optional().describe("Whether this matter is billable"),
        responsible_attorney_id: z.number().int().positive().optional().describe("Clio user ID of the responsible attorney"),
        originating_attorney_id: z.number().int().positive().optional().describe("Clio user ID of the originating attorney"),
        client_reference: z.string().optional().describe("External reference string for cross-linking with other systems"),
        custom_field_values: CUSTOM_FIELD_VALUES_SCHEMA,
      },
    },
    async ({ matter_id, client_id, description, practice_area_id, status, open_date,
             billable, responsible_attorney_id, originating_attorney_id, client_reference, custom_field_values }) => {
      if ([client_id, description, practice_area_id, status, open_date, billable,
           responsible_attorney_id, originating_attorney_id, client_reference, custom_field_values]
            .every((v) => v === undefined)) {
        return {
          content: [{ type: "text", text: "Error: at least one field to update must be provided" }],
          isError: true,
        };
      }
      try {
        const matterData: Record<string, unknown> = {};
        if (client_id !== undefined) matterData["client"] = { id: client_id };
        if (description !== undefined) matterData["description"] = description;
        if (practice_area_id !== undefined) matterData["practice_area"] = { id: practice_area_id };
        if (status !== undefined) matterData["status"] = status;
        if (open_date !== undefined) matterData["open_date"] = open_date;
        if (billable !== undefined) matterData["billable"] = billable;
        if (responsible_attorney_id !== undefined) matterData["responsible_attorney"] = { id: responsible_attorney_id };
        if (originating_attorney_id !== undefined) matterData["originating_attorney"] = { id: originating_attorney_id };
        if (client_reference !== undefined) matterData["client_reference"] = client_reference;

        if (custom_field_values !== undefined) {
          // Clio addresses an existing custom field value by its own composite id
          // and a brand-new one by the field definition id. Which shape applies is
          // a property of the record, not of the request, so read before writing.
          const current = await clioGet(`/matters/${matter_id}.json`, { fields: `id,${CUSTOM_FIELD_VALUE_FIELDS}` });
          matterData["custom_field_values"] = buildCustomFieldWrites(
            custom_field_values,
            mapCustomFieldValues(current?.data?.custom_field_values)
          );
        }

        const data = await clioPatch(`/matters/${matter_id}.json`, { data: matterData });
        const m = data.data;

        await appendAuditLog({
          tool: "update_matter",
          args: { matter_id, client_id, practice_area_id, status, open_date,
                  billable, responsible_attorney_id, originating_attorney_id,
                  custom_field_ids: customFieldIdsForAudit(custom_field_values) },
          outcome: "success",
          matter_id,
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
                billable: m.billable,
                client: m.client ? { id: m.client.id, name: m.client.name } : null,
                practice_area: m.practice_area ? { id: m.practice_area.id, name: m.practice_area.name } : null,
                responsible_attorney: m.responsible_attorney ? { id: m.responsible_attorney.id, name: m.responsible_attorney.name } : null,
                originating_attorney: m.originating_attorney ? { id: m.originating_attorney.id, name: m.originating_attorney.name } : null,
                client_reference: m.client_reference ?? null,
                open_date: m.open_date,
                custom_fields: mapCustomFieldValues(m.custom_field_values),
              },
            }, null, 2),
          }],
        };
      } catch (err: any) {
        const auditArgs = { matter_id, client_id, practice_area_id, status, open_date,
                             billable, responsible_attorney_id, originating_attorney_id,
                             custom_field_ids: customFieldIdsForAudit(custom_field_values) };
        if (err instanceof ClioApiError && err.statusCode === 422) {
          await appendAuditLog({ tool: "update_matter", args: auditArgs, outcome: "error", error_message: err.message, matter_id });
          return {
            content: [{ type: "text", text: `Validation error: ${err.message}` }],
            isError: true,
          };
        }
        await appendAuditLog({ tool: "update_matter", args: auditArgs, outcome: "error", error_message: err.message, matter_id });
        return {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );
}
