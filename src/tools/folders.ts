import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { clioGet, clioGetAllPages, clioPost, ClioApiError, extractNextPageToken } from "../utils/clioClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

const FOLDER_LIST_FIELDS = "id,name,parent{id,type},created_at,matter{id,display_number}";

type ParentRef = { id: number; type: "Matter" | "Folder" };

/**
 * Resolves a caller-supplied (matter_id | parent_folder_id) into the exact
 * {id, type} shape Clio expects on a folder's `parent`.
 *
 * Deliberately does NOT introspect an existing folder's own `parent.type` to
 * decide what to send here — that field describes what a folder's parent
 * already is, and reading it back to drive a write is exactly the mistake
 * that causes false negatives elsewhere (a matter's document root can itself
 * be modeled as a Folder node, so its children report parent.type "Folder",
 * not "Matter"). Instead we key off which kind of id the caller supplied,
 * which is unambiguous by construction and mirrors upload_document's proven
 * `type: "Matter"` behavior for matter-root writes.
 */
function resolveParentRef(matterId?: number, parentFolderId?: number): ParentRef {
  if (matterId && parentFolderId) {
    throw new Error("Provide exactly one of matter_id or parent_folder_id, not both.");
  }
  if (matterId) return { id: matterId, type: "Matter" };
  if (parentFolderId) return { id: parentFolderId, type: "Folder" };
  throw new Error("Provide exactly one of matter_id (create/list at a matter's document root) or parent_folder_id (create/list under an existing folder).");
}

export function registerFolderTools(server: McpServer): void {
  server.registerTool(
    "list_folders",
    {
      description: "List folders in Clio, filtered by matter or parent folder",
      inputSchema: {
        matter_id: z.number().int().positive().optional().describe("List folders at this matter's document root"),
        parent_id: z.number().int().positive().optional().describe("List folders under this parent folder ID"),
        query: z.string().optional().describe("Full-text search string for folder names"),
        limit: z.number().int().min(1).max(200).default(25).describe("Max results to return (1-200)"),
        page_token: z.string().optional().describe("Cursor from a previous list_folders response to fetch the next page"),
      },
    },
    async ({ matter_id, parent_id, query, limit, page_token }) => {
      if (!matter_id && !parent_id && !query) {
        return {
          content: [{ type: "text", text: "Error: provide at least one of matter_id, parent_id, or query" }],
          isError: true,
        };
      }

      try {
        const params: Record<string, string> = { fields: FOLDER_LIST_FIELDS, limit: String(limit) };
        if (matter_id) params["matter_id"] = String(matter_id);
        if (parent_id) params["parent_id"] = String(parent_id);
        if (query) params["query"] = query;
        if (page_token) params["page_token"] = page_token;

        const data = await clioGet("/folders.json", params);
        const folders = data.data as any[];
        const nextPageToken = folders.length >= limit ? extractNextPageToken(data.meta) : null;

        await appendAuditLog({
          tool: "list_folders",
          args: { matter_id, parent_id, query, limit, page_token },
          outcome: "success",
          result_count: folders?.length ?? 0,
          ...(matter_id && { matter_id }),
        });

        const result = {
          folders: folders.map((f) => ({
            id: f.id,
            name: f.name,
            parent: f.parent ? { id: f.parent.id, type: f.parent.type } : null,
            created_at: f.created_at,
            matter: f.matter ? { id: f.matter.id, display_number: f.matter.display_number } : null,
          })),
          total_count: data.meta?.records ?? folders.length,
          has_more: nextPageToken !== null,
          next_page_token: nextPageToken,
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        await appendAuditLog({
          tool: "list_folders",
          args: { matter_id, parent_id, query, limit, page_token },
          outcome: "error",
          error_message: err.message,
          ...(matter_id && { matter_id }),
        });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "folder_exists",
    {
      description:
        "Check whether a folder with the given exact name already exists under a matter's document root or under a parent folder. Fully paginates and never relies on parent-type filtering, so it won't false-negative on matters whose document root is itself a Folder node.",
      inputSchema: {
        matter_id: z.number().int().positive().optional().describe("Check under this matter's document root"),
        parent_folder_id: z.number().int().positive().optional().describe("Check under this existing folder"),
        name: z.string().min(1).describe("Exact folder name to check for"),
      },
    },
    async ({ matter_id, parent_folder_id, name }) => {
      try {
        const parent = resolveParentRef(matter_id, parent_folder_id);
        const params: Record<string, string> = { fields: FOLDER_LIST_FIELDS, query: name, limit: "200" };
        if (parent.type === "Matter") params["matter_id"] = String(parent.id);
        else params["parent_id"] = String(parent.id);

        const allFolders = await clioGetAllPages("/folders.json", params);
        // Clio's `query` param is a substring/full-text match, not exact — confirm
        // with a client-side exact-name comparison. Never filter on parent.type here.
        const match = allFolders.find((f: any) => f.name === name) ?? null;

        await appendAuditLog({
          tool: "folder_exists",
          args: { matter_id, parent_folder_id, name },
          outcome: "success",
          result_count: allFolders.length,
          ...(matter_id && { matter_id }),
        });

        const result = {
          exists: match !== null,
          folder: match
            ? { id: match.id, name: match.name, parent: match.parent ? { id: match.parent.id, type: match.parent.type } : null }
            : null,
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        await appendAuditLog({
          tool: "folder_exists",
          args: { matter_id, parent_folder_id, name },
          outcome: "error",
          error_message: err.message,
          ...(matter_id && { matter_id }),
        });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "create_folder",
    {
      description:
        "Create a folder in Clio under a matter's document root or under an existing folder. Call folder_exists first to avoid creating duplicates.",
      inputSchema: {
        name: z.string().min(1).describe("Folder name"),
        matter_id: z.number().int().positive().optional().describe("Create at this matter's document root"),
        parent_folder_id: z.number().int().positive().optional().describe("Create under this existing folder"),
      },
    },
    async ({ name, matter_id, parent_folder_id }) => {
      try {
        const parent = resolveParentRef(matter_id, parent_folder_id);

        const data = await clioPost("/folders.json?fields=" + FOLDER_LIST_FIELDS, {
          data: { name, parent },
        });
        const folder = data.data;

        await appendAuditLog({
          tool: "create_folder",
          args: { name, matter_id, parent_folder_id },
          outcome: "success",
          ...(matter_id && { matter_id }),
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              folder: {
                id: folder.id,
                name: folder.name,
                parent: folder.parent ? { id: folder.parent.id, type: folder.parent.type } : null,
              },
            }, null, 2),
          }],
        };
      } catch (err: any) {
        const auditArgs = { name, matter_id, parent_folder_id };
        if (err instanceof ClioApiError && err.statusCode === 422) {
          await appendAuditLog({ tool: "create_folder", args: auditArgs, outcome: "error", error_message: err.message, ...(matter_id && { matter_id }) });
          return { content: [{ type: "text", text: `Validation error: ${err.message}` }], isError: true };
        }
        await appendAuditLog({ tool: "create_folder", args: auditArgs, outcome: "error", error_message: err.message, ...(matter_id && { matter_id }) });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
