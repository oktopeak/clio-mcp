import { beforeEach, describe, expect, it, vi } from "vitest";
import z from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const { get, patch, audit } = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), audit: vi.fn() }));
vi.mock("../../utils/clioClient.js", async (original) => ({
  ...await original<typeof import("../../utils/clioClient.js")>(), clioGet: get, clioPatch: patch,
}));
vi.mock("../../utils/auditLog.js", () => ({ appendAuditLog: audit }));
vi.mock("@napi-rs/keyring", () => ({ Entry: class {} }));
import { ClioApiError } from "../../utils/clioClient.js";
import { buildContactPatch, CONTACT_CHANGES_SCHEMA, CONTACT_UPDATE_INPUT } from "../contactUpdates.js";
import { registerContactTools } from "../contacts.js";

const person = { id: 5, etag: "v1", type: "Person", first_name: "Ana", last_name: "Silva", sales_tax_number: null,
  email_addresses: [{ id: 10, name: "Work", address: "old@example.test" }],
  phone_numbers: [{ id: 11, name: "Mobile", number: "+351 210 000 000" }],
  addresses: [{ id: 12, name: "Home", city: "Lisboa" }], custom_field_values: [] };
const args = (changes: unknown) => ({ contact_id: 5, expected_etag: "v1", changes });
const handlers: Record<string, Function> = {};
registerContactTools({ registerTool(name: string, _config: unknown, fn: Function) { handlers[name] = fn; } } as any);
const call = (changes: unknown = { title: "Director" }) => handlers.update_contact(args(changes));
const body = (r: any) => JSON.parse(r.content[0].text);

beforeEach(() => {
  vi.resetAllMocks(); get.mockResolvedValue({ data: structuredClone(person) });
  patch.mockResolvedValue({ data: { id: 5, etag: "v2" } }); audit.mockResolvedValue(undefined);
});

describe("contact change validation", () => {
  it.each([
    {}, { type: "Company" }, { title: null }, { sales_tax_number: "" },
    { sales_tax_number: " " }, { email_addresses: [] },
    { email_addresses: [{ id: 10 }] }, { email_addresses: [{ address: "new@example.test" }] },
    { email_addresses: [{ name: "Work", address: "not-an-email" }] },
    { email_addresses: [{ name: "Billing", address: "new@example.test" }] },
    { phone_numbers: [{ name: "Billing", number: "+351123" }] },
    { addresses: [{ name: "Mobile", city: "Lisboa" }] },
    { addresses: [{ name: "Home" }] }, { addresses: [{ id: 12, _destroy: true }] },
    { email_addresses: [{ id: Number.MAX_SAFE_INTEGER + 1, address: "new@example.test" }] },
    { custom_field_values: [{ custom_field_id: 1, clear: true }] },
  ])("rejects invalid or unsupported changes %j", changes => {
    expect(CONTACT_CHANGES_SCHEMA.safeParse(changes).success).toBe(false);
  });
  it.each(["", " ", "*", "v1\n", "v1\t", "v1\u0000", "v1\u007f"])("rejects unusable ETag %j", tag => {
    expect(z.object(CONTACT_UPDATE_INPUT).strict().safeParse({ ...args({title:"Director"}), expected_etag:tag }).success).toBe(false);
  });
  it("rejects unknown top-level arguments", () => {
    expect(z.object(CONTACT_UPDATE_INPUT).strict().safeParse({...args({title:"Director"}),extra:true}).success).toBe(false);
  });
});

