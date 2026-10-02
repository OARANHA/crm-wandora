import { expect, test } from "./helpers/test";

import { lerCreds, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

test.describe("Integrações ERP: instalar e abrir VendaERP sem chamada externa", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("instala o módulo, abre a tela e bloqueia destino interno antes de salvar", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await loginComoDono(page, lerCreds());

    await page.goto("/admin/modulos");
    const cartao = page.getByTestId("modulo-integracoes_erp");
    await expect(cartao).toBeVisible();

    const instalar = page.getByTestId("instalar-integracoes_erp");
    if (await instalar.isVisible()) await instalar.click();

    await expect(
      cartao.getByText(/instalado/i),
      "o módulo de Integrações ERP não ficou instalado",
    ).toBeVisible({ timeout: 30_000 });

    await page.goto("/app/integracoes-erp");
    await expect(page.getByTestId("integracoes-erp")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Integrações ERP" })).toBeVisible();
    await expect(page.getByText("VendaERP", { exact: true })).toBeVisible();
    await expect(page.getByText("Somente leitura", { exact: true })).toBeVisible();

    // A prova usa endereço literal de loopback para a guarda textual recusar
    // ANTES de DNS/fetch. Assim o E2E não consome chamada nem envia segredo
    // para o VendaERP (ou para qualquer outro host).
    await page.getByLabel("URL base da API").fill("http://127.0.0.1:54321");
    await page.getByLabel("Authorization-Token").fill("e2e-token-nao-real");
    await page.getByLabel("User").fill("e2e-user-nao-real");
    await page.getByLabel("App").fill("e2e-app-nao-real");
    await page.getByRole("button", { name: "Salvar conexão" }).click();

    await expect(page.getByRole("alert")).toContainText(/unsafe_url:private_host/i);
    await expect(
      page.getByText("Conexão salva", { exact: true }),
      "um destino interno recusado não pode aparecer como conexão salva",
    ).toHaveCount(0);
  });
});
