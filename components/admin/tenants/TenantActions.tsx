"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SuspendDialog } from "./SuspendDialog";
import { ReactivateDialog } from "./ReactivateDialog";
import { ImpersonateButton } from "@/components/admin/ImpersonateButton";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TenantActionsProps {
  organizationId: string;
  status: "active" | "suspended" | "redacted";
  displayName: string;
  aiProviderAdmin: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TenantActions({
  organizationId,
  status,
  displayName,
  aiProviderAdmin,
}: TenantActionsProps) {
  const t = useT();
  const qc = useQueryClient();
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [salvandoIa, setSalvandoIa] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);

  const canSuspend = status === "active";
  const isSuspended = status === "suspended";
  const isRedacted = status === "redacted";

  async function alternarAdministracaoIa() {
    setSalvandoIa(true);
    try {
      await apiClient.patch(`/api/v1/admin/tenants/${organizationId}`, {
        ai_provider_admin: !aiProviderAdmin,
      });
      toast.success(
        t(
          aiProviderAdmin
            ? "Administração avançada de IA revogada."
            : "Administração avançada de IA liberada.",
        ),
      );
      await qc.invalidateQueries({ queryKey: ["admin", "tenant", organizationId] });
    } catch {
      toast.error(t("Não foi possível alterar a administração avançada de IA."));
    } finally {
      setSalvandoIa(false);
    }
  }

  return (
    <>
      <div className="rounded-lg border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          {t("Ações")}
        </h2>

        {/* Impersonate (S-11.07) */}
        <ImpersonateButton
          organizationId={organizationId}
          displayName={displayName}
          disabled={isRedacted}
          disabledReason={
            isRedacted ? t("Tenant redigido — ação não disponível") : undefined
          }
        />

        <div className="space-y-2 rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">{t("Administração avançada de IA")}</p>
            <p className="text-xs text-muted-foreground">
              {aiProviderAdmin
                ? t("Esta empresa pode administrar provedores, modelos e chaves próprias.")
                : t("Esta empresa usa a IA gerenciada pela instalação.")}
            </p>
          </div>
          <Button
            className="w-full"
            variant="outline"
            onClick={() => void alternarAdministracaoIa()}
            disabled={salvandoIa || isRedacted}
          >
            {salvandoIa
              ? t("Salvando…")
              : aiProviderAdmin
                ? t("Revogar administração de IA")
                : t("Liberar administração de IA")}
          </Button>
        </div>

        {/* Suspend */}
        {canSuspend && (
          <Button
            className="w-full"
            variant="destructive"
            onClick={() => setSuspendOpen(true)}
            aria-label={t("Suspender tenant")}
          >
            {t("Suspender tenant")}
          </Button>
        )}

        {/* Reactivate */}
        {isSuspended && (
          <Button
            className="w-full"
            variant="outline"
            onClick={() => setReactivateOpen(true)}
            aria-label={t("Reativar tenant")}
          >
            {t("Reativar tenant")}
          </Button>
        )}

        {isRedacted && (
          <p className="text-xs text-muted-foreground text-center py-2">
            {t("Tenant redigido — ações de gestão não disponíveis.")}
          </p>
        )}
      </div>

      <SuspendDialog
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        organizationId={organizationId}
      />

      <ReactivateDialog
        open={reactivateOpen}
        onClose={() => setReactivateOpen(false)}
        organizationId={organizationId}
      />
    </>
  );
}
