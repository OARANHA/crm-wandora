import { expect, test } from "./helpers/test";

test.describe("candidato Elus — login premium preservado", () => {
  test("desktop preserva o login aprovado", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");

    await expect(page.locator("[data-elus-login]")).toBeVisible();

    const hero = page.locator('img[src="/brand/elus/login-hero.png"]');
    const logo = page.locator('img[src="/brand/elus/logo-horizontal.png"]');

    await expect(hero).toBeVisible();
    await expect(logo).toBeVisible();

    await hero.evaluate((img: HTMLImageElement) => img.decode());
    await logo.evaluate((img: HTMLImageElement) => img.decode());

    const heroWidth = await hero.evaluate((img: HTMLImageElement) => img.naturalWidth);
    const logoWidth = await logo.evaluate((img: HTMLImageElement) => img.naturalWidth);
    expect(heroWidth).toBeGreaterThan(0);
    expect(logoWidth).toBeGreaterThan(0);

    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();

    const entrar = page.getByRole("button", {
      name: "Entrar",
      exact: true,
    });
    await expect(entrar).toBeVisible();

    const esqueciSenha = page.getByRole("link", {
      name: "Esqueci minha senha",
    });
    await expect(esqueciSenha).toHaveAttribute("href", "/login/forgot");

    await expect(page.getByText("Criar conta", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /google/i })).toHaveCount(0);

    const mostrarSenha = page.getByRole("button", {
      name: "Mostrar senha",
    });
    await mostrarSenha.click();
    await expect(page.locator("#password")).toHaveAttribute("type", "text");

    const ocultarSenha = page.getByRole("button", {
      name: "Ocultar senha",
    });
    await expect(ocultarSenha).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath("login-elus-desktop.png"),
      fullPage: true,
    });
  });

  test("mobile preserva formulário sem hero lateral", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");

    await expect(page.locator("[data-elus-login]")).toBeVisible();

    const hero = page.locator('img[src="/brand/elus/login-hero.png"]');
    const logo = page.locator('img[src="/brand/elus/logo-horizontal.png"]');

    await expect(hero).toBeHidden();
    await expect(logo).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();

    const entrar = page.getByRole("button", {
      name: "Entrar",
      exact: true,
    });
    await expect(entrar).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath("login-elus-mobile.png"),
      fullPage: true,
    });
  });
});
