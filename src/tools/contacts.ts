import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { clioGet, clioPatch, clioGetWithFieldFallback, ClioApiError, extractNextPageToken } from "../utils/clioClient.js";
import { CONTACT_UPDATE_INPUT, buildContactPatch, contactUpdateError } from "./contactUpdates.js";
import { appendAuditLog } from "../utils/auditLog.js";
import {
  CUSTOM_FIELD_VALUE_FIELDS,
  CUSTOM_FIELD_STRIPPED_WARNING,
  MappedCustomField,
  mapCustomFieldValues,
  resolvePicklistLabelsFor,
  hasStrippedCustomFieldValues,
} from "../utils/customFields.js";

/** Everything except the custom field expansion, which is what a `fields` fallback drops. */
const CONTACT_LIST_BASE_FIELDS =
  "id,name,email_addresses{address,name},phone_numbers{number,name},company{id,name},type";
const CONTACT_LIST_FIELDS = `${CONTACT_LIST_BASE_FIELDS},${CUSTOM_FIELD_VALUE_FIELDS}`;

const CONTACT_DETAIL_BASE_FIELDS =
  "id,etag,name,first_name,last_name,title,sales_tax_number,email_addresses{id,address,name},phone_numbers{id,number,name},company{id,name},type,created_at,updated_at,addresses{id,name,street,city,province,postal_code,country}";
const CONTACT_DETAIL_FIELDS = `${CONTACT_DETAIL_BASE_FIELDS},${CUSTOM_FIELD_VALUE_FIELDS}`;

/** Warnings that belong on a contact response, given what came back on it. */
async function customFieldNotes(groups: MappedCustomField[][]): Promise<Record<string, string>> {
  await resolvePicklistLabelsFor(groups, "Contact");
  return groups.some(hasStrippedCustomFieldValues)
    ? { custom_fields_warning: CUSTOM_FIELD_STRIPPED_WARNING }
    : {};
}

