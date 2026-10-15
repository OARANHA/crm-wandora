import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  encrypt: vi.fn(),
  audit: vi.fn(),
  validate: vi.fn(),
}));
vi.mock("@/lib/crypto/aes_gcm", () => ({
  encryptKey: mock.encrypt,
  bufToBytea: (value: Buffer) => "\\x" + value.toString("hex"),
}));
vi.mock("@/lib/audit", () => ({ audit: mock.audit }));
vi.mock("@/lib/ai/provider-validators", () => ({ validateProviderKey: mock.validate }));

import { guardarCredencial } from "./guardar";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

beforeEach(() => {
  vi.clearAllMocks();
  mock.encrypt.mockReturnValue({
    ciphertext: Buffer.from("synthetic-ciphertext"),
    iv: Buffer.from("synthetic-iv"),
    tag: Buffer.from("synthetic-tag"),
    last4: "9999",
  });
  mock.audit.mockResolvedValue(undefined);
});

describe("capability canônica AES-GCM com prova síncrona do Superadmin", () => {
  it("persiste só ciphertext, validação e catálogo, sem reexecutar validação async", async () => {
    let inserted: Record<string, unknown> | null = null;
    const admin = {
      from: vi.fn().mockReturnValue({
        insert: (values: Record<string, unknown>) => {
          inserted = values;
          return {
            select: () => ({
              single: async () => ({ data: { id: ID }, error: null }),
            }),
          };
        },
      }),
    };
    const result = await guardarCredencial({
      admin: admin as never,
      orgId: ORG,
      userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      provider: "custom",
      label: "Gateway",
      apiKey: "SYNTHETIC_ONLY_NEVER_REAL",
      baseUrl: "https://models.example.test/v1",
      validacaoConfirmada: { models: ["valid-model"] },
    });
    expect(result).toEqual({ ok: true, id: ID, last4: "9999" });
    expect(inserted).toMatchObject({
      organization_id: ORG,
      provider: "custom",
      label: "Gateway",
      models_available: ["valid-model"],
      validation_error: null,
      base_url: "https://models.example.test/v1",
      api_key_last4: "9999",
    });
    expect(inserted?.validated_at).toEqual(expect.any(String));
    expect(JSON.stringify(inserted)).not.toContain("SYNTHETIC_ONLY_NEVER_REAL");
    expect(mock.validate).not.toHaveBeenCalled();
    expect(mock.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai.credential_created",
        organizationId: ORG,
        resourceId: ID,
      }),
    );
  });
});
