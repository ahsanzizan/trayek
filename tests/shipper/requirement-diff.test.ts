import { describe, expect, it } from "vitest";

import { diffRequirementRules } from "~/server/domain/shipper/requirement-diff";
import { type RequirementRules } from "~/server/domain/shipper/requirement-rules";

const base: RequirementRules = {
  requiredPodFields: ["tandaTangan", "stempel"],
  requiredDocuments: ["SURAT_JALAN", "POD", "INVOICE"],
  packetFormat: {
    fileNamingPattern: "{nomorSuratJalan}-{documentType}",
    ordering: ["INVOICE", "SURAT_JALAN", "POD"],
    delivery: "MERGED_PDF",
  },
  submissionCadence: { type: "ROLLING" },
  terms: { netDays: 30, clockStart: "INVOICE_DATE" },
};

describe("diffRequirementRules: no change", () => {
  it("reports nothing for identical rules", () => {
    expect(diffRequirementRules(base, base)).toEqual([]);
  });

  it("reports nothing for a structurally equal copy", () => {
    expect(
      diffRequirementRules(
        base,
        JSON.parse(JSON.stringify(base)) as RequirementRules,
      ),
    ).toEqual([]);
  });
});

describe("diffRequirementRules: scalar changes", () => {
  it("reports a changed net term, which is the field that moves DSO", () => {
    expect(
      diffRequirementRules(base, {
        ...base,
        terms: { ...base.terms, netDays: 60 },
      }),
    ).toEqual([
      { path: "terms.netDays", kind: "CHANGED", before: 30, after: 60 },
    ]);
  });

  it("reports a changed clock start event", () => {
    expect(
      diffRequirementRules(base, {
        ...base,
        terms: { ...base.terms, clockStart: "PACKET_RECEIVED_DATE" },
      }),
    ).toEqual([
      {
        path: "terms.clockStart",
        kind: "CHANGED",
        before: "INVOICE_DATE",
        after: "PACKET_RECEIVED_DATE",
      },
    ]);
  });

  it("reports several changes at once, sorted by path", () => {
    const changes = diffRequirementRules(base, {
      ...base,
      packetFormat: { ...base.packetFormat, delivery: "SEPARATE_FILES" },
      terms: { netDays: 45, clockStart: "PACKET_RECEIVED_DATE" },
    });

    expect(changes.map((change) => change.path)).toEqual([
      "packetFormat.delivery",
      "terms.clockStart",
      "terms.netDays",
    ]);
  });
});

describe("diffRequirementRules: requirement lists", () => {
  it("reports an added requirement by name, not as two arrays", () => {
    expect(
      diffRequirementRules(base, {
        ...base,
        requiredPodFields: ["tandaTangan", "stempel", "namaTerang"],
      }),
    ).toEqual([
      {
        path: "requiredPodFields.namaTerang",
        kind: "ADDED",
        before: undefined,
        after: "namaTerang",
      },
    ]);
  });

  it("reports a removed requirement by name", () => {
    expect(
      diffRequirementRules(base, {
        ...base,
        requiredPodFields: ["tandaTangan"],
      }),
    ).toEqual([
      {
        path: "requiredPodFields.stempel",
        kind: "REMOVED",
        before: "stempel",
        after: undefined,
      },
    ]);
  });

  it("treats requirement lists as unordered", () => {
    expect(
      diffRequirementRules(base, {
        ...base,
        requiredPodFields: ["stempel", "tandaTangan"],
      }),
    ).toEqual([]);
  });

  it("reports an added and a removed document in one diff", () => {
    const changes = diffRequirementRules(base, {
      ...base,
      requiredDocuments: ["SURAT_JALAN", "POD", "FAKTUR_PAJAK"],
    });

    expect(changes).toEqual([
      {
        path: "requiredDocuments.INVOICE",
        kind: "REMOVED",
        before: "INVOICE",
        after: undefined,
      },
      {
        path: "requiredDocuments.FAKTUR_PAJAK",
        kind: "ADDED",
        before: undefined,
        after: "FAKTUR_PAJAK",
      },
    ]);
  });
});

describe("diffRequirementRules: packet ordering", () => {
  it("reports a reorder as one change, because the order is the meaning", () => {
    const after = {
      ...base,
      packetFormat: {
        ...base.packetFormat,
        ordering: ["SURAT_JALAN", "POD", "INVOICE"] as const,
      },
    } as RequirementRules;

    expect(diffRequirementRules(base, after)).toEqual([
      {
        path: "packetFormat.ordering",
        kind: "CHANGED",
        before: ["INVOICE", "SURAT_JALAN", "POD"],
        after: ["SURAT_JALAN", "POD", "INVOICE"],
      },
    ]);
  });
});

describe("diffRequirementRules: cadence", () => {
  it("reports the added field when the cadence gains one", () => {
    const changes = diffRequirementRules(base, {
      ...base,
      submissionCadence: { type: "WEEKLY", dayOfWeek: 5 },
    });

    expect(changes).toEqual([
      {
        path: "submissionCadence.dayOfWeek",
        kind: "ADDED",
        before: undefined,
        after: 5,
      },
      {
        path: "submissionCadence.type",
        kind: "CHANGED",
        before: "ROLLING",
        after: "WEEKLY",
      },
    ]);
  });

  it("reports the removed field when the cadence loses one", () => {
    const weekly: RequirementRules = {
      ...base,
      submissionCadence: { type: "WEEKLY", dayOfWeek: 5 },
    };

    expect(
      diffRequirementRules(weekly, base).map((change) => [
        change.path,
        change.kind,
      ]),
    ).toEqual([
      ["submissionCadence.dayOfWeek", "REMOVED"],
      ["submissionCadence.type", "CHANGED"],
    ]);
  });
});
