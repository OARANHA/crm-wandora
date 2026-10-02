import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("ERP -> Inbox -> WhatsApp reutiliza autoridades existentes", () => {
  const raiz = process.cwd();
  const rota = fs.readFileSync(
    path.join(raiz, "app/api/v1/conversations/[id]/erp/route.ts"),
    "utf8",
  );
  const card = fs.readFileSync(path.join(raiz, "components/inbox/ErpDanfeCard.tsx"), "utf8");

  it("a ponte ERP não importa provider de canal nem cria sender próprio", () => {
    expect(rota).not.toMatch(/lib\/waha|WahaClient|sendFile|sendText/);
    expect(card).toContain("useSendMessage");
    expect(card).not.toMatch(/\/sendFile|\/sendText|crm_send_whatsapp_message/);
  });

  it("o preparo é humano agent+ e o envio continua no hook da rota canônica", () => {
    expect(rota).toContain('requireRole("agent"');
    expect(card).toContain("useSendMessage");
    expect(card).not.toContain('fetch("/api/v1/messages');
  });

  it("a URL externa do provider não volta para o browser", () => {
    expect(rota).toContain("danfeDisponivel");
    expect(rota).not.toContain("danfe_url:");
    expect(rota).not.toContain("danfeUrl: nota.danfeUrl");
  });

  it("prova pedido -> contato antes de materializar o DANFE", () => {
    expect(rota).toContain("buscarPedidosErpComIdentidadeInterna");
    expect(rota).toContain("provarPedidoDoContato");
    expect(rota.indexOf("provarPedidoDoContato(", rota.indexOf("export async function POST"))).toBeLessThan(
      rota.indexOf("materializarDanfeExterno(", rota.indexOf("export async function POST")),
    );
  });
});
