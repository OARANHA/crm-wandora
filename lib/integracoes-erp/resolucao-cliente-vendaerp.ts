import type { SupabaseClient } from "@supabase/supabase-js";

import { conferirContatoComClienteErp } from "./autoridade-documento";
import {
  buscarVinculosClientePorRotulo,
  carregarVinculoClienteExterno,
  carregarVinculoClienteExternoPorIdExterno,
  normalizarChaveRotuloCliente,
  vincularIdentidadeClienteExterno,
  type AuditoriaVinculoCliente,
  type OrigemResolucaoClienteExterno,
} from "./identidade-externa-cliente";
import { localizarContatosCandidatosClienteErp } from "./identidade-cliente";
import { PROVEDOR_VENDAERP } from "./provedores";
import { buscarClientesErp, type PedidoErpComIdentidadeInterna } from "./service";
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
function origemDosSinais(s: SinaisResolucaoClienteVendaErp): OrigemResolucaoClienteExterno {
  if (s.cpfCnpj) return "exact_document";
  if (s.email) return "exact_email";
  return "exact_name";
}
function rotuloExterno(s: SinaisResolucaoClienteVendaErp, c: ClienteErp) {
  return (
    s.nome?.trim() || c.nome?.trim() || c.nomeFantasia?.trim() || c.razaoSocial?.trim() || null
  );
}
function rotuloLookupProvider(c: ClienteErp) {
  // Pedidos/Pesquisar aceita Nome/Razão Social; pessoaID ainda revalida o retorno.
  return c.razaoSocial?.trim() || c.nome?.trim() || c.nomeFantasia?.trim() || null;
}

