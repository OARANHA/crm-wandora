"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { apiClient } from "@/lib/api/client";
import { usePermission } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { useSendMessage } from "@/hooks/inbox/useSendMessage";
import { ArrowSquareOut, FileText, MagnifyingGlass, PaperPlaneTilt } from "@/lib/ui/icons";

interface PedidoErpNoAtendimento {
  id: string | null;
  codigo: number | null;
  cliente: string | null;
  status: string | null;
  statusSistema: string | null;
  total: number | null;
  data: string | null;
  finalizado: boolean | null;
  numeroNFe: string | null;
  dataFaturamento: string | null;
  chaveAcessoNFe: string | null;
  danfeDisponivel: boolean;
}

interface NotaPreparada {
  nota: {
    numero: number | null;
    codigoStatus: number | null;
    mensagemStatus: string | null;
    chave: string | null;
    lote: number | null;
    danfeDisponivel: boolean;
  };
  documento: {
    storage_path: string;
    media_mime: string;
    media_size_bytes: number;
    filename: string;
    preview_url: string;
    preview_expires_seconds: number;
  };
}

interface Props {
  conversationId: string;
}

function nfeNumerica(valor: string | null | undefined): number | null {
  const texto = valor?.trim() ?? "";
  if (!/^\d+$/.test(texto)) return null;
  const n = Number(texto);
  return Number.isSafeInteger(n) && n > 0 && n <= 2_147_483_647 ? n : null;
}

