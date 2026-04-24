import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { clioGet, getClioBaseUrl, ClioApiError } from "../utils/clioClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

const DOCUMENT_LIST_FIELDS = "id,name,content_type,size,created_at,matter{id,display_number}";

const DOCUMENT_DETAIL_FIELDS =
  "id,name,content_type,size,created_at,matter{id,display_number},latest_document_version{uuid,created_at,size}";

export function registerDocumentTools(server: McpServer): void {
  server.registerTool(
    "list_documents",
    {
      description: "List documents in Clio, filtered by matter or folder",
      inputSchema: {
        matter_id: z.number().int().positive().optional().describe("Filter documents by matter ID"),
        folder_id: z.number().int().positive().optional().describe("Filter documents by folder ID"),
        limit: z.number().int().min(1).max(200).default(25).describe("Max results to return (1–200)"),
      },
    },
    async ({ matter_id, folder_id, limit }) => {
      if (!matter_id && !folder_id) {
        return {
          content: [{ type: "text", text: "Error: either matter_id or folder_id is required" }],
          isError: true,
        };
      }

      try {
        const params: Record<string, string> = { fields: DOCUMENT_LIST_FIELDS, limit: String(limit) };
        if (matter_id) params["matter_id"] = String(matter_id);
        if (folder_id) params["folder_id"] = String(folder_id);

        const data = await clioGet("/documents.json", params);
        const docs = data.data as any[];

        await appendAuditLog({
          tool: "list_documents",
          args: { matter_id, folder_id, limit },
          outcome: "success",
          ...(matter_id && { matter_id }),
        });

        if (!docs || docs.length === 0) {
          return { content: [{ type: "text", text: "No documents found." }] };
        }

        const result = docs.map((d) => ({
          id: d.id,
          name: d.name,
          content_type: d.content_type,
          size: d.size,
          created_at: d.created_at,
          matter: d.matter ? { id: d.matter.id, display_number: d.matter.display_number } : null,
        }));

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        await appendAuditLog({
          tool: "list_documents",
          args: { matter_id, folder_id, limit },
          outcome: "error",
          error_message: err.message,
          ...(matter_id && { matter_id }),
        });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "get_document",
    {
      description: "Get metadata and download URL for a single Clio document",
      inputSchema: {
        document_id: z.number().int().positive().describe("The Clio document ID"),
      },
    },
    async ({ document_id }) => {
      try {
        const data = await clioGet(`/documents/${document_id}.json`, { fields: DOCUMENT_DETAIL_FIELDS });
        const doc = data.data;

        const versionUuid = doc.latest_document_version?.uuid ?? null;
        const download_url = versionUuid
          ? `${getClioBaseUrl()}/documents/${doc.id}/download?version_uuid=${versionUuid}`
          : null;

        const result = {
          id: doc.id,
          name: doc.name,
          content_type: doc.content_type,
          size: doc.size,
          created_at: doc.created_at,
          matter: doc.matter ? { id: doc.matter.id, display_number: doc.matter.display_number } : null,
          latest_version_uuid: versionUuid,
          download_url,
        };

        await appendAuditLog({ tool: "get_document", args: { document_id }, outcome: "success" });

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        if (err instanceof ClioApiError && err.statusCode === 404) {
          await appendAuditLog({ tool: "get_document", args: { document_id }, outcome: "success" });
          return { content: [{ type: "text", text: `Document ${document_id} not found.` }] };
        }
        await appendAuditLog({ tool: "get_document", args: { document_id }, outcome: "error", error_message: err.message });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
