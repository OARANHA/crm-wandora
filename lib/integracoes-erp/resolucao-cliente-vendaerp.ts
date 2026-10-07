import type { SupabaseClient } from "@supabase/supabase-js";

import { conferirContatoComClienteErp } from "./autoridade-documento";
import {
  buscarVinculosClientePorRotulo,
  carregarVinculoClienteExterno,
  normalizarChaveRotuloCliente,
  vincularIdentidadeClienteExterno,
  type AuditoriaVinculoCliente,
  type OrigemResolucaoClienteExterno,
} from "./identidade-externa-cliente";
import { localizarContatosCandidatosClienteErp } from "./identidade-cliente";
import { PROVEDOR_VENDAERP } from "./provedores";
import { buscarClientesErp } from "./service";
import type { ClienteErp } from "./tipos";

export interface SinaisResolucaoClienteVendaErp {
  nome?: string;
  cpfCnpj?: string;
  email?: string;
  contactId?: string;
  limite?: number;
  skip?: number;
}
export interface CandidatoClienteSeguro {
  nome: string | null;
  nomeFantasia: string | null;
  razaoSocial: string | null;
  cidade: string | null;
  uf: string | null;
}
export type ResolucaoClienteVendaErp =
  | {
      status: "resolved";
      contactId: string;
      origem: "existing_link" | "provider";
      materialized: boolean;
      externalLabel: string;
      cliente?: ClienteErp;
    }
  | { status: "ambiguous"; candidatos: CandidatoClienteSeguro[]; motivo: string }
  | { status: "not_found" }
  | {
      status: "unresolved";
      motivo: string;
      candidatos?: CandidatoClienteSeguro[];
      motivoProvider?: string;
    };

const emailKey = (v: string | null | undefined) => v?.trim().toLowerCase() ?? "";
const documentoKey = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
const nomeKey = (v: string | null | undefined) => (v ? normalizarChaveRotuloCliente(v) : "");
function nomesDoCliente(c: ClienteErp) {
  return [c.nome, c.nomeFantasia, c.razaoSocial]
    .map(nomeKey)
    .filter((v, i, all) => Boolean(v) && all.indexOf(v) === i);
}
function tokensDoNome(v: string | null | undefined): string[] {
  return nomeKey(v)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
function contemSequenciaDeTokens(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let inicio = 0; inicio <= haystack.length - needle.length; inicio += 1) {
    if (needle.every((token, offset) => haystack[inicio + offset] === token)) return true;
  }
  return false;
}
function candidatoSeguro(c: ClienteErp): CandidatoClienteSeguro {
  return {
    nome: c.nome,
    nomeFantasia: c.nomeFantasia,
    razaoSocial: c.razaoSocial,
    cidade: c.cidade,
    uf: c.uf,
  };
}
export function selecionarClientesVendaErpExatos(
  sinais: SinaisResolucaoClienteVendaErp,
  clientes: readonly ClienteErp[],
): ClienteErp[] {
  const nome = nomeKey(sinais.nome),
    documento = documentoKey(sinais.cpfCnpj),
    email = emailKey(sinais.email);
  return clientes.filter((c) => {
    if (nome && !nomesDoCliente(c).includes(nome)) return false;
    if (documento && documentoKey(c.cpfCnpj) !== documento) return false;
    if (email && emailKey(c.email) !== email) return false;
    return true;
  });
}

/**
 * Fallback seguro para busca SOMENTE por nome.
 *
 * O VendaERP pode devolver "ECO PROJETOS ENGENHARIA LTDA" para a busca
 * "Eco Projetos". Isso só autoriza resolução quando a busca tem pelo menos
 * dois tokens e UM único candidato contém a sequência inteira.
 */
