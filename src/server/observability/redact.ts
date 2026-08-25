const PHONE_PATTERN =
  /(?<!\d)(?:(?:\+?62|\(?0\)?)[\s.-]?|\(\+?62\)[\s.-]?)(?:8\d{1,3}\)?|\(8\d{1,3}\))[\s.-]?\d{2,4}[\s.-]?\d{3,5}(?!\d)/g;
const URL_PATTERN = /\b(?:https?|ftp):\/\/[^\s"'<>]+/gi;
const NPWP_PATTERN = /\d{2}\.\d{3}\.\d{3}\.\d{1}-\d{3}\.\d{3}/g;

const REDACTED = "[REDACTED]";
const REDACTED_PHONE = "[REDACTED_PHONE]";
const REDACTED_URL = "[REDACTED_URL]";
const REDACTED_NPWP = "[REDACTED_NPWP]";
const CIRCULAR = "[CIRCULAR]";
const UNAVAILABLE = "[UNAVAILABLE]";

const NON_SENSITIVE_EXACT_KEYS = new Set([
  "inputtokens",
  "outputtokens",
  "totaltokens",
  "tokencount",
  "tokens",
  "jobkey",
  "filekey",
  "idempotencykey",
]);

const SENSITIVE_EXACT_KEYS = new Set([
  "data",
  "body",
  "payload",
  "prompt",
  "completion",
  "cookie",
  "cookies",
  "auth",
  "authorization",
]);

const SENSITIVE_KEY_PATTERNS = [
  /passw/i,
  /secret/i,
  /cred/i,
  /(?:authstate|remotejid|jid)/i,
  /token/i,
  /phone/i,
  /nohp/i,
  /nomorhp/i,
  /telepon/i,
  /telephone/i,
  /npwp/i,
  /nik/i,
  /ktp/i,
  /(?:api|private|secret|access|auth|signing|encryption|master|pass)key/i,
  /(?:request|raw|model)(?:body|payload|request|response|output)/i,
];

function normalizedKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function isSensitiveKey(key: string): boolean {
  const normalized = normalizedKey(key);
  if (!normalized) {
    return false;
  }
  if (NON_SENSITIVE_EXACT_KEYS.has(normalized)) {
    return false;
  }
  if (SENSITIVE_EXACT_KEYS.has(normalized)) {
    return true;
  }
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  try {
    const prototype = Reflect.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

export function redactString(value: string): string {
  return value
    .replace(PHONE_PATTERN, REDACTED_PHONE)
    .replace(URL_PATTERN, REDACTED_URL)
    .replace(NPWP_PATTERN, REDACTED_NPWP);
}

function redactError(
  error: Error,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const errorRecord = error as unknown as Record<string, unknown>;
  const result: Record<string, unknown> = {
    name: redactString(error.name),
    message: redactString(error.message),
  };

  if (error.stack) {
    result.stack = redactString(error.stack);
  }

  if ("cause" in error) {
    result.cause = redactValueInternal(error.cause, seen, "cause");
  }

  for (const key of Object.keys(error)) {
    if (key === "cause") {
      continue;
    }

    try {
      result[key] = redactValueInternal(errorRecord[key], seen, key);
    } catch {
      result[key] = UNAVAILABLE;
    }
  }

  return result;
}

function redactRecord(
  value: Record<string, unknown>,
  seen: WeakSet<object>,
): unknown {
  if (seen.has(value)) {
    return CIRCULAR;
  }

  seen.add(value);
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(value)) {
    try {
      result[key] = redactValueInternal(value[key], seen, key);
    } catch {
      result[key] = UNAVAILABLE;
    }
  }

  seen.delete(value);
  return result;
}

const PHONE_KEY_PATTERN = /(?:phone|nohp|nomorhp|telepon|telephone)/i;
const NPWP_KEY_PATTERN = /(?:npwp|nik|ktp)/i;

function redactValueInternal(
  value: unknown,
  seen: WeakSet<object>,
  key?: string,
): unknown {
  if (key) {
    const normalized = normalizedKey(key);
    if (normalized && !NON_SENSITIVE_EXACT_KEYS.has(normalized)) {
      if (PHONE_KEY_PATTERN.test(normalized)) {
        return REDACTED_PHONE;
      }
      if (NPWP_KEY_PATTERN.test(normalized)) {
        return REDACTED_NPWP;
      }
      if (
        SENSITIVE_EXACT_KEYS.has(normalized) ||
        SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(normalized))
      ) {
        return REDACTED;
      }
    }
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "undefined") {
    return value;
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return REDACTED;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return CIRCULAR;
    }

    seen.add(value);
    const result = value.map((item) => redactValueInternal(item, seen));
    seen.delete(value);
    return result;
  }

  if (value instanceof Error) {
    if (seen.has(value)) {
      return CIRCULAR;
    }

    seen.add(value);
    const result = redactError(value, seen);
    seen.delete(value);
    return result;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof URL) {
    return REDACTED_URL;
  }

  if (isPlainRecord(value)) {
    return redactRecord(value, seen);
  }

  try {
    return redactString(Object.prototype.toString.call(value));
  } catch {
    return UNAVAILABLE;
  }
}

export function redactValue(value: unknown): unknown {
  return redactValueInternal(value, new WeakSet<object>());
}

export function redactErrorValue(error: unknown): unknown {
  return redactValue(error);
}

export function redactSentryData<T>(value: T): T {
  return redactValue(value) as T;
}
