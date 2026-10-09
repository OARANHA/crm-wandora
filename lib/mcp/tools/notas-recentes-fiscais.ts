/**
 * Busca fiscal administrativa: reaproveita o provider VendaERP, resolução de
 * identidade e autorização existentes. Não recebe nem retorna XML ou URL externa.
 */
import { z } from "zod";

import { buscarUltimasNfesFiscais } from "@/lib/integracoes-erp/busca-notas-recentes-fiscais";
import { comprovarDocumentoFiscalDoVinculo, documentoFiscalValido } from "@/lib/integracoes-erp/identidade-fiscal-vinculo";
import { carregarVinculoClienteExterno } from "@/lib/integracoes-erp/identidade-externa-cliente";
import { PROVEDOR_VENDAERP } from "@/lib/integracoes-erp/provedores";
import { resolverClienteVendaErp } from "@/lib/integracoes-erp/resolucao-cliente-vendaerp";

import type { McpToolDefinition } from "../types";
import {
  erroFiscalRecenteParaAuditoria,
  vazioFiscalRecenteParaAuditoria,
} from "./auditoria-notas-recentes-fiscais";

const inputShape = {
  quantidade: z.number().int().min(1).max(20).optional().default(3),
  cliente: z.string().trim().min(2).max(200).optional(),
  cpf_cnpj: z.string().trim().min(11).max(30).optional(),
  cliente_contact_id: z.string().uuid().optional(),
  mes_ano: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
};

export const crmErpSearchRecentInvoices: McpToolDefinition<typeof inputShape> = {
  name: "crm_erp_search_recent_invoices",
  description:
    "Localiza as últimas N NFes EMITIDAS por data fiscal comprovada, com PDFs a enviar pela tool de DANFE. Sem quantidade, retorna até 3; para mais de 3, solicite mes_ano (AAAA-MM) antes de consultar. Aceita opcionalmente nome, CPF/CNPJ ou cliente_contact_id. Sem cliente busca NFes emitidas para qualquer destinatário. Varre meses de trás para frente, página por página, sem usar número de NFe como data. Se não puder provar recência, retorna erro; não invente ausência.",
  inputSchema: inputShape,
  category: "read",
  erroParaAuditoria: erroFiscalRecenteParaAuditoria,
  motivoDoVazio: vazioFiscalRecenteParaAuditoria,
  requiresRole: "agent",
  requiresScope: "mcp:read",
  redigirParaAuditoria: (args) =>
    Object.fromEntries(
      Object.entries(args).map(([k, v]) =>
        ["cliente", "cpf_cnpj", "cliente_contact_id"].includes(k) && v !== undefined
          ? [k, "[redigido]"]
          : [k, v],
      ),
    ),
  handler: async (input, ctx) => {
    if (input.quantidade > 3 && !input.mes_ano) {
      return {
        erro: "mes_necessario",
        mensagem: "Para mais de 3 NFes, informe o mês e o ano (por exemplo, agosto de 2026).",
      };
    }

    const alvos = [input.cliente, input.cpf_cnpj, input.cliente_contact_id].filter(Boolean);
    if (alvos.length > 1)
      return {
        erro: "filtros_cliente_conflitantes",
        mensagem: "Informe somente um identificador de cliente.",
      };

    let documento: string | undefined;
    let contactId: string | undefined;
    if (alvos.length) {
      const resolucao = await resolverClienteVendaErp(
        ctx.supabase,
        ctx.organizationId,
        { nome: input.cliente, cpfCnpj: input.cpf_cnpj, contactId: input.cliente_contact_id },
        {
          actorUserId: ctx.actor.type === "user" ? ctx.actor.id : null,
          actorApiTokenId: ctx.actor.type === "user" ? null : ctx.apiTokenId,
          requestId: ctx.requestId,
        },
      );
      if (resolucao.status !== "resolved") {
        return {
          erro: resolucao.status === "ambiguous" ? "cliente_ambiguo" : "cliente_nao_resolvido",
          mensagem:
            "Não foi possível comprovar uma identidade única no VendaERP; confirme o CPF/CNPJ do cliente.",
          resolucao_cliente: { status: resolucao.status },
        };
      }
      contactId = resolucao.contactId;
      documento = documentoFiscalValido(resolucao.cliente?.cpfCnpj) ?? undefined;
      if (!documento) {
        // Vínculos antigos armazenam ID externo, mas não o documento fiscal.
        // Prova estrita: Pessoa.id ou Pedido.pessoaID, nunca rótulo.
        const vinculo = await carregarVinculoClienteExterno(ctx.supabase, {
          organizationId: ctx.organizationId,
          contactId,
          provider: PROVEDOR_VENDAERP.id,
        });
        if (!vinculo.ok || !vinculo.vinculo)
          return { erro: "cliente_nao_resolvido", mensagem: "Vínculo ERP indisponível." };
        const prova = await comprovarDocumentoFiscalDoVinculo(
          ctx.supabase,
          ctx.organizationId,
          vinculo.vinculo,
        );
        if (!prova.ok) {
          return {
            erro: prova.motivo,
            mensagem:
              prova.motivo === "consulta_parcial"
                ? "A paginação dos pedidos não comprovou a identidade fiscal; confirme o CPF/CNPJ."
                : prova.motivo === "erp_read_failed"
                  ? "Não foi possível consultar a identidade fiscal no VendaERP."
                  : "Não há CPF/CNPJ comprovado para este vínculo. Confirme o documento fiscal.",
          };
        }
        documento = prova.documento;
      }
      if (!documento || ![11, 14].includes(documento.length))
        return {
          erro: "identidade_fiscal_nao_confirmada",
          mensagem: "O cliente não possui documento fiscal utilizável no ERP.",
        };
    }

    const resultado = await buscarUltimasNfesFiscais(ctx.supabase, ctx.organizationId, {
      quantidade: input.quantidade,
      documento,
      mesAno: input.mes_ano,
    });
    if (!resultado.ok) {
      return {
        erro: resultado.motivo,
        mensagem:
          resultado.motivo === "janela_fiscal_insuficiente" ||
          resultado.motivo === "consulta_parcial"
            ? "A pesquisa não comprovou a recência dentro dos limites de segurança. Informe mês e ano para uma consulta direcionada."
            : "Não foi possível concluir a pesquisa fiscal no VendaERP.",
        ...(resultado.detalhes ? { detalhes: resultado.detalhes } : {}),
      };
    }
    return {
      ...(contactId ? { resolucao_cliente: { status: "resolved", contact_id: contactId } } : {}),
      notas: resultado.dados.notas.map((n) => ({
        numeroNFe: String(n.numero),
        serie: n.serie,
        dataEmissao: n.dataEmissao,
        danfeDisponivel: n.danfeDisponivel,
      })),
      resumo: {
        quantidadeSolicitada: input.quantidade,
        quantidadeRetornada: resultado.dados.notas.length,
        mesesConsultados: resultado.dados.mesesConsultados,
        consultaCompleta: true,
      },
    };
  },
};
