import type { ReactNode } from "react";

import { LoginForm } from "@/components/auth/LoginForm";
import { marcaDaSaida } from "@/lib/branding/saida";
import { createClient } from "@/lib/supabase/server";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { traduzir } from "@/lib/i18n/dicionario";

export const metadata = { title: "Entrar" };

function AvisoLogin({
  children,
  tipo = "erro",
}: {
  children: ReactNode;
  tipo?: "erro" | "sucesso";
}) {
  const sucesso = tipo === "sucesso";
  return (
    <div
      className={
        sucesso
          ? "rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100"
          : "rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100"
      }
      role={sucesso ? "status" : "alert"}
    >
      {children}
    </div>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string; error?: string }>;
}) {
  const { next, reset, error } = await searchParams;
  const [marca, supabase] = await Promise.all([marcaDaSaida(null), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const idioma = await idiomaDoVisitante(
    (user?.user_metadata?.locale as string | undefined) ?? null,
  );
  const t = (texto: string) => traduzir(texto, idioma);

  return (
    <main
      data-elus-login
      data-theme="dark"
      className="fixed inset-0 z-20 overflow-y-auto bg-[#070812] text-white"
    >
      <div className="relative min-h-[100dvh] overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-32 top-[-10rem] h-96 w-96 rounded-full bg-cyan-500/18 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 bottom-[-8rem] h-96 w-96 rounded-full bg-fuchsia-500/18 blur-3xl"
        />

        <div className="relative mx-auto grid min-h-[100dvh] w-full max-w-[1600px] lg:grid-cols-[minmax(0,1.12fr)_minmax(420px,0.88fr)]">
          <section
            className="relative hidden min-h-[100dvh] overflow-hidden border-r border-white/10 lg:block"
            aria-label={t("Apresentação do Elus")}
          >
            {/* Asset aprovado do Elus. O texto da campanha já faz parte da arte. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/elus/login-hero.png"
              alt={t("Elus — Seu atendimento, vendas e rotina trabalhando no automático.")}
              className="absolute inset-0 h-full w-full object-cover object-[62%_center]"
            />
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-r from-[#070812]/10 via-transparent to-[#070812]/70"
            />
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#070812]/70 to-transparent"
            />
          </section>

          <section className="flex min-h-[100dvh] items-center justify-center px-5 py-10 sm:px-8 lg:px-12 xl:px-20">
            <div className="w-full max-w-md">
              <div className="rounded-[28px] border border-violet-300/15 bg-[#0d1020]/78 p-6 shadow-2xl shadow-violet-950/35 backdrop-blur-xl sm:p-8">
                <div className="mb-8">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/brand/elus/logo-horizontal.png"
                    alt={marca.nome}
                    className="h-auto max-h-12 w-auto max-w-[220px] object-contain"
                  />
                </div>

                <div className="mb-7 space-y-2">
                  <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-[2rem]">
                    {t("Bem-vindo ao")} <span>{marca.nome}</span>
                  </h1>
                  <p className="max-w-sm text-sm leading-6 text-white/55">
                    {t("Acesse sua operação para continuar seus atendimentos, vendas e automações.")}
                  </p>
                </div>

                <div className="mb-5 space-y-3">
                  {reset === "success" && (
                    <AvisoLogin tipo="sucesso">
                      {t("Senha redefinida com sucesso. Entre com a nova senha.")}
                    </AvisoLogin>
                  )}
                  {error === "link_invalido" && (
                    <AvisoLogin>
                      {t("Link inválido ou expirado. Peça um novo em Recuperar senha ou refaça o cadastro.")}
                    </AvisoLogin>
                  )}
                  {error === "convite_invalido" && (
                    <AvisoLogin>
                      {t(
                        "Sua conta foi confirmada, mas o convite não vale mais — ele expirou ou foi emitido para outro e-mail. Peça um novo a quem te convidou.",
                      )}
                    </AvisoLogin>
                  )}
                  {error === "cadastro_por_convite" && (
                    <AvisoLogin>
                      {t(
                        "Esta instalação aceita cadastro apenas por convite. Peça um novo convite a quem administra o sistema.",
                      )}
                    </AvisoLogin>
                  )}
                  {error === "template_padrao" && (
                    <AvisoLogin>
                      {t(
                        "Este link de confirmação não é compatível com esta instalação. Peça a quem administra o sistema para revisar os modelos de e-mail.",
                      )}
                    </AvisoLogin>
                  )}
                  {error === "provisionamento" && (
                    <AvisoLogin>
                      {t(
                        "Sua conta foi confirmada, mas houve um erro ao preparar seu ambiente. Tente entrar novamente em instantes.",
                      )}
                    </AvisoLogin>
                  )}
                  {error === "entrada_com_google" && (
                    <AvisoLogin>
                      {t(
                        "Não foi possível concluir a autenticação anterior. Entre com e-mail e senha.",
                      )}
                    </AvisoLogin>
                  )}
                  {error === "entrada_com_google_cancelada" && (
                    <AvisoLogin>
                      {t("A autenticação anterior foi cancelada. Nada mudou na sua conta.")}
                    </AvisoLogin>
                  )}
                  {error === "acesso_revogado" && (
                    <AvisoLogin>
                      {t(
                        "O acesso desta conta foi retirado por quem administra o sistema. Se o acesso deveria continuar, peça a restauração.",
                      )}
                    </AvisoLogin>
                  )}
                </div>

                <LoginForm
                  next={next}
                  forgotHref="/login/forgot"
                  appearance="elus"
                />

                <div className="mt-7 border-t border-white/10 pt-5 text-center">
                  <p className="text-xs leading-5 text-white/40">
                    {t("Acesso restrito a usuários autorizados do Elus.")}
                  </p>
                </div>
              </div>

              <p className="mt-5 text-center text-xs text-white/30">
                {t("Elus by Wandora")}
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
