import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { ErroDanfeExterno } from "@/lib/integracoes-erp/danfe";
import {
  executarCanarioDanfeAdmin,
  type DependenciasCanarioDanfeAdmin,
} from "@/lib/integracoes-erp/canario-danfe-admin";

const conversaId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const org = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const contatoId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const nfe = 123;
const urlComToken = "https://app.vendaerp.com.br/v3/public/NFe/Danfe?Cod=abc&token=segredo";
const credencial = "token-privado-nunca-devolver";

const autoridade = {
  kind: "whatsapp_admin" as const,
  organizationId: org,
  userId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  contactId: contatoId,
  capability: "erp.admin.read" as const,
};

function banco(conversa: Record<string, unknown> | null = {
  id: conversaId,
  organization_id: org,
  contact_id: contatoId,
}): SupabaseClient {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: conversa, error: null })),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return { from: vi.fn(() => query) } as unknown as SupabaseClient;
}

function d(): DependenciasCanarioDanfeAdmin {
  return {
    resolverAutoridade: vi.fn(async () => autoridade) as never,
    carregarConexao: vi.fn(async () => ({
      ok: true,
      conexao: { access_mode: "read" },
      credenciais: {
        baseUrl: "https://api.vendaerp.com.br",
        authorizationToken: credencial,
        user: "sealed-user",
        app: "sealed-app",
      },
    })) as never,
    obterNota: vi.fn(async () => ({
      ok: true,
      dados: { numero: nfe, danfeUrl: urlComToken },
    })) as never,
    renderizar: vi.fn(async () => ({
      buffer: Buffer.from("%PDF-1.4 test"),
      mime: "application/pdf",
      sizeBytes: 13,
      extensao: "pdf",
    })),
    auditar: vi.fn(async () => undefined),
    uuid: () => "run-canario-admin",
  };
}

describe("canário administrativo ISIS sem envio", () => {
  it("falha antes de qualquer consulta se UUID ou NFe não são válidos", async () => {
    const db = banco();
    const deps = d();
    expect(await executarCanarioDanfeAdmin(db, { conversationId: "qualquer", codigoNfe: nfe }, deps))
      .toMatchObject({ ok: false, code: "invalid_scope" });
    expect(await executarCanarioDanfeAdmin(db, { conversationId: conversaId, codigoNfe: 0 }, deps))
      .toMatchObject({ ok: false, code: "invalid_scope" });
    expect(db.from).not.toHaveBeenCalled();
    expect(deps.obterNota).not.toHaveBeenCalled();
  });

  it("falha fechado para conversa inexistente, admin não vinculado e organização divergente", async () => {
    const deps = d();
    expect(await executarCanarioDanfeAdmin(banco(null), {
      conversationId: conversaId, codigoNfe: nfe,
    }, deps)).toMatchObject({ code: "conversation_not_found" });
    expect(deps.resolverAutoridade).not.toHaveBeenCalled();

    vi.mocked(deps.resolverAutoridade).mockResolvedValueOnce(null);
    expect(await executarCanarioDanfeAdmin(banco(), {
      conversationId: conversaId, codigoNfe: nfe,
    }, deps)).toMatchObject({ code: "admin_authority_denied" });

    vi.mocked(deps.resolverAutoridade).mockResolvedValueOnce({
      ...autoridade,
      organizationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    });
    expect(await executarCanarioDanfeAdmin(banco(), {
      conversationId: conversaId, codigoNfe: nfe,
    }, deps)).toMatchObject({ code: "admin_authority_denied" });
    expect(deps.carregarConexao).not.toHaveBeenCalled();
    expect(deps.obterNota).not.toHaveBeenCalled();
    expect(deps.renderizar).not.toHaveBeenCalled();
  });

  it("nunca consulta NFe quando a conexão não é somente leitura", async () => {
    const deps = d();
    vi.mocked(deps.carregarConexao).mockResolvedValueOnce({
      ok: true,
      conexao: { access_mode: "write" },
      credenciais: {},
    } as never);
    expect(await executarCanarioDanfeAdmin(banco(), {
      conversationId: conversaId, codigoNfe: nfe,
    }, deps)).toMatchObject({ ok: false, code: "erp_read_denied" });
    expect(deps.obterNota).not.toHaveBeenCalled();
    expect(deps.renderizar).not.toHaveBeenCalled();
  });

  it("recusa nota divergente antes de qualquer renderização", async () => {
    const deps = d();
    vi.mocked(deps.obterNota).mockResolvedValueOnce({
      ok: true, dados: { numero: 999, danfeUrl: urlComToken },
    } as never);
    expect(await executarCanarioDanfeAdmin(banco(), {
      conversationId: conversaId, codigoNfe: nfe,
    }, deps)).toMatchObject({ ok: false, code: "nfe_number_mismatch" });
    expect(deps.renderizar).not.toHaveBeenCalled();
  });

  it("propaga apenas o código e a etapa segura do Chromium; audita ator e origem corretos", async () => {
    const deps = d();
    vi.mocked(deps.renderizar).mockRejectedValueOnce(
      new ErroDanfeExterno("timeout", undefined, "chromium_apos_redirect"),
    );
    const resultado = await executarCanarioDanfeAdmin(banco(), {
      conversationId: conversaId, codigoNfe: nfe,
    }, deps);

    expect(resultado).toEqual({
      ok: false,
      code: "danfe_failed",
      codigo_tecnico: "timeout",
      etapa_renderizacao: "chromium_apos_redirect",
      whatsapp_sent: false,
      vendaerp_writes: 0,
    });
    expect(deps.auditar).toHaveBeenCalledWith(expect.objectContaining({
      autoridade,
      origem: "canario_admin_readonly",
      toolName: "crm_erp_prepare_admin_danfe",
      requestId: "run-canario-admin",
      success: false,
      motivo: "danfe_download_failed",
      codigoTecnico: "timeout",
      etapaRenderizacao: "chromium_apos_redirect",
    }));
    expect(JSON.stringify(resultado)).not.toContain("segredo");
    expect(JSON.stringify(resultado)).not.toContain(credencial);
    expect(JSON.stringify(resultado)).not.toContain(conversaId);
    expect(JSON.stringify(resultado)).not.toContain(String(nfe));
  });

  it("reutiliza materializador e confirma PDF sem storage ou sender", async () => {
    const deps = d();
    const db = banco();
    const resultado = await executarCanarioDanfeAdmin(db, {
      conversationId: conversaId, codigoNfe: nfe,
    }, deps);

    expect(resultado).toEqual({
      ok: true,
      pdf_valido: true,
      pdf_size_bytes: 13,
      whatsapp_sent: false,
      vendaerp_writes: 0,
    });
    expect(deps.obterNota).toHaveBeenCalledOnce();
    expect(deps.renderizar).toHaveBeenCalledOnce();
    expect(deps.auditar).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, origem: "canario_admin_readonly" }),
    );
    expect(db.storage).toBeUndefined();
  });

  it("falha fechado quando o PDF não possui assinatura e não declara sucesso de auditoria", async () => {
    const deps = d();
    vi.mocked(deps.renderizar).mockResolvedValueOnce({
      buffer: Buffer.from("HTML disfarçado"),
      mime: "application/pdf",
      sizeBytes: 16,
      extensao: "pdf",
    });
    expect(await executarCanarioDanfeAdmin(banco(), {
      conversationId: conversaId, codigoNfe: nfe,
    }, deps)).toMatchObject({ ok: false, code: "danfe_failed", codigo_tecnico: "tipo_nao_documento" });
    expect(deps.auditar).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});
