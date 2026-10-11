import type { SupabaseClient } from "@supabase/supabase-js";

import { selecionarNotasRecentes, type NotaFiscalPeriodoErp } from "./notas-fiscais-periodo";
import { buscarNfesPeriodoErp, type ConsultaErpResultado } from "./service";

export interface ResultadoNotasRecentesFiscais {
  notas: NotaFiscalPeriodoErp[];
  mesesConsultados: string[];
  periodoConsultado: { dataInicio: string; dataFim: string };
  quantidadeSolicitada: number;
  consultaCompleta: true;
}

const PAGINA = 50;
const LIMITE_PAGINAS_INTERVALO = 12;
const LIMITE_PAGINAS_TOTAL = 24;
const DIA_MS = 86_400_000;

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

function dataIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function lerDataIso(data: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
  const [ano, mes, dia] = data.split("-").map(Number);
  const instante = Date.UTC(ano, mes - 1, dia);
  return dataIso(instante) === data ? instante : null;
}

function dataVendaErp(ms: number): string {
  const iso = dataIso(ms);
  return iso.slice(5, 7) + "-" + iso.slice(8, 10) + "-" + iso.slice(0, 4);
}

interface IntervaloFiscal {
  codigo: string;
  inicio: number;
  fim: number;
  dataInicial: string;
  dataFinal: string;
}

/** Busca padrão dos últimos 30 dias civis incluindo hoje (Brasília), sem regressão. */
export function planejarBuscaFiscal(opcoes: {
  agora?: Date;
  mesAno?: string;
  dataInicio?: string;
  dataFim?: string;
}): { ok: true; intervalos: IntervaloFiscal[]; periodoConsultado: { dataInicio: string; dataFim: string } } |
  { ok: false; motivo: "periodo_invalido" | "periodo_incompleto" | "periodo_excede_limite" } {
  const hoje = hojeBrasil(opcoes.agora ?? new Date());
  const hojeMs = Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia);
  const temInicio = opcoes.dataInicio !== undefined;
  const temFim = opcoes.dataFim !== undefined;
  if (opcoes.mesAno && (temInicio || temFim)) return { ok: false, motivo: "periodo_invalido" };
  if (temInicio !== temFim) return { ok: false, motivo: "periodo_incompleto" };
  let inicio: number;
  let fim: number;
  if (opcoes.mesAno) {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(opcoes.mesAno);
    if (!match) return { ok: false, motivo: "periodo_invalido" };
    inicio = Date.UTC(Number(match[1]), Number(match[2]) - 1, 1);
    fim = Date.UTC(Number(match[1]), Number(match[2]), 0);
    if (inicio > hojeMs) return { ok: false, motivo: "periodo_invalido" };
    fim = Math.min(fim, hojeMs);
  } else if (temInicio && temFim) {
    const de = lerDataIso(opcoes.dataInicio!);
    const ate = lerDataIso(opcoes.dataFim!);
    if (de === null || ate === null || de > ate || ate > hojeMs)
      return { ok: false, motivo: "periodo_invalido" };
    if (ate - de >= 30 * DIA_MS)
      return { ok: false, motivo: "periodo_excede_limite" };
    inicio = de;
    fim = ate;
  } else {
    inicio = hojeMs - 29 * DIA_MS;
    fim = hojeMs;
  }

  const intervalos: IntervaloFiscal[] = [];
  let cursor = fim;
  while (cursor >= inicio) {
    const fimData = new Date(cursor);
    const inicioMes = Date.UTC(fimData.getUTCFullYear(), fimData.getUTCMonth(), 1);
    const trechoInicio = Math.max(inicio, inicioMes, cursor - 29 * DIA_MS);
    intervalos.push({
      codigo: dataIso(cursor).slice(0, 7),
      inicio: trechoInicio,
      fim: cursor,
      dataInicial: dataVendaErp(trechoInicio),
      dataFinal: dataVendaErp(cursor),
    });
    cursor = trechoInicio - DIA_MS;
  }
  return {
    ok: true,
    intervalos,
    periodoConsultado: { dataInicio: dataIso(inicio), dataFim: dataIso(fim) },
  };
}

export async function buscarUltimasNfesFiscais(
  db: SupabaseClient,
  organizationId: string,
  opcoes: {
    quantidade: number;
    documento?: string;
    mesAno?: string;
    dataInicio?: string;
    dataFim?: string;
    agora?: Date;
  },
): Promise<ConsultaErpResultado<ResultadoNotasRecentesFiscais>> {
  if (!Number.isInteger(opcoes.quantidade) || opcoes.quantidade < 1 || opcoes.quantidade > 20)
    return { ok: false, motivo: "quantidade_invalida" };
  const plano = planejarBuscaFiscal(opcoes);
  if (!plano.ok) return { ok: false, motivo: plano.motivo };
  const encontradas: NotaFiscalPeriodoErp[] = [];
  const mesesConsultados: string[] = [];
  let paginasTotais = 0;
  for (const intervalo of plano.intervalos) {
    let skip = 0;
    let completa = false;
    for (let pagina = 0; pagina < LIMITE_PAGINAS_INTERVALO; pagina++) {
      if (++paginasTotais > LIMITE_PAGINAS_TOTAL)
        return { ok: false, motivo: "consulta_parcial", detalhes: { mesesConsultados } };
      const resposta = await buscarNfesPeriodoErp(db, organizationId, {
        dataInicial: intervalo.dataInicial,
        dataFinal: intervalo.dataFinal,
        pageSize: PAGINA,
        skip,
      });
      if (!resposta.ok) return resposta;
      const { notas, retornados } = resposta.dados;
      if (!Number.isInteger(retornados) || retornados < 0 || retornados > PAGINA)
        return { ok: false, motivo: "invalid_response" };
      if (
        notas.some((n) =>
          n.instanteFiscal < intervalo.inicio || n.instanteFiscal >= intervalo.fim + DIA_MS
        )
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
    if (!mesesConsultados.includes(intervalo.codigo)) mesesConsultados.push(intervalo.codigo);
  }
  let selecionadas: NotaFiscalPeriodoErp[];
  try {
    selecionadas = selecionarNotasRecentes(encontradas, opcoes.quantidade, opcoes.documento);
  } catch {
    return { ok: false, motivo: "invalid_response" };
  }
  return {
    ok: true,
    dados: {
      notas: selecionadas,
      mesesConsultados,
      periodoConsultado: plano.periodoConsultado,
      quantidadeSolicitada: opcoes.quantidade,
      consultaCompleta: true,
    },
  };
}
