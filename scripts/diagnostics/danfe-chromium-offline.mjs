/**
 * Probe offline do Chromium na MESMA imagem publicada do worker ELUS.
 *
 * Exclusivamente fixtures HTTP em 127.0.0.1. O workflow executa --network none.
 * Sem leitura de .env, APIs ERP, credenciais, screenshot ou HTML fiscal.
 * A execução NÃO altera o renderizador de produção nem substitui canário real.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const CHROMIUM = "/usr/local/bin/elus-chromium";
const MAX_CASE_MS = 23_000;

const scenarios = [
  { name: "loopback_redirect_static", delayed: false, virtualTime: true, mustWork: true },
  { name: "loopback_redirect_spa_slow_asset", delayed: true, virtualTime: true, mustWork: false },
  { name: "loopback_redirect_spa_slow_asset_no_virtual_time", delayed: true, virtualTime: false, mustWork: false },
];

function spawnArgs(url, pdf, virtualTime) {
  return [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    "--run-all-compositor-stages-before-draw",
    ...(virtualTime ? ["--virtual-time-budget=12000"] : []),
    "--no-pdf-header-footer",
    "--print-to-pdf=" + pdf,
    url,
  ];
}

async function runScenario(test) {
  const nonce = randomUUID();
  const counts = { redirect: 0, html: 0, asset: 0 };
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    if (req.url === "/start/" + nonce) {
      counts.redirect++;
      const address = server.address();
      res.writeHead(302, {
        Location: "http://127.0.0.1:" + address.port + "/document/" + nonce,
        "Referrer-Policy": "no-referrer",
      }).end();
      return;
    }
    if (req.url === "/document/" + nonce) {
      counts.html++;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(test.delayed
        ? '<!doctype html><title>Offline SPA</title><main id="root"></main><script>document.getElementById("root").textContent="DANFE FIXTURE SIMULADA";</script><img src="/asset/' + nonce + '">'
        : '<!doctype html><title>Offline PDF</title><main>DANFE FIXTURE SIMULADA</main>');
      return;
    }
    if (req.url === "/asset/" + nonce && test.delayed) {
      counts.asset++;
      res.writeHead(200, { "Content-Type": "image/png" });
      // Um recurso sem resposta simula a condição lenta sem rede externa.
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const url = "http://127.0.0.1:" + address.port + "/start/" + nonce;
  const dir = await mkdtemp(join(tmpdir(), "elus-chromium-offline-"));
  const pdf = join(dir, "document.pdf");
  const start = performance.now();
  let timedOut = false;
  let exitCode = null;
  let errorCode = null;
  let signal = null;
  try {
    const childResult = await new Promise((resolve) => {
      let done = false;
      const complete = (result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(result);
      };
      const child = spawn(CHROMIUM, spawnArgs(url, pdf, test.virtualTime), {
        stdio: "ignore",
        env: {
          NODE_ENV: "production",
          PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
          HOME: "/tmp",
        },
      });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, MAX_CASE_MS);
      child.on("error", (err) => complete({ error: err.code ?? "spawn_error" }));
      child.on("close", (code, sig) => complete({ code, signal: sig }));
    });
    exitCode = childResult.code ?? null;
    signal = childResult.signal ?? null;
    errorCode = childResult.error ?? null;
    let pdfBytes = 0;
    let pdfMarkers = false;
    try {
      const bytes = await readFile(pdf);
      pdfBytes = bytes.length;
      pdfMarkers = bytes.subarray(0, Math.min(1024, bytes.length)).includes(Buffer.from("%PDF-")) &&
        bytes.subarray(-2048).includes(Buffer.from("%%EOF"));
    } catch (err) {
      if (err.code !== "ENOENT") errorCode = "pdf_read_error";
    }
    const result = {
      scenario: test.name,
      elapsed_ms: Math.round(performance.now() - start),
      redirect_seen: counts.redirect > 0,
      html_seen: counts.html > 0,
      slow_asset_seen: counts.asset > 0,
      chromium_exited_ok: exitCode === 0,
      chromium_signal: signal === "SIGKILL" ? "SIGKILL" : signal ? "other" : null,
      timed_out: timedOut,
      pdf_exists: pdfBytes > 0,
      pdf_markers_present: pdfMarkers,
      pdf_size_bucket: pdfBytes === 0 ? "absent" : pdfBytes < 1024 ? "tiny" : "nonempty",
      error_code: errorCode,
    };
    console.log("PROBE_RESULT " + JSON.stringify(result));
    return { ...result, valid: exitCode === 0 && pdfMarkers };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}

let failed = false;
for (const scenario of scenarios) {
  try {
    const result = await runScenario(scenario);
    if (scenario.mustWork && !result.valid) failed = true;
  } catch (error) {
    console.log("PROBE_RESULT " + JSON.stringify({
      scenario: scenario.name,
      status: "error",
      code: error?.code ?? "probe_error",
    }));
    if (scenario.mustWork) failed = true;
  }
}
console.log("PROBE_SUMMARY " + JSON.stringify({
  environment: "elus-worker-published-image",
  external_network: "disabled_by_ci",
  canary: false,
  fixture_only: true,
  baseline_required_passed: !failed,
}));
if (failed) process.exitCode = 1;
