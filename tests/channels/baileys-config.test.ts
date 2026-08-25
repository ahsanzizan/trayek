import { describe, expect, it } from "vitest";

import { resolveBaileysConfig } from "~/server/channels/config";

describe("Baileys channel configuration", () => {
  it("uses a local auth directory and small development socket limit by default", () => {
    expect(
      resolveBaileysConfig({
        nodeEnv: "development",
      }),
    ).toEqual({
      authDir: "./auth_info",
      maxChannelSockets: 10,
    });
  });

  it("uses the production socket limit and preserves explicit values", () => {
    expect(
      resolveBaileysConfig({
        nodeEnv: "production",
        authDir: "/var/lib/trayek/auth_info",
        maxChannelSockets: 42,
        pairingPhone: "+6281234567890",
      }),
    ).toEqual({
      authDir: "/var/lib/trayek/auth_info",
      maxChannelSockets: 42,
      pairingPhone: "+6281234567890",
    });
  });

  it("does not expose pairing phone configuration when it is absent", () => {
    expect(
      resolveBaileysConfig({
        nodeEnv: "production",
      }),
    ).not.toHaveProperty("pairingPhone");
  });
});
