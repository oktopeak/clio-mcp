import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { clioGet, ClioApiError, extractNextPageToken } from "../utils/clioClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

const CONTACT_LIST_FIELDS =
  "id,name,email_addresses{address,name},phone_numbers{number,name},company{id,name},type,custom_field_values{custom_field{id,name},value}";

const CONTACT_DETAIL_FIELDS =
  "id,name,first_name,last_name,title,email_addresses{address,name},phone_numbers{number,name},company{id,name},type,created_at,updated_at,addresses{name,street,city,province,postal_code,country},custom_field_values{custom_field{id,name},value}";

export function registerContactTools(server: McpServer): void {
  server.registerTool(
    "search_contacts",
    {
      description: "Search Clio contacts by name, email, or company",
      inputSchema: {
        query: z.string().min(1).describe("Search string (name, email, or company)"),
        limit: z.number().int().min(1).max(200).default(25).describe("Max results to return (1–200)"),
        page_token: z.string().optional().describe("Cursor from a previous search_contacts response to fetch the next page"),
      },
    },
    async ({ query, limit, page_token }) => {
      try {
        const params: Record<string, string> = { query, fields: CONTACT_LIST_FIELDS, limit: String(limit) };
        if (page_token) params["page_token"] = page_token;

        const data = await clioGet("/contacts.json", params);
        const contacts = data.data as any[];
        const nextPageToken = contacts.length >= limit ? extractNextPageToken(data.meta) : null;

        await appendAuditLog({ tool: "search_contacts", args: { query, limit, page_token }, outcome: "success", result_count: contacts?.length ?? 0 });

        if (!contacts || contacts.length === 0) {
          return { content: [{ type: "text", text: "No contacts found." }] };
        }

        const result = {
          contacts: contacts.map((c) => ({
            id: c.id,
            name: c.name,
            email: c.email_addresses?.[0]?.address ?? null,
            phone: c.phone_numbers?.[0]?.number ?? null,
            company: c.company?.name ?? null,
            type: c.type,
            custom_field_values: c.custom_field_values ?? [],
          })),
          total_count: data.meta?.records ?? contacts.length,
          has_more: nextPageToken !== null,
          next_page_token: nextPageToken,
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        await appendAuditLog({ tool: "search_contacts", args: { query, limit, page_token }, outcome: "error", error_message: err.message });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "get_contact",
    {
      description: "Get full detail for a single contact by ID",
      inputSchema: {
        contact_id: z.number().int().positive().describe("The Clio contact ID"),
      },
    },
    async ({ contact_id }) => {
      try {
        const data = await clioGet(`/contacts/${contact_id}.json`, { fields: CONTACT_DETAIL_FIELDS });
        const c = data.data;

        const result = {
          id: c.id,
          name: c.name,
          first_name: c.first_name ?? null,
          last_name: c.last_name ?? null,
          title: c.title ?? null,
          type: c.type,
          company: c.company ? { id: c.company.id, name: c.company.name } : null,
          emails: (c.email_addresses ?? []).map((e: any) => ({ label: e.name, address: e.address })),
          phone_numbers: (c.phone_numbers ?? []).map((p: any) => ({ label: p.name, number: p.number })),
          addresses: (c.addresses ?? []).map((a: any) => ({
            label: a.name,
            street: a.street ?? null,
            city: a.city ?? null,
            province: a.province ?? null,
            postal_code: a.postal_code ?? null,
            country: a.country ?? null,
          })),
          created_at: c.created_at,
          updated_at: c.updated_at,
          custom_field_values: c.custom_field_values ?? [],
        };

        await appendAuditLog({ tool: "get_contact", args: { contact_id }, outcome: "success" });

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        if (err instanceof ClioApiError && err.statusCode === 404) {
          await appendAuditLog({ tool: "get_contact", args: { contact_id }, outcome: "success" });
          return { content: [{ type: "text", text: `Contact ${contact_id} not found.` }] };
        }
        await appendAuditLog({ tool: "get_contact", args: { contact_id }, outcome: "error", error_message: err.message });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
