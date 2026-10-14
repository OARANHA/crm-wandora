// @vitest-environment node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type * as BrowserEgress from "@/lib/documentos/egress-browser-pdf";

const fixture = vi.hoisted(() => ({
  mode: "normal",
  hits: [] as string[],
}));

// Só DNS e transporte remoto são simulados. Chromium, bootstrap loopback,
// interceptação Playwright, DOM, impressão, extração isolada e identidade
// fiscal são reais. Rodar na imagem publicada com --network none.
vi.mock("@/lib/documentos/egress-browser-pdf", async (load) => ({
  ...(await load<typeof BrowserEgress>()),
  resolverIpPublicoFixadoParaBrowser: async () => "8.8.8.8",
}));
vi.mock("@/lib/documentos/recurso-browser-pdf-pinado", () => ({
  buscarRecursoBrowserPdfPinado: async (args: { url: string; metodo: string }) => {
    const url = new URL(args.url);
    if (!["fiscal.invalid", "assets.invalid", "api.invalid"].includes(url.hostname))
      throw new Error("fixture_host_recusado");
    fixture.hits.push(args.metodo + " " + url.pathname);
    const recurso = recursoSintetico(url.pathname, fixture.mode);
    if (!recurso) throw new Error("fixture_recurso_recusado");
    return {
      status: recurso.status ?? 200,
      headers: {
        "content-type": recurso.tipo,
        "access-control-allow-origin": "https://fiscal.invalid",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      },
      body: Buffer.from(recurso.corpo),
    };
  },
}));

import { extractPdfText } from "@/lib/ai/rag/extractors/pdf";
import {
  diagnosticarTextoPdfFiscal,
  renderizarUrlParaPdfControlado,
} from "@/lib/documentos/renderizar-url-pdf-controlado";

const CHAVE = "35261012345678000190550010649963971123456780";
const TEXTO =
  "DANFE SINTETICA CHAVE DE ACESSO " +
  CHAVE +
  " EMITENTE SINTETICO DESTINATARIO SINTETICO PRODUTO FISCAL SINTETICO QUANTIDADE 1 TOTAL R$ 123,45";

function recursoSintetico(
  path: string,
  mode: string,
): { tipo: string; corpo: string; status?: number } | null {
  if (path === "/danfe")
    return {
      tipo: "text/html; charset=utf-8",
      corpo:
        '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/style.css">' +
        '<main id="nota">Carregando</main><script type="module" src="' +
        (mode === "cross-origin" ? "https://assets.invalid/app.js" : "/app.js") +
        '"></script>',
    };
  if (path === "/style.css")
    return {
      tipo: "text/css",
      corpo:
        mode === "print-hidden"
          ? "@media print { #nota { display:none } }"
          : "body {font-family:sans-serif}",
    };
  if (path === "/app.js")
    return {
      tipo: "application/javascript",
      corpo:
        "const res=await fetch(" +
        JSON.stringify(mode === "cross-origin" ? "https://api.invalid/data" : "/data") +
        ",{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});" +
        "const data=await res.json();setTimeout(()=>document.querySelector('#nota').textContent=data.text," +
        (mode === "dom-atrasado" ? "8000" : "150") +
        ");" +
        "fetch('http://169.254.169.254/latest/meta-data/').catch(()=>{});",
    };
  if (path === "/data")
    return {
      tipo: "application/json",
      status: mode === "api-503" ? 503 : 200,
      corpo: JSON.stringify({
        text: mode === "wrong-key" ? TEXTO.replace(CHAVE, "1".repeat(44)) : TEXTO,
      }),
    };
  return null;
}

async function conferirPdf(pdf: Buffer) {
  const texto = await extractPdfText(pdf, {
    estrategia: "processo-a-parte",
    timeoutMs: 8_000,
    heapMb: 96,
  });
  expect(diagnosticarTextoPdfFiscal(texto, CHAVE)).toBeNull();
  expect(texto).toContain("PRODUTO FISCAL SINTETICO");
  expect(texto).toContain("123,45");
  expect(texto).not.toContain("Carregando");
}

