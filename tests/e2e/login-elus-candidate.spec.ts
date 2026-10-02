import { expect, test } from "./helpers/test";

test.describe("candidato Elus — login premium preservado", () => {
  test("desktop mostra hero, logo e formulário real sem cadastro público", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");

    await expect(page.locator("[data-elus-login]")).toBeVisible();

    const hero = page.locator('img[src="/brand/elus/login-hero.png"]');
    const logo = page.locator('img[src="/brand/elus/logo-horizontal.png"]');

    await expect(hero).toBeVisible();
    await expect(logo).toBeVisible();

    for (const imagem of [hero, logo]) {
      await expect
        .poll(async () =>
          imagem.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0)),
        )
        .toBeGreaterThan(0);
    }

    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Esqueci minha senha" })).toHaveAttribute(
      "href",
      "/login/forgot",
    );

    await expect(page.getByText("Criar conta", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /google/i })).toHaveCount(0);

    const mostrarSenha = page.getByRole("button", { name: "Mostrar senha" });
    await mostrarSenha.click();
    await expect(page.locator("#password")).toHaveAttribute("type", "text");
    await expect(page.getByRole("button", { name: "Ocultar senha" })).toBeVisible();
  });

  test("mobile mantém o formulário acessível e não força o hero lateral", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");

    await expect(page.locator("[data-elus-login]")).toBeVisible();
    await expect(page.locator('img[src="/brand/elus/login-hero.png"]')).toBeHidden();
    await expect(page.locator('img[src="/brand/elus/logo-horizontal.png"]')).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible();
  });
});
