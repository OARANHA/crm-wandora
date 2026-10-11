# Spike — DANFE nativa a partir do XML fiscal (somente offline)

Estado real: ELUS main `aa8e705670abb21a0f2946e66935983e6c728a33` — PR #93, diagnóstico de falha na impressão da SPA; issue #55 aberta. O canário anterior encontrou `extracao_sem_texto_apos_screen` nas duas DANFEs. Não há evidência de que a SPA do VendaERP necessite especificamente de POST ou domínio adicional. Não ampliar egress.

## Reuse gate

A capability atual já consulta `Fiscal/ConsultarNFE` (GET read-only) e seu adapter normaliza `CodigoStatus`, `MsgStatus`, `ChaveNFe`, `Numero`, `Lote`, `UrlImpressaoDanfe`. A documentação viva registra que **`Xml` apareceu na resposta real de 01/10/2026**, mas o adapter o descarta para não expor PII ao agente. O Swagger fornecido não tipa o corpo HTTP 200; logo não há garantia de `Xml` completo, autorizado, tamanho ou formato.

Alternativa a investigar: renderização do XML **inteiramente no servidor** via a mesma leitura ERP e sender canônico, sem browser/nova origem/credenciais no modelo. **Não está habilitada por esta PR.**

## Prova isolada na CI

O teste usa um XML de NF-e de exemplo **inteiramente fictício**, originado de `brasil-fiscal/nfe/examples/nfe-exemplo.xml` (MIT; empresa e destinatário explicitamente TESTE). Instala `@brasil-fiscal/nfe@2.0.7`, `pdfkit@0.18.0` e `qrcode@1.5.4` fora do projeto, com `--ignore-scripts`. Invoca apenas `GerarDanfeUseCase` em contêiner descartável, `--network none`, permissões reduzidas e memória limitada. Inspeciona os bytes PDF e exige **texto selecionável**, rótulo DANFE e chave sintética exata via `pdftotext`.

O XML de amostra é **não autorizado** (sem prova SEFAZ); serve apenas para viabilidade técnica e jamais pode ser enviado como DANFE. Nenhum pacote entra nas dependências de produção. O código da ISIS, armazenamento, auditoria, renderer vigente e política SSRF são intocados.

## Gaps antes de qualquer uso real

- **Formato/autoridade:** confirmar XML interno real por evidência pré-existente ou documentação: `nfeProc`, `protNFe/infProt/cStat=100`, chave consistente, modelo 55, protocolo, assinatura/autorização. Exigir validação estrita; nunca inventar protocolo nem transformar `NFe` simples em documento autorizado.
- **Parser e segurança:** a biblioteca em avaliação usa extração por regex na versão examinada; **não confiar nela para validar XML não confiável**. Parser robusto com DTD/entidades externas proibidos, limite de bytes e profundidade, subprocesso com memória e prazo limitados, revisão de dependências/licença/egress e igualdade da chave do XML e do PDF.
- **Fiscalidade:** cotejar layout, totais, itens, emitente/destinatário, protocolo, status, código de barras e páginas contra DANFE oficial em teste controlado; avaliar modelos 55/65 separadamente e fail closed quando não suportado.
- **Privacidade:** `Xml` permanece exclusivamente no servidor, jamais no retorno MCP, prompt, logs, audit, URL, storage exposto, artifact da CI ou WhatsApp; nenhum caminho paralelo de envio.
- **Integração futura:** reutilizar `obterNotaErp` / uma única resposta `Fiscal/ConsultarNFE` com um seam interno, sem nova chamada para o mesmo documento e sem mudar provider/sender.
- **Aceite:** duas notas comprovadamente mais recentes, PDFs distintos/legíveis/válidos chegando à conversa correta. CI verde desta prova NÃO autoriza merge como funcional, deploy ou canário.

Este spike é pesquisa instrumentada, não correção definitiva. Se falhar, ler uma vez o job na CI e ajustar especificamente. Sem polling; usuário informa green/red.
