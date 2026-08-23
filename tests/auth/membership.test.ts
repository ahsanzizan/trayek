import { describe, expect, it } from "vitest";

import { chooseActiveOrganization } from "~/server/auth/membership";

const memberships = [
  { id: "membership-viewer", organizationId: "org-viewer", role: "VIEWER" },
  { id: "membership-owner", organizationId: "org-owner", role: "OWNER" },
  { id: "membership-admin", organizationId: "org-admin", role: "ADMIN" },
] as const;

describe("chooseActiveOrganization", () => {
  it("keeps a valid token preference over the highest role", () => {
    expect(chooseActiveOrganization(memberships, "org-viewer")).toBe(
      "org-viewer",
    );
  });

  it("falls back to the highest role when the token preference is stale", () => {
    expect(chooseActiveOrganization(memberships, "org-revoked")).toBe(
      "org-owner",
    );
  });

  it("returns null when the user has no memberships", () => {
    expect(chooseActiveOrganization([], null)).toBeNull();
  });
});
