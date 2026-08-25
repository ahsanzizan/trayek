import { normalizeIndonesianPhone } from "~/server/domain/driver/phone";

export const WHATSAPP_JID_SUFFIX = "@s.whatsapp.net" as const;
export const WHATSAPP_LID_SUFFIX = "@lid" as const;

export function toJid(phone: string): string {
  const result = normalizeIndonesianPhone(phone);

  if (!result.ok) {
    throw new Error("INVALID_E164");
  }

  return `${result.e164.slice(1)}${WHATSAPP_JID_SUFFIX}`;
}

export function fromE164(jid: string): string {
  const cleanJid = jid.replace(/:\d+@/, "@");
  const isUserJid =
    cleanJid.endsWith(WHATSAPP_JID_SUFFIX) ||
    cleanJid.endsWith(WHATSAPP_LID_SUFFIX);

  if (!isUserJid) {
    throw new Error("INVALID_JID");
  }

  if (cleanJid.endsWith(WHATSAPP_LID_SUFFIX)) {
    return `lid:${cleanJid.slice(0, -WHATSAPP_LID_SUFFIX.length)}`;
  }

  const rawPhone = cleanJid.replace(/@(s\.whatsapp\.net|lid)$/, "");
  const result = normalizeIndonesianPhone(`+${rawPhone}`);

  if (result.ok) {
    return result.e164;
  }

  if (/^\d{7,15}$/.test(rawPhone)) {
    return `+${rawPhone}`;
  }

  throw new Error("INVALID_JID");
}

export function isWhatsappUserJid(jid: unknown): jid is string {
  return (
    typeof jid === "string" &&
    (jid.includes(WHATSAPP_JID_SUFFIX) || jid.includes(WHATSAPP_LID_SUFFIX))
  );
}

export function isWhatsappJid(jid: unknown): boolean {
  return (
    typeof jid === "string" &&
    (jid.includes(WHATSAPP_JID_SUFFIX) || jid.includes(WHATSAPP_LID_SUFFIX))
  );
}
