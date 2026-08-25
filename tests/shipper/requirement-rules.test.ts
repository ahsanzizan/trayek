import { describe, expect, it } from "vitest";

import {
  DOCUMENT_TYPES,
  InvalidRequirementRulesError,
  POD_FIELDS,
  parseRequirementRules,
  type RequirementRules,
} from "~/server/domain/shipper/requirement-rules";

const valid: RequirementRules = {
  requiredPodFields: ["tandaTangan", "stempel", "namaTerang"],
  requiredDocuments: ["SURAT_JALAN", "POD", "INVOICE"],
  packetFormat: {
    fileNamingPattern: "{nomorSuratJalan}-{documentType}",
    ordering: ["INVOICE", "SURAT_JALAN", "POD"],
    delivery: "MERGED_PDF",
  },
  submissionCadence: { type: "WEEKLY", dayOfWeek: 5 },
  terms: { netDays: 60, clockStart: "PACKET_RECEIVED_DATE" },
};

describe("parseRequirementRules: valid input", () => {
  it("accepts a complete profile unchanged", () => {
    expect(parseRequirementRules(valid)).toEqual(valid);
  });

  it.each(["ROLLING", "WEEKLY", "MONTHLY"] as const)(
    "accepts %s submission cadence",
    (type) => {
      const cadence =
        type === "ROLLING"
          ? { type }
          : type === "WEEKLY"
            ? { type, dayOfWeek: 1 }
            : { type, dayOfMonth: 25 };

      expect(
        parseRequirementRules({ ...valid, submissionCadence: cadence })
          .submissionCadence,
      ).toEqual(cadence);
    },
  );
});

describe("parseRequirementRules: unknown keys", () => {
  // The acceptance criterion is explicit that unknown keys are rejected.
  // Dropping them silently would produce a profile that does not require what
  // whoever wrote it believed it required.
  it("rejects an unknown key at the root", () => {
    expect(() =>
      parseRequirementRules({ ...valid, requiresStempelBasah: true }),
    ).toThrow(InvalidRequirementRulesError);
  });

  it.each([
    ["packetFormat", { ...valid.packetFormat, watermark: true }],
    ["terms", { ...valid.terms, graceDays: 5 }],
  ])("rejects an unknown key inside %s", (key, patched) => {
    expect(() => parseRequirementRules({ ...valid, [key]: patched })).toThrow(
      InvalidRequirementRulesError,
    );
  });

  it("rejects an unknown key inside a cadence variant", () => {
    expect(() =>
      parseRequirementRules({
        ...valid,
        submissionCadence: { type: "ROLLING", dayOfWeek: 3 },
      }),
    ).toThrow(InvalidRequirementRulesError);
  });
});

describe("parseRequirementRules: membership and bounds", () => {
  it("rejects a POD field that is not in the vocabulary", () => {
    expect(() =>
      parseRequirementRules({
        ...valid,
        requiredPodFields: ["tandaTangan", "nomorPolisi"],
      }),
    ).toThrow(InvalidRequirementRulesError);
  });

  it("rejects a document type that is not in the vocabulary", () => {
    expect(() =>
      parseRequirementRules({
        ...valid,
        requiredDocuments: ["SURAT_JALAN", "DELIVERY_NOTE"],
      }),
    ).toThrow(InvalidRequirementRulesError);
  });

  it.each([
    ["dayOfWeek below range", { type: "WEEKLY", dayOfWeek: 0 }],
    ["dayOfWeek above range", { type: "WEEKLY", dayOfWeek: 8 }],
    ["dayOfMonth above range", { type: "MONTHLY", dayOfMonth: 32 }],
    ["fractional dayOfWeek", { type: "WEEKLY", dayOfWeek: 2.5 }],
  ])("rejects %s", (_label, submissionCadence) => {
    expect(() =>
      parseRequirementRules({ ...valid, submissionCadence }),
    ).toThrow(InvalidRequirementRulesError);
  });

  it.each([-1, 366, 30.5])("rejects netDays of %s", (netDays) => {
    expect(() =>
      parseRequirementRules({
        ...valid,
        terms: { ...valid.terms, netDays },
      }),
    ).toThrow(InvalidRequirementRulesError);
  });

  it("accepts netDays of 0, which is cash on delivery", () => {
    expect(
      parseRequirementRules({
        ...valid,
        terms: { ...valid.terms, netDays: 0 },
      }).terms.netDays,
    ).toBe(0);
  });
});

describe("parseRequirementRules: internal consistency", () => {
  it("rejects a duplicated required document", () => {
    expect(() =>
      parseRequirementRules({
        ...valid,
        requiredDocuments: ["SURAT_JALAN", "POD", "SURAT_JALAN"],
        packetFormat: { ...valid.packetFormat, ordering: ["SURAT_JALAN"] },
      }),
    ).toThrow(/listed more than once/);
  });

  it("rejects a duplicated required POD field", () => {
    expect(() =>
      parseRequirementRules({
        ...valid,
        requiredPodFields: ["stempel", "stempel"],
      }),
    ).toThrow(/listed more than once/);
  });

  it("rejects ordering a document the packet never contains", () => {
    // Otherwise assembly fails at packet time, long after the mistake.
    expect(() =>
      parseRequirementRules({
        ...valid,
        packetFormat: {
          ...valid.packetFormat,
          ordering: [...valid.packetFormat.ordering, "FAKTUR_PAJAK"],
        },
      }),
    ).toThrow(/FAKTUR_PAJAK is ordered but not in requiredDocuments/);
  });

  it("allows a required document to be left out of the ordering", () => {
    expect(() =>
      parseRequirementRules({
        ...valid,
        packetFormat: { ...valid.packetFormat, ordering: ["INVOICE"] },
      }),
    ).not.toThrow();
  });
});

describe("requirement vocabulary drives validation", () => {
  // TRK-010: "Adding a new requirement type requires no schema migration."
  // Validation reads the exported consts, so extending one extends what is
  // accepted without touching the database. These assertions fail if someone
  // hardcodes a parallel list in the schema.
  it("accepts every declared POD field", () => {
    expect(
      parseRequirementRules({ ...valid, requiredPodFields: [...POD_FIELDS] })
        .requiredPodFields,
    ).toEqual([...POD_FIELDS]);
  });

  it("accepts every declared document type", () => {
    expect(
      parseRequirementRules({
        ...valid,
        requiredDocuments: [...DOCUMENT_TYPES],
        packetFormat: {
          ...valid.packetFormat,
          ordering: [...DOCUMENT_TYPES],
        },
      }).requiredDocuments,
    ).toEqual([...DOCUMENT_TYPES]);
  });
});

describe("InvalidRequirementRulesError", () => {
  it("names the offending path so an admin can fix it", () => {
    expect(() =>
      parseRequirementRules({
        ...valid,
        terms: { ...valid.terms, netDays: -5 },
      }),
    ).toThrow(/terms\.netDays/);
  });

  it("carries the underlying issues for a form to render", () => {
    try {
      parseRequirementRules({ ...valid, terms: { netDays: 30 } });
      expect.unreachable("expected a parse failure");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidRequirementRulesError);
      expect(
        (error as InvalidRequirementRulesError).issues.length,
      ).toBeGreaterThan(0);
    }
  });
});
