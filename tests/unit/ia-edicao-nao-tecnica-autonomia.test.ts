import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("salvar rascunho com campos de IA bloqueados", () => {
  it("página lê autonomia e não veda edição ordinária", () => {
    const s = read("app/app/ai/agents/[id]/page.tsx");
    expect(s).toContain("autonomiaTecnica={await autonomiaEfetiva(user, activeOrg.orgId)}");
    expect(s).not.toContain("recusaConfiguracaoDeIa(");
  });
  it("form permite salvar legado mas publicação mantém validação estrita", () => {
    const s = read("app/app/ai/agents/[id]/_components/AgentForm.tsx");
    expect(s).toContain("podePreservarChaveLegadaAoSalvar");
    // Props é uma união discriminada: versões só existem em mode edit.
    expect(s).toContain(
      'props.mode === "edit" && Boolean(props.base ?? props.draft ?? props.published)',
    );
    expect(s).toContain("if (faltaChaveInstalacao && !manterChaveLegadaAoSalvar)");
    expect(s).toContain("formularioValido: isValid && !faltaCredencialParaPublicar");
    expect(s).toContain("disabled={disabled || !autonomia.provider}");
    expect(s).toContain("disabled={disabled || !autonomia.model}");
    expect(s).toContain("disabled={disabled || !autonomia.credentials}");
  });
  it("server compara escolhas técnicas com versão original no banco", () => {
    const s = read("app/app/ai/agents/[id]/_actions.ts");
    expect(s).toContain("motivoDaRecusaTecnica(");
    expect(s).toContain("existingDraft?.id ?? agent.published_version_id ?? null");
    expect(read("lib/ai/governanca-da-ia.ts")).toContain("if (mudancas.length === 0) return []");
  });
});
