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
      className="fixed inset-0 z-20 overflow-y-auto bg-[#050611] text-white"
    >
      <div className="relative min-h-[100dvh] overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-40 top-[-12rem] h-[32rem] w-[32rem] rounded-full bg-cyan-500/15 blur-[120px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 bottom-[-10rem] h-[34rem] w-[34rem] rounded-full bg-fuchsia-600/15 blur-[130px]"
        />

        <div className="relative grid min-h-[100dvh] w-full lg:grid-cols-[minmax(0,1.2fr)_minmax(420px,0.8fr)]">
          <section
            className="relative hidden min-h-[100dvh] overflow-hidden border-r border-white/[0.08] lg:block"
            aria-label={t("Apresentação do Elus")}
          >
            {/* Asset aprovado do Elus. O texto da campanha já faz parte da arte. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/elus/login-hero.png"
              alt={t("Elus — Seu atendimento, vendas e rotina trabalhando no automático.")}
              className="absolute inset-0 h-full w-full object-cover object-[58%_center]"
            />
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-r from-[#050611]/5 via-transparent to-[#050611]/75"
            />
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#050611]/75 to-transparent"
            />
          </section>

          <section className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-5 py-10 sm:px-8 lg:px-12 xl:px-16">
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-600/10 blur-[110px]"
            />
            <div className="relative w-full max-w-[440px]">
              <div className="overflow-hidden rounded-[32px] border border-white/10 bg-[#0b0d1d]/80 shadow-[0_28px_90px_rgba(0,0,0,0.42)] backdrop-blur-2xl">
                <div
                  aria-hidden
                  className="h-px w-full bg-gradient-to-r from-transparent via-cyan-300/80 to-transparent"
                />
                <div className="p-6 sm:p-8">
                  <div className="mb-8">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/brand/elus/logo-horizontal.png"
                    alt={marca.nome}
                    className="h-auto max-h-12 w-auto max-w-[230px] object-contain drop-shadow-[0_0_28px_rgba(99,102,241,0.22)]"
                  />
                </div>

                <div className="mb-7 space-y-2">
                  <h1 className="text-3xl font-semibold tracking-[-0.025em] text-white sm:text-[2.15rem]">
                    {t("Bem-vindo ao")}{" "}
                    <span className="bg-gradient-to-r from-cyan-300 via-violet-300 to-fuchsia-300 bg-clip-text text-transparent">
                      {marca.nome}
                    </span>
                  </h1>
                  <p className="max-w-sm text-sm leading-6 text-white/60">
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

                <div className="mt-7 border-t border-white/[0.08] pt-5 text-center">
                  <p className="text-xs leading-5 text-white/40">
                    {t("Acesso restrito a usuários autorizados do Elus.")}
                  </p>
                </div>
                </div>
              </div>

              <p className="mt-5 text-center text-xs tracking-[0.16em] text-white/30 uppercase">
                {t("Elus by Wandora")}
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
