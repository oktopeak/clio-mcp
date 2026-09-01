import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { clioGet, clioPost, extractNextPageToken } from "../utils/clioClient.js";
import { appendAuditLog } from "../utils/auditLog.js";
import { stripHtml } from "../utils/text.js";

const NOTE_LIST_FIELDS =
  "id,subject,detail,detail_text_type,date,type,matter{id,display_number},contact{id,name},author{id,name},created_at,updated_at";

export function registerNoteTools(server: McpServer): void {
  server.registerTool(
    "create_note",
    {
      description: "Create a note on a matter in Clio",
      inputSchema: {
        matter_id: z.number().int().positive().describe("Matter ID to attach the note to"),
        subject: z.string().min(1).describe("Note subject / title"),
        body: z.string().min(1).describe("Note body text"),
      },
    },
    async ({ matter_id, subject, body }) => {
      try {
        const data = await clioPost("/notes.json", {
          data: {
            subject,
            detail: body,
            detail_text_type: "plain_text",
            type: "Matter",
            matter: { id: matter_id },
          },
        });
        const note = data.data;

        await appendAuditLog({
          tool: "create_note",
          args: { matter_id },
          outcome: "success",
          matter_id,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              note: {
                id: note.id,
                subject: note.subject,
                matter_id,
              },
            }, null, 2),
          }],
        };
      } catch (err: any) {
        await appendAuditLog({
          tool: "create_note",
          args: { matter_id },
          outcome: "error",
          error_message: err.message,
          matter_id,
        });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "list_notes",
    {
      description:
        "List notes on a matter or contact in Clio. Notes carry the narrative record (intake interviews, call summaries, case history), so this is usually where the detail behind a matter lives. Provide exactly one of matter_id or contact_id.",
      inputSchema: {
        matter_id: z.number().int().positive().optional().describe("List notes on this matter"),
        contact_id: z.number().int().positive().optional().describe("List notes on this contact"),
        created_since: z.string().optional().describe("ISO-8601 timestamp; only notes created at or after this time"),
        updated_since: z.string().optional().describe("ISO-8601 timestamp; only notes updated at or after this time"),
        limit: z.number().int().min(1).max(200).default(25).describe("Max results to return (1-200)"),
        page_token: z.string().optional().describe("Cursor from a previous list_notes response to fetch the next page"),
      },
    },
    async ({ matter_id, contact_id, created_since, updated_since, limit, page_token }) => {
      if (!matter_id && !contact_id) {
        return { content: [{ type: "text", text: "Error: provide either matter_id or contact_id" }], isError: true };
      }
      if (matter_id && contact_id) {
        return {
          content: [{ type: "text", text: "Error: provide only one of matter_id or contact_id, not both" }],
          isError: true,
        };
      }
      try {
        const params: Record<string, string> = {
          fields: NOTE_LIST_FIELDS,
          limit: String(limit),
          // Clio validates this filter and 422s on anything other than the
          // lowercase forms (API changelog v4.0.10). The capitalized "Matter"
          // used when *creating* a note is a different field on the note body.
          type: matter_id ? "matter" : "contact",
        };
        if (matter_id) params["matter_id"] = String(matter_id);
        else params["contact_id"] = String(contact_id!);
        if (created_since) params["created_since"] = created_since;
        if (updated_since) params["updated_since"] = updated_since;
        if (page_token) params["page_token"] = page_token;

        const data = await clioGet("/notes.json", params);
        const notes = (data.data ?? []) as any[];
        const nextPageToken = notes.length >= limit ? extractNextPageToken(data.meta) : null;

        await appendAuditLog({
          tool: "list_notes",
          args: { matter_id, contact_id, created_since, updated_since, limit, page_token },
          outcome: "success",
          result_count: notes.length,
          ...(matter_id && { matter_id }),
        });

        if (notes.length === 0) {
          return { content: [{ type: "text", text: "No notes found." }] };
        }

        const result = {
          notes: notes.map((n) => ({
            id: n.id,
            subject: n.subject,
            // `date` is the note's own date, set by whoever wrote it. `created_at`
            // is when the record was entered. For "when did this last move?"
            // questions the first is the honest answer, so lead with it.
            date: n.date ?? null,
            detail: stripHtml(n.detail),
            ...(n.detail_text_type === "rich_text" && { detail_html: n.detail }),
            author: n.author ? { id: n.author.id, name: n.author.name } : null,
            matter: n.matter ? { id: n.matter.id, display_number: n.matter.display_number } : null,
            contact: n.contact ? { id: n.contact.id, name: n.contact.name } : null,
            created_at: n.created_at,
            updated_at: n.updated_at,
          })),
          total_count: data.meta?.records ?? notes.length,
          has_more: nextPageToken !== null,
          next_page_token: nextPageToken,
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        await appendAuditLog({
          tool: "list_notes",
          args: { matter_id, contact_id, created_since, updated_since, limit, page_token },
          outcome: "error",
          error_message: err.message,
          ...(matter_id && { matter_id }),
        });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