export function ErpDanfeCard({ conversationId }: Props) {
  const t = useT();
  const podeResponder = usePermission("inbox.reply");
  const enviar = useSendMessage();

  const [disponivel, setDisponivel] = useState<boolean | null>(null);
  const [pedido, setPedido] = useState("");
  const [nfe, setNfe] = useState("");
  const [pedidos, setPedidos] = useState<PedidoErpNoAtendimento[]>([]);
  const [preparado, setPreparado] = useState<NotaPreparada | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [preparando, setPreparando] = useState(false);

  useEffect(() => {
    let cancelado = false;
    if (!podeResponder) {
      setDisponivel(false);
      return;
    }
    void apiClient
      .get<{ data: Array<{ provider: string; enabled: boolean }> }>(
        "/api/v1/integracoes-erp/conexoes",
      )
      .then((r) => {
        if (!cancelado) {
          setDisponivel(r.data.some((c) => c.provider === "vendaerp" && c.enabled));
        }
      })
      .catch(() => {
        if (!cancelado) setDisponivel(false);
      });
    return () => {
      cancelado = true;
    };
  }, [podeResponder]);

  useEffect(() => {
    setPedido("");
    setNfe("");
    setPedidos([]);
    setPreparado(null);
  }, [conversationId]);

  if (!podeResponder || disponivel !== true) return null;

  async function buscarPedido() {
    const codigo = pedido.trim();
    if (!/^\d+$/.test(codigo)) {
      toast.error(t("Informe o número do pedido."));
      return;
    }
    setBuscando(true);
    setPreparado(null);
    try {
      const r = await apiClient.get<{ data: { pedidos: PedidoErpNoAtendimento[] } }>(
        `/api/v1/conversations/${conversationId}/erp?pedido=${encodeURIComponent(codigo)}`,
      );
      setPedidos(r.data.pedidos);
      if (r.data.pedidos.length === 0) toast.info(t("Nenhum pedido encontrado."));
    } catch (erro) {
      showApiError(erro);
    } finally {
      setBuscando(false);
    }
  }

  async function preparar(codigoNfe: number) {
    setPreparando(true);
    setPreparado(null);
    try {
      const r = await apiClient.post<{ data: NotaPreparada }>(
        `/api/v1/conversations/${conversationId}/erp`,
        { codigo_nfe: codigoNfe },
        { timeoutMs: 45_000 },
      );
      setPreparado(r.data);
      setNfe(String(r.data.nota.numero ?? codigoNfe));
    } catch (erro) {
      showApiError(erro);
    } finally {
      setPreparando(false);
    }
  }

  async function prepararDigitada() {
    const codigo = nfeNumerica(nfe);
    if (!codigo) {
      toast.error(t("Informe o número da NFe/NFCe."));
      return;
    }
    await preparar(codigo);
  }

  async function enviarDanfe() {
    if (!preparado) return;
    try {
      const numero = preparado.nota.numero ?? nfeNumerica(nfe);
      await enviar.mutateAsync({
        conversation_id: conversationId,
        type: "document",
        body: numero ? `DANFE da nota fiscal nº ${numero}` : "DANFE",
        media_storage_path: preparado.documento.storage_path,
        media_mime: preparado.documento.media_mime,
        media_size_bytes: preparado.documento.media_size_bytes,
        metadata: {
          source: "integracoes_erp",
          provider: "vendaerp",
          document: "danfe",
          invoice_number: numero,
        },
      });
      toast.success(t("DANFE enviado pelo atendimento."));
      setPreparado(null);
    } catch {
      // useSendMessage já mostra o erro canônico do sender.
    }
  }

  return (
    <>
      <section data-testid="inbox-erp-danfe">
        <h3 className="text-xs font-semibold text-text">{t("VendaERP")}</h3>
        <Card className="mt-2 space-y-3 p-3 text-xs">
          <p className="text-muted-foreground">
            {t(
              "A conversa atual define o cliente e o destino. O ERP apenas fornece pedido e documento.",
            )}
          </p>

          <div className="space-y-1">
            <label className="font-medium" htmlFor={`erp-pedido-${conversationId}`}>
              {t("Pedido")}
            </label>
            <div className="flex gap-2">
              <input
                id={`erp-pedido-${conversationId}`}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5"
                inputMode="numeric"
                value={pedido}
                onChange={(e) => setPedido(e.target.value)}
                placeholder={t("Número do pedido")}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={buscando}
                onClick={() => void buscarPedido()}
              >
                <MagnifyingGlass size={14} aria-hidden />
                <span className="sr-only">{t("Buscar pedido")}</span>
              </Button>
            </div>
          </div>

          {pedidos.length > 0 && (
            <ul className="space-y-2" data-testid="erp-pedidos-encontrados">
              {pedidos.map((p, index) => {
                const codigoNfe = nfeNumerica(p.numeroNFe);
                return (
                  <li
                    key={p.id ?? `${p.codigo ?? "pedido"}-${index}`}
                    className="rounded-md border border-border p-2"
                  >
                    <div className="font-medium">
                      {t("Pedido")} #{p.codigo ?? "—"}
                    </div>
                    <div className="text-muted-foreground">
                      {[p.status, p.statusSistema].filter(Boolean).join(" · ") ||
                        t("Status não informado")}
                    </div>
                    <div className="mt-1">
                      {p.numeroNFe
                        ? `${t("NFe/NFCe")} #${p.numeroNFe}`
                        : t("Sem NFe/NFCe informada")}
                    </div>
                    {codigoNfe && (
                      <Button
                        className="mt-2 h-7 px-2 text-xs"
                        size="sm"
                        variant="outline"
                        disabled={preparando}
                        onClick={() => void preparar(codigoNfe)}
                      >
                        <FileText size={13} className="mr-1" aria-hidden />
                        {t("Preparar DANFE")}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="space-y-1 border-t border-border pt-3">
            <label className="font-medium" htmlFor={`erp-nfe-${conversationId}`}>
              {t("NFe/NFCe")}
            </label>
            <div className="flex gap-2">
              <input
                id={`erp-nfe-${conversationId}`}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5"
                inputMode="numeric"
                value={nfe}
                onChange={(e) => setNfe(e.target.value)}
                placeholder={t("Número da nota")}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={preparando}
                onClick={() => void prepararDigitada()}
              >
                <FileText size={14} aria-hidden />
                <span className="sr-only">{t("Consultar DANFE")}</span>
              </Button>
            </div>
          </div>

          {preparado && (
            <div
              className="space-y-2 rounded-md border border-border p-2"
              data-testid="erp-danfe-preparado"
            >
              <div>
                <div className="font-medium">
                  {t("Nota fiscal")} #{preparado.nota.numero ?? nfe}
                </div>
                <div className="text-muted-foreground">
                  {preparado.nota.mensagemStatus ?? t("Status fiscal não informado")}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
                  <a href={preparado.documento.preview_url} target="_blank" rel="noreferrer">
                    <ArrowSquareOut size={13} className="mr-1" aria-hidden />
                    {t("Visualizar DANFE")}
                  </a>
                </Button>
                <Button
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={enviar.isPending}
                  onClick={() => void enviarDanfe()}
                >
                  <PaperPlaneTilt size={13} className="mr-1" aria-hidden />
                  {t("Enviar DANFE no WhatsApp")}
                </Button>
              </div>
            </div>
          )}
        </Card>
      </section>
      <Separator />
    </>
  );
}
