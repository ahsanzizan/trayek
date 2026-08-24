import { describe, expect, it } from "vitest";

import { redactString, redactValue } from "~/server/observability/redact";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a record");
  }

  return value as Record<string, unknown>;
}

describe("observability redaction", () => {
  it("redacts Indonesian phones, absolute URLs, and NPWP values in strings", () => {
    const result = redactString(
      "+6281234567890 081234567890 6281234567890 " +
        "https://storage.example.com/pod.jpg?token=secret " +
        "NPWP 12.345.678.9-012.345",
    );

    expect(result).not.toContain("6281234567890");
    expect(result).not.toContain("081234567890");
    expect(result).not.toContain("https://storage.example.com");
    expect(result).not.toContain("12.345.678.9-012.345");
    expect(result).toContain("[REDACTED_PHONE]");
    expect(result).toContain("[REDACTED_URL]");
    expect(result).toContain("[REDACTED_NPWP]");
  });

  it("redacts formatted phone numbers with spaces, hyphens, dots, and parentheses", () => {
    const formatted =
      "Contact: 0812-3456-7890, +62 812 3456 7890, (0812) 3456789, (+62) 812-3456-7890, +62.812.3456.7890";
    const result = redactString(formatted);

    expect(result).not.toContain("0812-3456-7890");
    expect(result).not.toContain("+62 812 3456 7890");
    expect(result).not.toContain("(0812) 3456789");
    expect(result).not.toContain("(+62) 812-3456-7890");
    expect(result).not.toContain("+62.812.3456.7890");
    expect(result).toBe(
      "Contact: [REDACTED_PHONE], [REDACTED_PHONE], [REDACTED_PHONE], [REDACTED_PHONE], [REDACTED_PHONE]",
    );
  });

  it("redacts compound sensitive keys and numeric PII fields", () => {
    const result = asRecord(
      redactValue({
        sessionToken: "session-xyz",
        authToken: "auth-abc",
        clientSecret: "secret-123",
        dbPassword: "root-password",
        userPassword: "secret-password",
        customerNpwp: "123456789012345",
        driverNik: "3201234567890001",
        phone: 6281234567890,
        npwp: 123456789012345,
      }),
    );

    expect(result.sessionToken).toBe("[REDACTED]");
    expect(result.authToken).toBe("[REDACTED]");
    expect(result.clientSecret).toBe("[REDACTED]");
    expect(result.dbPassword).toBe("[REDACTED]");
    expect(result.userPassword).toBe("[REDACTED]");
    expect(result.customerNpwp).toBe("[REDACTED_NPWP]");
    expect(result.driverNik).toBe("[REDACTED_NPWP]");
    expect(result.phone).toBe("[REDACTED_PHONE]");
    expect(result.npwp).toBe("[REDACTED_NPWP]");
  });

  it("preserves non-sensitive keys such as token counts and operational identifiers", () => {
    const result = asRecord(
      redactValue({
        jobKey: "load-123",
        fileKey: "pod-upload-key",
        idempotencyKey: "idem-456",
        inputTokens: 1500,
        outputTokens: 320,
        totalTokens: 1820,
        tokenCount: 1820,
      }),
    );

    expect(result.jobKey).toBe("load-123");
    expect(result.fileKey).toBe("pod-upload-key");
    expect(result.idempotencyKey).toBe("idem-456");
    expect(result.inputTokens).toBe(1500);
    expect(result.outputTokens).toBe(320);
    expect(result.totalTokens).toBe(1820);
    expect(result.tokenCount).toBe(1820);
  });

  it("redacts sensitive keyed payloads while retaining safe correlation IDs", () => {
    const result = asRecord(
      redactValue({
        requestId: "req-1",
        organizationId: "org-a",
        phone: "+6281234567890",
        imageUrl: "https://storage.example.com/signed?token=secret",
        authorization: "Bearer secret-token",
        body: { driverName: "Pak Herman" },
        rawModelOutput: { phone: "081234567890" },
        nested: [{ message: "Call 081234567890" }],
      }),
    );

    expect(result.requestId).toBe("req-1");
    expect(result.organizationId).toBe("org-a");
    expect(result.phone).toBe("[REDACTED_PHONE]");
    expect(result.imageUrl).toBe("[REDACTED_URL]");
    expect(result.authorization).toBe("[REDACTED]");
    expect(result.body).toBe("[REDACTED]");
    expect(result.rawModelOutput).toBe("[REDACTED]");
    expect(result.nested).toEqual([{ message: "Call [REDACTED_PHONE]" }]);
  });

  it("redacts request data before it can reach an external event sink", () => {
    const result = asRecord(
      redactValue({
        request: { data: { phone: "081234567890", document: "raw body" } },
      }),
    );

    expect(asRecord(result.request).data).toBe("[REDACTED]");
  });

  it("scrubs error causes, arrays, and cycles without throwing", () => {
    const cause = new Error(
      "cause for +6281234567890 at https://storage.example.com/pod.png",
    );
    const error = new Error("top-level failure", { cause });
    const cyclic: Record<string, unknown> = { error, values: [error] };
    cyclic.self = cyclic;

    const result = asRecord(redactValue(cyclic));
    const redactedError = asRecord(result.error);
    const redactedCause = asRecord(redactedError.cause);

    expect(redactedError.message).toBe("top-level failure");
    expect(redactedCause.message).toContain("[REDACTED_PHONE]");
    expect(redactedCause.message).toContain("[REDACTED_URL]");
    expect(result.values).toEqual([redactedError]);
    expect(result.self).toBe("[CIRCULAR]");
  });
});