describe("contact payload construction", () => {
  it("preserves omitted fields and does not normalize Unicode", () => {
    expect(buildContactPatch({ first_name: "Ána", title: "" }, person)).toEqual({ first_name: "Ána", title: "" });
  });
  // Deliberately invalid, synthetic tax identifiers; never use client data in fixtures.
  it("sets the native tax number and rejects a conflicting existing value", () => {
    expect(buildContactPatch({ sales_tax_number: "000000000" }, person)).toEqual({ sales_tax_number: "000000000" });
    expect(buildContactPatch({ sales_tax_number: "PT000000000" }, person)).toEqual({ sales_tax_number: "PT000000000" });
    expect(() => buildContactPatch({ sales_tax_number: "000000000" }, { ...person, sales_tax_number: "123456789" })).toThrow();
  });
  it("edits associations by ID and allows explicit additions", () => {
    const changes = {email_addresses:[{id:10,address:"new@example.test"},{name:"Home" as const,address:"home@example.test"}],
      phone_numbers:[{id:11,number:"+351 999 000 000 ext 3"}],addresses:[{id:12,city:"Porto",street:""}]};
    expect(buildContactPatch(changes,person)).toEqual(changes);
  });
  it.each([
    {email_addresses:[{id:99,address:"a@example.test"}]},
    {phone_numbers:[{id:10,number:"123"}]},
    {addresses:[{id:11,city:"Porto"}]},
    {email_addresses:[{id:10,address:"a@example.test"},{id:10,address:"b@example.test"}]},
    {first_name:"",last_name:" "}, {name:"Ana Silva"},
  ])("rejects invalid ownership, duplicate IDs or person names %j", changes => {
    expect(() => buildContactPatch(changes as any,person)).toThrow();
  });
  it("renames a Company but rejects person-name edits and blank names", () => {
    const company={...person,type:"Company",name:"Acme"};
    expect(buildContactPatch({name:"Acme Portugal"},company)).toEqual({name:"Acme Portugal"});
    expect(() => buildContactPatch({first_name:"Ana"},company)).toThrow();
    expect(() => buildContactPatch({name:" "},company)).toThrow();
  });
  it("rejects unknown contact types and missing associations", () => {
    expect(() => buildContactPatch({title:"Director"},{...person,type:"Unknown"})).toThrow();
    expect(() => buildContactPatch({email_addresses:[{id:10,address:"a@example.test"}]},{...person,email_addresses:undefined})).toThrow();
  });
  it("uses existing composite custom-field IDs and preserves false and zero", () => {
    const current={...person,custom_field_values:[{id:"checkbox-7",field_name:"Active",field_type:"checkbox",value:true,custom_field:{id:7}}]};
    expect(buildContactPatch({custom_field_values:[{custom_field_id:7,value:false},{custom_field_id:8,value:0}]},current)).toEqual({custom_field_values:[{id:"checkbox-7",value:false},{custom_field:{id:8},value:0}]});
  });
  it.each([undefined, [{id:"text_line-7"}]])("refuses missing or stripped custom-field reads", custom_field_values => {
    expect(() => buildContactPatch({custom_field_values:[{custom_field_id:7,value:"new"}]},{...person,custom_field_values})).toThrow();
  });
  it("creates a value for a displayed but unset custom field with a null instance ID", () => {
    const current={...person,custom_field_values:[
      {id:null,field_name:"Default field",field_type:"text_line",value:null,custom_field:{id:7}},
      {id:"checkbox-8",field_name:"Active",field_type:"checkbox",value:true,custom_field:{id:8}},
    ]};
    expect(buildContactPatch({custom_field_values:[{custom_field_id:7,value:"new"}]},current))
      .toEqual({custom_field_values:[{custom_field:{id:7},value:"new"}]});
    expect(buildContactPatch({custom_field_values:[{custom_field_id:8,value:false}]},current))
      .toEqual({custom_field_values:[{id:"checkbox-8",value:false}]});
  });
  it("rejects duplicate custom-field IDs", () => {
    expect(() => buildContactPatch({custom_field_values:[{custom_field_id:7,value:"one"},{custom_field_id:7,value:"two"}]},person)).toThrow();
  });
});

