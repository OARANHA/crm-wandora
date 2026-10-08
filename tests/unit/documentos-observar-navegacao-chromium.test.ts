import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { observarNavegacaoChromium } from "@/lib/documentos/observar-navegacao-chromium";

const URL_COM_SEGREDO =
  "https://app.vendaerp.com.br/v3/public/NFe/Danfe?Cod=fiscal-secreto&t=token-que-nao-pode-vazar";

function simularCanal() {
  const escrita = new PassThrough();
  const leitura = new PassThrough();
  const comandos: Array<Record<string, unknown>> = [];
  escrita.on("data", (chunk: Buffer) => {
    for (const parte of chunk.toString().split("\u0000").filter(Boolean)) {
      comandos.push(JSON.parse(parte) as Record<string, unknown>);
    }
  });
  const observador = observarNavegacaoChromium(escrita, leitura, URL_COM_SEGREDO);
  const evento = (method: string, params: Record<string, unknown>) => {
    leitura.write(JSON.stringify({ method, params }) + "\u0000");
  };
  const fechar = () => {
    observador.fechar();
    leitura.destroy();
    escrita.destroy();
  };
  return { observador, comandos, evento, fechar };
}

describe("observador CDP privado do documento", () => {
  it("ativa apenas descoberta de targets, sem URL fiscal no comando ou logs", () => {
    const c = simularCanal();
    try {
      expect(c.comandos.map((m) => m.method)).toEqual([
        "Target.setDiscoverTargets",
        "Target.getTargets",
      ]);
      expect(JSON.stringify(c.comandos)).not.toContain("fiscal-secreto");
      expect(JSON.stringify(c.comandos)).not.toContain("token-que-nao-pode-vazar");
      expect(c.observador.diagnostico()).toBeUndefined();
    } finally {
      c.fechar();
    }
  });

  it("classifica resposta HTTP do documento sem reter URL, query ou corpo", () => {
    const c = simularCanal();
    try {
      c.evento("Target.targetCreated", {
        targetInfo: { type: "page", targetId: "pagina-1", url: URL_COM_SEGREDO },
      });
      expect(c.comandos.at(-1)?.method).toBe("Target.attachToTarget");
      c.evento("Target.attachedToTarget", {
        sessionId: "sessao-1",
        targetInfo: { type: "page", url: URL_COM_SEGREDO },
      });
      expect(c.comandos.map((m) => m.method)).toContain("Network.enable");
      expect(c.comandos.map((m) => m.method)).toContain("Page.enable");

      c.evento("Network.requestWillBeSent", {
        type: "Document",
        requestId: "request-1",
        request: { url: URL_COM_SEGREDO },
      });
      expect(c.observador.diagnostico()).toBe("requisicao_externa");
      c.evento("Network.responseReceived", {
        type: "Document",
        requestId: "request-1",
        response: { url: URL_COM_SEGREDO, status: 403, headers: { authorization: "secreto" } },
      });
      expect(c.observador.diagnostico()).toBe("resposta_http_4xx");
      expect(JSON.stringify(c.observador.diagnostico())).not.toContain("secreto");
      expect(JSON.stringify(c.comandos)).not.toContain("fiscal-secreto");
      expect(JSON.stringify(c.comandos)).not.toContain("token-que-nao-pode-vazar");
    } finally {
      c.fechar();
    }
  });

  it("não atribui resposta de outra rota/origem ao documento fiscal", () => {
    const c = simularCanal();
    try {
      c.evento("Network.responseReceived", {
        type: "Document",
        response: { url: "https://app.vendaerp.com.br/v3/outro?token=segredo", status: 503 },
      });
      expect(c.observador.diagnostico()).toBeUndefined();
      c.evento("Network.responseReceived", {
        type: "Document",
        response: { url: "https://malicioso.example/v3/public/NFe/Danfe", status: 500 },
      });
      expect(c.observador.diagnostico()).toBeUndefined();
    } finally {
      c.fechar();
    }
  });

  it("classifica falha de transporte sem copiar mensagem de erro do Chromium", () => {
    const c = simularCanal();
    try {
      c.evento("Network.requestWillBeSent", {
        type: "Document",
        requestId: "req-interna",
        request: { url: URL_COM_SEGREDO },
      });
      c.evento("Network.loadingFailed", {
        type: "Document",
        requestId: "req-interna",
        errorText: "net::ERR_FAKE segredo fiscal",
      });
      expect(c.observador.diagnostico()).toBe("falha_transporte");
      expect(String(c.observador.diagnostico())).not.toContain("segredo");
    } finally {
      c.fechar();
    }
  });

  it("falha fechado para payload CDP grande ou corrompido", () => {
    const c = simularCanal();
    try {
      expect(() => c.evento("evento", { outro: "x".repeat(300_000) })).not.toThrow();
      expect(c.observador.diagnostico()).toBeUndefined();
      expect(() =>
        c.evento("Network.responseReceived", {
          type: "Document",
          response: { url: URL_COM_SEGREDO, status: 200 },
        }),
      ).not.toThrow();
      expect(c.observador.diagnostico()).toBeUndefined();
    } finally {
      c.fechar();
    }
  });
});
