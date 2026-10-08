import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  argumentosChromiumParaPdf,
  renderizarUrlParaPdf,
} from "@/lib/documentos/renderizar-url-pdf";

/**
 * Teste real de Chromium, somente no CI opt-in. A fixture é uma SPA inteiramente
 * local: não contém nota, token, chamada VendaERP, Storage ou sender WhatsApp.
 * A comparação file:// vs. loopback 302 serve para localizar regressões, NÃO
 * para reintroduzir o bootstrap file:// em produção.
 */
describe.runIf(process.env.ELUS_DANFE_CHROMIUM_OFFLINE === "1")(
  "DANFE renderer — Chromium real e SPA local sem ERP",
  () => {
    let servidor: Server;
    let urlFixture: string;
    const hits = { html: 0, script: 0, executed: 0 };

    beforeAll(async () => {
      servidor = createServer((req, res) => {
        if (req.method !== "GET") {
          res.writeHead(405).end();
          return;
        }
        if (req.url === "/v3/public/NFe/Danfe") {
          hits.html += 1;
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          });
          res.end(
            '<!doctype html><html><head><title>Fixture local</title></head>' +
              '<body><div id="danfe">Carregando</div><script src="/app.js"></script></body></html>',
          );
          return;
        }
        if (req.url === "/js-executed") {
          hits.executed += 1;
          res.writeHead(204, { "Cache-Control": "no-store" }).end();
          return;
        }
        if (req.url === "/app.js") {
          hits.script += 1;
          res.writeHead(200, {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-store",
          });
          res.end(
            'document.getElementById("danfe").textContent="DANFE sintetica pronta";' +
              'const sinal = new Image(); sinal.src="/js-executed"; document.body.append(sinal);',
          );
          return;
        }
        res.writeHead(404).end();
      });

      await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
      const address = servidor.address();
      if (!address || typeof address === "string") {
        throw new Error("servidor_offline_indisponivel");
      }
      urlFixture = `http://127.0.0.1:${address.port}/v3/public/NFe/Danfe`;
    });

    beforeEach(() => {
      hits.html = 0;
      hits.script = 0;
      hits.executed = 0;
    });

    afterAll(async () => {
      if (servidor?.listening) {
        servidor.closeAllConnections();
        await new Promise<void>((resolve) => servidor.close(() => resolve()));
      }
    });

    it("controle legado: imprime SPA local após file:// + location.replace", async () => {
      const chromium = process.env.CHROMIUM_PATH;
      expect(chromium).toBeTruthy();
      const pasta = await mkdtemp(join(tmpdir(), "elus-danfe-offline-"));
      try {
        const entrada = join(pasta, "entrada.html");
        const saida = join(pasta, "documento.pdf");
        await writeFile(
          entrada,
          '<!doctype html><meta charset="utf-8"><script>location.replace(' +
            JSON.stringify(urlFixture) +
            ")</script>",
          { mode: 0o600 },
        );

        await new Promise<void>((resolve, reject) => {
          const filho = spawn(chromium!, argumentosChromiumParaPdf(entrada, saida), {
            stdio: "ignore",
            env: {
              NODE_ENV: "production",
              PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
              HOME: "/tmp",
            },
          });
          const timer = setTimeout(() => {
            filho.kill("SIGKILL");
            reject(new Error("chromium_legado_timeout_offline"));
          }, 20_000);
          filho.once("error", () => {
            clearTimeout(timer);
            reject(new Error("chromium_legado_falhou_offline"));
          });
          filho.once("exit", (code) => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error("chromium_legado_falhou_offline"));
          });
        });

        const pdf = await readFile(saida);
        expect(pdf.subarray(0, 1024).includes(Buffer.from("%PDF-"))).toBe(true);
        expect(pdf.length).toBeGreaterThan(1_000);
        expect(hits.html).toBeGreaterThan(0);
        expect(hits.script).toBeGreaterThan(0);
      expect(hits.executed).toBeGreaterThan(0);
      } finally {
        await rm(pasta, { recursive: true, force: true });
      }
    }, 35_000);

    it("renderer atual: imprime mesma SPA por redirect HTTP 302 com URL allowlisted", async () => {
      const pdf = await renderizarUrlParaPdf(urlFixture, {
        nome: "fixture-local-sem-provider",
        permiteUrl: (url) => url === urlFixture,
        timeoutMs: 20_000,
        maxBytes: 5_000_000,
      });

      expect(pdf.subarray(0, 1024).includes(Buffer.from("%PDF-"))).toBe(true);
      expect(pdf.length).toBeGreaterThan(1_000);
      expect(hits.html).toBeGreaterThan(0);
      expect(hits.script).toBeGreaterThan(0);
        expect(hits.executed).toBeGreaterThan(0);
    }, 35_000);
  },
);
