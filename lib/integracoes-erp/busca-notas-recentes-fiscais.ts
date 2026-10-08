import type { SupabaseClient } from "@supabase/supabase-js";

import { selecionarNotasRecentes, type NotaFiscalPeriodoErp } from "./notas-fiscais-periodo";
import { buscarNfesPeriodoErp, type ConsultaErpResultado } from "./service";

export interface ResultadoNotasRecentesFiscais {
  notas: NotaFiscalPeriodoErp[];
  mesesConsultados: string[];
  quantidadeSolicitada: number;
  consultaCompleta: true;
}

const PAGINA = 50;
const LIMITE_PAGINAS_MES = 12;
const LIMITE_PAGINAS_TOTAL = 24;

function hojeBrasil(agora: Date) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(agora);
  const ler = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  return { ano: ler("year"), mes: ler("month"), dia: ler("day") };
}

export function intervaloFiscal(ano: number, mes: number, diaFinal?: number) {
  const mm = String(mes).padStart(2, "0");
  const dia = diaFinal ?? new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return {
    codigo: String(ano) + "-" + mm,
    dataInicial: mm + "-01-" + ano,
    dataFinal: mm + "-" + String(dia).padStart(2, "0") + "-" + ano,
  };
}

export async function buscarUltimasNfesFiscais(
  db: SupabaseClient,
  organizationId: string,
  opcoes: { quantidade: number; documento?: string; mesAno?: string; agora?: Date },
): Promise<ConsultaErpResultado<ResultadoNotasRecentesFiscais>> {
  const { quantidade, documento, mesAno } = opcoes;
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 20)
    return { ok: false, motivo: "quantidade_invalida" };
  if (quantidade > 3 && !mesAno) return { ok: false, motivo: "mes_necessario" };
  const hoje = hojeBrasil(opcoes.agora ?? new Date());
  const meses: ReturnType<typeof intervaloFiscal>[] = [];
  if (mesAno) {
    const partes = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(mesAno);
    if (!partes) return { ok: false, motivo: "mes_invalido" };
    const ano = Number(partes[1]),
      mes = Number(partes[2]);
    if (ano > hoje.ano || (ano === hoje.ano && mes > hoje.mes))
      return { ok: false, motivo: "mes_invalido" };
    meses.push(
      intervaloFiscal(ano, mes, ano === hoje.ano && mes === hoje.mes ? hoje.dia : undefined),
    );
  } else {
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.UTC(hoje.ano, hoje.mes - i - 1, 1));
      meses.push(
        intervaloFiscal(d.getUTCFullYear(), d.getUTCMonth() + 1, i === 0 ? hoje.dia : undefined),
      );
    }
  }

  const encontradas: NotaFiscalPeriodoErp[] = [];
  const mesesConsultados: string[] = [];
  let paginasTotais = 0;
  for (const mes of meses) {
    let skip = 0,
      completa = false;
    for (let pagina = 0; pagina < LIMITE_PAGINAS_MES; pagina++) {
      if (++paginasTotais > LIMITE_PAGINAS_TOTAL)
        return { ok: false, motivo: "consulta_parcial", detalhes: { mesesConsultados } };
      const resposta = await buscarNfesPeriodoErp(db, organizationId, {
        dataInicial: mes.dataInicial,
        dataFinal: mes.dataFinal,
        pageSize: PAGINA,
        skip,
      });
      if (!resposta.ok) return resposta;
      const { notas, retornados } = resposta.dados;
      if (!Number.isInteger(retornados) || retornados < 0 || retornados > PAGINA)
        return { ok: false, motivo: "invalid_response" };
      if (
        notas.some((n) => {
          const d = new Date(n.instanteFiscal);
          return (
            d.getUTCFullYear() !== Number(mes.codigo.slice(0, 4)) ||
            d.getUTCMonth() + 1 !== Number(mes.codigo.slice(5, 7))
          );
        })
      )
        return { ok: false, motivo: "consulta_inconsistente" };
      encontradas.push(...notas);
      skip += retornados;
      if (retornados < PAGINA) {
        completa = true;
        break;
      }
    }
    if (!completa)
      return { ok: false, motivo: "consulta_parcial", detalhes: { mesesConsultados } };
    mesesConsultados.push(mes.codigo);
    let selecionadas: NotaFiscalPeriodoErp[];
    try {
      selecionadas = selecionarNotasRecentes(encontradas, quantidade, documento);
    } catch {
      return { ok: false, motivo: "invalid_response" };
    }
    if (mesAno || selecionadas.length >= quantidade)
      return {
        ok: true,
        dados: {
          notas: selecionadas,
          mesesConsultados,
          quantidadeSolicitada: quantidade,
          consultaCompleta: true,
        },
      };
  }
  return { ok: false, motivo: "janela_fiscal_insuficiente", detalhes: { mesesConsultados } };
}
