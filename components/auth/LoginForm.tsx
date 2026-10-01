"use client";

import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";

import { useT } from "@/hooks/i18n/useT";
import { loginSchema, type LoginInput } from "@/lib/auth/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInWithPassword } from "@/app/actions/auth/signInWithPassword";
import { Eye, EyeSlash } from "@/lib/ui/icons";

type LoginFormProps = {
  next?: string;
  forgotHref?: string;
  appearance?: "default" | "elus";
};

export function LoginForm({
  next,
  forgotHref,
  appearance = "default",
}: LoginFormProps) {
  const t = useT();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const elus = appearance === "elus";

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = (values: LoginInput) => {
    setServerError(null);
    startTransition(async () => {
      const res = await signInWithPassword(values, next);
      if (!res) {
        router.replace(next || "/app");
        return;
      }
      if (res.error === "mfa_required") {
        const params = new URLSearchParams();
        if (next) params.set("next", next);
        if (res.challengeId) params.set("factor", res.challengeId);
        router.replace(`/login/mfa${params.toString() ? `?${params}` : ""}`);
        return;
      }
      if (res.error === "invalid_credentials") {
        setServerError(t("Email ou senha incorretos."));
      } else if (res.error === "rate_limited") {
        setServerError(t("Muitas tentativas. Aguarde alguns minutos."));
      } else if (res.error === "validation_error") {
        setServerError(t("Dados inválidos. Confira os campos."));
      } else {
        setServerError(t("Erro inesperado. Tente novamente."));
      }
    });
  };

  const inputClassName = elus
    ? "h-12 rounded-xl border-white/[0.09] bg-[#11152a]/85 px-4 text-white shadow-none placeholder:text-white/28 hover:border-cyan-300/25 focus-visible:border-cyan-300/55 focus-visible:ring-cyan-300/15"
    : undefined;

  return (
    <form
      method="post"
      onSubmit={handleSubmit(onSubmit)}
      className={elus ? "space-y-5" : "space-y-4"}
      noValidate
    >
      <div className="space-y-1.5">
        <Label htmlFor="email" className={elus ? "text-sm font-medium text-white/75" : undefined}>
          {t("Email")}
        </Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          autoFocus
          className={inputClassName}
          aria-invalid={errors.email ? true : undefined}
          {...register("email")}
        />
        {errors.email && (
          <p className={elus ? "text-xs text-rose-300" : "text-xs text-destructive"}>
            {t(errors.email.message ?? "")}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <Label
            htmlFor="password"
            className={elus ? "text-sm font-medium text-white/75" : undefined}
          >
            {t("Senha")}
          </Label>
          {forgotHref ? (
            <Link
              href={forgotHref}
              className={
                elus
                  ? "text-xs font-medium text-cyan-300 transition-colors hover:text-cyan-200"
                  : "text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              }
            >
              {t("Esqueci minha senha")}
            </Link>
          ) : null}
        </div>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            className={elus ? `${inputClassName} pr-12` : "pr-12"}
            aria-invalid={errors.password ? true : undefined}
            {...register("password")}
          />
          <button
            type="button"
            className={
              elus
                ? "absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-white/40 transition-colors hover:text-white/80 focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:outline-hidden focus-visible:ring-inset"
                : "absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:outline-hidden focus-visible:ring-inset"
            }
            aria-pressed={showPassword}
            onClick={() => setShowPassword((visible) => !visible)}
          >
            <span className="sr-only">{t(showPassword ? "Ocultar senha" : "Mostrar senha")}</span>
            {showPassword ? <EyeSlash size={20} aria-hidden /> : <Eye size={20} aria-hidden />}
          </button>
        </div>
        {errors.password && (
          <p className={elus ? "text-xs text-rose-300" : "text-xs text-destructive"}>
            {t(errors.password.message ?? "")}
          </p>
        )}
      </div>

      {serverError && (
        <div
          className={
            elus
              ? "rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100"
              : "rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          }
          role="alert"
        >
          {serverError}
        </div>
      )}

      <Button
        type="submit"
        className={
          elus
            ? "h-12 w-full rounded-xl border-0 bg-gradient-to-r from-cyan-500 via-violet-600 to-fuchsia-600 font-semibold text-white shadow-[0_14px_38px_rgba(91,76,240,0.28)] transition-[transform,filter,opacity] hover:brightness-110 active:scale-[0.99]"
            : "w-full"
        }
        disabled={isPending}
      >
        {isPending ? t("Entrando...") : t("Entrar")}
      </Button>
    </form>
  );
}
