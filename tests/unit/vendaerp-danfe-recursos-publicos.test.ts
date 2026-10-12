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

describe("DANFE VendaERP: exceção de recursos públicos estritamente limitada", () => {
  it("admite apenas POST/OPTIONS no endpoint fiscal público e bundles observados", () => {
    expect(HOSTS_RECURSOS_DANFE_VENDAERP).toEqual([
      "novaapi.vendaerp.com.br",
      "d1fkuoqvag3bur.cloudfront.net",
    ]);
    expect(recursoPublicoDanfeVendaErpPermitido(api, "POST")).toBe(true);
    expect(recursoPublicoDanfeVendaErpPermitido(api, "OPTIONS")).toBe(true);
    for (const url of [main, css, fiscal]) {
      expect(recursoPublicoDanfeVendaErpPermitido(url, "GET")).toBe(true);
      expect(recursoPublicoDanfeVendaErpPermitido(url, "HEAD")).toBe(true);
      expect(recursoPublicoDanfeVendaErpPermitido(url, "POST")).toBe(false);
    }
  });

  it("vincula o POST de dados públicos ao g exato da DANFE solicitada", () => {
    const esperado = "12345678-1234-4123-8123-123456789abc";
    expect(recursoPublicoDanfeVendaErpPermitido(api, "POST", esperado)).toBe(true);
    expect(
      recursoPublicoDanfeVendaErpPermitido(
        api,
        "POST",
        "87654321-1234-4123-8123-123456789abc",
      ),
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
