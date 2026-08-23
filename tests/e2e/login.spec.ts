import { expect, test, type Page } from "@playwright/test";

async function stubAuthEndpoints(page: Page) {
  await page.route("**/api/auth/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;

    if (pathname.endsWith("/providers")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          resend: {
            id: "resend",
            name: "Resend",
            type: "email",
            signinUrl: "http://127.0.0.1:3000/api/auth/signin/resend",
            callbackUrl: "http://127.0.0.1:3000/api/auth/callback/resend",
          },
        }),
      });
      return;
    }

    if (pathname.endsWith("/csrf")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ csrfToken: "test-token" }),
      });
      return;
    }

    if (pathname.includes("/signin/resend")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ url: "http://127.0.0.1:3000/" }),
      });
      return;
    }

    if (pathname.endsWith("/session")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(null),
      });
      return;
    }

    await route.continue();
  });
}

test.describe("login", () => {
  test("shows the email confirmation after requesting a magic link", async ({
    page,
  }) => {
    await stubAuthEndpoints(page);
    await page.goto("/login");

    await page.getByLabel("Email").fill("owner@example.com");
    await page.getByRole("button", { name: "Kirim tautan masuk" }).click();

    await expect(
      page.getByRole("heading", { name: "Cek email Anda" }),
    ).toBeVisible();
    await expect(
      page.getByText("Kami mengirim tautan masuk ke owner@example.com."),
    ).toBeVisible();
  });

  test("offers a new link when the verification link is invalid", async ({
    page,
  }) => {
    await page.goto("/login?error=Verification");

    await expect(
      page.getByRole("heading", {
        name: "Tautan tidak valid atau sudah kedaluwarsa.",
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Minta tautan baru" }).click();
    await expect(page.getByLabel("Email")).toBeVisible();
  });
});
