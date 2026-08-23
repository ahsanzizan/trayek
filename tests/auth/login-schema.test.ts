import { describe, expect, it } from "vitest";

import { loginSchema } from "~/lib/login-schema";

describe("loginSchema", () => {
  it("accepts an email without a password", () => {
    expect(loginSchema.parse({ email: "operator@example.test" })).toEqual({
      email: "operator@example.test",
    });
  });

  it("rejects an invalid email with Indonesian copy", () => {
    const result = loginSchema.safeParse({ email: "not-an-email" });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues[0]?.message).toBe("Alamat email tidak valid");
  });
});
