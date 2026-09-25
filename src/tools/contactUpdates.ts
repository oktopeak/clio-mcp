import z from "zod";
import { ClioApiError } from "../utils/clioClient.js";
import { buildCustomFieldWrites, hasStrippedCustomFieldValues, mapCustomFieldValues } from "../utils/customFields.js";

const id = z.number().int().positive().safe();
const nonblank = z.string().refine(v => v.trim().length > 0, "Must not be blank");
function associationRules(value: { id?: number; [key: string]: unknown }, ctx: z.RefinementCtx, required: string[]) {
  if (value.id !== undefined) {
    if (!Object.entries(value).some(([k, v]) => k !== "id" && v !== undefined)) {
      ctx.addIssue({ code: "custom", message: "An existing association requires at least one change" });
    }
  } else if (required.some(k => value[k] === undefined)) {
    ctx.addIssue({ code: "custom", message: `A new association requires ${required.join(" and ")}` });
  }
}
const email = z.object({
  id: id.optional(), name: z.enum(["Work", "Home", "Other"]).optional(), address: z.string().email().optional(),
}).strict().superRefine((v, ctx) => associationRules(v, ctx, ["name", "address"]));
const phone = z.object({
  id: id.optional(), name: z.enum(["Work", "Home", "Mobile", "Fax", "Pager", "Skype", "Other"]).optional(),
  number: nonblank.optional(),
}).strict().superRefine((v, ctx) => associationRules(v, ctx, ["name", "number"]));
const address = z.object({
  id: id.optional(), name: z.enum(["Work", "Home", "Billing", "Other"]).optional(),
  street: z.string().optional(), city: z.string().optional(), province: z.string().optional(),
  postal_code: z.string().optional(), country: z.string().optional(),
}).strict().superRefine((v, ctx) => {
  associationRules(v, ctx, ["name"]);
  if (v.id === undefined && !Object.entries(v).some(([k, value]) => k !== "name" && k !== "id" && typeof value === "string" && value.trim().length > 0)) {
    ctx.addIssue({ code: "custom", message: "A new address requires at least one nonblank address component" });
  }
});
export const CONTACT_CHANGES_SCHEMA = z.object({
  first_name: z.string().optional(), last_name: z.string().optional(),
  name: nonblank.optional().describe("Company name; for people use first_name and last_name"),
  title: z.string().optional(),
  sales_tax_number: nonblank.optional().describe("Native Clio tax number, including a NIF or foreign VAT identifier"),
  email_addresses: z.array(email).min(1).optional().describe("Edit using IDs from get_contact.emails; omit id only to add an email"),
  phone_numbers: z.array(phone).min(1).optional(),
  addresses: z.array(address).min(1).optional(),
  custom_field_values: z.array(z.object({
    custom_field_id: id, value: z.union([z.string().min(1), z.number().finite(), z.boolean()]),
  }).strict()).min(1).optional().describe("Set values by field definition ID; picklists use option IDs. Clearing is not supported"),
}).strict().refine(v => Object.values(v).some(x => x !== undefined), "Provide at least one change");
export type ContactChanges = z.infer<typeof CONTACT_CHANGES_SCHEMA>;
export const CONTACT_UPDATE_INPUT = {
  contact_id: id,
  expected_etag: nonblank.refine(v => v.trim() !== "*" && !/[\x00-\x1f\x7f]/.test(v), "Use the ETag from get_contact")
    .describe("Exact ETag returned by get_contact; required to prevent overwriting concurrent changes"),
  changes: CONTACT_CHANGES_SCHEMA,
};
class ContactValidationError extends Error {}
function reject(message: string): never { throw new ContactValidationError(message); }

