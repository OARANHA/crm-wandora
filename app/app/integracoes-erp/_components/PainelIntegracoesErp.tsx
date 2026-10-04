"use client";

import { useMemo, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestExtensionApi } from "@/components/extensions/api-client";
import { useT } from "@/hooks/i18n/useT";
import { PROVEDOR_VENDAERP } from "@/lib/integracoes-erp/provedores";
import type { ConexaoErpSegura } from "@/lib/integracoes-erp/tipos";

interface VinculoAdminWhatsapp {
  id: string;
  phone_number: string;
  capability: "erp.admin.read";
  enabled: boolean;
}

export function PainelIntegracoesErp({
  inicial,
  canWrite,
  canBindWhatsapp,
  vinculoAdminWhatsapp: vinculoInicial,
}: {
  inicial: readonly ConexaoErpSegura[];
  canWrite: boolean;
  canBindWhatsapp: boolean;
  vinculoAdminWhatsapp: VinculoAdminWhatsapp | null;
}) {
  const t = useT();
  const [conexoes, setConexoes] = useState<readonly ConexaoErpSegura[]>(inicial);
  const [baseUrl, setBaseUrl] = useState(
    inicial.find((c) => c.provider === "vendaerp")?.base_url ?? "",
  );
  const [token, setToken] = useState("");
  const [user, setUser] = useState("");
  const [app, setApp] = useState("");
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [vinculoAdminWhatsapp, setVinculoAdminWhatsapp] =
    useState<VinculoAdminWhatsapp | null>(vinculoInicial);
  const [telefoneAdmin, setTelefoneAdmin] = useState(vinculoInicial?.phone_number ?? "");
  const [mensagemAdmin, setMensagemAdmin] = useState<string | null>(null);
  const [erroAdmin, setErroAdmin] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  const venda = useMemo(() => conexoes.find((c) => c.provider === "vendaerp") ?? null, [conexoes]);
  const leituras = PROVEDOR_VENDAERP.capacidades.filter((c) => c.habilitada);

  function salvar() {
    setErro(null);
    setMensagem(null);
    startTransition(async () => {
      const r = await requestExtensionApi<ConexaoErpSegura>("/api/v1/integracoes-erp/conexoes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          base_url: baseUrl,
          authorization_token: token,
          user,
          app,
        }),
      });
      if (!r.ok) {
        setErro(r.error.message);
        return;
      }
      setConexoes((atuais) => [r.data, ...atuais.filter((c) => c.provider !== "vendaerp")]);
      setToken("");
      setUser("");
      setApp("");
      setMensagem(t("Conexão salva. Agora você pode testar sem alterar nenhum dado no ERP."));
    });
  }

  function testar() {
    setErro(null);
    setMensagem(null);
    startTransition(async () => {
      const r = await requestExtensionApi<ConexaoErpSegura>(
        "/api/v1/integracoes-erp/conexoes/test",
        { method: "POST" },
      );
      if (!r.ok) {
        setErro(r.error.message);
        return;
      }
      setConexoes((atuais) => [r.data, ...atuais.filter((c) => c.provider !== "vendaerp")]);
      setMensagem(t("Conexão com o VendaERP confirmada em modo somente leitura."));
    });
  }

  function salvarWhatsappAdmin() {
    setErroAdmin(null);
    setMensagemAdmin(null);
    startTransition(async () => {
      const r = await requestExtensionApi<VinculoAdminWhatsapp>(
        "/api/v1/integracoes-erp/admin-whatsapp",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ phone_number: telefoneAdmin }),
        },
      );
      if (!r.ok) {
        setErroAdmin(r.error.message);
        return;
      }
      setVinculoAdminWhatsapp(r.data);
      setTelefoneAdmin(r.data.phone_number);
      setMensagemAdmin(
        t(
          "WhatsApp administrativo vinculado. O acesso continua limitado a consultas do ERP desta organização.",
        ),
      );
    });
  }

  function removerWhatsappAdmin() {
    setErroAdmin(null);
    setMensagemAdmin(null);
    startTransition(async () => {
      const r = await requestExtensionApi<{ removed: boolean }>(
        "/api/v1/integracoes-erp/admin-whatsapp",
        { method: "DELETE" },
      );
      if (!r.ok) {
        setErroAdmin(r.error.message);
        return;
      }
      setVinculoAdminWhatsapp(null);
      setTelefoneAdmin("");
      setMensagemAdmin(t("WhatsApp administrativo desvinculado."));
    });
  }

  return (
    <div className="space-y-6 p-6" data-testid="integracoes-erp">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Integrações ERP")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {t(
            "Conecte o ERP da empresa ao CRM por provedores oficiais. Nesta primeira etapa nenhuma operação de escrita é executada no ERP.",
          )}
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>VendaERP</CardTitle>
            <Badge variant="secondary">{t("Leitura administrativa")}</Badge>
            {venda?.last_test_ok === true ? (
              <Badge variant="success">{t("Conectado")}</Badge>
            ) : null}
          </div>
          <CardDescription>
            {t("Limite declarado pela API: 1.000 requisições por hora por chave.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-medium">{t("Leituras habilitadas agora")}</p>
            <div className="flex flex-wrap gap-2">
              {leituras.map((cap) => (
                <Badge key={cap.id} variant="outline">
                  {cap.id}
                </Badge>
              ))}
            </div>
          </div>

          {venda ? (
            <div className="rounded-lg border p-4 text-sm">
              <p className="font-medium">{t("Conexão salva")}</p>
              <p className="mt-1 text-muted-foreground">{venda.base_url}</p>
              <p className="mt-1 text-muted-foreground">
                Token ••••{venda.auth_token_last4} · User ••••{venda.user_last4} · App ••••
                {venda.app_last4}
              </p>
              {venda.last_tested_at ? (
                <p className="mt-1 text-muted-foreground">
                  {venda.last_test_ok ? t("Último teste aprovado.") : t("Último teste falhou.")}{" "}
                  {venda.last_test_error ?? ""}
                </p>
              ) : null}
              {canWrite ? (
                <Button className="mt-3" variant="outline" onClick={testar} disabled={pendente}>
                  {pendente ? t("Testando…") : t("Testar conexão")}
                </Button>
              ) : null}
            </div>
          ) : null}

          {canWrite ? (
            <div className="space-y-4 rounded-lg border p-4">
              <div>
                <p className="font-medium">
                  {venda ? t("Substituir credenciais") : t("Conectar VendaERP")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t(
                    "Informe os três cabeçalhos exigidos pela API do VendaERP. Os segredos são cifrados antes de serem gravados.",
                  )}
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="erp-base-url">{t("URL base da API")}</Label>
                <Input
                  id="erp-base-url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://..."
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="erp-token">Authorization-Token</Label>
                <Input
                  id="erp-token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="erp-user">User</Label>
                <Input id="erp-user" value={user} onChange={(e) => setUser(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="erp-app">App</Label>
                <Input id="erp-app" value={app} onChange={(e) => setApp(e.target.value)} />
              </div>
              <Button onClick={salvar} disabled={pendente || !baseUrl || !token || !user || !app}>
                {pendente ? t("Salvando…") : t("Salvar conexão")}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("Somente administradores da organização podem trocar a credencial do ERP.")}
            </p>
          )}

          {mensagem ? <p className="text-sm text-emerald-600">{mensagem}</p> : null}
          {erro ? (
            <p role="alert" className="text-sm text-destructive">
              {erro}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {canBindWhatsapp ? (
        <Card data-testid="erp-admin-whatsapp">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{t("WhatsApp administrativo")}</CardTitle>
              <Badge variant="secondary">{t("Somente leitura")}</Badge>
              {vinculoAdminWhatsapp?.enabled ? (
                <Badge variant="success">{t("Ativo")}</Badge>
              ) : null}
            </div>
            <CardDescription>
              {t(
                "Vincule o seu próprio WhatsApp ao seu usuário administrador do Elus. Esse número poderá consultar clientes, pedidos e notas da organização sem se passar pelo cliente.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-4 text-sm text-muted-foreground">
              {t(
                "A autorização é conferida de novo a cada conversa: número vinculado, usuário da mesma organização e papel de administrador ativo. O VendaERP continua somente leitura.",
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="erp-admin-whatsapp-phone">{t("Meu WhatsApp")}</Label>
              <Input
                id="erp-admin-whatsapp-phone"
                inputMode="tel"
                value={telefoneAdmin}
                onChange={(e) => setTelefoneAdmin(e.target.value)}
                placeholder="+5551999999999"
                autoComplete="tel"
              />
              <p className="text-xs text-muted-foreground">
                {t("Use o formato internacional com + e código do país.")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={salvarWhatsappAdmin} disabled={pendente || !telefoneAdmin.trim()}>
                {pendente
                  ? t("Salvando…")
                  : vinculoAdminWhatsapp
                    ? t("Atualizar meu WhatsApp")
                    : t("Vincular meu WhatsApp")}
              </Button>
              {vinculoAdminWhatsapp ? (
                <Button variant="outline" onClick={removerWhatsappAdmin} disabled={pendente}>
                  {t("Desvincular")}
                </Button>
              ) : null}
            </div>
            {mensagemAdmin ? <p className="text-sm text-emerald-600">{mensagemAdmin}</p> : null}
            {erroAdmin ? (
              <p role="alert" className="text-sm text-destructive">
                {erroAdmin}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
