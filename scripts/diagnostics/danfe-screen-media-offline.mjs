/** Probe offline: CSS print esconde a nota, CSS screen libera texto selecionavel. */
import { createRequire } from "node:module";
const require = createRequire("/app/package.json");
const { chromium } = require("@playwright/test");
const pdfjs = await import(require.resolve("pdfjs-dist/legacy/build/pdf.mjs"));
const CHAVE_SINTETICA = "35261012345678000190550010649963971123456780";
let browser;
let stage = "start";
let printGenerated = false;
let printMarkers = false;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/local/bin/elus-chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking"],
    timeout: 12000,
    env: {
      HOME: "/tmp",
      XDG_CONFIG_HOME: "/tmp",
      XDG_CACHE_HOME: "/tmp",
      PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      NODE_ENV: "production",
    },
  });
  const page = await browser.newPage({ serviceWorkers: "block" });
  await page.route("**/*", async (route) => route.abort("blockedbyclient"));
  const html =
    '<!doctype html><meta charset="utf-8"><style>@media print { #nota { display: none !important; } }</style><main id="nota">DANFE CHAVE DE ACESSO ' +
    CHAVE_SINTETICA +
    " " +
    "PRODUTO SINTETICO PARA EXEMPLO. ".repeat(12) +
    "</main>";
  await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 8000 });
  const domReady = (await page.locator("#nota").innerText()).includes(CHAVE_SINTETICA);
  if (!domReady) throw Error("dom_not_ready");
  const texto = async (buffer) => {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
    const chunks = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const content = await (await doc.getPage(p)).getTextContent();
      chunks.push(content.items.map((item) => ("str" in item ? item.str : "")).join(""));
    }
    await doc.destroy();
    return chunks.join("").trim();
  };
  stage = "print_capture";
  const impresso = await page.pdf({
    format: "A4",
    printBackground: true,
    displayHeaderFooter: false,
  });
  printGenerated = true;
  printMarkers =
    impresso.subarray(0, 1024).includes(Buffer.from("%PDF-")) &&
    impresso.subarray(-2048).includes(Buffer.from("%%EOF"));
  stage = "print_extract";
  const textoImpresso = await texto(impresso);
  stage = "screen_media";
  await page.emulateMedia({ media: "screen" });
  stage = "screen_capture";
  const reimpresso = await page.pdf({
    format: "A4",
    printBackground: true,
    displayHeaderFooter: false,
  });
  stage = "screen_extract";
  const textoScreen = await texto(reimpresso);
  const passou =
    textoImpresso.length === 0 &&
    textoScreen.includes("DANFE") &&
    textoScreen.includes(CHAVE_SINTETICA);
  console.log(
    JSON.stringify({
      scenario: "print_hidden_screen_visible",
      network: "none",
      dom_ready: domReady,
      print_no_selectable_text: textoImpresso.length === 0,
      screen_danfe_marker: textoScreen.includes("DANFE"),
      screen_exact_synthetic_key: textoScreen.includes(CHAVE_SINTETICA),
      passed: passou,
    }),
  );
  if (!passou) process.exitCode = 1;
} catch (error) {
  // Categoria finita: nunca exportar stack, stderr, texto extraído ou caminhos.
  const mensagem = error instanceof Error ? error.message : "";
  const failureClass = /DOMMatrix|@napi-rs\/canvas/.test(mensagem)
    ? "pdfjs_native_dependency"
    : /workerSrc|PDFWorker|worker.*failed/i.test(mensagem)
      ? "pdfjs_worker"
      : /Invalid PDF|Missing PDF|format error/i.test(mensagem)
        ? "pdf_invalid"
        : /Target page|browser.*closed|process exited/i.test(mensagem)
          ? "browser_closed"
          : /Timeout|timed out/i.test(mensagem)
            ? "timeout"
            : "unclassified";
  console.log(
    JSON.stringify({
      scenario: "print_hidden_screen_visible",
      passed: false,
      failed_stage: stage,
      failure_class: failureClass,
      print_generated: printGenerated,
      print_pdf_markers: printMarkers,
    }),
  );
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
}
