import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  podeGerenciarIaDaPlataforma,
  interpretarAutonomiaIa,
  mudancasTecnicas,
  autonomiaEfetiva,
  validarMudancasTecnicas,
  CHAVE_SETTINGS_AUTONOMIA_IA,
} from "./governanca-da-ia";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const OWNER = { is_platform_admin: true, platform_admin_scope: "full", support: null };
const CLIENT = { is_platform_admin: false, platform_admin_scope: null, support: null };
const SUPPORT = {
  is_platform_admin: true,
  platform_admin_scope: "full",
  support: { status: "active" } as never,
};
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

function fakeDb(map: Record<string, unknown>, fail = false) {
  vi.mocked(createAdminClient).mockImplementation(
    () =>
      ({
        from: () => ({
          select: () => ({
            eq: (_field: string, orgId: string) => ({
              maybeSingle: async () =>
                fail
                  ? { data: null, error: { code: "DB_DOWN" } }
                  : {
                      data: map[orgId] === undefined ? null : { settings: map[orgId] },
                      error: null,
                    },
            }),
          }),
        }),
      }) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("autonomia tecnica de IA por tenant", () => {
  it("somente owner full, nunca support_readonly ou impersonation, bypassa a politica", () => {
    expect(podeGerenciarIaDaPlataforma(OWNER)).toBe(true);
    expect(podeGerenciarIaDaPlataforma(CLIENT)).toBe(false);
    expect(podeGerenciarIaDaPlataforma(SUPPORT)).toBe(false);
    expect(
      podeGerenciarIaDaPlataforma({ ...OWNER, platform_admin_scope: "support_readonly" }),
    ).toBe(false);
  });

  it("ausencia, falsos positivos e valores malformados nao concedem nada", () => {
    expect(Object.values(interpretarAutonomiaIa({}))).toEqual([false, false, false, false]);
    expect(
      interpretarAutonomiaIa({
        [CHAVE_SETTINGS_AUTONOMIA_IA]: {
          provider: "true",
          model: 1,
          credentials: {},
          operator_model: true,
        },
      }),
    ).toEqual({ provider: false, model: false, credentials: false, operator_model: true });
  });

  it("tenant A nunca herda privilegios do tenant B", async () => {
    fakeDb({
      [ORG_A]: { [CHAVE_SETTINGS_AUTONOMIA_IA]: { credentials: true } },
      [ORG_B]: { [CHAVE_SETTINGS_AUTONOMIA_IA]: { model: true } },
    });
    expect((await autonomiaEfetiva(CLIENT, ORG_A)).credentials).toBe(true);
    expect((await autonomiaEfetiva(CLIENT, ORG_A)).model).toBe(false);
    expect((await autonomiaEfetiva(CLIENT, ORG_B)).credentials).toBe(false);
    expect((await autonomiaEfetiva(CLIENT, ORG_B)).model).toBe(true);
  });

  it("falha na consulta é fail-closed mesmo quando existe concessao anterior", async () => {
    fakeDb({ [ORG_A]: { [CHAVE_SETTINGS_AUTONOMIA_IA]: { credentials: true } } }, true);
    expect((await autonomiaEfetiva(CLIENT, ORG_A)).credentials).toBe(false);
    expect((await autonomiaEfetiva(OWNER, ORG_A)).credentials).toBe(true);
    expect((await autonomiaEfetiva(SUPPORT, ORG_A)).credentials).toBe(false);
  });

  it("reeditar prompt sem alterar provider/model/credencial nao exige autonomia", () => {
    expect(
      mudancasTecnicas(
        { provider: "anthropic", model: "anthropic/x", credential_id: null, operator_model: null },
        { provider: "anthropic", model: "anthropic/x", credential_id: null, operator_model: null },
      ),
    ).toEqual([]);
  });

  it("nega so o campo tecnico nao autorizado, mantendo os outros separados", async () => {
    fakeDb({ [ORG_A]: { [CHAVE_SETTINGS_AUTONOMIA_IA]: { model: true } } });
    const negadas = await validarMudancasTecnicas(
      CLIENT,
      ORG_A,
      { provider: "anthropic", model: "anthropic/x", credential_id: null, operator_model: null },
      { provider: "openai", model: "openai/y", credential_id: ORG_A, operator_model: "openai/z" },
    );
    expect(negadas).toEqual(["provider", "credentials", "operator_model"]);
  });
});
