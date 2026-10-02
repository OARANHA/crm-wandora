import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";
import { expect, test, type Page } from "./helpers/test";
import { lerCreds, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

interface CredsFluxo {
  password: string;
  org_id: string;
  users: Record<string, { id: string; email: string; role: string }>;
}

const credenciais = credenciaisSupabaseDeTeste();
const admin = createClient(credenciais.url, credenciais.serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SUFIXO = randomUUID().slice(0, 8);
const NOME_CONTATO_DANFE = `ERP DANFE ${SUFIXO}`;
let conversaDanfeId = "";
let contatoDanfeId = "";
let canalDanfeId = "";

function lerCredsDoFluxo(): CredsFluxo {
  return lerCreds() as unknown as CredsFluxo;
}

async function loginComoAgente(page: Page, creds: CredsFluxo): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(creds.users.agent!.email);
  await page.locator("#password").fill(creds.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app\//, { timeout: 60_000 });
}

test.describe("Integrações ERP: instalar e usar VendaERP sem chamada externa", () => {
  test.beforeAll(async () => {
    const creds = lerCredsDoFluxo();
    await afirmarDonoDoServidor(creds.users.dono!.email);

    const { data: canal, error: erroCanal } = await admin
      .from("channel_sessions")
      .insert({
        organization_id: creds.org_id,
        waha_session_name: `e2e-erp-danfe-${SUFIXO}`,
        display_name: `Canal ERP DANFE ${SUFIXO}`,
        status: "WORKING",
        webhook_secret_encrypted: "e2e",
      })
      .select("id")
      .single();
    if (erroCanal) throw new Error(`channel_sessions: ${erroCanal.message}`);
    canalDanfeId = (canal as { id: string }).id;

    const { data: contato, error: erroContato } = await admin
      .from("contacts")
      .insert({
        organization_id: creds.org_id,
        display_name: NOME_CONTATO_DANFE,
        phone_number: `+55119${String(Date.now()).slice(-8)}`,
      })
      .select("id")
      .single();
    if (erroContato) throw new Error(`contacts: ${erroContato.message}`);
    contatoDanfeId = (contato as { id: string }).id;

    const { data: conversa, error: erroConversa } = await admin
      .from("conversations")
      .insert({
        organization_id: creds.org_id,
        contact_id: contatoDanfeId,
        channel_session_id: canalDanfeId,
        status: "open",
        last_message_preview: "Preciso da nota fiscal do meu pedido",
        last_message_at: new Date().toISOString(),
        last_inbound_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (erroConversa) throw new Error(`conversations: ${erroConversa.message}`);
    conversaDanfeId = (conversa as { id: string }).id;
  });

  test.afterAll(async () => {
    if (conversaDanfeId) await admin.from("conversations").delete().eq("id", conversaDanfeId);
    if (contatoDanfeId) await admin.from("contacts").delete().eq("id", contatoDanfeId);
    if (canalDanfeId) await admin.from("channel_sessions").delete().eq("id", canalDanfeId);
  });

  test("instala o módulo, abre a tela e bloqueia destino interno antes de salvar", async ({
    page,
  }, testInfo) => {
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

    await page.screenshot({
      path: testInfo.outputPath("integracoes-erp-vendaerp.png"),
      fullPage: true,
    });

    // A prova usa endereço literal de loopback para a guarda textual recusar
    // ANTES de DNS/fetch. Assim o E2E não consome chamada nem envia segredo
    // para o VendaERP (ou para qualquer outro host).
    await page.getByLabel("URL base da API").fill("https://127.0.0.1:54321");
    await page.getByLabel("Authorization-Token").fill("e2e-token-nao-real");
    await page.getByLabel("User").fill("e2e-user-nao-real");
    await page.getByLabel("App").fill("e2e-app-nao-real");
    await page.getByRole("button", { name: "Salvar conexão" }).click();

    await expect(page.getByText("unsafe_url:private_host", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Conexão salva", { exact: true }),
      "um destino interno recusado não pode aparecer como conexão salva",
    ).toHaveCount(0);
  });

  test("atendente prepara DANFE na conversa e envia pela rota canônica", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const creds = lerCredsDoFluxo();
    const pedido = 12345;
    const nfe = 98765;
    const storagePath = `${creds.org_id}/${conversaDanfeId}/danfe-e2e.pdf`;
    let envioCapturado: Record<string, unknown> | null = null;
    let preparoCapturado: Record<string, unknown> | null = null;

    // Somente doubles do browser: nenhum request deste caso chega ao VendaERP,
    // ao Storage externo ou a um provider de WhatsApp.
    await page.route("**/api/v1/integracoes-erp/conexoes", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [{ provider: "vendaerp", enabled: true }],
        }),
      });
    });

    await page.route(`**/api/v1/conversations/${conversaDanfeId}/erp**`, async (route) => {
      const req = route.request();

      if (req.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              conversation_id: conversaDanfeId,
              pedidos: [
                {
                  id: "pedido-e2e",
                  codigo: pedido,
                  cliente: NOME_CONTATO_DANFE,
                  status: "Faturado",
                  statusSistema: "Finalizado",
                  total: 199.9,
                  data: "02/10/2026",
                  finalizado: true,
                  numeroNFe: String(nfe),
                  dataFaturamento: "02/10/2026",
                  chaveAcessoNFe: "e2e-chave-nao-real",
                  danfeDisponivel: true,
                },
              ],
            },
          }),
        });
        return;
      }

      if (req.method() === "POST") {
        preparoCapturado = req.postDataJSON() as Record<string, unknown>;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              nota: {
                numero: nfe,
                codigoStatus: 100,
                mensagemStatus: "Autorizado o uso da NF-e",
                chave: "e2e-chave-nao-real",
                lote: 1,
                danfeDisponivel: true,
              },
              documento: {
                storage_path: storagePath,
                media_mime: "application/pdf",
                media_size_bytes: 4096,
                filename: "danfe-e2e.pdf",
                preview_url: "/e2e/danfe-preview.pdf",
                preview_expires_seconds: 600,
              },
            },
          }),
        });
        return;
      }

      await route.abort();
    });

    await page.route("**/api/v1/messages**", async (route) => {
      const req = route.request();
      if (req.method() !== "POST") {
        await route.continue();
        return;
      }

      envioCapturado = req.postDataJSON() as Record<string, unknown>;
      const agora = new Date().toISOString();

      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            id: randomUUID(),
            organization_id: creds.org_id,
            conversation_id: conversaDanfeId,
            channel_session_id: canalDanfeId,
            contact_id: contatoDanfeId,
            external_id: "e2e-danfe-nao-real",
            type: "document",
            direction: "outbound",
            status: "sent",
            ack: 1,
            error_code: null,
            error_message: null,
            body: `DANFE da nota fiscal nº ${nfe}`,
            media_url: null,
            media_mime: "application/pdf",
            media_size_bytes: 4096,
            media_storage_path: storagePath,
            sent_via: "user",
            sent_by_user_id: creds.users.agent!.id,
            sent_at: agora,
            delivered_at: null,
            read_at: null,
            metadata: {
              source: "integracoes_erp",
              provider: "vendaerp",
              document: "danfe",
              invoice_number: nfe,
            },
            edited_at: null,
            revoked_at: null,
            reply_to_message_id: null,
            created_at: agora,
          },
        }),
      });
    });

    await loginComoAgente(page, creds);
    await page.goto(`/app/inbox/${conversaDanfeId}`);

    const painel = page.getByTestId("inbox-erp-danfe");
    await expect(painel).toBeVisible({ timeout: 30_000 });

    await painel.getByLabel("Pedido").fill(String(pedido));
    await painel.getByRole("button", { name: "Buscar pedido" }).click();

    await expect(painel.getByText(`Pedido #${pedido}`, { exact: true })).toBeVisible();
    await expect(painel.getByText(`NFe/NFCe #${nfe}`, { exact: true })).toBeVisible();

    await painel.getByRole("button", { name: "Preparar DANFE" }).click();

    await expect(painel.getByText(`Nota fiscal #${nfe}`, { exact: true })).toBeVisible();
    await expect(painel.getByRole("link", { name: "Visualizar DANFE" })).toBeVisible();
    await expect(painel.getByRole("button", { name: "Enviar DANFE no WhatsApp" })).toBeVisible();

    expect(preparoCapturado).toEqual({ codigo_nfe: nfe });

    await page.screenshot({
      path: testInfo.outputPath("erp-danfe-atendimento-preparado.png"),
      fullPage: true,
    });

    await painel.getByRole("button", { name: "Enviar DANFE no WhatsApp" }).click();

    await expect(page.getByText("DANFE enviado pelo atendimento.", { exact: true })).toBeVisible();
    expect(envioCapturado).toMatchObject({
      conversation_id: conversaDanfeId,
      type: "document",
      body: `DANFE da nota fiscal nº ${nfe}`,
      media_storage_path: storagePath,
      media_mime: "application/pdf",
      media_size_bytes: 4096,
      metadata: {
        source: "integracoes_erp",
        provider: "vendaerp",
        document: "danfe",
        invoice_number: nfe,
      },
    });

    await expect(
      page.getByText(`DANFE da nota fiscal nº ${nfe}`, { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
  });
});