/** Build only supplied changes, after a complete read of affected associations. */
export function buildContactPatch(input: ContactChanges, current: any): Record<string, unknown> {
  const changes = CONTACT_CHANGES_SCHEMA.parse(input);
  if (!current || !["Person", "Company"].includes(current.type)) reject("Cannot edit an unknown contact type.");
  if (current.type === "Person") {
    if (changes.name !== undefined) reject("Use first_name and last_name for a person.");
    const first = changes.first_name ?? current.first_name;
    const last = changes.last_name ?? current.last_name;
    if (![first, last].some(v => typeof v === "string" && v.trim().length > 0)) reject("A person must retain a first or last name.");
  } else if (changes.first_name !== undefined || changes.last_name !== undefined) reject("Use name for a company.");
  if (changes.sales_tax_number !== undefined && typeof current.sales_tax_number === "string"
      && current.sales_tax_number.trim() && current.sales_tax_number !== changes.sales_tax_number) {
    reject("Contact already has a different tax number.");
  }
  const result: Record<string, unknown> = {};
  for (const key of ["first_name", "last_name", "name", "title", "sales_tax_number"] as const) {
    if (changes[key] !== undefined) result[key] = changes[key];
  }
  for (const key of ["email_addresses", "phone_numbers", "addresses"] as const) {
    const entries = changes[key];
    if (!entries) continue;
    if (!Array.isArray(current[key])) reject("Contact associations could not be read completely. Reread before editing.");
    const owned = new Set(current[key].map((v: any) => v.id));
    const seen = new Set<number>();
    for (const entry of entries) {
      if (entry.id === undefined) continue;
      if (seen.has(entry.id)) reject("Duplicate association IDs are not allowed.");
      if (!owned.has(entry.id)) reject("An association ID does not belong to this contact. Reread its details.");
      seen.add(entry.id);
    }
    result[key] = entries;
  }
  if (changes.custom_field_values) {
    if (!Array.isArray(current.custom_field_values)) reject("Custom fields could not be read completely. Check permissions before editing.");
    const mapped = mapCustomFieldValues(current.custom_field_values);
    // Displayed-but-unset fields have a definition ID and a null value-instance ID.
    // The shared mapper creates their first value; null is not a permission failure.
    if (hasStrippedCustomFieldValues(mapped) || mapped.some(v => !v.field_id || (v.id !== null && !v.id))) reject("Custom fields could not be read completely. Check permissions before editing.");
    const ids = changes.custom_field_values.map(v => v.custom_field_id);
    if (new Set(ids).size !== ids.length) reject("Duplicate custom-field IDs are not allowed.");
    result.custom_field_values = buildCustomFieldWrites(changes.custom_field_values, mapped);
  }
  return result;
}

/** Never forward provider bodies or arbitrary exception messages to the audit log. */
export function contactUpdateError(err: unknown, patchAttempted: boolean): { code: string; message: string; status?: number } {
  if (err instanceof z.ZodError) return { code: "invalid_changes", message: "Invalid contact changes. Check field names, values and association IDs." };
  if (err instanceof ContactValidationError) return { code: "invalid_changes", message: err.message };
  const status = err instanceof ClioApiError ? err.statusCode : undefined;
  const known: Record<number, [string, string]> = {
    400: ["validation_rejected", "Clio rejected the request. Check the supported fields."],
    401: ["authentication_required", "Reconnect to Clio before continuing."],
    403: ["permission_denied", "Clio denied access. Check contact permissions before continuing."],
    404: ["contact_not_found", "The contact was not found or is not accessible."],
    412: ["contact_changed", "The contact changed. Reread and review the changes before retrying with its new ETag."],
    422: ["validation_rejected", "Clio rejected the changes. Check field values and account requirements."],
    429: ["rate_limited", "Clio rate limit reached. Wait before retrying."],
  };
  const [code, message] = (status !== undefined ? known[status] : undefined) ?? (patchAttempted
    ? ["update_outcome_unknown", "The update outcome is unknown. Reread the contact and reconcile changes before retrying."]
    : ["read_failed", "Could not read the contact. No update was sent."]);
  return { code, message, ...(status !== undefined ? { status } : {}) };
}
