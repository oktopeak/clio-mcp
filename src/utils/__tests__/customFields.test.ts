import { describe, it, expect } from "vitest";
import {
  mapCustomFieldValues,
  buildCustomFieldWrites,
  customFieldIdsForAudit,
  hasStrippedCustomFieldValues,
  CUSTOM_FIELD_VALUE_FIELDS,
} from "../customFields.js";

const PICKLIST = {
  id: "picklist-55003",
  field_name: "Case Type",
  field_type: "picklist",
  value: "9002",
  custom_field: { id: 55003 },
  picklist_option: { id: 9002, option: "Identity Theft" },
};

const TEXT = {
  id: "text_line-55001",
  field_name: "Docket Number",
  field_type: "text_line",
  value: "24-cv-1234",
  custom_field: { id: 55001 },
};

describe("CUSTOM_FIELD_VALUE_FIELDS", () => {
  it("asks for everything needed to read a field without a second call", () => {
    // Without picklist_option a picklist reads back as a bare option id, and
    // without field_type the caller cannot tell a currency from a text field.
    for (const part of ["field_name", "field_type", "value", "custom_field", "picklist_option"]) {
      expect(CUSTOM_FIELD_VALUE_FIELDS).toContain(part);
    }
  });

  it("never nests a second level of {} inside custom_field_values, which Clio rejects with a 400", () => {
    // custom_field and picklist_option must be bare (default attributes), not
    // custom_field{id} / picklist_option{id,option} - Clio's fields parameter
    // supports only one level of curly-brace nesting.
    expect(CUSTOM_FIELD_VALUE_FIELDS).not.toContain("custom_field{");
    expect(CUSTOM_FIELD_VALUE_FIELDS).not.toContain("picklist_option{");
  });
});

describe("mapCustomFieldValues", () => {
  it("resolves a picklist to its label while keeping the raw option id", () => {
    expect(mapCustomFieldValues([PICKLIST])).toEqual([
      {
        id: "picklist-55003",
        field_id: 55003,
        name: "Case Type",
        type: "picklist",
        value: "9002",
        display_value: "Identity Theft",
      },
    ]);
  });

  it("leaves non-picklist values untouched, display_value included", () => {
    const [mapped] = mapCustomFieldValues([TEXT]);
    expect(mapped.value).toBe("24-cv-1234");
    expect(mapped.display_value).toBe("24-cv-1234");
  });

  it("preserves falsy values rather than coercing them away", () => {
    // A cleared checkbox and a zero-dollar loss are both real answers.
    const [checkbox] = mapCustomFieldValues([
      { id: "checkbox-1", field_name: "Police Report", field_type: "checkbox", value: false, custom_field: { id: 1 } },
    ]);
    expect(checkbox.value).toBe(false);
    expect(checkbox.display_value).toBe(false);
  });

  it("falls back to the nested custom_field name when field_name is absent", () => {
    const [mapped] = mapCustomFieldValues([{ id: "x-1", value: "v", custom_field: { id: 1, name: "Legacy" } }]);
    expect(mapped.name).toBe("Legacy");
  });

  it("returns an empty array for missing or non-array input", () => {
    expect(mapCustomFieldValues(undefined)).toEqual([]);
    expect(mapCustomFieldValues(null)).toEqual([]);
    expect(mapCustomFieldValues({} as unknown)).toEqual([]);
  });
});

describe("buildCustomFieldWrites", () => {
  const existing = mapCustomFieldValues([TEXT, PICKLIST]);

  it("addresses an existing value by its composite id and omits custom_field", () => {
    expect(buildCustomFieldWrites([{ custom_field_id: 55001, value: "24-cv-9999" }], existing)).toEqual([
      { id: "text_line-55001", value: "24-cv-9999" },
    ]);
  });

  it("addresses a field with no value yet by its definition id", () => {
    expect(buildCustomFieldWrites([{ custom_field_id: 99999, value: "new" }], existing)).toEqual([
      { custom_field: { id: 99999 }, value: "new" },
    ]);
  });

  it("picks the right shape per field within one batch", () => {
    const writes = buildCustomFieldWrites(
      [
        { custom_field_id: 55001, value: "a" },
        { custom_field_id: 12345, value: "b" },
      ],
      existing
    );
    expect(writes).toEqual([
      { id: "text_line-55001", value: "a" },
      { custom_field: { id: 12345 }, value: "b" },
    ]);
  });

  it("clears an existing value with _destroy", () => {
    expect(buildCustomFieldWrites([{ custom_field_id: 55003, clear: true }], existing)).toEqual([
      { id: "picklist-55003", _destroy: true },
    ]);
  });

  it("throws rather than no-op when clearing a field that has no value", () => {
    // Clio has nothing to target, so the call would appear to succeed and change
    // nothing. Failing loudly is the only honest outcome.
    expect(() => buildCustomFieldWrites([{ custom_field_id: 404, clear: true }], existing)).toThrow(
      /no value on this record/
    );
  });

  it("throws when neither a value nor clear is given", () => {
    expect(() => buildCustomFieldWrites([{ custom_field_id: 55001 }], existing)).toThrow(/provide a value/);
  });

  it("treats an empty existing set as all-new", () => {
    expect(buildCustomFieldWrites([{ custom_field_id: 55001, value: "x" }], [])).toEqual([
      { custom_field: { id: 55001 }, value: "x" },
    ]);
  });
});

describe("hasStrippedCustomFieldValues", () => {
  it("flags a value that has an id but no name, type, or value", () => {
    // The shape Clio returns when the developer application lacks custom
    // field permission: the composite id survives, everything else is null.
    const stripped = mapCustomFieldValues([{ id: "text_line-10422772625" }]);
    expect(hasStrippedCustomFieldValues(stripped)).toBe(true);
  });

  it("does not flag normally populated values", () => {
    expect(hasStrippedCustomFieldValues(mapCustomFieldValues([TEXT, PICKLIST]))).toBe(false);
  });

  it("does not flag an empty array", () => {
    expect(hasStrippedCustomFieldValues([])).toBe(false);
  });
});

describe("customFieldIdsForAudit", () => {
  it("reduces a write batch to field ids so no value reaches the log", () => {
    const summary = customFieldIdsForAudit([
      { custom_field_id: 55001, value: "Loss of $47,300" },
      { custom_field_id: 55003, value: "9002" },
    ]);
    expect(summary).toEqual([55001, 55003]);
    expect(JSON.stringify(summary)).not.toContain("47,300");
  });

  it("stays undefined when nothing was written", () => {
    expect(customFieldIdsForAudit(undefined)).toBeUndefined();
  });
});
