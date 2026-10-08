import type { Readable, Writable } from "node:stream";

/**
 * Diagnóstico exclusivamente enumerado. Nunca sai daqui uma URL, query string,
 * header, payload, corpo da página, token ou erro textual do Chromium.
 */
export type DiagnosticoNavegacaoDocumento =
  | "requisicao_externa"
  | "resposta_http_2xx"
  | "resposta_http_3xx"
  | "resposta_http_4xx"
  | "resposta_http_5xx"
  | "falha_transporte"
  | "pagina_carregada";

interface MensagemCdp {
  id?: number;
  method?: string;
  sessionId?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
}

interface InfoTarget {
  targetId?: string;
  type?: string;
}

function objeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

function mesmoDocumento(valor: unknown, origem: string, caminho: string): boolean {
  if (typeof valor !== "string") return false;
  try {
    const u = new URL(valor);
    return u.origin === origem && u.pathname === caminho;
  } catch {
    return false;
  }
}

function classeHttp(valor: unknown): DiagnosticoNavegacaoDocumento | undefined {
  if (typeof valor !== "number" || !Number.isInteger(valor)) return;
  if (valor >= 200 && valor < 300) return "resposta_http_2xx";
  if (valor >= 300 && valor < 400) return "resposta_http_3xx";
  if (valor >= 400 && valor < 500) return "resposta_http_4xx";
  if (valor >= 500 && valor < 600) return "resposta_http_5xx";
}

/**
 * Observa um Chromium DEDICADO somente pelo CDP via FDs privados 3/4
 * (--remote-debugging-pipe). Não abre socket/porta de depuração e nunca
 * ativa Runtime.evaluate, Page.captureScreenshot nem Network.getResponseBody.
 *
 * A observação é best-effort: falha/parsing lento nunca altera a execução
 * do renderer. Nenhuma informação bruta atravessa o retorno.
 */
export function observarNavegacaoChromium(
  escrita: Writable,
  leitura: Readable,
  destino: string,
): { diagnostico: () => DiagnosticoNavegacaoDocumento | undefined; fechar: () => void } {
  const url = new URL(destino);
  const origem = url.origin;
  const caminho = url.pathname;
  const observados = new Set<string>();
  const requisicoes = new Set<string>();
  let diagnostico: DiagnosticoNavegacaoDocumento | undefined;
  let parcial = "";
  let sequencia = 0;
  let desativado = false;
  const MAX_MSG = 128 * 1024;
  const MAX_REQUISICOES = 256;
  const MAX_TARGETS = 12;

  // O erro do fd não deve derrubar a preparação de documento; não logar erro.
  const ignorarErro = () => undefined;
  escrita.on("error", ignorarErro);
  leitura.on("error", ignorarErro);

  const enviar = (method: string, params: Record<string, unknown>, sessionId?: string) => {
    if (desativado || escrita.destroyed || !escrita.writable) return;
    try {
      escrita.write(
        JSON.stringify({ id: ++sequencia, method, params, ...(sessionId ? { sessionId } : {}) }) +
          "\u0000",
      );
    } catch {
      // Best-effort; nenhuma exceção ou objeto do Chromium atravessa o renderer.
    }
  };
  const anexarTarget = (info: InfoTarget) => {
    if (info.type !== "page" || typeof info.targetId !== "string") return;
    if (observados.has(info.targetId) || observados.size >= MAX_TARGETS) return;
    observados.add(info.targetId);
    enviar("Target.attachToTarget", { targetId: info.targetId, flatten: true });
  };

  const receber = (msg: MensagemCdp) => {
    const p = objeto(msg.params);
    if (msg.method === "Target.targetCreated") {
      anexarTarget(objeto(p.targetInfo) as InfoTarget);
      return;
    }
    if (msg.method === "Target.attachedToTarget") {
      const sessao = p.sessionId;
      if (typeof sessao === "string") {
        enviar("Network.enable", {}, sessao);
        enviar("Page.enable", {}, sessao);
      }
      return;
    }
    if (msg.result?.targetInfos && Array.isArray(msg.result.targetInfos)) {
      for (const info of msg.result.targetInfos) anexarTarget(objeto(info) as InfoTarget);
    }
    if (msg.method === "Network.requestWillBeSent" && p.type === "Document") {
      const request = objeto(p.request);
      if (mesmoDocumento(request.url, origem, caminho)) {
        if (typeof p.requestId === "string" && requisicoes.size < MAX_REQUISICOES) {
          requisicoes.add(p.requestId);
        }
        diagnostico = "requisicao_externa";
      }
    }
    if (msg.method === "Network.responseReceived" && p.type === "Document") {
      const response = objeto(p.response);
      if (mesmoDocumento(response.url, origem, caminho)) {
        diagnostico = classeHttp(response.status) ?? diagnostico;
      }
    }
    if (msg.method === "Network.loadingFailed" && p.type === "Document") {
      if (typeof p.requestId === "string" && requisicoes.has(p.requestId)) {
        diagnostico = "falha_transporte";
      }
    }
    if (msg.method === "Page.loadEventFired" && diagnostico === "resposta_http_2xx") {
      // DOM load != SPA pronta; não declarar conteúdo da DANFE validado.
      diagnostico = "pagina_carregada";
    }
  };

  const dados = (chunk: Buffer) => {
    if (desativado) return;
    if (parcial.length + chunk.length > MAX_MSG * 2) {
      parcial = "";
      desativado = true;
      return;
    }
    parcial += chunk.toString("utf8");
    let fim = parcial.indexOf("\u0000");
    while (fim !== -1) {
      const parte = parcial.slice(0, fim);
      parcial = parcial.slice(fim + 1);
      if (parte.length <= MAX_MSG) {
        try {
          receber(JSON.parse(parte) as MensagemCdp);
        } catch {
          // CDP protocol corrupt/unsupported => apenas diagnóstico ausente.
        }
      }
      fim = parcial.indexOf("\u0000");
    }
  };
  leitura.on("data", dados);
  enviar("Target.setDiscoverTargets", { discover: true });
  enviar("Target.getTargets", {});

  return {
    diagnostico: () => diagnostico,
    fechar: () => {
      desativado = true;
      leitura.off("data", dados);
      // Mantém handlers silenciosos até o fechamento físico dos FDs:
      // Chromium pode emitir EPIPE após SIGKILL no timeout.
      parcial = "";
      requisicoes.clear();
      observados.clear();
    },
  };
}
