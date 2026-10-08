/**
 * Prova offline: CDP controlado pelo Playwright sobre o Chromium instalado
 * na imagem Alpine do worker ELUS, sem modificar o runtime em produção.
 *
 * Sem dados fiscais, credenciais, URL externa, screenshot ou captura HTML.
 * O workflow executa este teste em contêiner sem acesso à rede externa.
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const require = createRequire("/app/package.json");
const { chromium } = require("@playwright/test");
const BIN = "/usr/local/bin/elus-chromium";
const sleepMs = 15_000;
const counts = { redirect: 0, html: 0, asset: 0 };
const nonce = randomUUID();
let browser = null;
let server = null;
let stage = "init";
let abortStage = null;
let timedOut = false;
let result = null;
const startedAt = performance.now();

// Não registrar a mensagem crua do launcher: Chromium pode incluir argv/URLs
// (no cenário real a URL fiscal pode carregar parâmetros sensíveis).
function classificarFalhaSegura(error) {
  const msg = error instanceof Error ? error.message : "";
  if (error?.name === "TimeoutError") return "stage_timeout";
  if (/EACCES|EROFS|read.only file system|permission denied|user.data.dir/i.test(msg)) {
    return "filesystem_not_writable";
  }
  if (/ENOENT|executable doesn't exist|no such file or directory/i.test(msg)) {
    return "executable_not_found";
  }
  if (/EPERM|operation not permitted|sandbox/i.test(msg)) return "sandbox_or_permission";
  if (/missing dependenc|shared librar|error while loading shared/i.test(msg)) {
    return "runtime_dependency";
  }
  if (/target page, context or browser has been closed|browser.*closed|process exited/i.test(msg)) {
    return "browser_exited";
  }
  return "controlled_print_failed";
}

const watchdog = setTimeout(() => {
  timedOut = true;
  console.log("CDP_PROBE_RESULT " + JSON.stringify({
    scenario: "spa_pending_asset_playwright_domcontentloaded",
    stage, timed_out: true, code: "global_watchdog", valid_pdf: false,
  }));
  process.exit(3);
}, sleepMs);
watchdog.unref();

let dir = null;
try {
  server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") return void res.writeHead(405).end();
    if (req.url === "/start/" + nonce) {
      counts.redirect++;
      const port = server.address().port;
      res.writeHead(302, {
        Location: "http://127.0.0.1:" + port + "/document/" + nonce,
        "Referrer-Policy": "no-referrer",
      }).end();
      return;
    }
    if (req.url === "/document/" + nonce) {
      counts.html++;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end('<!doctype html><meta charset="utf-8"><title>Fixture sem dados fiscais</title>' +
        '<main id="root"></main><script>document.getElementById("root").textContent="DOCUMENTO SINTETICO";</script>' +
        '<img src="/slow/' + nonce + '" alt="recurso lento">');
      return;
    }
    if (req.url === "/slow/" + nonce) {
      counts.asset++;
      res.writeHead(200, { "Content-Type": "image/png" });
      // Simula página SPA cujo asset permanece indefinidamente incompleto.
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  dir = await mkdtemp(join(tmpdir(), "elus-cdp-offline-"));
  const pdfPath = join(dir, "fixture.pdf");
  const target = "http://127.0.0.1:" + server.address().port + "/start/" + nonce;

  stage = "launch";
  browser = await chromium.launch({
    headless: true,
    executablePath: BIN,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    // O contêiner CI é read-only, com /tmp tmpfs. O Chromium de CLI do
    // experimento #75 explicitava HOME=/tmp; o Playwright não fazia isso.
    // Preservar as demais variáveis evita alterações de runtime e não há log de env.
    env: {
      ...process.env,
      HOME: "/tmp",
      XDG_CONFIG_HOME: "/tmp",
      XDG_CACHE_HOME: "/tmp",
    },
    timeout: 7000,
  });

  stage = "context";
  const context = await browser.newContext({ serviceWorkers: "block" });
  // Defense-in-depth: a imagem já está --network none; bloquear qualquer
  // tentativa de requisição do HTML fora de 127.0.0.1.
  await context.route("**/*", async (route) => {
    try {
      const dest = new URL(route.request().url());
      if (dest.protocol === "http:" && dest.hostname === "127.0.0.1") {
        return await route.continue();
      }
    } catch {
      // Sem logging de URL/argumentos da requisição.
    }
    return await route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  stage = "navigate_domcontentloaded";
  const response = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 7000 });
  const ready = response?.status() === 200 &&
    (await page.locator("#root").textContent({ timeout: 2000 })) === "DOCUMENTO SINTETICO";
  if (!ready) throw new Error("synthetic_dom_not_ready");

  stage = "print_controlled";
  const pdf = await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    displayHeaderFooter: false,
    timeout: 7000,
  });
  const data = await readFile(pdfPath);
  const signatures = pdf.subarray(0, 1024).includes(Buffer.from("%PDF-")) &&
    pdf.subarray(-2048).includes(Buffer.from("%%EOF")) &&
    data.length === pdf.length;
  stage = "completed";
  result = {
    scenario: "spa_pending_asset_playwright_domcontentloaded",
    elapsed_ms: Math.round(performance.now() - startedAt),
    redirect_seen: counts.redirect > 0,
    html_seen: counts.html > 0,
    slow_asset_seen: counts.asset > 0,
    dom_ready: ready,
    pdf_exists: pdf.length > 0,
    pdf_markers_present: signatures,
    timed_out: timedOut,
    stage, code: null,
  };
} catch (error) {
  abortStage = stage;
  result = {
    scenario: "spa_pending_asset_playwright_domcontentloaded",
    elapsed_ms: Math.round(performance.now() - startedAt),
    redirect_seen: counts.redirect > 0,
    html_seen: counts.html > 0,
    slow_asset_seen: counts.asset > 0,
    dom_ready: ["print_controlled", "completed"].includes(stage),
    pdf_exists: false, pdf_markers_present: false,
    timed_out: timedOut,
    stage: abortStage,
    code: classificarFalhaSegura(error),
  };
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch { /* cleanup best-effort */ }
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  if (dir) await rm(dir, { recursive: true, force: true });
  clearTimeout(watchdog);
}
if (result) {
  console.log("CDP_PROBE_RESULT " + JSON.stringify(result));
  if (!result.pdf_markers_present || !result.slow_asset_seen) process.exitCode = 1;
}
