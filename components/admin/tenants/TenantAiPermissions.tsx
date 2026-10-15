"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

type Permissions = {
  provider: boolean;
  model: boolean;
  credentials: boolean;
  operator_model: boolean;
};
const ITEMS: Array<{ key: keyof Permissions; label: string; note: string }> = [
  {
    key: "provider",
    label: "Escolher provedor de IA",
    note: "Autoriza trocar a empresa de IA dos agentes.",
  },
  {
    key: "model",
    label: "Escolher modelo",
    note: "Autoriza escolher modelos sem alterar as permissões de credenciais.",
  },
  {
    key: "credentials",
    label: "Gerenciar chaves próprias (BYOK)",
    note: "Autoriza cadastrar, testar e gerenciar credenciais da organização.",
  },
  {
    key: "operator_model",
    label: "Escolher modelo do operador",
    note: "Autoriza um modelo específico para operações, em vez de herdar o conversador.",
  },
];
type ApiResult = { data?: { permissions: Permissions }; error?: { message: string } };

export function TenantAiPermissions({ organizationId }: { organizationId: string }) {
  const [values, setValues] = React.useState<Permissions | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const endpoint = `/api/v1/admin/tenants/${encodeURIComponent(organizationId)}/ai-permissions`;
  React.useEffect(() => {
    let alive = true;
    void fetch(endpoint, { cache: "no-store" })
      .then(async (response) => ({ response, body: (await response.json()) as ApiResult }))
      .then(({ response, body }) => {
        if (!alive) return;
        if (response.ok && body.data) setValues(body.data.permissions);
        else setMessage(body.error?.message ?? "Não foi possível consultar as permissões.");
      })
      .catch(() => {
        if (alive) setMessage("Falha de conexão ao consultar permissões.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [endpoint]);

  async function save() {
    if (!values) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = (await response.json()) as ApiResult;
      if (!response.ok || !body.data) {
        setMessage(body.error?.message ?? "Não foi possível atualizar as permissões.");
        return;
      }
      setValues(body.data.permissions);
      setMessage("Permissões salvas para esta empresa.");
    } catch {
      setMessage("Falha de conexão ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border p-5" aria-label="Autonomia técnica de IA">
      <div>
        <h3 className="text-lg font-semibold">Autonomia técnica de IA</h3>
        <p className="text-sm text-muted-foreground">
          A plataforma gerencia a IA por padrão. Libere apenas as escolhas técnicas que esta empresa
          pode modificar. Desligar uma permissão não exclui chaves ou versões já publicadas.
        </p>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando permissões…</p>
      ) : values ? (
        <>
          <div className="space-y-3">
            {ITEMS.map((item) => (
              <label key={item.key} className="flex items-start gap-3">
                <Checkbox
                  checked={values[item.key]}
                  disabled={saving}
                  onCheckedChange={(checked) => {
                    setValues((old) => (old ? { ...old, [item.key]: checked === true } : old));
                  }}
                />
                <span>
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="block text-xs text-muted-foreground">{item.note}</span>
                </span>
              </label>
            ))}
          </div>
          <Button
            type="button"
            disabled={saving}
            onClick={() => {
              void save();
            }}
          >
            {saving ? "Salvando…" : "Salvar permissões"}
          </Button>
        </>
      ) : null}
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
    </section>
  );
}
