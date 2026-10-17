import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  result: { config: { host: "", fromEmail: "" }, bancoRespondeu: true },
}));
vi.mock("@/lib/email/config", () => ({
  lerSmtp: async () => db.result,
}));
vi.mock("@/lib/email/smtp", () => ({
  isSmtpConfigured: (c: { host: string; fromEmail: string }) =>
    Boolean(c.host && c.fromEmail),
}));

import { semSmtpNaInstalacao } from "@/lib/email/estado";

beforeEach(() => {
  db.result = { config: { host: "", fromEmail: "" }, bancoRespondeu: true };
});
afterEach(() => vi.unstubAllEnvs());

describe("ausência comprovada de SMTP na instalação", () => {
  it("no servidor único com banco respondendo e sem host/remetente, alerta", async () => {
    vi.stubEnv("SINGLE_SERVER", "1");
    expect(await semSmtpNaInstalacao()).toBe(true);
  });

  it("um banco com erro não é prova de configuração ausente", async () => {
    vi.stubEnv("SINGLE_SERVER", "1");
    db.result.bancoRespondeu = false;
    expect(await semSmtpNaInstalacao()).toBe(false);
  });

  it("host e remetente juntos não disparam aviso", async () => {
    vi.stubEnv("SINGLE_SERVER", "1");
    db.result.config = { host: "smtp.example.test", fromEmail: "noreply@example.test" };
    expect(await semSmtpNaInstalacao()).toBe(false);
  });

  it("remetente isolado não é configuração suficiente para login", async () => {
    vi.stubEnv("SINGLE_SERVER", "1");
    db.result.config = { host: "", fromEmail: "noreply@example.test" };
    expect(await semSmtpNaInstalacao()).toBe(true);
  });

  it("na instalação com Supabase separado não presume estado do login", async () => {
    vi.stubEnv("SINGLE_SERVER", "");
    expect(await semSmtpNaInstalacao()).toBe(false);
  });
});
