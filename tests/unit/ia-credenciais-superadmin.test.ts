import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const hooks = vi.hoisted(() => ({
  write: vi.fn(),
  support: vi.fn(),
  validate: vi.fn(),
  save: vi.fn(),
  adminClient: vi.fn(),
}));

vi.mock("@/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdminEscrita: hooks.write,
  falhaDaEscritaDePlatformAdmin: () =>
    Response.json({ error: { code: "forbidden" } }, { status: 403 }),
}));
vi.mock("@/lib/impersonate/support", () => ({
  requireSupportWrite: hooks.support,
}));
vi.mock("@/lib/ai/provider-validators", () => ({
  validateProviderKey: hooks.validate,
}));
vi.mock("@/lib/ai/credenciais/guardar", () => ({
  guardarCredencial: hooks.save,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: hooks.adminClient,
}));

import { POST as save } from "@/app/api/v1/admin/tenants/[id]/ai-credentials/route";
import { POST as testConnection } from "@/app/api/v1/admin/tenants/[id]/ai-credentials/test/route";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CREDENTIAL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const KEY = "SYNTHETIC_TEST_KEY_NEVER_REAL";
const BASE = "https://llm.example.test/v1";
const params = { params: Promise.resolve({ id: ORG }) };

function request(data: unknown): NextRequest {
  return new Request("http://localhost/endpoint", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  }) as NextRequest;
}

function orgFound(found = true) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: found ? { id: ORG } : null,
    error: null,
  });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  hooks.adminClient.mockReturnValue({ from });
  return { from, eq };
}

beforeEach(() => {
  vi.clearAllMocks();
  hooks.support.mockResolvedValue(null);
  hooks.write.mockResolvedValue({ user: { id: ACTOR }, platformAdmin: { scope: "full" } });
  hooks.validate.mockResolvedValue({ ok: true, models: ["model-one", "model-two"] });
  hooks.save.mockResolvedValue({ ok: true, id: CREDENTIAL, last4: "0000" });
  orgFound();
});

describe("Superadmin cria a credencial na organização explicitamente selecionada", () => {
  it("usa a capability AES-GCM existente, valida no servidor e não retorna segredo", async () => {
    const res = await save(
      request({ label: "Gateway administrado", base_url: BASE, api_key: KEY }),
      params,
    );
    expect(res.status).toBe(201);
    expect(hooks.validate).toHaveBeenCalledWith("custom", KEY, BASE);
    expect(hooks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG,
        userId: ACTOR,
        provider: "custom",
        label: "Gateway administrado",
        baseUrl: BASE,
        apiKey: KEY,
        validacaoConfirmada: { models: ["model-one", "model-two"] },
      }),
    );
    const output = await res.text();
    expect(output).toContain(CREDENTIAL);
    expect(output).toContain("validated");
    expect(output).not.toContain(KEY);
  });

  it("falha fechado para suporte em leitura, sem chamada externa ou escrita", async () => {
    hooks.support.mockResolvedValueOnce(Response.json({ error: "forbidden" }, { status: 403 }));
    const res = await save(request({ label: "Gateway", base_url: BASE, api_key: KEY }), params);
    expect(res.status).toBe(403);
    expect(hooks.validate).not.toHaveBeenCalled();
    expect(hooks.save).not.toHaveBeenCalled();
  });

  it("falha fechado sem Superadmin full/MFA", async () => {
    hooks.write.mockRejectedValueOnce(new Error("mfa_required"));
    const res = await save(request({ label: "Gateway", base_url: BASE, api_key: KEY }), params);
    expect(res.status).toBe(403);
    expect(hooks.validate).not.toHaveBeenCalled();
    expect(hooks.save).not.toHaveBeenCalled();
  });

  it("não grava para organização inexistente", async () => {
    orgFound(false);
    const res = await save(request({ label: "Gateway", base_url: BASE, api_key: KEY }), params);
    expect(res.status).toBe(404);
    expect(hooks.validate).not.toHaveBeenCalled();
    expect(hooks.save).not.toHaveBeenCalled();
  });

  it("não aceita URL HTTP, modelos ausentes ou conexão não validada", async () => {
    const http = await save(
      request({ label: "Gateway", base_url: "http://localhost/v1", api_key: KEY }),
      params,
    );
    expect(http.status).toBe(422);
    hooks.validate.mockResolvedValueOnce({ ok: true, models: [] });
    const noModels = await save(
      request({ label: "Gateway", base_url: BASE, api_key: KEY }),
      params,
    );
    expect(noModels.status).toBe(422);
    hooks.validate.mockResolvedValueOnce({ ok: false, error: "unsafe_url" });
    const invalid = await save(request({ label: "Gateway", base_url: BASE, api_key: KEY }), params);
    expect(invalid.status).toBe(422);
    expect(hooks.save).not.toHaveBeenCalled();
  });

  it("limita modelos longos antes de salvar", async () => {
    hooks.validate.mockResolvedValueOnce({ ok: true, models: ["x".repeat(300), "good-model"] });
    const res = await save(request({ label: "Gateway", base_url: BASE, api_key: KEY }), params);
    expect(res.status).toBe(201);
    expect(hooks.save).toHaveBeenCalledWith(
      expect.objectContaining({ validacaoConfirmada: { models: ["good-model"] } }),
    );
  });

  it("não aceita organização malformada", async () => {
    const res = await save(request({ label: "Gateway", base_url: BASE, api_key: KEY }), {
      params: Promise.resolve({ id: "malformed" }),
    });
    expect(res.status).toBe(400);
    expect(hooks.adminClient).not.toHaveBeenCalled();
    expect(hooks.validate).not.toHaveBeenCalled();
  });
});

describe("Superadmin testa a URL sem persistir credenciais", () => {
  it("verifica o UUID existente e devolve somente modelos e resultado", async () => {
    const res = await testConnection(request({ base_url: BASE, api_key: KEY }), params);
    expect(res.status).toBe(200);
    expect(hooks.validate).toHaveBeenCalledWith("custom", KEY, BASE);
    expect(hooks.save).not.toHaveBeenCalled();
    const result = await res.text();
    expect(result).toContain("model-one");
    expect(result).not.toContain(KEY);
  });

  it("não solicita o gateway quando a organização não existe", async () => {
    orgFound(false);
    const res = await testConnection(request({ base_url: BASE, api_key: KEY }), params);
    expect(res.status).toBe(404);
    expect(hooks.validate).not.toHaveBeenCalled();
  });

  it("não confirma conexão se /models retornar lista vazia", async () => {
    hooks.validate.mockResolvedValueOnce({ ok: true, models: [] });
    const res = await testConnection(request({ base_url: BASE, api_key: KEY }), params);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.verified).toBe(false);
    expect(data.data.error).toBe("models_empty");
  });
});
