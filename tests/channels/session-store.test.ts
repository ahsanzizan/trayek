import { describe, expect, it } from "vitest";

import {
  createBaileysSession,
  type AuthStateBundle,
  type BaileysSessionRepository,
} from "~/server/channels/whatsapp/session-store";

function createRepository(
  initial: AuthStateBundle | null = null,
): BaileysSessionRepository & { saved: AuthStateBundle | null } {
  let bundle = initial;

  return {
    saved: bundle,
    async loadAuthState() {
      return bundle;
    },
    async saveAuthState(_organizationId, nextBundle) {
      bundle = nextBundle;
      this.saved = nextBundle;
    },
  };
}

describe("Baileys session store", () => {
  it("restores persisted credentials and mirrors credential changes", async () => {
    const repository = createRepository({
      files: {
        "creds.json": {
          registered: true,
          accountSyncCounter: 7,
        },
      },
    });
    const session = await createBaileysSession({
      organizationId: "org-a",
      repository,
    });

    expect(session.state.creds.registered).toBe(true);
    expect(session.state.creds.accountSyncCounter).toBe(7);

    await session.saveCreds();

    expect(repository.saved?.files["creds.json"]).toMatchObject({
      registered: true,
    });

    await session.dispose();
  });

  it("mirrors signal key writes without sharing another organization's state", async () => {
    const repositoryA = createRepository();
    const repositoryB = createRepository();
    const [sessionA, sessionB] = await Promise.all([
      createBaileysSession({
        organizationId: "org-a",
        repository: repositoryA,
      }),
      createBaileysSession({
        organizationId: "org-b",
        repository: repositoryB,
      }),
    ]);

    await sessionA.state.keys.set({
      "identity-key": {
        "key-a": new Uint8Array([1, 2, 3]),
      },
    });

    expect(repositoryA.saved?.files["identity-key-key-a.json"]).toEqual({
      type: "Buffer",
      data: "AQID",
    });
    expect(repositoryB.saved).toBeNull();

    await Promise.all([sessionA.dispose(), sessionB.dispose()]);
  });
});
