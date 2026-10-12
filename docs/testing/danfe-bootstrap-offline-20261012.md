# DANFE — bootstrap interceptável comprovado offline em 12/10/2026

## Resultado e limite do aceite

**CONFIRMADO:** corrigida uma falha de navegação do renderer controlado, reproduzida
com uma SPA fiscal sintética na imagem real publicada do worker Alpine. O PDF
corrigido contém texto fiscal selecionável, chave sintética exata, produto,
quantidade e total. O controle com o comportamento da PR #37 também imprime
essa mesma SPA. Não houve chamada ao VendaERP, envio WhatsApp, merge ou deploy.

**NÃO MEDIDO:** conteúdo/recursos da SPA fiscal real e próximo canário. Este
resultado não estabelece que o bootstrap era a única causa do PDF vazio no
canário anterior, nem comprova entrega de uma DANFE real. A PR deve passar pelos
gates do projeto antes de qualquer publicação/deploy/canário autorizado.

Base reconciliada pelo GitHub: `OARANHA/crm-wandora`, `main`
`5aaa69ca017ff5cc412bdd273d7b28bcc7d039db`. Autoridades lidas: `AGENTS.md`,
`CLAUDE.md`, `UPSTREAM.md`, `docs/current-state.md`, handoff CRM-WANDORA,
spec de descobertas VendaERP e skills atuais `deskcomm-contribuir`,
`deskcomm-doutrina`, `sistema-vivo`. Memória externa foi contexto, não autoridade.

## Downloads e runtime

A nova execução já carregou a configuração publicada, revisão 2, com
`cdn.playwright.dev`, `dl-cdn.alpinelinux.org`, `storage.googleapis.com`. Não foi
necessário reiniciar. O status da política reporta `unknown`; o funcionamento
abaixo foi medido por downloads reais, não inferido da lista de hosts.

- Chromium Playwright 153.0.8010.12, build 1243: download completo (~186,8 MiB).
- Headless shell correspondente: download completo (~114,3 MiB).
- FFmpeg 1011: os dois primeiros mirrors retornaram HTTP 403 `Domain forbidden`;
  o instalador concluiu pelo terceiro mirror. Instalação completa exit 0.
- Alpine: índices APK baixados; pacote `chromium-152.0.7977.82-r0.apk` da
  comunidade v3.24 respondeu HTTP 200, **146.444.520 bytes**, tamanho igual ao
  anunciado no APKINDEX. TLS permaneceu habilitado.
- Imagem real obtida por digest imutável:
  `ghcr.io/oaranha/elus-worker@sha256:11565dda7eebdf730a5015a1d0e2a96a83001afb6814b7640fd12b5be0311503`.
  `APP_VERSION=5aaa69ca017ff5cc412bdd273d7b28bcc7d039db`; Alpine **3.24.2**.

As primeiras tentativas sem a rede do sandbox do comando falharam com
`curl: (7) Failed to connect to proxy port 8080` e acesso ao socket Docker
`operation not permitted`. Habilitar rede para o comando resolveu ambos,
preservando o proxy e a política publicada. Não houve bypass de destino.

## Causa específica e correção mínima

O renderer consultava o bootstrap local com `route.fetch({ maxRedirects: 0 })`,
validava o 302 e o entregava por `route.fulfill({ response, body: "" })`.
**Uma continuação de redirect HTTP não recebe uma nova interceptação Playwright,
mesmo quando o 302 foi entregue por `fulfill`.** Portanto a navegação principal
saltava `buscarRecursoBrowserPdfPinado` e tentava socket direto do Chromium.

Na imagem real com `--network none`, o renderer anterior falhou na etapa
`chromium_navegacao`, `render_falhou`, com
`net::ERR_INTERNET_DISCONNECTED`. O contador do transporte remoto simulado
permaneceu **zero**, enquanto o legado imprimiu a SPA local com conteúdo fiscal.
Os testes unitários antigos só conferiam a chamada a `fulfill`, sem medir o
comportamento real do redirect no browser.