export function registerContactTools(server: McpServer): void {
  server.registerTool(
    "list_contacts",
    {
      description: "List accessible Clio contacts one page at a time; follow next_page_token until absent",
      inputSchema: {
        limit: z.number().int().min(1).max(200).default(25).describe("Max results to return (1–200)"),
        page_token: z.string().min(1).optional().describe("Cursor from a previous list_contacts response to fetch the next page"),
      },
    },
    async ({ limit, page_token }) => {
      try {
        const params: Record<string, string> = { fields: CONTACT_LIST_FIELDS, limit: String(limit) };
        if (page_token) params["page_token"] = page_token;

        const { body: data, fields_warning } = await clioGetWithFieldFallback(
          "/contacts.json",
          params,
          CONTACT_LIST_BASE_FIELDS
        );
        const contacts = (data.data ?? []) as any[];
        const nextPageToken = extractNextPageToken(data.meta);



        const customFields = contacts.map((c) => mapCustomFieldValues(c.custom_field_values));
        const notes = await customFieldNotes(customFields);

        const result = {
          contacts: contacts.map((c, i) => ({
            id: c.id,
            name: c.name,
            email: c.email_addresses?.[0]?.address ?? null,
            phone: c.phone_numbers?.[0]?.number ?? null,
            company: c.company?.name ?? null,
            type: c.type,
            custom_fields: customFields[i],
          })),
          total_count: data.meta?.records ?? contacts.length,
          has_more: nextPageToken !== null,
          next_page_token: nextPageToken,
          ...notes,
          ...(fields_warning && { fields_warning }),
        };

        await appendAuditLog({ tool: "list_contacts", args: { limit, page_token }, outcome: "success", result_count: contacts?.length ?? 0 });

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof ClioApiError ? `Clio HTTP ${err.statusCode}` : "Contact listing failed";
        await appendAuditLog({ tool: "list_contacts", args: { limit, page_token }, outcome: "error", error_message: message });
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

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

        const { body: data, fields_warning } = await clioGetWithFieldFallback(
          "/contacts.json",
          params,
          CONTACT_LIST_BASE_FIELDS
        );
        const contacts = (data.data ?? []) as any[];
        const nextPageToken = extractNextPageToken(data.meta);

        await appendAuditLog({ tool: "search_contacts", args: { limit, page_token }, outcome: "success", result_count: contacts?.length ?? 0 });

        if (!contacts || contacts.length === 0) {
          return { content: [{ type: "text", text: "No contacts found." }] };
        }

        const customFields = contacts.map((c) => mapCustomFieldValues(c.custom_field_values));
        const notes = await customFieldNotes(customFields);

        const result = {
          contacts: contacts.map((c, i) => ({
            id: c.id,
            name: c.name,
            email: c.email_addresses?.[0]?.address ?? null,
            phone: c.phone_numbers?.[0]?.number ?? null,
            company: c.company?.name ?? null,
            type: c.type,
            custom_fields: customFields[i],
          })),
          total_count: data.meta?.records ?? contacts.length,
          has_more: nextPageToken !== null,
          next_page_token: nextPageToken,
          ...notes,
          ...(fields_warning && { fields_warning }),
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        await appendAuditLog({ tool: "search_contacts", args: { limit, page_token }, outcome: "error", error_message: err.message });
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
        const { body: data, fields_warning } = await clioGetWithFieldFallback(
          `/contacts/${contact_id}.json`,
          { fields: CONTACT_DETAIL_FIELDS },
          CONTACT_DETAIL_BASE_FIELDS
        );
        const c = data.data;

        const customFields = mapCustomFieldValues(c.custom_field_values);
        const notes = await customFieldNotes([customFields]);

        const result = {
          id: c.id,
          etag: c.etag ?? null,
          name: c.name,
          first_name: c.first_name ?? null,
          last_name: c.last_name ?? null,
          title: c.title ?? null,
          sales_tax_number: c.sales_tax_number ?? null,
          type: c.type,
          company: c.company ? { id: c.company.id, name: c.company.name } : null,
          emails: (c.email_addresses ?? []).map((e: any) => ({ id: e.id, label: e.name, address: e.address })),
          phone_numbers: (c.phone_numbers ?? []).map((p: any) => ({ id: p.id, label: p.name, number: p.number })),
          addresses: (c.addresses ?? []).map((a: any) => ({
            id: a.id,
            label: a.name,
            street: a.street ?? null,
            city: a.city ?? null,
            province: a.province ?? null,
            postal_code: a.postal_code ?? null,
            country: a.country ?? null,
          })),
          created_at: c.created_at,
          updated_at: c.updated_at,
          custom_fields: customFields,
          ...notes,
          ...(fields_warning && { fields_warning }),
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

  server.registerTool(
    "update_contact",
    {
      description: "Update selected contact details using the ETag and association IDs from get_contact. Omitted details remain unchanged. No deletion or contact-type changes. After an uncertain outcome, reread before retrying.",
      inputSchema: z.object(CONTACT_UPDATE_INPUT).strict(),
    },
    async (input) => {
      let patchAttempted = false;
      let auditArgs: Record<string, unknown> = {};
      try {
        // Parse here too: embedded callers may invoke the registered callback directly.
        const { contact_id, expected_etag, changes } = z.object(CONTACT_UPDATE_INPUT).strict().parse(input);
        auditArgs = { contact_id, ...(changes.custom_field_values && {
          custom_field_ids: changes.custom_field_values.map(v => v.custom_field_id),
        }) };
        const current = await clioGet(`/contacts/${contact_id}.json`, {
          fields: `id,etag,type,name,first_name,last_name,email_addresses{id},phone_numbers{id},addresses{id}${changes.sales_tax_number !== undefined ? ",sales_tax_number" : ""}${changes.custom_field_values ? "," + CUSTOM_FIELD_VALUE_FIELDS : ""}`,
        });
        if (current?.data?.id !== contact_id || !current.data.etag) throw new Error("Incomplete contact read");
        if (current.data.etag !== expected_etag) throw new ClioApiError(412, "Contact changed");
        const payload = buildContactPatch(changes, current.data);
        patchAttempted = true;
        const result = await clioPatch(`/contacts/${contact_id}.json`, { data: payload }, { fields: "id,etag" }, { ifMatch: expected_etag });
        await appendAuditLog({ tool: "update_contact", args: auditArgs, outcome: "success" });
        const etag = result?.data?.etag ?? null;
        return { content: [{ type: "text", text: JSON.stringify({ contact_id, updated: true, etag,
          ...(etag === null && { warning: "Reread the contact to obtain its ETag before another edit." }),
        }) }] };
      } catch (err: unknown) {
        const error = contactUpdateError(err, patchAttempted);
        await appendAuditLog({ tool: "update_contact", args: auditArgs, outcome: "error", error_message: error.code });
        return { content: [{ type: "text", text: JSON.stringify(error) }], isError: true };
      }
    }
  );
}