// Opt-in: a suíte unitária não lança browsers nem depende de rede externa.
describe.runIf(process.env.ELUS_DANFE_CONTROLLED_SPA_OFFLINE === "1")(
  "DANFE fiscal sintética — renderer real no worker sem egress",
  () => {
    for (const mode of ["normal", "print-hidden", "cross-origin"]) {
      it(
        "renderer controlado imprime SPA " + mode + " com identidade e conteúdo",
        async () => {
          fixture.mode = mode;
          fixture.hits = [];
          const pdf = await renderizarUrlParaPdfControlado("https://fiscal.invalid/danfe", {
            nome: "fixture-fiscal-sem-provider",
            permiteUrl: (url) => url === "https://fiscal.invalid/danfe",
            chaveFiscalEsperada: CHAVE,
            recursosBrowser: {
              hostsAutorizados: ["assets.invalid", "api.invalid"],
              permiteRecurso: (url, metodo) =>
                (url === "https://fiscal.invalid/data" && metodo === "POST") ||
                (url === "https://assets.invalid/app.js" && metodo === "GET") ||
                (url === "https://api.invalid/data" && ["POST", "OPTIONS"].includes(metodo)),
            },
          });
          await conferirPdf(pdf);
          expect(fixture.hits.filter((hit) => !hit.startsWith("OPTIONS ")).sort()).toEqual(
            ["GET /danfe", "GET /style.css", "GET /app.js", "POST /data"].sort(),
          );
          // Em --network none, sucesso comprova que até a navegação principal
          // passou pelo transporte simulado, sem seguir o 302 por socket direto.
          if (process.env.ELUS_DANFE_EVIDENCE_DIR) {
            await writeFile(
              join(process.env.ELUS_DANFE_EVIDENCE_DIR, "current-" + mode + ".pdf"),
              pdf,
            );
          }
        },
        35_000,
      );
    }

    for (const mode of ["normal", "cross-origin"]) {
      it(
        "impressão direta só ocorre depois do POST público e montagem assíncrona: " + mode,
        async () => {
          fixture.mode = mode;
          fixture.hits = [];
          const recursoEsperado =
            mode === "cross-origin" ? "https://api.invalid/data" : "https://fiscal.invalid/data";
          const pdf = await renderizarUrlParaPdfControlado("https://fiscal.invalid/danfe", {
            nome: "fixture-spa-async-print-sem-validacao-fiscal",
            permiteUrl: (url) => url === "https://fiscal.invalid/danfe",
            impressaoDireta: true,
            // A DANFE direta deve provar a chave no PDF realmente impresso.
            chaveFiscalEsperada: CHAVE,
            aguardarRecursoDeMontagem: (url, metodo) =>
              url === recursoEsperado && metodo === "POST",
            recursosBrowser: {
              hostsAutorizados: ["assets.invalid", "api.invalid"],
              permiteRecurso: (url, metodo) =>
                (url === "https://fiscal.invalid/data" && metodo === "POST") ||
                (url === "https://assets.invalid/app.js" && metodo === "GET") ||
                (url === "https://api.invalid/data" && ["POST", "OPTIONS"].includes(metodo)),
            },
          });
          const texto = await extractPdfText(pdf, {
            estrategia: "processo-a-parte",
            timeoutMs: 8_000,
            heapMb: 96,
          });
          // Checagem da fixture SINTÉTICA apenas no teste; zero validação fiscal em produção.
          expect(texto).toContain("PRODUTO FISCAL SINTETICO");
          expect(texto).not.toContain("Carregando");
          expect(fixture.hits.some((x) => x === "POST /data")).toBe(true);
        },
        35_000,
      );
    }

    it("POST público HTTP 503 falha fechado na etapa de resposta, sem PDF", async () => {
      fixture.mode = "api-503";
      fixture.hits = [];
      await expect(
        renderizarUrlParaPdfControlado("https://fiscal.invalid/danfe", {
          nome: "fixture-api-erro-sem-documento",
          permiteUrl: (url) => url === "https://fiscal.invalid/danfe",
          impressaoDireta: true,
          chaveFiscalEsperada: CHAVE,
          aguardarRecursoDeMontagem: (url, metodo) =>
            url === "https://fiscal.invalid/data" && metodo === "POST",
          recursosBrowser: {
            hostsAutorizados: [],
            permiteRecurso: (url, metodo) =>
              url === "https://fiscal.invalid/data" && metodo === "POST",
          },
        }),
      ).rejects.toMatchObject({
        codigo: "render_falhou",
        etapa: "chromium_resposta_montagem",
      });
      expect(fixture.hits).toContain("POST /data");
    }, 35_000);

    it("POST 200 com montagem fiscal atrasada nao libera PDF incompleto", async () => {
      fixture.mode = "dom-atrasado";
      fixture.hits = [];
      await expect(
        renderizarUrlParaPdfControlado("https://fiscal.invalid/danfe", {
          nome: "fixture-dom-atrasado-sem-documento",
          permiteUrl: (url) => url === "https://fiscal.invalid/danfe",
          impressaoDireta: true,
          chaveFiscalEsperada: CHAVE,
          aguardarRecursoDeMontagem: (url, metodo) =>
            url === "https://fiscal.invalid/data" && metodo === "POST",
          recursosBrowser: {
            hostsAutorizados: [],
            permiteRecurso: (url, metodo) =>
              url === "https://fiscal.invalid/data" && metodo === "POST",
          },
        }),
      ).rejects.toMatchObject({
        codigo: "render_falhou",
        etapa: "pdf_validacao",
      });
      expect(fixture.hits).toContain("POST /data");
    }, 35_000);

    it("impressão direta recusa NFe com chave fiscal divergente", async () => {
      fixture.mode = "wrong-key";
      fixture.hits = [];
      await expect(
        renderizarUrlParaPdfControlado("https://fiscal.invalid/danfe", {
          nome: "fixture-danfe-direta-chave-divergente",
          permiteUrl: (url) => url === "https://fiscal.invalid/danfe",
          impressaoDireta: true,
          chaveFiscalEsperada: CHAVE,
          aguardarRecursoDeMontagem: (url, metodo) =>
            url === "https://fiscal.invalid/data" && metodo === "POST",
          recursosBrowser: {
            hostsAutorizados: [],
            permiteRecurso: (url, metodo) =>
              url === "https://fiscal.invalid/data" && metodo === "POST",
          },
        }),
      ).rejects.toMatchObject({
        codigo: "render_falhou",
        etapa: "pdf_validacao",
        evidenciaValidacaoPdf: "chave_divergente",
      });
      expect(fixture.hits).toContain("POST /data");
    }, 35_000);

    it("não entrega PDF com outra identidade fiscal", async () => {
      fixture.mode = "wrong-key";
      fixture.hits = [];
      await expect(
        renderizarUrlParaPdfControlado("https://fiscal.invalid/danfe", {
          nome: "fixture-fiscal-sem-provider",
          permiteUrl: (url) => url === "https://fiscal.invalid/danfe",
          chaveFiscalEsperada: CHAVE,
          recursosBrowser: {
            hostsAutorizados: ["assets.invalid", "api.invalid"],
            permiteRecurso: (url, metodo) =>
              (url === "https://fiscal.invalid/data" && metodo === "POST") ||
              (url === "https://assets.invalid/app.js" && metodo === "GET") ||
              (url === "https://api.invalid/data" && ["POST", "OPTIONS"].includes(metodo)),
          },
        }),
      ).rejects.toMatchObject({
        codigo: "render_falhou",
        etapa: "pdf_validacao",
        evidenciaValidacaoPdf: "chave_divergente",
      });
    }, 35_000);

    it("controle PR #37: mesma SPA em file:// + location.replace imprime conteúdo fiscal", async () => {
      const server = createServer((req, res) => {
        const recurso = recursoSintetico(req.url ?? "", "normal");
        if (!recurso) return void res.writeHead(404).end();
        res.writeHead(200, { "Content-Type": recurso.tipo });
        res.end(recurso.corpo);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const endereco = server.address();
      if (!endereco || typeof endereco === "string") throw new Error("fixture_sem_porta");
      const dir = await mkdtemp(join(tmpdir(), "danfe-pr37-"));
      try {
        const entrada = join(dir, "entrada.html");
        const saida = join(dir, "legacy.pdf");
        await writeFile(
          entrada,
          '<!doctype html><meta charset="utf-8"><script>location.replace(' +
            JSON.stringify(`http://127.0.0.1:${endereco.port}/danfe`) +
            ")</script>",
          { mode: 0o600 },
        );
        // Argumentos exatos da PR #37, SHA 220e827c8cc7e732612179bce26c07739fe80380.
        // Controle histórico somente; nunca restaurar esse renderer em produção.
        await new Promise<void>((resolve, reject) => {
          const child = spawn(
            process.env.CHROMIUM_PATH!,
            [
              "--headless=new",
              "--no-sandbox",
              "--disable-dev-shm-usage",
              "--hide-scrollbars",
              "--run-all-compositor-stages-before-draw",
              "--virtual-time-budget=12000",
              "--no-pdf-header-footer",
              "--print-to-pdf=" + saida,
              "file://" + entrada,
            ],
            {
              stdio: "ignore",
              env: { HOME: "/tmp", NODE_ENV: "production", PATH: process.env.PATH },
            },
          );
          const timer = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error("fixture_legacy_timeout"));
          }, 25_000);
          child.once("error", () => {
            clearTimeout(timer);
            reject(new Error("fixture_legacy_spawn"));
          });
          child.once("exit", (code) => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error("fixture_legacy_exit"));
          });
        });
        const pdf = await readFile(saida);
        await conferirPdf(pdf);
        if (process.env.ELUS_DANFE_EVIDENCE_DIR)
          await writeFile(join(process.env.ELUS_DANFE_EVIDENCE_DIR, "legacy.pdf"), pdf);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(dir, { recursive: true, force: true });
      }
    }, 35_000);
  },
);