A correção preserva a consulta e validação do 302/Location/nonce consumido, mas
entrega ao Chromium um bootstrap HTML 200 efêmero com `location.replace` para
iniciar **uma nova navegação interceptável**. A URL fica em memória, serializada
por JSON e com `<` escapado; não entra em argv/arquivo/log fiscal. A página
remota continua recebendo a CSP original. Bootstrap usa `no-store` e
`Referrer-Policy: no-referrer`.

Não mudou nenhuma allowlist, host/path/método, timeout, resolução DNS pública,
pinning, TLS/SNI, limite de tamanho, filtragem de headers, bloqueio de redirects
remotos, WebSocket/WebRTC/service workers, identidade fiscal, storage ou sender.
O renderer genérico sem `recursosBrowser` não foi modificado. Nenhum cliente ERP
novo, fila, envio alternativo ou mudança de provider foi introduzido.

## RED → GREEN e provas

[Artefatos de execução](evidence/danfe-bootstrap-20261012/) contêm logs e quatro
PDFs **exclusivamente sintéticos**. Extração canônica: `extractPdfText`, em
processo Node separado, heap 96 MB, prazo 8 segundos. Todos os PDFs aceitos
comprovam DANFE, CHAVE DE ACESSO, uma única chave esperada, produto sintético e
`123,45`; não contêm `Carregando`. Extração independente por `pdftotext` e
inspeção visual do PDF normal também confirmaram conteúdo não vazio.

| Execução                                                                | Resultado                                                                  |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Baseline unitário antes da mudança                                      | 104/104                                                                    |
| Teste unitário do novo bootstrap antes da correção                      | 1 falha prevista, 51 passam                                                |
| Bancada inicial real, renderer antigo, normal/print-hidden + legado     | 2 falhas, legado passa; zero hits de transporte remoto                     |
| Teste final de 5 casos, código da main sem correção                     | 4 falhas, legado passa; falha em navegação, não em identidade              |
| Mesmo teste final, correção restaurada                                  | 5/5; normal, print-hidden, cross-origin, chave divergente recusada, legado |
| Comando do workflow na imagem real, checkout montado read-only          | **68/68**, quatro arquivos                                                 |
| Segurança/identidade/autoridade/entrega governada local                 | **119/119**, oito arquivos                                                 |
| Typecheck canônico `tsc --noEmit -p tsconfig.typecheck.json`, heap 6 GB | exit 0, incluindo testes                                                   |
| ESLint dos três arquivos TS alterados, Prettier e `git diff --check`    | exit 0                                                                     |
| `lint:channels`                                                         | exit 0, sem dívida nova                                                    |
| Revisão independente                                                    | sem achados críticos/importantes; ordem de requests no teste corrigida     |

O typecheck com heap padrão esgotou memória (exit 134); a repetição com 6 GB
passou. Avisos de compatibilidade da configuração Vite existente não foram
tratados como erros nem removidos deste escopo.

**Gate global preexistente:** `release:conferir` exit 1 devido a **29 fragmentos
inválidos já idênticos na main**. Exemplo: `admin-danfe-document-delivery.md`,
`frontmatter inválido`; `checkpoint-recuperacao-local.md`, `falta o bloco ---`.
Lista completa em `release-check.txt`. O novo fragmento
`elus-danfe-bootstrap-controlado.md` passa no parser canônico. Nenhum dos 29
fragmentos anteriores foi alterado. PR em rascunho; não declarar todos os gates
globais verdes.

### Reprodução da prova na imagem real

O workflow atualizado `danfe-worker-runtime-parity.yml` verifica a versão da
imagem e executa o comando abaixo. Somente DNS e transporte remoto são mocks;
o Chromium instalado no worker, o bootstrap, as rotas Playwright, JavaScript,
CSS, impressão e extração fiscal são reais. `.invalid` nunca é serviço externo.

