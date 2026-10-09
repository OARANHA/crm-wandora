import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { createServer, type Server } from "node:http";

import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { abrirRedirectLocalParaDocumento } from "@/lib/documentos/renderizar-url-pdf";

/**
 * Fixture apenas de loopback; o CI executa este teste na imagem real
 * do worker, sem rede externa. NÃO prova o contrato fiscal nem a policy de
 * egress do renderer em produção.
 */
describe.runIf(process.env.ELUS_DANFE_WORKER_OFFLINE === "1")(
  "Runtime Playwright/Chromium do worker — offline",
  () => {
    let servidor: Server;
    let url: string;
    let hits = 0;

    beforeAll(async () => {
      servidor = createServer((req, res) => {
        if (req.method !== "GET" || req.url !== "/danfe") {
          res.writeHead(404).end();
          return;
        }
        hits += 1;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(
          '<!doctype html><html><body><p id="estado">Carregando</p>' +
            '<script>document.getElementById("estado").textContent=' +
            '"DANFE SINTETICA PRONTA";</script></body></html>',
        );
      });
      await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
      const endereco = servidor.address();
      if (!endereco || typeof endereco === "string") throw new Error("fixture_sem_porta");
      url = `http://127.0.0.1:${endereco.port}/danfe`;
    });

    afterAll(async () => {
      if (servidor?.listening) {
        servidor.closeAllConnections();
        await new Promise<void>((resolve) => servidor.close(() => resolve()));
      }
    });

    it("lança browser, recebe redirect, executa JS e imprime PDF", async () => {
      const binario = process.env.CHROMIUM_PATH?.trim();
      expect(binario).toBeTruthy();
      await access(binario!, constants.X_OK);
      const redirect = await abrirRedirectLocalParaDocumento(url);
      let browser: Browser | undefined;

      try {
        browser = await chromium.launch({
          headless: true,
          executablePath: binario,
          args: [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-background-networking",
            "--no-proxy-server",
          ],
          timeout: 8_000,
          env: {
            HOME: "/tmp",
            XDG_CONFIG_HOME: "/tmp",
            XDG_CACHE_HOME: "/tmp",
            NODE_ENV: "production",
            PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          },
        });
        const context = await browser.newContext({
          serviceWorkers: "block",
          acceptDownloads: false,
          javaScriptEnabled: true,
          bypassCSP: false,
        });
        await context.route("**/*", (route) => {
          const request = route.request();
          if (
            request.method() === "GET" &&
            (request.url() === redirect.url || request.url() === url)
          ) {
            return route.continue();
          }
          return route.abort("blockedbyclient");
        });
        await context.routeWebSocket("**/*", (socket) => socket.close());
        const page = await context.newPage();
        const response = await page.goto(redirect.url, {
          waitUntil: "domcontentloaded",
          timeout: 8_000,
        });
        expect(response?.ok()).toBe(true);
        expect(redirect.houveRedirecionamento()).toBe(true);
        await page.waitForFunction(
          () => document.body.innerText.includes("DANFE SINTETICA PRONTA"),
          null,
          { timeout: 8_000 },
        );
        const pdf = await page.pdf({ format: "A4", printBackground: true });
        expect(pdf.subarray(0, 1024).includes(Buffer.from("%PDF-"))).toBe(true);
        expect(pdf.subarray(-2048).includes(Buffer.from("%%EOF"))).toBe(true);
        expect(pdf.length).toBeGreaterThan(1_000);
        expect(hits).toBe(1);
      } finally {
        await browser?.close();
        await redirect.fechar();
      }
    }, 30_000);
  },
);