export function selecionarClientesVendaErpCompativeisPorNome(
  nome: string,
  clientes: readonly ClienteErp[],
): ClienteErp[] {
  const procurados = tokensDoNome(nome);
  if (procurados.length < 2) return [];

  return clientes.filter((cliente) =>
    [cliente.nome, cliente.nomeFantasia, cliente.razaoSocial].some((rotulo) =>
      contemSequenciaDeTokens(tokensDoNome(rotulo), procurados),
    ),
  );
}
function origemDosSinais(s: SinaisResolucaoClienteVendaErp): OrigemResolucaoClienteExterno {
  if (s.cpfCnpj) return "exact_document";
  if (s.email) return "exact_email";
  return "exact_name";
}
function rotuloExterno(
  s: SinaisResolucaoClienteVendaErp,
  c: ClienteErp,
  origem: OrigemResolucaoClienteExterno,
) {
  const rotuloProvider =
    c.nomeFantasia?.trim() || c.razaoSocial?.trim() || c.nome?.trim() || null;
  return origem === "provider_unique_name" ? rotuloProvider : s.nome?.trim() || rotuloProvider;
}
function rotuloLookupProvider(c: ClienteErp) {
  // Pedidos/Pesquisar aceita Nome/Razão Social; pessoaID ainda revalida o retorno.
  return c.razaoSocial?.trim() || c.nome?.trim() || c.nomeFantasia?.trim() || null;
}