```sh
WORKER_IMAGE=ghcr.io/oaranha/elus-worker@sha256:11565dda7eebdf730a5015a1d0e2a96a83001afb6814b7640fd12b5be0311503
docker run --rm --pull=never \
  --network none --cap-drop ALL --security-opt no-new-privileges:true \
  --pids-limit 512 --memory 2g --cpus 2 \
  --tmpfs /tmp:rw,nosuid,nodev,size=536870912 \
  --mount "type=bind,source=$PWD/tests,target=/app/tests,readonly" \
  --mount "type=bind,source=$PWD/lib/documentos,target=/app/lib/documentos,readonly" \
  --env ELUS_DANFE_CHROMIUM_OFFLINE=1 \
  --env ELUS_DANFE_CONTROLLED_SPA_OFFLINE=1 \
  "$WORKER_IMAGE" node /app/node_modules/vitest/vitest.mjs run \
  tests/integration/danfe-chromium-offline.test.ts \
  tests/integration/danfe-controlled-spa-offline.test.ts \
  tests/unit/danfe-renderer-controlado.test.ts \
  tests/unit/documentos-renderizar-url-pdf.test.ts --maxWorkers=1
```

Artefatos são capturados pela bancada com `ELUS_DANFE_EVIDENCE_DIR` apontando
para uma pasta local do contêiner. Não se captura HTML nem dados do provider.
Hashes SHA-256 dos PDFs desta execução:

```text
current-normal.pdf       dd11ed21c958a2215cceed4133ea06f06d8b1ff62ffda4bc2bbda7b4473c87ce
current-print-hidden.pdf cdf0f4a1f68d85ac244fce1f9fb68213ea0df1f59b3bd7d4d2f1eb5875b8caf8
current-cross-origin.pdf a5e011b5f69337bd87596948c114ccc4a2fed9b754ae2555a35456404e229c20
legacy.pdf               bf699e16e89321e5ec929dcfed74e56e54e1358977173edd47cff489a32700c4
```

O arquivo do renderer copiado ao worker para a execução tem SHA-256
`948209aa270b1b8dc553103e1b0a68ccbe29b25187d516372ba056ee12258305`, igual ao
checkout. Os PDFs acima foram preservados da execução GREEN antes da sabotagem;
a correção foi restaurada e novamente passou 5/5 após a sabotagem.

## Limites arquiteturais e continuidade

Destino: **núcleo**, conserto da capability existente de documento; detalhes de
provider continuam no adapter. Com zero extensões a operação continua inteira.
Nenhuma peça, tela, schema, configuração ou aresta de arquitetura foi criada.

- Entrada: `renderizarDanfeVendaErpParaPdf` em `lib/integracoes-erp/vendaerp-danfe-pdf.ts`.
- Saída: `lib/integracoes-erp/danfe.ts` e `danfe-conversa.ts`, somente após a validação fiscal.
- Log/falha: `ErroRenderizacaoDocumento` e evidências finitas existentes continuam
  propagadas por `ErroDanfe`, sem payload fiscal ou URLs novas.
- Tela/porta: fluxo administrativo já existente na conversa/inbox, não uma nova UI.
- Anti-morte e continuidade IA↔humano: contratos existentes de falha/preparação
  continuam iguais; este slice não envia nem altera roteamento/handoff.
- Configuração: `CHROMIUM_PATH` e política existente do adapter; nenhuma env nova.
- Laço de retorno: regressão real passa a rodar no workflow da imagem publicada;
  sem transporte interceptado ou com identidade divergente o teste reprova.
- Mapa vivo: sem peça/aresta nova; os consumidores existentes foram preservados.
- Sender da PR #36: não tocado; testes de autoridade e entrega governada permanecem verdes.

Não foram executados build Next completo, suíte unitária global, E2E de UI,
banco/produção, CI remoto ou canário real. Não houve polling de Actions. Próximo
aceite funcional real continua sendo **UMA DANFE correta**, após os gates e
autorização operacional, sem usar o teste sintético como prova de entrega real.
