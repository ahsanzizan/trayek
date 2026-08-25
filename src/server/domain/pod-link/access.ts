/**
 * Whether a POD upload link may be used right now (TRK-024).
 *
 * Pure and total: every way a link can be unusable is a named reason with a
 * message a driver can act on. Pak Herman is at a warehouse gate with the
 * engine running — "contact the admin" is the only useful instruction, and a
 * stack trace is the acceptance criterion this exists to fail.
 */

export type LinkRefusalReason =
  "NOT_FOUND" | "EXPIRED" | "REVOKED" | "EXHAUSTED" | "THROTTLED";

export type LinkAccessDecision =
  | { allowed: true; remainingUses: number }
  | { allowed: false; reason: LinkRefusalReason };

/**
 * What the driver sees. Bahasa Indonesia only, no English fallback, and no
 * detail that would tell someone probing the URL which links exist: an
 * unknown token and a revoked one differ in wording only in that the revoked
 * one is worth asking the admin about.
 */
export const LINK_REFUSAL_MESSAGES: Record<LinkRefusalReason, string> = {
  NOT_FOUND:
    "Tautan tidak dikenali. Periksa kembali tautan yang dikirim admin Anda.",
  EXPIRED:
    "Tautan ini sudah kedaluwarsa. Hubungi admin untuk meminta tautan baru.",
  REVOKED:
    "Tautan ini sudah dibatalkan. Hubungi admin untuk meminta tautan baru.",
  EXHAUSTED:
    "Batas unggah untuk tautan ini sudah habis. Hubungi admin untuk meminta tautan baru.",
  THROTTLED: "Terlalu banyak percobaan. Tunggu beberapa menit, lalu coba lagi.",
};

/** The link fields the decision reads. Deliberately not the Prisma model. */
export type UploadLinkState = {
  expiresAt: Date;
  revokedAt: Date | null;
  useBudget: number;
  useCount: number;
};

export function evaluateLinkAccess(
  link: UploadLinkState,
  now: Date,
): LinkAccessDecision {
  // Revocation is checked before expiry: a link revoked because it leaked
  // stays revoked in the record even after it would have expired anyway, and
  // the admin who revoked it should see that reason reflected back.
  if (link.revokedAt !== null && link.revokedAt.getTime() <= now.getTime()) {
    return { allowed: false, reason: "REVOKED" };
  }

  if (link.expiresAt.getTime() <= now.getTime()) {
    return { allowed: false, reason: "EXPIRED" };
  }

  if (link.useCount >= link.useBudget) {
    return { allowed: false, reason: "EXHAUSTED" };
  }

  return { allowed: true, remainingUses: link.useBudget - link.useCount };
}
