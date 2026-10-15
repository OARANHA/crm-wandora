"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Model = { provider: string; model_id: string; display_name: string };
type Readiness = {
  provider: string;
  chave_instalacao: boolean;
  credencial_organizacao_validada: boolean;
};
type Data = {
  padrao: { provider: string; default_model: string | null; configured: boolean };
  provedores: string[];
  modelos: Model[];
  disponibilidade: Readiness[];
  agentes_publicados: number;
  pontos_com_configuracao_propria: number;
  pode_editar: boolean;
};
type Result = { data?: Data; error?: { message?: string } };

export function TenantAiPlatformDefault({ organizationId }: { organizationId: string }) {
  const endpoint = "/api/v1/admin/tenants/" + encodeURIComponent(organizationId) + "/ai-default";
  const [data, setData] = React.useState<Data | null>(null);
  const [provider, setProvider] = React.useState("");
  const [model, setModel] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const load = React.useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      const result = (await response.json()) as Result;
      if (!response.ok || !result.data)
        throw new Error(result.error?.message ?? "Falha ao consultar IA.");
      setData(result.data);
      setProvider(result.data.padrao.provider);
      setModel(result.data.padrao.default_model ?? "");
    },
    [endpoint],
  );
  React.useEffect(() => {
    const ctrl = new AbortController();
    void (async () => {
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: ctrl.signal });
        const result = (await response.json()) as Result;
        if (!response.ok || !result.data)
          throw new Error(result.error?.message ?? "Falha ao consultar IA.");
        if (!ctrl.signal.aborted) {
          setData(result.data);
          setProvider(result.data.padrao.provider);
          setModel(result.data.padrao.default_model ?? "");
        }
      } catch (reason) {
        if (!ctrl.signal.aborted)
          setError(reason instanceof Error ? reason.message : "Falha de conexão.");
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [endpoint]);

  const models = (data?.modelos ?? []).filter((x) => x.provider === provider);
  const availability = data?.disponibilidade.find((x) => x.provider === provider);
  const ready = !!availability?.chave_instalacao || !!availability?.credencial_organizacao_validada;
  const unchanged =
    provider === data?.padrao.provider && model === (data?.padrao.default_model ?? "");
  const disabled = saving || !data?.pode_editar;
  async function save() {
    if (!data || disabled || unchanged || !model.trim()) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch(endpoint, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, default_model: model.trim() }),
      });
      const body = (await r.json()) as Result;
      if (!r.ok) {
        setError(body.error?.message ?? "Falha ao salvar.");
        return;
      }
      await load();
      setNotice("Padrão salvo. Nenhum agente já publicado foi alterado.");
    } catch {
      setError("Falha de conexão. Recarregue antes de tentar novamente.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="space-y-4 rounded-lg border p-5" aria-label="IA fornecida pela plataforma">
      <div>
        <h3 className="text-lg font-semibold">IA fornecida pela plataforma</h3>
        <p className="text-sm text-muted-foreground">
          O padrão desta empresa vale onde não existir escolha específica. Versões de agentes
          publicadas e configurações próprias dos pontos continuam prevalecendo. As permissões de
          autonomia são controladas separadamente acima.
        </p>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Consultando configuração…</p>
      ) : data ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="ai-platform-provider" className="text-sm font-medium">
                Provedor padrão
              </label>
              <Select
                value={provider}
                disabled={disabled}
                onValueChange={(p) => {
                  setProvider(p);
                  setModel("");
                  setNotice("");
                }}
              >
                <SelectTrigger id="ai-platform-provider">
                  <SelectValue placeholder="Escolha o provedor" />
                </SelectTrigger>
                <SelectContent>
                  {data.provedores.map((id) => (
                    <SelectItem key={id} value={id}>
                      {id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label htmlFor="ai-platform-model" className="text-sm font-medium">
                Modelo padrão
              </label>
              {models.length > 0 && (model === "" || models.some((m) => m.model_id === model)) ? (
                <Select value={model} disabled={disabled} onValueChange={setModel}>
                  <SelectTrigger id="ai-platform-model">
                    <SelectValue placeholder="Escolha o modelo" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((m) => (
                      <SelectItem key={m.provider + "/" + m.model_id} value={m.model_id}>
                        {m.display_name || m.model_id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="ai-platform-model"
                  value={model}
                  maxLength={120}
                  disabled={disabled}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Identificador exato do modelo"
                />
              )}
            </div>
          </div>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              Origem:{" "}
              {data.padrao.configured
                ? "configuração da organização"
                : "fallback da instalação (não salvo)"}
              .
            </p>
            <p>
              Credencial de {provider}:{" "}
              {ready
                ? availability?.credencial_organizacao_validada
                  ? "credencial própria validada"
                  : "chave da instalação presente"
                : "nenhuma credencial confirmada. Salvar o modelo não cria chaves."}
            </p>
            <p>
              {data.agentes_publicados} agente(s) publicado(s),{" "}
              {data.pontos_com_configuracao_propria} ponto(s) com modelo próprio. Nenhum desses
              registros será sobrescrito.
            </p>
            {models.length === 0 && (
              <p>Catálogo de modelos vazio para este provedor. Confirme o ID antes de usar.</p>
            )}
          </div>
          {data.pode_editar ? (
            <Button
              type="button"
              disabled={disabled || unchanged || !model.trim()}
              onClick={() => {
                void save();
              }}
            >
              {saving ? "Salvando…" : "Salvar padrão da organização"}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Somente o Superadmin full pode alterar este padrão.
            </p>
          )}
        </>
      ) : null}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
    </section>
  );
}
