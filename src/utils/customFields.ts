/**
 * Clio custom field values: read mapping, write mapping, and audit-safe summaries.
 *
 * Two Clio behaviours drive everything in this file.
 *
 * 1. READ. A custom field value's `value` is type-dependent, and for `picklist`
 *    fields it is the selected option's *id*, not its label (e.g. "9002"). The
 *    label only arrives if `picklist_option{id,option}` is requested alongside
 *    it. A caller that renders `value` for a picklist shows a meaningless
 *    number, so we expose both: `value` stays raw, `display_value` is what a
 *    human (or a model) should read.
 *
 * 2. WRITE. Setting a field that has no value yet and changing one that already
 *    does use *different* shapes. New value: `{custom_field: {id}, value}`.
 *    Existing value: `{id: "<composite>", value}` where the id is the value
 *    instance's own composite string id (e.g. "text_line-55001") and
 *    `custom_field` is omitted. Clearing: `{id: "<composite>", _destroy: true}`.
 *    Clio does not document what happens when the new-value shape is sent for a
 *    field that already has one, so `buildCustomFieldWrites` never guesses: the
 *    caller reads the record first and passes what is already there.
 */

/** The `fields=` sub-selection needed to read custom fields usefully. */
export const CUSTOM_FIELD_VALUE_FIELDS =
  "custom_field_values{id,field_name,field_type,value,custom_field{id},picklist_option{id,option}}";

export interface MappedCustomField {
  /** Composite value-instance id, e.g. "text_line-55001". Needed to update or clear this value. */
  id: string | null;
  /** The field *definition* id (a plain integer). Stable across records. */
  field_id: number | null;
  name: string | null;
  type: string | null;
  /** Raw value exactly as Clio returned it. For picklists this is the option id. */
  value: unknown;
  /** Human-readable value. Identical to `value` except for picklists, where it is the option label. */
  display_value: unknown;
}

/**
 * Normalises Clio's `custom_field_values` array into a flat, name-first shape.
 * Returns [] for a missing or non-array input so callers never branch on it.
 */
export function mapCustomFieldValues(raw: unknown): MappedCustomField[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v: any) => {
    const picklistLabel = v?.picklist_option?.option;
    return {
      id: v?.id ?? null,
      field_id: v?.custom_field?.id ?? null,
      name: v?.field_name ?? v?.custom_field?.name ?? null,
      type: v?.field_type ?? null,
      value: v?.value ?? null,
      display_value: picklistLabel ?? v?.value ?? null,
    };
  });
}

/** One custom field write as the caller expresses it, before Clio's shape rules are applied. */
export interface CustomFieldWriteInput {
  custom_field_id: number;
  value?: string | number | boolean;
  /** Clear this field's value instead of setting it. Requires an existing value. */
  clear?: boolean;
}

/**
 * Turns caller intent plus the record's current values into Clio's write payload.
 *
 * `existing` is the record's `custom_field_values` as returned by Clio (raw or
 * already mapped). Fields found there are updated in place by composite id;
 * fields not found are created with `custom_field: {id}`.
 *
 * Throws when asked to clear a field that has no value, because Clio has no
 * composite id to target and would silently do nothing.
 */
export function buildCustomFieldWrites(
  inputs: CustomFieldWriteInput[],
  existing: MappedCustomField[]
): Record<string, unknown>[] {
  const byFieldId = new Map<number, MappedCustomField>();
  for (const e of existing) {
    if (e.field_id !== null && e.id !== null) byFieldId.set(e.field_id, e);
  }

  return inputs.map((input) => {
    const current = byFieldId.get(input.custom_field_id);

    if (input.clear) {
      if (!current) {
        throw new Error(
          `Cannot clear custom field ${input.custom_field_id}: it has no value on this record.`
        );
      }
      return { id: current.id, _destroy: true };
    }

    if (input.value === undefined) {
      throw new Error(
        `Custom field ${input.custom_field_id}: provide a value, or set clear: true to remove it.`
      );
    }

    // Existing value: address it by its own composite id and omit custom_field.
    if (current) return { id: current.id, value: input.value };

    // No value yet: address the field definition.
    return { custom_field: { id: input.custom_field_id }, value: input.value };
  });
}

/**
 * Audit-safe summary of a custom field write: which fields were touched, never
 * what they were set to. Custom fields are where firms keep case-vetting data
 * (loss amounts, incident dates, names), so values must not reach the log.
 */
export function customFieldIdsForAudit(inputs?: CustomFieldWriteInput[]): number[] | undefined {
  if (!inputs) return undefined;
  return inputs.map((i) => i.custom_field_id);
}
