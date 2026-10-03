const scope = {
  conversationId: process.env.ELUS_CANARY_CONVERSATION_ID ?? "",
  pedidoCodigo: Number(process.env.ELUS_CANARY_PEDIDO_CODIGO ?? ""),
};

function emit(result: unknown, code: number): never {
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(code);
}

if (
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    scope.conversationId,
  ) ||
  !Number.isSafeInteger(scope.pedidoCodigo) ||
  scope.pedidoCodigo < 1
) {
  emit({ ok: false, code: "invalid_scope" }, 2);
}

const sealedRequired = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AI_CRED_AES_KEY",
] as const;

if (sealedRequired.some((name) => !(process.env[name] ?? "").trim())) {
  emit({ ok: false, code: "missing_sealed_runtime_env" }, 2);
}

process.env.NODE_ENV = "production";
for (const name of [
  "INTERNAL_SECRET",
  "CPF_ENCRYPTION_KEY",
  "WAHA_BYO_ENCRYPTION_KEY",
  "SUPABASE_DB_URL",
  "WAHA_API_BASE_URL",
  "WAHA_API_KEY",
  "WAHA_WEBHOOK_BASE_URL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
]) {
  if (!(process.env[name] ?? "").trim()) process.env[name] = "canary-not-used";
}

try {
  const [{ createAdminClient }, { executarCanarioDanfeReadonly }] = await Promise.all([
    import("@/lib/supabase/admin"),
    import("@/lib/integracoes-erp/canario-danfe-readonly"),
  ]);

  const resultado = await executarCanarioDanfeReadonly(createAdminClient(), scope);
  emit(resultado, resultado.ok ? 0 : 2);
} catch {
  emit({ ok: false, code: "unexpected_failure" }, 2);
}
