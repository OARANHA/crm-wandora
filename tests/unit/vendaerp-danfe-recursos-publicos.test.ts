import { describe, expect, it } from "vitest";

import {
  HOSTS_RECURSOS_DANFE_VENDAERP,
  recursoPublicoDanfeVendaErpPermitido,
} from "@/lib/integracoes-erp/recursos-publicos-danfe";

const api =
  "https://novaapi.vendaerp.com.br/v3/CriaDANFE/GetDanfeInfoPublic?g=12345678-1234-4123-8123-123456789abc";
const main = "https://d1fkuoqvag3bur.cloudfront.net/v3/main.92dd4700c482a54b467d.js";
const css = "https://d1fkuoqvag3bur.cloudfront.net/v3/styles.6f06af8287b64a3b4b7a.css";
const fiscal =
  "https://d1fkuoqvag3bur.cloudfront.net/v3/fiscal-nfe-nfe-module.ea31513d184754b3eb79.js";
// Chunks compartilhados de code-splitting webpack usados pela SPA fiscal.
// Nomes sem query, hash de conteúdo hexadecimal e host CDN exato.
const webpackCompartilhados = [
  "https://d1fkuoqvag3bur.cloudfront.net/v3/default~fiscal-cte-cte-module~fiscal-nfe-nfe-module~7f2cdd2a.a054f60fc760903fef37.js",
  "https://d1fkuoqvag3bur.cloudfront.net/v3/default~fiscal-nfe-nfe-module~fiscal-nfse-nfse-module.bafb47867cc414dbe8ed.js",
];

describe("DANFE VendaERP: exceção de recursos públicos estritamente limitada", () => {
  it("admite apenas POST/OPTIONS no endpoint fiscal público e bundles observados", () => {
    expect(HOSTS_RECURSOS_DANFE_VENDAERP).toEqual([
      "novaapi.vendaerp.com.br",
      "d1fkuoqvag3bur.cloudfront.net",
    ]);
    expect(recursoPublicoDanfeVendaErpPermitido(api, "POST")).toBe(true);
    expect(recursoPublicoDanfeVendaErpPermitido(api, "OPTIONS")).toBe(true);
    for (const url of [main, css, fiscal, ...webpackCompartilhados]) {
      expect(recursoPublicoDanfeVendaErpPermitido(url, "GET")).toBe(true);
      expect(recursoPublicoDanfeVendaErpPermitido(url, "HEAD")).toBe(true);
      expect(recursoPublicoDanfeVendaErpPermitido(url, "POST")).toBe(false);
    }
  });

  it("vincula o POST de dados públicos ao g exato da DANFE solicitada", () => {
    const esperado = "12345678-1234-4123-8123-123456789abc";
    expect(recursoPublicoDanfeVendaErpPermitido(api, "POST", esperado)).toBe(true);
    expect(
      recursoPublicoDanfeVendaErpPermitido(api, "POST", "87654321-1234-4123-8123-123456789abc"),
    ).toBe(false);
  });

  it.each([
    [api, "GET"],
    [api + "&outro=1", "POST"],
    ["https://novaapi.vendaerp.com.br/v3/CriaDANFE/GetDanfeInfoPublic", "POST"],
    ["https://novaapi.vendaerp.com.br/v3/CriaDANFE/GetDanfeInfoPublic?g=errado", "POST"],
    ["https://novaapi.vendaerp.com.br/v3/Fiscal/EmitirNFE", "POST"],
    ["https://novaapi.vendaerp.com.br:8443/v3/CriaDANFE/GetDanfeInfoPublic", "POST"],
    ["http://novaapi.vendaerp.com.br/v3/CriaDANFE/GetDanfeInfoPublic", "POST"],
    ["https://novaapi.vendaerp.com.br.evil.test/v3/CriaDANFE/GetDanfeInfoPublic", "POST"],
    ["https://d1fkuoqvag3bur.cloudfront.net/v3/main.js", "GET"],
    [main + "?redirect=https://127.0.0.1", "GET"],
    ["https://d1fkuoqvag3bur.cloudfront.net/v3/../admin.js", "GET"],
    ["https://d1fkuoqvag3bur.cloudfront.net/v3/default~fiscal-nfe-module.abc12xyz.js", "GET"],
    [
      "https://d1fkuoqvag3bur.cloudfront.net/v3/default~fiscal-nfe-module.abc123ab.js?next=x",
      "GET",
    ],
    ["https://d1fkuoqvag3bur.cloudfront.net/v3/default~fiscal-nfe-module.abc123ab.js#frag", "GET"],
    ["https://d1fkuoqvag3bur.cloudfront.net/v3/../default~fiscal-nfe-module.abc123ab.js", "GET"],
    ["https://d1fkuoqvag3bur.cloudfront.net/v3/default~fiscal-nfe-module.abc123ab/evil.js", "GET"],
    ["https://d1fkuoqvag3bur.cloudfront.net/v3/evil.abc123ab.html", "GET"],
    ["https://d1fkuoqvag3bur.cloudfront.net/v3/evil.abc123ab.js", "POST"],
    ["https://s3-sa-east-1.amazonaws.com/private", "GET"],
    ["https://cdn.jsdelivr.net/gh/test", "GET"],
    ["http://169.254.169.254/latest/meta-data", "GET"],
    ["file:///etc/passwd", "GET"],
  ])("recusa URL/método não comprovado %s %s", (url, metodo) => {
    expect(recursoPublicoDanfeVendaErpPermitido(url, metodo)).toBe(false);
  });
});
