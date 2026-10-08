import { describe, expect, it } from "vitest";

import {
  recursoPermitidoNoBrowserDeDocumento,
  selecionarIpPublicoFixadoParaBrowser,
} from "@/lib/documentos/egress-browser-pdf";

const origem = "https://app.vendaerp.com.br/v3/public/NFe/Danfe?Cod=abc123";
const bootstrap = "http://127.0.0.1:43210/um-nonce-sintetico";

describe("guarda de rede browser PDF", () => {
  it("permite apenas o bootstrap loopback exato e a mesma origem HTTPS", () => {
    expect(recursoPermitidoNoBrowserDeDocumento(bootstrap, origem, bootstrap, "GET")).toBe(true);
    expect(recursoPermitidoNoBrowserDeDocumento(bootstrap, origem, bootstrap, "POST")).toBe(false);
    expect(
      recursoPermitidoNoBrowserDeDocumento(
        "https://app.vendaerp.com.br/scripts/danfe.js",
        origem,
        bootstrap,
        "GET",
      ),
    ).toBe(true);
    expect(
      recursoPermitidoNoBrowserDeDocumento(
        "https://app.vendaerp.com.br/v3/api/documento",
        origem,
        bootstrap,
        "POST",
      ),
    ).toBe(false);
  });

  it.each([
    "http://127.0.0.1:43210/outro-nonce",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.2/admin",
    "http://192.168.0.1/",
    "https://cdn.example.com/scripts.js",
    "https://app.vendaerp.com.br.evil.example/",
    "https://app.vendaerp.com.br:8443/",
    "https://usuario:senha@app.vendaerp.com.br/",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/plain,x",
    "about:blank",
    "nota%inválida",
  ])("recusa host, protocolo ou recurso não autorizado: %s", (url) => {
    expect(recursoPermitidoNoBrowserDeDocumento(url, origem, bootstrap, "GET")).toBe(false);
  });

  it("falha fechado quando não há IP público ou há DNS misto com privado", () => {
    expect(selecionarIpPublicoFixadoParaBrowser([])).toBe(null);
    expect(selecionarIpPublicoFixadoParaBrowser(["8.8.8.8", "127.0.0.1"])).toBe(null);
    expect(selecionarIpPublicoFixadoParaBrowser(["8.8.8.8", "169.254.169.254"])).toBe(null);
    expect(selecionarIpPublicoFixadoParaBrowser(["8.8.8.8", "10.0.0.1"])).toBe(null);
    expect(selecionarIpPublicoFixadoParaBrowser(["8.8.8.8", "::1"])).toBe(null);
    expect(selecionarIpPublicoFixadoParaBrowser(["203.0.113.1"])).toBe(null);
  });

  it("somente seleciona IP público IPv4 explícito após validação integral", () => {
    expect(selecionarIpPublicoFixadoParaBrowser(["8.8.8.8"])).toBe("8.8.8.8");
    expect(selecionarIpPublicoFixadoParaBrowser(["1.1.1.1", "8.8.8.8"])).toBe("1.1.1.1");
  });
});
