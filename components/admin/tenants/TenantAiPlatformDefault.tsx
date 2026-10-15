"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PROVEDOR_POR_ID } from "@/lib/ai/pontos/provedores";
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
  gateway_instalacao: boolean;
  credencial_organizacao_validada: boolean;
};
type Credential = {
  id: string;
  provider: string;
  label: string;
  base_url: string | null;
  api_key_last4: string;
  is_active: boolean;
  validated_at: string | null;
  models_available: string[];
};
type Data = {
  organization_name: string;
  padrao: {
    provider: string;
    default_model: string | null;
    credential_id: string | null;
    configured: boolean;
  };
  credenciais: Credential[];
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
  const [credentialId, setCredentialId] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [tested, setTested] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const load = React.useCallback(
    async (preserveChoice = false) => {
      const response = await fetch(endpoint, { cache: "no-store" });
      const result = (await response.json()) as Result;
      if (!response.ok || !result.data)
        throw new Error(result.error?.message ?? "Falha ao consultar IA.");
      setData(result.data);
      if (!preserveChoice) {
        setProvider(result.data.padrao.provider);
        setModel(result.data.padrao.default_model ?? "");
        setCredentialId(result.data.padrao.credential_id ?? "");
      }
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
          setCredentialId(result.data.padrao.credential_id ?? "");
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

  const credentials = (data?.credenciais ?? []).filter((c) => c.provider === provider);
  const selected = credentials.find((c) => c.id === credentialId);
  const selectedReady = !!selected?.is_active && !!selected.validated_at;
  const catalog = (data?.modelos ?? []).filter((x) => x.provider === provider);
  const models: Model[] =
    selectedReady && selected?.models_available?.length
      ? selected.models_available.map((id) => ({ provider, model_id: id, display_name: id }))
      : catalog;
  const availability = data?.disponibilidade.find((x) => x.provider === provider);
  const ready = !!availability?.chave_instalacao || !!availability?.credencial_organizacao_validada;
  const unchanged =
    provider === data?.padrao.provider &&
    model === (data?.padrao.default_model ?? "") &&
    credentialId === (data?.padrao.credential_id ?? "");
  const disabled = saving || !data?.pode_editar;
  async function save() {
    if (
      !data ||
      disabled ||
      unchanged ||
      !model.trim() ||
      (provider === "custom" && !selectedReady) ||
      (credentialId && !selectedReady)
    )
      return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch(endpoint, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          default_model: model.trim(),
          credential_id: credentialId || null,
        }),
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
  const credentialsEndpoint =
    "/api/v1/admin/tenants/" + encodeURIComponent(organizationId) + "/ai-credentials";

  async function testCustom() {
    if (disabled || testing || !baseUrl.startsWith("https://") || !apiKey.trim()) return;
    setTesting(true);
    setError("");
    setNotice("");
    setTested(false);
    try {
      const response = await fetch(credentialsEndpoint + "/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ base_url: baseUrl.trim(), api_key: apiKey }),
      });
      const body = (await response.json()) as {
        data?: { verified: boolean; models: string[] };
        error?: { message?: string };
      };
      if (!response.ok || !body.data?.verified)
        throw new Error(
          body.error?.message ?? "O provedor não validou a conexão. Confira URL e chave.",
        );
      setTested(true);
      setNotice("Conexão confirmada. " + body.data.models.length + " modelos disponíveis.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao testar conexão.");
    } finally {
      setTesting(false);
    }
  }

  async function createCustom() {
    if (disabled || testing || !tested || !label.trim() || !baseUrl || !apiKey.trim()) return;
    setTesting(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(credentialsEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: label.trim(), base_url: baseUrl.trim(), api_key: apiKey }),
      });
      const body = (await response.json()) as {
        data?: { id: string };
        error?: { message?: string };
      };
      if (!response.ok || !body.data)
        throw new Error(body.error?.message ?? "Falha ao cadastrar credencial.");
      setApiKey("");
      setLabel("");
      setBaseUrl("");
      setTested(false);
      await load(true);
      setCredentialId(body.data.id);
      setModel("");
      setNotice(
        "Credencial validada e salva para esta organização. Escolha um modelo confirmado e clique em Ativar padrão.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao cadastrar credencial.");
    } finally {
      setTesting(false);
    }
  }

  async function refreshCredentials() {
    setTesting(true);
    setError("");
    try {
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao consultar credenciais.");
    } finally {
      setTesting(false);
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
        {data && (
          <p className="mt-2 text-sm font-medium">
            Organização selecionada: {data.organization_name}
          </p>
        )}
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
                  setCredentialId("");
                  setNotice("");
                  setTested(false);
                }}
              >
                <SelectTrigger id="ai-platform-provider">
                  <SelectValue placeholder="Escolha o provedor" />
                </SelectTrigger>
                <SelectContent>
                  {data.provedores.map((id) => (
                    <SelectItem key={id} value={id}>
                      {PROVEDOR_POR_ID.get(id)?.rotulo ?? id}
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
          <div className="space-y-2">
            <label htmlFor="ai-platform-credential" className="text-sm font-medium">
              Credencial da organização
            </label>
            <Select
              value={credentialId || (provider === "custom" ? undefined : "__installation__")}
              disabled={disabled || testing}
              onValueChange={(id) => {
                setCredentialId(id === "__installation__" ? "" : id);
                setModel("");
                setNotice("");
              }}
            >
              <SelectTrigger id="ai-platform-credential">
                <SelectValue placeholder="Escolha a credencial" />
              </SelectTrigger>
              <SelectContent>
                {provider !== "custom" && (
                  <SelectItem value="__installation__">
                    Chave da instalação (se disponível)
                  </SelectItem>
                )}
                {credentials.map((c) => (
                  <SelectItem key={c.id} value={c.id} disabled={!c.is_active || !c.validated_at}>
                    {c.label} · final {c.api_key_last4} ·
                    {c.is_active && c.validated_at ? " validada" : " aguardando validação"}
                  </SelectItem>
                ))}
                {provider === "custom" && credentials.length === 0 && (
                  <SelectItem value="__missing__" disabled>
                    Cadastre uma credencial abaixo
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            {selected && (
              <p className="text-xs text-muted-foreground">
                Endpoint: {selected.base_url ?? "padrão do provedor"}.{" "}
                {selectedReady
                  ? "Credencial validada."
                  : "Validação pendente; não pode ser ativada."}
              </p>
            )}
          </div>
          {provider === "custom" && data.pode_editar && (
            <div
              className="space-y-3 rounded-md border p-4"
              aria-label="Cadastrar provedor personalizado"
            >
              <h4 className="font-semibold">
                Cadastrar IA personalizada para {data.organization_name}
              </h4>
              <p className="text-sm text-muted-foreground">
                Endpoint HTTPS público compatível com OpenAI, com GET /models autenticado. A chave
                será cifrada na credencial da organização, não nas variáveis da VPS. Endereços de
                rede interna e destinos não autorizados são bloqueados.
              </p>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <label htmlFor="custom-label">Nome da conexão</label>
                  <Input
                    id="custom-label"
                    value={label}
                    maxLength={80}
                    disabled={disabled || testing}
                    onChange={(e) => {
                      setLabel(e.target.value);
                      setTested(false);
                    }}
                    placeholder="Gateway de IA"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="custom-url">Base URL HTTPS</label>
                  <Input
                    id="custom-url"
                    value={baseUrl}
                    maxLength={500}
                    disabled={disabled || testing}
                    onChange={(e) => {
                      setBaseUrl(e.target.value);
                      setTested(false);
                    }}
                    placeholder="https://seu-gateway.example/v1"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="custom-key">Token/API Key</label>
                  <Input
                    id="custom-key"
                    type="password"
                    value={apiKey}
                    disabled={disabled || testing}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setTested(false);
                    }}
                    autoComplete="off"
                    placeholder="Chave de acesso"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    disabled || testing || !baseUrl.trim().startsWith("https://") || !apiKey
                  }
                  onClick={() => void testCustom()}
                >
                  {testing ? "Processando…" : "Testar conexão"}
                </Button>
                <Button
                  type="button"
                  disabled={disabled || testing || !tested || !label.trim()}
                  onClick={() => void createCustom()}
                >
                  Salvar credencial validada
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled || testing}
                  onClick={() => void refreshCredentials()}
                >
                  Atualizar credenciais
                </Button>
              </div>
              {tested && (
                <p className="text-sm">Conexão comprovada. Você pode cadastrar a credencial.</p>
              )}
            </div>
          )}
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              Origem:{" "}
              {data.padrao.configured
                ? "configuração da organização"
                : "fallback da instalação (não salvo)"}
              .
            </p>
            {provider === "custom" && (
              <p>
                Provedor personalizado significa uma API compatível com OpenAI. Configure acima a
                Base URL, a chave e o modelo para esta organização. Cadastrar a credencial não ativa
                o padrão: após a validação, selecione-a e clique em Ativar padrão.
              </p>
            )}
            <p>
              Credencial de {PROVEDOR_POR_ID.get(provider)?.rotulo ?? provider}:{" "}
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
            {!ready && availability?.gateway_instalacao && (
              <p>
                Gateway da instalação configurado; não foi comprovado que ele suporta este
                provedor/modelo.
              </p>
            )}
            {models.length === 0 && (
              <p>Catálogo de modelos vazio para este provedor. Confirme o ID antes de usar.</p>
            )}
          </div>
          {data.pode_editar ? (
            <Button
              type="button"
              disabled={
                disabled ||
                testing ||
                unchanged ||
                !model.trim() ||
                (provider === "custom" && !selectedReady) ||
                (!!credentialId && !selectedReady)
              }
              onClick={() => {
                void save();
              }}
            >
              {saving ? "Salvando…" : "Ativar padrão nesta organização"}
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