export async function resolverClienteVendaErpPorPedidos(
  db: SupabaseClient,
  organizationId: string,
  nomeConsultado: string,
  pedidos: readonly PedidoErpComIdentidadeInterna[],
  auditoria?: AuditoriaVinculoCliente,
): Promise<ResolucaoClienteVendaErp> {
  const nome = nomeConsultado.trim();
  if (!nome) return { status: "unresolved", motivo: "sinais_insuficientes" };
  if (pedidos.length === 0) return { status: "unresolved", motivo: "pedidos_nao_encontrados" };

  const pessoaIds = pedidos.map((item) => item.identidadeCliente.pessoaId?.trim() ?? "");
  const idsPreenchidos = pessoaIds.filter((id): id is string => Boolean(id));
  const idsUnicos = [...new Set(idsPreenchidos)];
  if (idsUnicos.length > 1) {
    const candidatos = idsUnicos.slice(0, 5).map((id) => {
      const pedido = pedidos.find((item) => item.identidadeCliente.pessoaId?.trim() === id);
      return {
        nome: pedido?.pedido.cliente ?? nome,
        nomeFantasia: null,
        razaoSocial: null,
        cidade: null,
        uf: null,
      };
    });
    return {
      status: "ambiguous",
      motivo: "mais_de_um_cliente_nos_pedidos",
      candidatos,
    };
  }

  const documentos = new Map<string, string>();
  const emails = new Map<string, string>();
  for (const item of pedidos) {
    const documentoOriginal = item.identidadeCliente.cpfCnpj?.trim();
    const documento = documentoKey(documentoOriginal);
    if (documento && documentoOriginal) documentos.set(documento, documentoOriginal);

    const emailOriginal = item.identidadeCliente.email?.trim();
    const email = emailKey(emailOriginal);
    if (email && emailOriginal) emails.set(email, emailOriginal);
  }

  const todosComPessoaId = pessoaIds.every(Boolean) && idsUnicos.length === 1;
  let clienteDoPedido: ClienteErp;
  let externalId: string;
  let externalLabel: string;
  let providerLookupLabel: string;
  let origemSemContato: OrigemResolucaoClienteExterno;
  let identityField: "pessoaID" | "clienteCNPJ" | "clienteEmail";

  if (todosComPessoaId) {
    externalId = idsUnicos[0]!;
    clienteDoPedido = {
      id: externalId,
      nome,
      nomeFantasia: nome,
      razaoSocial: null,
      cpfCnpj: documentos.size === 1 ? [...documentos.values()][0]! : null,
      email: emails.size === 1 ? [...emails.values()][0]! : null,
      telefone: null,
      celular: null,
      cidade: null,
      uf: null,
    };
    externalLabel = nome;
    providerLookupLabel = nome;
    origemSemContato = "exact_name";
    identityField = "pessoaID";
  } else {
    // Se pessoaID vier ausente em parte ou em todos os pedidos, não voltamos à
    // varredura ampla por nome. Usamos no máximo uma consulta direta por sinal
    // forte já contido no próprio Pedido e exigimos correspondência exata local.
    if (documentos.size > 1 || emails.size > 1) {
      return { status: "unresolved", motivo: "identidade_pedido_inconsistente" };
    }

    const cpfCnpj = [...documentos.values()][0] ?? null;
    const email = [...emails.values()][0] ?? null;
    if (!cpfCnpj && !email) {
      return { status: "unresolved", motivo: "identidade_pedido_incompleta" };
    }

    const sinaisFortes: SinaisResolucaoClienteVendaErp = {
      ...(cpfCnpj ? { cpfCnpj } : {}),
      ...(email ? { email } : {}),
    };
    const resposta = await buscarClientesErp(db, organizationId, {
      ...(cpfCnpj ? { cpfcnpj: cpfCnpj } : { email: email! }),
      pageSize: 20,
      skip: 0,
    });
    if (!resposta.ok) {
      return {
        status: "unresolved",
        motivo: "identidade_pedido_fallback_provider_error",
        motivoProvider: resposta.motivo,
      };
    }

    const exatos = selecionarClientesVendaErpExatos(sinaisFortes, resposta.dados);
    if (exatos.length === 0) {
      return {
        status: "unresolved",
        motivo:
          resposta.dados.length === 0
            ? "identidade_pedido_fallback_nao_encontrado"
            : "identidade_pedido_fallback_sem_correspondencia_exata",
        ...(resposta.dados.length > 0
          ? { candidatos: resposta.dados.slice(0, 5).map(candidatoSeguro) }
          : {}),
      };
    }
    if (exatos.length > 1) {
      return {
        status: "ambiguous",
        motivo: "mais_de_um_cliente_exato_pelos_sinais_do_pedido",
        candidatos: exatos.slice(0, 5).map(candidatoSeguro),
      };
    }

    const cliente = exatos[0]!;
    const idResolvido = cliente.id?.trim();
    const labelResolvido = rotuloExterno(sinaisFortes, cliente);
    const lookupResolvido = rotuloLookupProvider(cliente);
    if (!idResolvido || !labelResolvido || !lookupResolvido) {
      return {
        status: "unresolved",
        motivo: "identidade_provider_insuficiente",
        candidatos: [candidatoSeguro(cliente)],
      };
    }

    if (idsUnicos.length === 1 && idsUnicos[0] !== idResolvido) {
      return { status: "unresolved", motivo: "identidade_pedido_inconsistente" };
    }

    clienteDoPedido = cliente;
    externalId = idResolvido;
    externalLabel = labelResolvido;
    providerLookupLabel = lookupResolvido;
    origemSemContato = cpfCnpj ? "exact_document" : "exact_email";
    identityField = cpfCnpj ? "clienteCNPJ" : "clienteEmail";
  }

  const existente = await carregarVinculoClienteExternoPorIdExterno(db, {
    organizationId,
    provider: PROVEDOR_VENDAERP.id,
    externalId,
  });
  if (!existente.ok) return { status: "unresolved", motivo: "banco" };

  let contactId = existente.vinculo?.contactId ?? null;
  if (!contactId) {
    const locais = await localizarContatosCandidatosClienteErp(db, organizationId, clienteDoPedido);
    if (!locais.ok) return { status: "unresolved", motivo: "banco" };

    const confirmados = locais.contatos.filter(
      (contato) => conferirContatoComClienteErp(contato, clienteDoPedido).ok,
    );
    if (confirmados.length > 1) {
      return {
        status: "ambiguous",
        motivo: "mais_de_um_contato_local",
        candidatos: [candidatoSeguro(clienteDoPedido)],
      };
    }
    if (confirmados.length === 0 && locais.contatos.length > 0) {
      return {
        status: "unresolved",
        motivo: "identidade_local_inconsistente",
        candidatos: [candidatoSeguro(clienteDoPedido)],
      };
    }
    contactId = confirmados[0]?.id ?? null;
  }

  const vinculo = await vincularIdentidadeClienteExterno(db, {
    organizationId,
    contactId,
    provider: PROVEDOR_VENDAERP.id,
    externalId,
    externalLabel,
    providerLookupLabel,
    resolutionOrigin: contactId ? "existing_contact" : origemSemContato,
    evidence: {
      source: "orders_search",
      identity_field: identityField,
      matched_orders: pedidos.length,
      pessoa_id_present_count: idsPreenchidos.length,
      has_document: documentos.size === 1,
      has_email: emails.size === 1,
    },
    auditoria,
  });

  if (!vinculo.ok) {
    return {
      status: "unresolved",
      motivo:
        vinculo.motivo === "conflito"
          ? "conflito_de_vinculo"
          : vinculo.motivo === "contato_invalido"
            ? "contato_local_invalido"
            : "banco",
    };
  }

  return {
    status: "resolved",
    contactId: vinculo.vinculo.contactId,
    origem: existente.vinculo ? "existing_link" : "provider",
    materialized: vinculo.createdContact,
    externalLabel: vinculo.vinculo.externalLabel,
    cliente: clienteDoPedido,
  };
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

  let exatos = selecionarClientesVendaErpExatos(sinais, resposta.dados);
  const buscaSomentePorNome = temNome && !temDocumento && !temEmail;
  let varreduraNomeCompleta = false;

  // Pessoas/Pesquisar não documenta filtro por razão social. Se a busca direta
  // por nome fantasia não encontra correspondência exata, fazemos uma varredura
  // paginada e LIMITADA só de clientes, comparando nomeFantasia e razaoSocial
  // no backend. Nunca inventamos um parâmetro provider-side.
  if (buscaSomentePorNome && exatos.length === 0) {
    const pageSize = 100;
    const maxPages = 5;
    const encontrados = new Map<string, ClienteErp>();

    for (let pagina = 0; pagina < maxPages; pagina += 1) {
      const paginaErp = await buscarClientesErp(db, organizationId, {
        pageSize,
        skip: pagina * pageSize,
      });
      if (!paginaErp.ok) {
        // A busca direta por nome já respondeu. A varredura ampla é um fallback
        // opcional para alcançar razão social, e não pode transformar um timeout
        // dessa segunda etapa em "o cadastro está indisponível". Falhamos fechado:
        // identidade continua NÃO resolvida, mas preservamos os candidatos seguros
        // da busca direta para o agente pedir confirmação/identificador forte.
        if (paginaErp.motivo === "timeout") {
          const candidatos = resposta.dados.slice(0, 5).map(candidatoSeguro);
          return {
            status: "unresolved",
            motivo: "busca_nome_incompleta",
            ...(candidatos.length > 0 ? { candidatos } : {}),
          };
        }
        return {
          status: "unresolved",
          motivo: "provider_error",
          motivoProvider: paginaErp.motivo,
        };
      }

      const destaPagina = selecionarClientesVendaErpExatos(sinais, paginaErp.dados);
      destaPagina.forEach((cliente, indice) => {
        const chave = cliente.id?.trim() || `sem-id:${pagina}:${indice}`;
        encontrados.set(chave, cliente);
      });

      if (paginaErp.dados.length < pageSize) {
        varreduraNomeCompleta = true;
        break;
      }
    }

    exatos = [...encontrados.values()];

    if (!varreduraNomeCompleta && exatos.length <= 1) {
      return {
        status: "unresolved",
        motivo: "busca_nome_incompleta",
        ...(exatos.length === 1 ? { candidatos: [candidatoSeguro(exatos[0]!)] } : {}),
      };
    }
  }

  if (exatos.length === 0) {
    if (buscaSomentePorNome && varreduraNomeCompleta) return { status: "not_found" };
    if (!buscaSomentePorNome && resposta.dados.length === 0) return { status: "not_found" };
    return {
      status: "unresolved",
      motivo: "sem_correspondencia_exata",
      candidatos: resposta.dados.slice(0, 5).map(candidatoSeguro),
    };
  }
  if (exatos.length > 1)
    return {
      status: "ambiguous",
      motivo: "mais_de_um_cliente_exato",
      candidatos: exatos.slice(0, 5).map(candidatoSeguro),
    };

  const cliente = exatos[0]!;
  const externalId = cliente.id?.trim();
  const externalLabel = rotuloExterno(sinais, cliente);
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

  const origem = origemDosSinais(sinais);
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
