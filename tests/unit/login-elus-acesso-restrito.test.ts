import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const LOGIN = path.join(RAIZ, "app/(public)/login/page.tsx");
const FORM = path.join(RAIZ, "components/auth/LoginForm.tsx");

describe("login do Elus — acesso restrito", () => {
  it("usa os assets aprovados do Elus sem transformar o formulário em imagem", () => {
    const fonte = fs.readFileSync(LOGIN, "utf8");

    expect(fonte).toContain('src="/brand/elus/login-hero.png"');
    expect(fonte).toContain('src="/brand/elus/logo-horizontal.png"');
    expect(fonte).toContain("<LoginForm");
    expect(fs.existsSync(path.join(RAIZ, "public/brand/elus/login-hero.png"))).toBe(true);
    expect(fs.existsSync(path.join(RAIZ, "public/brand/elus/logo-horizontal.png"))).toBe(true);
  });

  it("não expõe cadastro público nem botão do Google na tela de entrada", () => {
    const fonte = fs.readFileSync(LOGIN, "utf8");

    expect(fonte).not.toContain("EntrarComGoogle");
    expect(fonte).not.toContain('href="/signup"');
    expect(fonte).not.toContain("Criar conta");
  });

  it("mantém recuperação de senha e mostrar/ocultar senha em componentes reais", () => {
    const login = fs.readFileSync(LOGIN, "utf8");
    const form = fs.readFileSync(FORM, "utf8");

    expect(login).toContain('forgotHref="/login/forgot"');
    expect(form).toContain('type={showPassword ? "text" : "password"}');
    expect(form).toContain("Ocultar senha");
    expect(form).toContain("Mostrar senha");
  });

  it("a marca mostrada no login vem do resolvedor do banco", () => {
    const fonte = fs.readFileSync(LOGIN, "utf8");

    expect(fonte).toContain('import { marcaDaSaida } from "@/lib/branding/saida"');
    expect(fonte).toContain("marcaDaSaida(null)");
    expect(fonte).not.toMatch(/\bbranding\(\)/);
  });
});
