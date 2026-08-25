import { expect, test, type Page } from "@playwright/test";

import { SEED_POD_LINK_TOKENS } from "../../prisma/seed";

/**
 * TRK-030 acceptance criterion: an upload completes in under 30 seconds on a
 * throttled 3G profile.
 *
 * The upload transport is stubbed rather than driven against real storage.
 * That is deliberate: the criterion is about what Pak Herman waits for on a
 * bad connection, which is our page weight, our render, and our request
 * count. Pointing it at a live vendor would measure their week instead of our
 * regression, and would make the suite need credentials to run at all.
 *
 * Requires a seeded database — `pnpm db:seed` — because the link it opens is
 * the seeded fixture for organization A.
 */

/** Regular 3G, the profile Chrome DevTools ships: ~400 kbps up, 400 ms RTT. */
const THREE_G = {
  offline: false,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
  latency: 400,
};

const UPLOAD_BUDGET_MS = 30_000;

async function throttleTo3G(page: Page) {
  const session = await page.context().newCDPSession(page);

  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", THREE_G);

  return session;
}

/**
 * Stands in for UploadThing's two-step upload: the route hands back a
 * destination, the browser PUTs the bytes to it.
 */
async function stubUploadTransport(page: Page) {
  await page.route("**/api/uploadthing**", async (route) => {
    const body = [
      {
        url: "https://storage.test.invalid/put/pod-1",
        key: "pod-1",
        name: "pod.jpg",
        customId: null,
      },
    ];

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  await page.route("https://storage.test.invalid/**", async (route) => {
    await route.fulfill({ status: 200, body: "{}" });
  });
}

async function attachPhoto(page: Page, name: string) {
  // A small valid JPEG. The bytes matter only in that the browser accepts
  // them as an image; the timing this test measures is ours, not the codec's.
  await page.setInputFiles('input[accept="image/*"]:not([capture])', {
    name,
    mimeType: "image/jpeg",
    buffer: Buffer.from(
      "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
      "base64",
    ),
  });
}

test.describe("driver POD upload on 3G", () => {
  test("shows the order, accepts a photo, and confirms inside the budget", async ({
    page,
  }) => {
    await stubUploadTransport(page);
    await throttleTo3G(page);

    const started = Date.now();

    await page.goto(`/pod/${SEED_POD_LINK_TOKENS.forwarderA}`);

    // The driver confirms he is on the right link before he photographs
    // anything — the whole reason the order number is on this screen.
    await expect(page.getByText("ORD-2026-0001")).toBeVisible();
    await expect(page.getByText("SJ-2026-0001")).toBeVisible();

    await attachPhoto(page, "pod.jpg");

    await expect(page.getByAltText("Foto POD halaman 1")).toBeVisible();

    await page.getByRole("button", { name: /^Kirim 1 foto$/ }).click();

    await expect(page.getByText("POD sudah terkirim")).toBeVisible({
      timeout: UPLOAD_BUDGET_MS,
    });

    const elapsed = Date.now() - started;

    expect(
      elapsed,
      `Upload took ${(elapsed / 1000).toFixed(1)}s on 3G, over the 30s budget.`,
    ).toBeLessThan(UPLOAD_BUDGET_MS);
  });

  test("accepts several photographs for a multi-page POD", async ({ page }) => {
    await stubUploadTransport(page);

    await page.goto(`/pod/${SEED_POD_LINK_TOKENS.forwarderA}`);

    await page.setInputFiles('input[accept="image/*"]:not([capture])', [
      {
        name: "halaman-1.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.from("ffd8ffd9", "hex"),
      },
      {
        name: "halaman-2.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.from("ffd8ffd9", "hex"),
      },
    ]);

    await expect(page.getByAltText("Foto POD halaman 1")).toBeVisible();
    await expect(page.getByAltText("Foto POD halaman 2")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Kirim 2 foto$/ }),
    ).toBeVisible();
  });

  test("tells a driver with a dead link to contact the admin", async ({
    page,
  }) => {
    await page.goto("/pod/ZZZZZZZZZZZZZZZZZZZZ");

    await expect(page.getByText("Tautan tidak dapat dibuka")).toBeVisible();
    await expect(page.getByText(/admin/)).toBeVisible();
  });
});
