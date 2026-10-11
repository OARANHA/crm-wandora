/** Probe offline: CSS print esconde a nota, CSS screen libera texto selecionavel. */
import { createRequire } from "node:module";
const require = createRequire("/app/package.json");
const { chromium } = require("@playwright/test");
const CHAVE_SINTETICA = "35261012345678000190550010649963971123456780";
let browser;
let stage = "start";
let printGenerated = false;
let printMarkers = false;
let screenGenerated = false;
let screenMarkers = false;
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
  const marcadoresPdf = (arquivo) =>
    arquivo.subarray(0, 1024).includes(Buffer.from("%PDF-")) &&
    arquivo.subarray(-2048).includes(Buffer.from("%%EOF"));

  // Confirmar a mudança efetiva de CSS no próprio Chromium, não inferi-la
  // a partir de bytes nem aceitar resultados de uma extração PDF com erro.
  stage = "print_media";
  await page.emulateMedia({ media: "print" });
  const ocultoNoPrint = await page
    .locator("#nota")
    .evaluate((elemento) => getComputedStyle(elemento).display === "none");
  stage = "print_capture";
  const impresso = await page.pdf({
    format: "A4",
    printBackground: true,
    displayHeaderFooter: false,
  });
  printGenerated = true;
  printMarkers = marcadoresPdf(impresso);

  stage = "screen_media";
  await page.emulateMedia({ media: "screen" });
  const visivelNoScreen = await page
    .locator("#nota")
    .evaluate((elemento) => getComputedStyle(elemento).display !== "none");
  const textoVisivel = await page.locator("#nota").innerText();
  const chaveSinteticaNoDom = textoVisivel.includes(CHAVE_SINTETICA);

  stage = "screen_capture";
  const reimpresso = await page.pdf({
    format: "A4",
    printBackground: true,
    displayHeaderFooter: false,
  });
  screenGenerated = true;
  screenMarkers = marcadoresPdf(reimpresso);
  const pdfsDiferentes = !impresso.equals(reimpresso);
  const screenMaior = reimpresso.length > impresso.length;

  // Este probe verifica a transição CSS + dois PDFs estruturais distintos,
  // mas NÃO prova texto selecionável nem identidade fiscal dentro dos PDFs.
  // Essa verificação segue obrigatória no renderer e nos testes de regressão.
  const passou =
    ocultoNoPrint &&
    visivelNoScreen &&
    chaveSinteticaNoDom &&
    printMarkers &&
    screenMarkers &&
    pdfsDiferentes &&
    screenMaior;
  console.log(
    JSON.stringify({
      scenario: "print_hidden_screen_visible",
      network: "none",
      dom_ready: domReady,
      css_print_hidden: ocultoNoPrint,
      css_screen_visible: visivelNoScreen,
      screen_dom_contains_synthetic_key: chaveSinteticaNoDom,
      print_pdf_markers: printMarkers,
      screen_pdf_markers: screenMarkers,
      pdfs_different: pdfsDiferentes,
      screen_pdf_larger: screenMaior,
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
      screen_generated: screenGenerated,
      screen_pdf_markers: screenMarkers,
    }),
  );
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
}
