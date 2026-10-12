import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequest = vi.hoisted(() => vi.fn());
vi.mock("node:https", () => ({ request: mockRequest }));

import { buscarRecursoBrowserPdfPinado } from "@/lib/documentos/recurso-browser-pdf-pinado";

const url =
  "https://novaapi.vendaerp.com.br/v3/CriaDANFE/GetDanfeInfoPublic?g=12345678-1234-4123-8123-123456789abc";

function respostaFake(statusCode: number, body = "{}") {
  mockRequest.mockImplementationOnce((options, onResponse) => {
    const request = new EventEmitter() as EventEmitter & {
      end: () => void;
      write: (body: Buffer) => void;
      enviados?: Buffer;
    };
    request.write = vi.fn((buffer: Buffer) => {
      request.enviados = buffer;
    });
    request.end = vi.fn(() => {
      const response = new EventEmitter() as EventEmitter & {
        statusCode: number;
        headers: Record<string, string>;
        destroy: () => void;
      };
      response.statusCode = statusCode;
      response.headers = { "content-type": "application/json", location: "http://127.0.0.1/admin" };
      response.destroy = vi.fn();
      onResponse(response);
      if (statusCode === 200) {
        response.emit("data", Buffer.from(body));
        response.emit("end");
      }
    });
    expect(options.hostname).toBe("8.8.8.8");
    expect(options.servername).toBe("novaapi.vendaerp.com.br");
    expect(options.headers.Authorization).toBeUndefined();
    expect(options.headers.Cookie).toBeUndefined();
    expect(options.headers.Referer).toBeUndefined();
    return request;
  });
}

const args = {
  url,
  metodo: "POST",
  ip: "8.8.8.8",
  headers: {
    accept: "application/json",
    "content-type": "application/json",
    authorization: "segredo-nao-propagar",
    cookie: "sessao-nao-propagar",
    referer: "https://app.vendaerp.com.br/?t=segredo-nao-propagar",
    origin: "https://app.vendaerp.com.br",
  },
  body: Buffer.from("{}"),
  prazoMs: 3000,
};

describe("transporte de documento via HTTPS IP pinado", () => {
  beforeEach(() => mockRequest.mockReset());

  it("pin DNS, preserva SNI e só encaminha headers seguros, sem redirecionar", async () => {
    respostaFake(200);
    const res = await buscarRecursoBrowserPdfPinado(args);
    expect(res).toMatchObject({ status: 200, body: Buffer.from("{}") });
    expect(res.headers.location).toBeUndefined();
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it("não segue redirect 302, mesmo quando o destino é privado", async () => {
    respostaFake(302);
    await expect(buscarRecursoBrowserPdfPinado(args)).rejects.toThrow("recurso_pdf_http_recusado");
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it.each(["127.0.0.1", "10.0.0.5", "169.254.169.254", "203.0.113.1"])(
    "rejeita IP especial antes de qualquer requisição: %s",
    async (ip) => {
      await expect(buscarRecursoBrowserPdfPinado({ ...args, ip })).rejects.toThrow(
        "recurso_pdf_recusado",
      );
      expect(mockRequest).not.toHaveBeenCalled();
    },
  );

  it("rejeita POST grande antes de acessar rede", async () => {
    await expect(
      buscarRecursoBrowserPdfPinado({ ...args, body: Buffer.alloc(128 * 1024 + 1) }),
    ).rejects.toThrow("recurso_pdf_recusado");
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("rejeita preflight com headers ou método não autorizados", async () => {
    for (const headers of [
      { "access-control-request-method": "DELETE" },
      {
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization",
      },
    ]) {
      await expect(
        buscarRecursoBrowserPdfPinado({
          ...args,
          metodo: "OPTIONS",
          body: null,
          headers,
        }),
      ).rejects.toThrow("recurso_pdf_preflight_recusado");
    }
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
