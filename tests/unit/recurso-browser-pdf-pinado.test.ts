import { EventEmitter } from "node:events";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequest = vi.hoisted(() => vi.fn());
vi.mock("node:https", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:https")>();
  return {
    ...actual,
    request: mockRequest,
    default: { ...(actual as { default?: object }).default, request: mockRequest },
  };
});

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

/** Resposta fake por bytes, sem sockets ou consultas externas. */
function respostaEmBytes(
  bytes: Buffer,
  headers: Record<string, string> = { "content-type": "application/javascript" },
) {
  mockRequest.mockImplementationOnce((_options, onResponse) => {
    const request = new EventEmitter() as EventEmitter & {
      end: () => void;
      write: (body: Buffer) => void;
    };
    request.write = vi.fn();
    request.end = vi.fn(() => {
      const response = new EventEmitter() as EventEmitter & {
        statusCode: number;
        headers: Record<string, string>;
        destroy: (reason?: Error) => void;
      };
      response.statusCode = 200;
      response.headers = headers;
      response.destroy = vi.fn((reason?: Error) => {
        if (reason) response.emit("error", reason);
      });
      onResponse(response);
      response.emit("data", bytes);
      response.emit("end");
    });
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

  it("mantém código finito de timeout no transporte HTTPS pinado", async () => {
    mockRequest.mockImplementationOnce(() => {
      const request = new EventEmitter() as EventEmitter & {
        end: () => void;
        write: (body: Buffer) => void;
        destroy: (reason: Error) => void;
      };
      request.write = vi.fn();
      request.destroy = vi.fn((reason: Error) => request.emit("error", reason));
      request.end = vi.fn(() => request.emit("timeout"));
      return request;
    });
    await expect(buscarRecursoBrowserPdfPinado(args)).rejects.toThrow("recurso_pdf_timeout");
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
    const casos: Record<string, string>[] = [
      { "access-control-request-method": "DELETE" },
      {
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization",
      },
    ];
    for (const headers of casos) {
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
  it("usa User-Agent literal e compressão controlada, ignorando headers fornecidos pela página", async () => {
    respostaFake(200);
    await buscarRecursoBrowserPdfPinado({
      ...args,
      headers: {
        ...args.headers,
        "user-agent": "NÃO ENCAMINHAR",
        "accept-encoding": "identity",
      },
    });
    const options = mockRequest.mock.calls[0]?.[0];
    expect(options.headers["User-Agent"]).toContain("HeadlessChrome/156");
    expect(options.headers["User-Agent"]).not.toContain("NÃO ENCAMINHAR");
    expect(options.headers["Accept-Encoding"]).toBe("gzip, br");
    expect(options.headers.Cookie).toBeUndefined();
    expect(options.headers.Authorization).toBeUndefined();
  });

  it("aceita bundle JS de 11 MiB sem truncar a resposta", async () => {
    const bytes = Buffer.alloc(11 * 1024 * 1024, 97);
    respostaEmBytes(bytes);
    const result = await buscarRecursoBrowserPdfPinado({ ...args, metodo: "GET", body: null });
    expect(result.body.length).toBe(bytes.length);
    expect(result.body.equals(bytes)).toBe(true);
  });

  it("recusa corpo recebido acima de 16 MiB sem entregar bytes ao navegador", async () => {
    respostaEmBytes(Buffer.alloc(16 * 1024 * 1024 + 1, 97));
    await expect(
      buscarRecursoBrowserPdfPinado({ ...args, metodo: "GET", body: null }),
    ).rejects.toThrow();
  });

  it("descomprime gzip e preserva o corpo original para route.fulfill", async () => {
    const body = Buffer.from("SCRIPT FISCAL SINTETICO ".repeat(1000));
    respostaEmBytes(gzipSync(body), {
      "content-type": "application/javascript",
      "content-encoding": "gzip",
    });
    const result = await buscarRecursoBrowserPdfPinado({ ...args, metodo: "GET", body: null });
    expect(result.body).toEqual(body);
  });

  it("descomprime brotli e preserva o corpo original para route.fulfill", async () => {
    const body = Buffer.from("SCRIPT FISCAL SINTETICO ".repeat(1000));
    respostaEmBytes(brotliCompressSync(body), {
      "content-type": "application/javascript",
      "content-encoding": "br",
    });
    const result = await buscarRecursoBrowserPdfPinado({ ...args, metodo: "GET", body: null });
    expect(result.body).toEqual(body);
  });

  it("recusa expansão gzip para mais de 16 MiB mesmo quando o download comprimido é pequeno", async () => {
    respostaEmBytes(gzipSync(Buffer.alloc(16 * 1024 * 1024 + 1, 97)), {
      "content-type": "application/javascript",
      "content-encoding": "gzip",
    });
    await expect(
      buscarRecursoBrowserPdfPinado({ ...args, metodo: "GET", body: null }),
    ).rejects.toThrow("recurso_pdf_validacao_falhou");
  });

  it("aceita prazo de 12 s e recusa prazo acima de 12 s antes da rede", async () => {
    respostaFake(200);
    await expect(
      buscarRecursoBrowserPdfPinado({ ...args, prazoMs: 12_000 }),
    ).resolves.toMatchObject({ status: 200 });
    await expect(buscarRecursoBrowserPdfPinado({ ...args, prazoMs: 12_001 })).rejects.toThrow(
      "recurso_pdf_recusado",
    );
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});