describe("update_contact orchestration", () => {
  it("issues one conditional PATCH containing only selected fields", async () => {
    expect(body(await call())).toEqual({contact_id:5,updated:true,etag:"v2"});
    expect(patch).toHaveBeenCalledExactlyOnceWith("/contacts/5.json",{data:{title:"Director"}},{fields:"id,etag"},{ifMatch:"v1"});
    expect(audit).toHaveBeenCalledTimes(1);
  });
  it("requires complete custom-field reads before choosing value-instance IDs", async () => {
    await call({custom_field_values:[{custom_field_id:7,value:"new"}]});
    expect(get.mock.calls[0][1].fields).toContain("custom_field_values{");
    expect(patch.mock.calls[0][1]).toEqual({data:{custom_field_values:[{custom_field:{id:7},value:"new"}]}});
  });
  it("reads the current native tax number and conditionally patches only that field", async () => {
    const result = body(await call({ sales_tax_number: "000000000" }));
    expect(result).toEqual({ contact_id: 5, updated: true, etag: "v2" });
    expect(get.mock.calls[0][1].fields).toContain("sales_tax_number");
    expect(patch).toHaveBeenCalledExactlyOnceWith(
      "/contacts/5.json", { data: { sales_tax_number: "000000000" } }, { fields: "id,etag" }, { ifMatch: "v1" }
    );
  });
  it("rejects invalid input without accessing Clio", async () => {
    expect((await call({})).isError).toBe(true); expect(get).not.toHaveBeenCalled(); expect(patch).not.toHaveBeenCalled();
  });
  it("rejects foreign association IDs before writing", async () => {
    expect((await call({email_addresses:[{id:99,address:"a@example.test"}]})).isError).toBe(true); expect(patch).not.toHaveBeenCalled();
  });
  it("rejects a stale read without refreshing the ETag", async () => {
    get.mockResolvedValue({data:{...person,etag:"v2"}});
    expect(body(await call()).code).toBe("contact_changed"); expect(patch).not.toHaveBeenCalled(); expect(get).toHaveBeenCalledTimes(1);
  });
  it.each([[401,"authentication_required"],[403,"permission_denied"],[404,"contact_not_found"],[412,"contact_changed"],[422,"validation_rejected"],[429,"rate_limited"],[500,"update_outcome_unknown"]])("handles PATCH %s without replay or leaking provider text", async (status,code) => {
    patch.mockRejectedValue(new ClioApiError(status as number,"PRIVATE_PROVIDER_DATA"));
    const r=await call(); expect(r.isError).toBe(true); expect(body(r).code).toBe(code);
    expect(patch).toHaveBeenCalledTimes(1); expect(get).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([r,audit.mock.calls])).not.toContain("PRIVATE_PROVIDER_DATA");
  });
  it("reports uncertain writes without replaying", async () => {
    patch.mockRejectedValue(new Error("PRIVATE_NETWORK_DETAIL"));
    expect(body(await call()).code).toBe("update_outcome_unknown"); expect(patch).toHaveBeenCalledTimes(1);
  });
  it("reports preflight failure as a read failure", async () => {
    get.mockRejectedValue(new Error("PRIVATE_READ_DETAIL"));
    expect(body(await call()).code).toBe("read_failed"); expect(patch).not.toHaveBeenCalled();
  });
  it("does not turn a completed empty-body PATCH into a failed write", async () => {
    patch.mockResolvedValue({});
    expect(body(await call())).toMatchObject({contact_id:5,updated:true,etag:null});
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("enforces the schema at the MCP boundary", async () => {
    const server=new McpServer({name:"contact-test",version:"1"}); registerContactTools(server);
    const client=new Client({name:"test-client",version:"1"});
    const [a,b]=InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a),client.connect(b)]);
    try {
      const r=await client.callTool({name:"update_contact",arguments:args({type:"Company"})});
      expect(r.isError).toBe(true); expect(get).not.toHaveBeenCalled(); expect(patch).not.toHaveBeenCalled();
    } finally { await client.close(); await server.close(); }
  });
});