export async function resolverClienteVendaErp(
  db: SupabaseClient,
  organizationId: string,
  sinais: SinaisResolucaoClienteVendaErp,
  auditoria?: AuditoriaVinculoCliente,
): Promise<ResolucaoClienteVendaErp> {
  const nomeInformado = sinais.nome?.trim();
  const temNome = Boolean(nomeInformado);
  const temDocumento = Boolean(sinais.cpfCnpj?.trim());
  const temEmail = Boolean(sinais.email?.trim());
  const temSinalDeDescoberta = temNome || temDocumento || temEmail;

  if (sinais.contactId && temSinalDeDescoberta) {
    return { status: "unresolved", motivo: "sinais_conflitantes" };
  }
  if (!sinais.contactId && !temSinalDeDescoberta) {
    return { status: "unresolved", motivo: "sinais_insuficientes" };
  }

  if (sinais.contactId) {
    const existente = await carregarVinculoClienteExterno(db, {
      organizationId,
      contactId: sinais.contactId,
      provider: PROVEDOR_VENDAERP.id,
    });
    if (!existente.ok) return { status: "unresolved", motivo: "banco" };
    if (!existente.vinculo) return { status: "unresolved", motivo: "vinculo_nao_encontrado" };
    return {
      status: "resolved",
      contactId: existente.vinculo.contactId,
      origem: "existing_link",
      materialized: false,
      externalLabel: existente.vinculo.externalLabel,
    };
  }

  // Atalho local por rótulo só existe para busca por NOME PURO.
  // CPF/CNPJ/e-mail são sinais mais fortes e não podem ser ignorados por um
  // vínculo antigo que por acaso compartilha o mesmo rótulo.
  if (temNome && !temDocumento && !temEmail) {
    const existentes = await buscarVinculosClientePorRotulo(db, {
      organizationId,
      provider: PROVEDOR_VENDAERP.id,
      rotulo: nomeInformado!,
    });
    if (!existentes.ok) return { status: "unresolved", motivo: "banco" };
    if (existentes.vinculos.length > 1) {
      return {
        status: "ambiguous",
        motivo: "mais_de_um_vinculo_local",
        candidatos: existentes.vinculos.map((v) => ({
          nome: v.externalLabel,
          nomeFantasia: null,
          razaoSocial: null,
          cidade: null,
          uf: null,
        })),
      };
    }
    if (existentes.vinculos.length === 1) {
      const v = existentes.vinculos[0]!;
      return {
        status: "resolved",
        contactId: v.contactId,
        origem: "existing_link",
        materialized: false,
        externalLabel: v.externalLabel,
      };
    }
  }

  const resposta = await buscarClientesErp(db, organizationId, {
    nomefantasia: sinais.nome,
    cpfcnpj: sinais.cpfCnpj,
    email: sinais.email,
    pageSize: sinais.limite ?? 10,
    skip: sinais.skip ?? 0,
  });
  if (!resposta.ok)
    return { status: "unresolved", motivo: "provider_error", motivoProvider: resposta.motivo };
  if (resposta.dados.length === 0) return { status: "not_found" };

  const exatos = selecionarClientesVendaErpExatos(sinais, resposta.dados);
  if (exatos.length > 1)
    return {
      status: "ambiguous",
      motivo: "mais_de_um_cliente_exato",
      candidatos: exatos.slice(0, 5).map(candidatoSeguro),
    };

  let resolvidos = exatos;
  let origem = origemDosSinais(sinais);

  // CPF/CNPJ e e-mail continuam exatos. O fallback vale só para nome puro.
  if (resolvidos.length === 0 && temNome && !temDocumento && !temEmail) {
    const compativeis = selecionarClientesVendaErpCompativeisPorNome(
      nomeInformado!,
      resposta.dados,
    );
    if (compativeis.length > 1)
      return {
        status: "ambiguous",
        motivo: "mais_de_um_cliente_compativel",
        candidatos: compativeis.slice(0, 5).map(candidatoSeguro),
      };
    if (compativeis.length === 1) {
      resolvidos = compativeis;
      origem = "provider_unique_name";
    }
  }

  if (resolvidos.length === 0)
    return {
      status: "unresolved",
      motivo: "sem_correspondencia_exata",
      candidatos: resposta.dados.slice(0, 5).map(candidatoSeguro),
    };

  const cliente = resolvidos[0]!;
  const externalId = cliente.id?.trim();
  const externalLabel = rotuloExterno(sinais, cliente, origem);
  const providerLookupLabel = rotuloLookupProvider(cliente);
  if (!externalId || !externalLabel || !providerLookupLabel)
    return {
      status: "unresolved",
      motivo: "identidade_provider_insuficiente",
      candidatos: [candidatoSeguro(cliente)],
    };

  const locais = await localizarContatosCandidatosClienteErp(db, organizationId, cliente);
  if (!locais.ok) return { status: "unresolved", motivo: "banco" };
  const confirmados = locais.contatos.filter(
    (contato) => conferirContatoComClienteErp(contato, cliente).ok,
  );
  if (confirmados.length > 1)
    return {
      status: "ambiguous",
      motivo: "mais_de_um_contato_local",
      candidatos: [candidatoSeguro(cliente)],
    };
  if (confirmados.length === 0 && locais.contatos.length > 0)
    return {
      status: "unresolved",
      motivo: "identidade_local_inconsistente",
      candidatos: [candidatoSeguro(cliente)],
    };

  const vinculo = await vincularIdentidadeClienteExterno(db, {
    organizationId,
    contactId: confirmados[0]?.id ?? null,
    provider: PROVEDOR_VENDAERP.id,
    externalId,
    externalLabel,
    providerLookupLabel,
    resolutionOrigin: confirmados[0] ? "existing_contact" : origem,
    evidence: {
      signal_types: [
        ...(sinais.cpfCnpj ? ["document"] : []),
        ...(sinais.email ? ["email"] : []),
        ...(sinais.nome ? ["name"] : []),
      ],
      match_strategy: origem,
    },
    auditoria,
  });
  if (!vinculo.ok)
    return {
      status: "unresolved",
      motivo:
        vinculo.motivo === "conflito"
          ? "conflito_de_vinculo"
          : vinculo.motivo === "contato_invalido"
            ? "contato_local_invalido"
            : "banco",
    };
  return {
    status: "resolved",
    contactId: vinculo.vinculo.contactId,
    origem: "provider",
    materialized: vinculo.createdContact,
    externalLabel: vinculo.vinculo.externalLabel,
    cliente,
  };
}
