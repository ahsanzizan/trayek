import { z } from "zod";

/**
 * What a shipper requires before it will accept a `berkas tagih`.
 *
 * Stored as JSON on `RequirementProfile.rules`, not as columns, because
 * TRK-010 requires that adding a new requirement type needs no schema
 * migration. Adding one here is a single edit to a const below; the database
 * is unaware of the shape.
 *
 * Every object is `.strict()`: an unknown key is a typo or a stale client, and
 * silently dropping it would mean a profile that does not require what the
 * person who wrote it believed it required.
 */

/** Fields read off the POD itself. Indonesian terms are canonical (glossary). */
export const POD_FIELDS = [
  "tandaTangan",
  "stempel",
  "namaTerang",
  "tanggalTerima",
  "nomorSuratJalan",
  "jumlahKoli",
] as const;

export type PodField = (typeof POD_FIELDS)[number];

/** Documents the packet must contain. */
export const DOCUMENT_TYPES = [
  "SURAT_JALAN",
  "POD",
  "INVOICE",
  "FAKTUR_PAJAK",
  "BERITA_ACARA",
  "FOTO_BARANG",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/**
 * When the payment clock starts. The distinction moves DSO by weeks and
 * customers routinely get it wrong, so it is recorded per profile version
 * rather than inferred.
 */
export const CLOCK_START_EVENTS = [
  "INVOICE_DATE",
  "PACKET_RECEIVED_DATE",
] as const;

export type ClockStartEvent = (typeof CLOCK_START_EVENTS)[number];

const podFieldSchema = z.enum(POD_FIELDS);
const documentTypeSchema = z.enum(DOCUMENT_TYPES);

const packetFormatSchema = z
  .object({
    /** Template for each file name, e.g. `{nomorSuratJalan}-{documentType}`. */
    fileNamingPattern: z.string().min(1).max(200),
    /** Document order inside the packet. */
    ordering: z.array(documentTypeSchema),
    delivery: z.enum(["MERGED_PDF", "SEPARATE_FILES"]),
  })
  .strict();

/**
 * When packets may be submitted. Many shippers only accept billing on a fixed
 * day, and submitting off-cadence silently adds a week to DSO.
 */
const submissionCadenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ROLLING") }).strict(),
  z
    .object({
      type: z.literal("WEEKLY"),
      /** ISO-8601 weekday: 1 is Monday, 7 is Sunday. */
      dayOfWeek: z.number().int().min(1).max(7),
    })
    .strict(),
  z
    .object({
      type: z.literal("MONTHLY"),
      dayOfMonth: z.number().int().min(1).max(31),
    })
    .strict(),
]);

const termsSchema = z
  .object({
    netDays: z.number().int().min(0).max(365),
    clockStart: z.enum(CLOCK_START_EVENTS),
  })
  .strict();

export const requirementRulesSchema = z
  .object({
    requiredPodFields: z.array(podFieldSchema),
    requiredDocuments: z.array(documentTypeSchema),
    packetFormat: packetFormatSchema,
    submissionCadence: submissionCadenceSchema,
    terms: termsSchema,
  })
  .strict()
  .superRefine((rules, ctx) => {
    assertNoDuplicates(rules.requiredPodFields, ["requiredPodFields"], ctx);
    assertNoDuplicates(rules.requiredDocuments, ["requiredDocuments"], ctx);
    assertNoDuplicates(
      rules.packetFormat.ordering,
      ["packetFormat", "ordering"],
      ctx,
    );

    // Ordering a document the packet never contains produces a packet that can
    // never be assembled, so reject it at write time rather than at assembly.
    const required = new Set<string>(rules.requiredDocuments);
    rules.packetFormat.ordering.forEach((documentType, index) => {
      if (!required.has(documentType)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["packetFormat", "ordering", index],
          message: `${documentType} is ordered but not in requiredDocuments`,
        });
      }
    });
  });

export type RequirementRules = z.infer<typeof requirementRulesSchema>;

function assertNoDuplicates(
  values: readonly string[],
  path: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();

  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index],
        message: `${value} is listed more than once`,
      });
    }
    seen.add(value);
  });
}

export class InvalidRequirementRulesError extends Error {
  constructor(readonly issues: z.ZodIssue[]) {
    super(
      `Requirement rules are invalid: ${issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "InvalidRequirementRulesError";
  }
}

/**
 * Parses rules read back from the database or submitted by a client.
 *
 * Pure: the caller owns persistence. Throws rather than returning a result
 * union because every call site treats invalid rules as unrecoverable.
 */
export function parseRequirementRules(value: unknown): RequirementRules {
  const parsed = requirementRulesSchema.safeParse(value);

  if (!parsed.success) {
    throw new InvalidRequirementRulesError(parsed.error.issues);
  }

  return parsed.data;
}
