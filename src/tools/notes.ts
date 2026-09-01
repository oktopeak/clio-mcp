import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { clioGet, clioPost, extractNextPageToken } from "../utils/clioClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

const NOTE_LIST_FIELDS =
  "id,subject,detail,type,matter{id,display_number},contact{id,name},author{id,name},created_at,updated_at";

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
          args: { matter_id, subject },
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
          args: { matter_id, subject },
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
      description: "List notes on a matter or contact in Clio. If both matter_id and contact_id are given, matter_id takes precedence.",
      inputSchema: {
        matter_id: z.number().int().positive().optional().describe("Filter notes by matter ID"),
        contact_id: z.number().int().positive().optional().describe("Filter notes by contact ID"),
        limit: z.number().int().min(1).max(200).default(25).describe("Max results to return (1-200)"),
        page_token: z.string().optional().describe("Cursor from a previous list_notes response to fetch the next page"),
      },
    },
    async ({ matter_id, contact_id, limit, page_token }) => {
      if (!matter_id && !contact_id) {
        return { content: [{ type: "text", text: "Error: provide at least one of matter_id or contact_id" }], isError: true };
      }
      try {
        const params: Record<string, string> = {
          fields: NOTE_LIST_FIELDS,
          limit: String(limit),
          type: matter_id ? "Matter" : "Contact",
        };
        if (matter_id) params["matter_id"] = String(matter_id);
        if (contact_id) params["contact_id"] = String(contact_id);
        if (page_token) params["page_token"] = page_token;

        const data = await clioGet("/notes.json", params);
        const notes = data.data as any[];
        const nextPageToken = notes.length >= limit ? extractNextPageToken(data.meta) : null;

        await appendAuditLog({
          tool: "list_notes",
          args: { matter_id, contact_id, limit, page_token },
          outcome: "success",
          result_count: notes?.length ?? 0,
          ...(matter_id && { matter_id }),
        });

        if (!notes || notes.length === 0) {
          return { content: [{ type: "text", text: "No notes found." }] };
        }

        const result = {
          notes: notes.map((n) => ({
            id: n.id,
            subject: n.subject,
            detail: n.detail,
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
          args: { matter_id, contact_id, limit, page_token },
          outcome: "error",
          error_message: err.message,
          ...(matter_id && { matter_id }),
        });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
