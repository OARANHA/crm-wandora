# VendaERP — caderno de descobertas da integração

Este arquivo é o registro vivo do que foi **confirmado**, do que foi apenas
**observado em execução** e do que continua **desconhecido**. Ele existe para a
integração não voltar a inferir payload, semântica ou permissão quando o contexto
da conversa se perder.

## Como a evidência é tratada

A ordem usada na implementação é:

1. **Swagger recebido**: fonte para paths, métodos, parâmetros, headers e schemas
   que estejam realmente declarados.
2. **Resposta real observada**: pode preencher uma lacuna do Swagger, mas fica
   marcada como observação de runtime, com data.
3. **Contrato interno do Elus**: projeta somente os campos necessários; payload
   bruto do provider não vira contrato do agente.
4. **Desconhecido continua desconhecido**: nenhum cálculo ou campo é inventado
   para deixar a resposta mais conveniente.

Credenciais, tokens, curls completos e screenshots autenticados **não são
commitados** neste repositório.

## Confirmado pelo Swagger

### Autenticação

As operações verificadas usam os headers:

- Authorization-Token
- User
- App

O Swagger também declara limite de 1.000 requests por hora por chave.

### Depósitos

Endpoint:

- GET /api/request/Depositos/GetTodosDepositos

O 200 é documentado como array de Deposito, com:

- id
- nome
- empresaID
- empresa

### Estoque

Endpoint:

- GET /api/request/Estoque/BuscarQuantidades

Parâmetros de query documentados:

- deposito: string
- visivelCatalogo: boolean, default false

O Swagger recebido não declara o schema do corpo do 200 para este endpoint.

## Observado em execução em 2026-10-01

### Resposta de depósitos

Uma resposta autenticada real do endpoint de depósitos veio com os mesmos
conceitos do schema, porém em PascalCase:

- ID
- Nome
- EmpresaID
- Empresa

Decisão: o adapter aceita camelCase e PascalCase, mas normaliza para um único
contrato interno. A inconsistência do provider não vaza para o resto do Elus.

### Resposta de estoque

Foi observada a seguinte forma de resposta:

- envelope EstoqueItens
- ProdutoCodigo
- EstoqueAtual
- SaldoReservado

Valores negativos de EstoqueAtual também foram observados. Eles são preservados
como vieram; não são corrigidos, truncados nem reinterpretados.

Também foi confirmado no teste manual que o parâmetro deposito aceita o **nome**
do depósito, não apenas seu identificador.

## Decisão de resolução de depósito

Para crm_erp_read_stock:

- depósito informado: consulta diretamente esse nome, sem uma chamada extra só
  para validar;
- depósito omitido e existe exatamente um: usa esse depósito automaticamente;
- nenhum depósito: devolve erro sem_deposito;
- mais de um depósito: devolve deposito_ambiguo com as opções e **não consulta
  estoque até haver escolha**;
- depósito único sem nome utilizável: devolve deposito_sem_nome.

Isso evita escolher empresa/depósito por adivinhação e economiza uma chamada
quando a conversa já informou o depósito.

## Contrato interno de estoque

A saída estável entregue ao agente mantém:

- codigo
- estoque_atual
- saldo_reservado

Não existe, nesta etapa, campo derivado "disponível".

Motivo: ainda não há documentação que prove se SaldoReservado deve ser subtraído
de EstoqueAtual, se EstoqueAtual já inclui reservas, ou se a relação muda por
configuração do VendaERP.

## Consulta por produto

Estoque/BuscarQuantidades não recebe código do produto no endpoint documentado.
Quando crm_erp_read_stock recebe codigo, o Elus consulta o estoque do depósito
uma vez e filtra a resposta localmente pelo código exato.

Quando a pessoa conhece apenas o nome do produto, o fluxo correto é:

1. crm_erp_search_products para descobrir o código;
2. crm_erp_read_stock com esse código.

Não foi criado um join escondido que faça múltiplas chamadas sem o agente saber.

## Limite de requests — proteção ainda pendente

O Swagger declara 1.000 requests por hora por chave. O provider já trata HTTP
429 como rate_limited, e o MCP do Elus tem o próprio rate-limit de tools, mas
isso **não é a mesma coisa** que contabilizar chamadas consumidas na chave do
VendaERP.

Nesta etapa não foi criado um contador preventivo por conexão. Isso fica como
pendência explícita antes de ampliar automação ou escrita, especialmente porque
uma consulta de estoque sem depósito informado pode consumir duas chamadas:
listar depósitos e, quando houver exatamente um, consultar o estoque.

## Fiscal — resposta real observada em 2026-10-01

O Swagger confirma dois endpoints GET diferentes, mas não declara schema para o
corpo de 200 de nenhum deles:

### Fiscal/ConsultarNFE

Entrada formal:

- CodigoNFe: número da NFe/NFCe, int32.

Resposta real observada:

- CodigoStatus
- MsgStatus
- ChaveNFe
- Numero
- Lote
- UrlImpressaoDanfe
- Xml

Decisão: crm_erp_get_invoice usa este endpoint diretamente. O contrato interno
expõe somente numero, codigoStatus, mensagemStatus, chave, lote e danfeUrl.

**Xml é descartado** no adapter. O agente não precisa do XML completo para
confirmar autorização ou disponibilizar o DANFE, e o XML pode ser volumoso e
conter dados fiscais/pessoais que não devem ampliar o contexto da conversa.

### Fiscal/InformacoesVenda

Entrada formal:

- Codigo: código da venda, int64.

Resposta real observada:

- Tipo
- Numero
- Serie
- ChaveAcesso
- DataEmissao
- UrlImpressaoUrl

Esse endpoint também foi mapeado no provider e normalizado no service. Ele é
uma segunda visão fiscal, a partir da venda, e não cria uma nova capability do
agente nesta V1.

DataEmissao permanece string porque a resposta observada usa formato local
"dd/MM/yyyy - HH:mm" e o provider não documenta timezone no schema de resposta.
Converter para ISO agora inventaria informação temporal.

### Relação entre as duas consultas

- quando se conhece o número da NFe/NFCe: ConsultarNFE;
- quando se parte do código de uma venda: InformacoesVenda.

Nenhuma das duas operações emite, altera ou cancela documento fiscal; são
leituras.

## Escrita

Nada desta descoberta altera a fronteira de autoridade da V1:

- pedido: desabilitado;
- faturamento: desabilitado;
- emissão fiscal: desabilitada;
- exclusão: desabilitada.

A etapa atual continua estritamente READ-ONLY.

## DANFE como documento de atendimento — contrato canônico comprovado

Em 2026-10-05 o caminho administrativo foi provado em produção, de ponta a ponta,
com uma NFe real solicitada pelo administrador via WhatsApp. O documento foi
preparado com sucesso, persistido no bucket privado da conversa e enviado como
`type=document`, `application/pdf`, pelo sender canônico; o provider retornou
receipt e a mensagem chegou ao estado `read`.

A forma canônica passa a ser:

1. `crm_erp_get_invoice` consulta `Fiscal/ConsultarNFE` em modo read-only;
2. `crm_erp_prepare_admin_danfe` recebe o número da NFe e usa somente a
   `danfeUrl` normalizada;
3. se a URL casar exatamente com a rota pública allowlisted
   `https://app.vendaerp.com.br/v3/public/NFe/Danfe`, o Elus **não** faz um
   fetch HTTP intermediário: renderiza diretamente pelo Chromium através de
   `erp.vendaerp.danfe_to_pdf`;
4. a policy especializada mantém host/path/query fechados, sem credenciais ERP,
   e timeout de 60 s; a capability genérica `document.render.url_to_pdf`
   permanece com seu timeout padrão;
5. os bytes precisam validar como PDF/documento antes de qualquer upload;
6. o PDF entra no bucket privado `whatsapp-media` no path da própria
   organização/conversa;
7. o `storage_path` permanece interno ao runtime e não é exposto ao modelo;
8. a próxima `send_message` do mesmo turno anexa esse objeto como documento;
9. a entrega segue o único caminho outbound:
   `before_send → send_ledger → sendMessageHandler → adapter → WAHA`.

Esse caminho é a referência canônica para DANFE administrativa do VendaERP.
Não se envia `UrlImpressaoDanfe` diretamente ao WhatsApp, não se usa um sender
paralelo, não se expõe `storage_path` ao modelo e nenhuma escrita fiscal é
executada no VendaERP.

### Prova real de produção — 2026-10-05

Evidência observável do turno que fechou o aceite:

- job: `18330315-1df7-4980-adcd-8a076d31a21c`;
- `api_audit_log`: `crm_erp_prepare_admin_danfe` com `success=true`;
- `send_ledger`: sequência 1 em `accepted`;
- `messages.type=document`;
- `messages.media_mime=application/pdf`;
- objeto salvo em `whatsapp-media` sob o prefixo canônico
  `{organization_id}/{conversation_id}/danfe-admin-nfe-...`;
- mensagem outbound com `sent_via=ai` e status final observado `read`.

A prova é do fluxo e de seus invariantes; os identificadores acima são recibos
datados de produção, não configuração a ser reutilizada em outra organização.

## Resolução NFe → cliente CRM

A composição nova parte de uma NFe conhecida, localiza o pedido exato e mantém `pessoaID`, CPF/CNPJ
e e-mail somente no backend para selecionar a Pessoa ERP. Depois reconcilia essa identidade com um
único contato CRM. Nome não identifica; divergência ou multiplicidade interrompem a operação.

A conversa destino precisa ser única, não terminal e usar sessão ativa. Sua `fn_service_boundary` é
capturada antes do job derivado. O documento é materializado no namespace dessa conversa e o
consumer reutiliza o seam governado de messaging. O VendaERP permanece somente leitura.

## Cliente da NFe ainda sem conversa

A ausência de conversa deixou de ser, por si só, um bloqueio quando a identidade ERP já provou
um único contato CRM ativo. Nesse caso o Elus exige telefone discável no contato existente,
revalida a origem administrativa e usa a mesma sessão WhatsApp da ordem para criar ou reabrir
o thread por `fn_service_begin`.

Nada muda na autoridade de identidade: o ERP continua somente leitura, nome não identifica,
telefone digitado pelo modelo não escolhe destinatário e nenhum contato é criado automaticamente.

## Identidade fiscal — recuperação de vínculo legado (slice de segurança)

Em um vínculo antigo `contact_id ↔ Pessoa.id`, nome/razão social **não**
comprovam CPF/CNPJ. Quando a busca de `Pessoas/Pesquisar` pelo rótulo armazenado
não retorna o ID externo exato com documento válido, a busca fiscal pode consultar
`Pedidos/Pesquisar` pelo mesmo rótulo **somente como descoberta**. O documento
é aceito apenas quando `Pedido.pessoaID === external_id` do vínculo ativo,
não há documentos divergentes e a paginação limitada chegou ao fim. Quando
o limite é atingido, responde `consulta_parcial` e não declara recência.

A projeção pública não recebe o documento, os pedidos brutos, o XML nem a URL.
As duas fontes são GET/read-only e ficam sob o mesmo `organization_id`.
A validação CPF segue `isValidCpf`; CNPJ exige `normalizeCnpj` canônico
e também verificação dos dois dígitos verificadores.
Não confundir esse fallback com **persistência de cadastro mínimo**: contatos PF
ainda precisam de CPF cifrado + hash, e empresas PJ exigem `companies` e
identidade própria, sem criar um `contacts.kind=person` fictício.
A RPC `encrypt_cpf` segue não comprovada no banco observado.
Esse trabalho de schema/enriquecimento continua obrigatório na issue #55 e
não é declarado resolvido por este slice de desbloqueio fiscal.

## Diagnóstico controlado do Chromium no worker — 09/10/2026

No canário das 10h39, a busca fiscal retornou sucesso, mas as duas
preparações falharam com `timeout` na etapa agregada
`chromium_antes_redirect`. Nenhum documento foi enviado.

A rota pública VendaERP utiliza `renderizarUrlParaPdfControlado`
(Playwright-core). Antes deste slice, o teste Chromium real do CI
exercitava somente o executor CLI, não o Playwright no Alpine do worker.
O diagnóstico agora distingue lançamento, criação de contexto,
configuração de políticas, criação da página e navegação, sem registrar
URLs, credenciais ou conteúdo fiscal.

Um teste offline constrói a imagem `Dockerfile.worker` apenas no CI e
executa Chromium/Playwright com 512 MiB e `--network none`, usando
apenas fixture local. O diretório `tests/` é intencionalmente excluído
pelo `.dockerignore` e é montado somente em leitura no container
efêmero do CI, sem ampliar o conteúdo da imagem de produção. O teste não substitui o gate SSRF e não comprova
a entrega das duas DANFEs reais. A causa original do timeout segue
não comprovada até os resultados da investigação.

## Canário administrativo de 13h35 — 09/10/2026

No turno real da ISIS, a mensagem de entrada ocorreu às 13h35min10s BRT.
A busca fiscal crm_erp_search_recent_invoices foi auditada com success=true
às 13h35min44s. As duas chamadas de crm_erp_prepare_admin_danfe
falharam com danfe_download_failed, código timeout e etapa agregada
chromium_apos_redirect às 13h36min08s e 13h36min25s. A resposta outbound
foi somente texto, às 13h36min34s; não há PDF/documento no turno.
O job inbound_turn terminou done, sem nova tentativa, e o worker permaneceu
healthy, com memória cgroup de 768 MiB e sem OOM.

**Limite da prova:** chromium_apos_redirect cobria tanto espera pelo DOM fiscal
quanto impressão por Playwright. Não é possível atribuir a falha a cross-origin,
à chave de 44 dígitos, à página ou à impressão sem uma evidência mais fina.
O renderer controlado já recusa métodos diferentes de GET/HEAD, origens extras
e DNS privado: não relaxar a política de egress para tentar resolver timeout.

**Slice de diagnóstico:** adicionar apenas os estágios sanitizados
chromium_validacao_conteudo e chromium_impressao_pdf ao contrato de erro
e à allowlist da auditoria. Testes sintéticos offline cobrem falha em cada fase
e fechamento do browser; nenhuma URL fiscal ou conteúdo do documento é logado.
Não há novo canário real nem alteração no VendaERP ou no sender WhatsApp.

## Observação offline de recursos bloqueados — 09/10/2026

A fase chromium_validacao_conteudo ainda não prova por que o DOM
fiscal não chegou ao estado esperado. A policy do browser intercepta
requisições antes de acessar a rede, bloqueia destinos fora da origem
HTTPS única e métodos diferentes de GET/HEAD. Esses bloqueios são
controles obrigatórios de SSRF/egress e **não são afrouxados**.

Para uma falha de timeout nessa fase, o renderer passa a devolver
apenas uma **classe finita de bloqueios HTTP interceptados**:
nenhum_bloqueio_interceptado, metodo_nao_permitido,
destino_fora_origem ou ambas_classes_bloqueadas.
A classificação nunca contém URL, host, path, método bruto, corpo,
chave fiscal, token, HTML ou contagem identificadora; segue a auditoria
administrativa com allowlist e não aparece na mensagem do agente.

**Limites:** nenhum_bloqueio_interceptado não prova que o browser
realizou toda a rede nem que o provider está saudável.
Bloqueio observado não estabelece causalidade com o timeout,
especialmente para scripts de rastreamento opcionais.
Testes sintéticos cobrem os quatro estados e propagation/censura.
A causa e a entrega de duas DANFEs reais ainda não foram provadas.

## Gate de prontidão da DANFE — reprodução offline de tela de erro

Em 09/10/2026, teste unitário sintético acrescentou uma página que responde
"Nota Fiscal indisponível para consulta" e ecoa a chave fiscal correta de
44 dígitos. A função original de prontidão aceitou a página como DANFE
(true em vez de false), reproduzindo um falso positivo determinístico.
Essa prova **não é evidência do HTML real do VendaERP** nem explica os
timeouts observados.

O gate no renderer controlado passa a exigir os rótulos de documento
DANFE e CHAVE DE ACESSO, rejeita mensagens explícitas de nota indisponível,
não encontrada ou erro ao carregar/consultar, e mantém obrigatória a
chave exata comprovada pelo ERP antes da impressão. Nenhum texto do DOM,
URL fiscal, chave, HTML ou erro do Chromium é enviado para logs/auditoria.
Os limites de tempo, a allowlist, o DNS pinado, o bloqueio de egress,
a persistência privada e o sender não são alterados.

**Limite:** rótulos e chave exata não constituem prova criptográfica de
autenticidade nem substituem a conferência do PDF na conversa administrativa.
A issue #55 permanece aberta para recência fiscal e duas DANFEs corretas.

## DANFE: validação do PDF impresso com identidade fiscal — 09/10/2026

### Evidência reproduzida (RED → GREEN; sem VendaERP real)

Em 05/10/2026 o renderer legado com impressão direta do Chromium entregou um PDF
administrativo: `api_audit_log.success=true`, `messages.type=document`,
`media_mime=application/pdf`, `send_ledger=accepted` e status final `read`.
O renderer atual do Playwright exige uma combinação de strings no DOM da SPA
**antes** de chamar `page.pdf()`; isso é um novo gate, não presente no fluxo
comprovadamente funcional. Um teste sintético fez `page.waitForFunction()`
expirar, embora a impressão e o conteúdo fiscal simulado fossem válidos. O teste
falhou no código anterior com `ErroRenderizacaoDocumento(timeout)` sem imprimir.

A correção permite seguir à impressão **somente** quando (a) a validação DOM
expirou, (b) existe uma chave fiscal de 44 dígitos comprovada por leitura
estruturada ERP, (c) ainda resta tempo no prazo global. Qualquer outra falha do
browser continua encerrando o processo. A impressão continua executada pelo
Playwright com egress restrito ao mesmo origin, DNS público fixado, bloqueio
de WebSocket/WebRTC, processo sem credenciais ERP e cleanup do loopback.

**Depois da impressão** o PDF é validado em duas camadas:

1. assinatura do arquivo, marcador final e limite de tamanho já existentes;
2. texto extraído pelo `extractPdfText` canônico, na estratégia
   `processo-a-parte`, com limite de heap e deadline, deve conter
   `DANFE`, `CHAVE DE ACESSO`, a chave fiscal exata e não conter marcadores
   explícitos de nota indisponível ou não encontrada.

A chave deve aparecer como sequência íntegra de 44 dígitos no campo principal
imediatamente após o rótulo `CHAVE DE ACESSO`. Separadores tipográficos
(espaços, pontos e hífens) são aceitos entre os dígitos; palavras não são.
Não concatenar todos os dígitos do PDF: isso pode gerar chave artificial
ou aceitar uma NFe diferente que apenas referencia a nota solicitada.
Quando o campo principal não puder ser comprovado, falhar fechado.
O controle textual não é prova criptográfica de autenticidade do documento.

O texto extraído não vai para logs, modelo, auditoria ou WhatsApp. Erro na
extração, chave distinta, ausência de texto ou retorno com aviso de erro
**falham fechado**, sem preparar mídia. A inspeção de texto não equivale à
prova criptográfica do documento; o canário funcional exige conferir o PDF
aberto e associado à NFe correta.

**Limite do diagnóstico:** esta correção fecha uma regressão reproduzida no
código de prontidão, mas não prova que todos os recursos da SPA real do
VendaERP carregam sob a policy atual. Se ela depender de POST ou de terceiros,
a policy de egress permanece bloqueando esses recursos até haver prova da
necessidade e revisão adversarial específica. Não aumentar timeout, não
abrir domínio alternativo, não reutilizar URL provider em sender.
A issue #55 só fecha com as duas notas comprovadamente mais recentes,
distintas e os dois PDFs corretos recebidos na conversa administrativa.

## DANFE — observabilidade do extrator sem repetir canário — 10/10/2026

Canário administrativo pós-deploy `d664b676`, às 18h50 (Brasília): busca
`crm_erp_search_recent_invoices` bem-sucedida; duas preparações de DANFE
falharam na etapa `pdf_validacao` com `extracao_falhou`. Nenhum PDF foi enviado;
apenas uma resposta textual aceita pelo sender. A auditoria anterior não permite
distinguir timeout do subprocesso, heap esgotado, import ausente ou PDF sem texto.
**Esta evidência não comprova qual dessas hipóteses ocorreu.**

Para futuras falhas, `PdfExtractError` carrega uma categoria técnica finita,
sem texto, URL, chave, notas, `stderr` ou identidade. O renderer mapeia para
`extracao_sem_texto`, `extracao_timeout`, `extracao_memoria`,
`extracao_processo_falhou`, `extracao_dependencia` ou o fallback
`extracao_falhou`. Todos os casos continuam **fail-closed**: nenhum documento
é preparado. O diagnóstico não autoriza aumentar heap/timeout sem evidência,
abrir egress, nem chamar o VendaERP outra vez antes de CI/merge/deploy saudáveis.

## CANÁRIO 11/10/2026 — PDF sem texto / hipótese CSS de impressão

No canário único após o deploy `4cb7f53e`, o job
`c6b3798d-3dfd-4111-83e2-b5fb0188dae5` registrou consulta recente
bem-sucedida e duas tentativas de `crm_erp_prepare_admin_danfe` com
`pdf_validacao / extracao_sem_texto`. Ledger aceitou só texto e nenhum PDF
foi armazenado na conversa. Isso prova ausência de texto selecionável no
PDF impresso, **não prova qual regra CSS ou conteúdo causou isso**.

Hipótese defensiva: o Chromium usa `media=print`; uma página com conteúdo
no DOM pode ficar vazia sob o CSS de impressão. Em `extracao_sem_texto`
apenas, permitir UMA reimpressão da mesma página em `media=screen`, sem nova
consulta VendaERP, sem navegação adicional e sem estender o prazo total.
A segunda impressão volta a exigir PDF estruturalmente válido, título DANFE,
rótulo e chave fiscal exata da NFe. Se não tiver texto, auditar
`extracao_sem_texto_apos_screen` e falhar fechado. Outros erros (timeout,
heap, dependência, chave divergente) **não acionam** a segunda impressão.
Esse mecanismo não representa aceite real até duas DANFEs distintas chegarem
à conversa correta após CI, merge, imagens e deploy saudável.

## Canário 11/10/2026 — repetição segura após PR #92

Turno `a17dff3a-9923-4af6-82ba-f8001f91ffe5`: busca recente sucesso,
duas preparações com `pdf_validacao / extracao_sem_texto_apos_screen`.
Apenas uma resposta `text`, nenhum documento enviado. O renderer
executou a segunda impressão; **isso não demonstra que o HTML fiscal estivesse
pronto nem que a falha tenha sido causada por CSS**.

O código atual tolera timeout do gate DOM quando há uma chave fiscal
estruturada, para permitir que um PDF válido seja comprovado após impressão.
Assim, PDFs sem texto podem vir tanto de DOM não confirmado quanto de um
DOM confirmado com renderização textual invisível para o extrator. Não há
sinal retrospectivo separando as duas hipóteses; logs históricos não provam
recurso bloqueado. O próximo diagnóstico conserva a proteção fiscal e marca
somente `extracao_sem_texto_apos_screen_dom_confirmado` ou
`extracao_sem_texto_apos_screen_dom_nao_confirmado` e a classificação
finita já existente de egress `nenhum_bloqueio_interceptado`,
`metodo_nao_permitido`, `destino_fora_origem` ou
`ambas_classes_bloqueadas` nesse ramo específico.

Nunca exportar DOM, PDF, URLs, método bruto, chave, NFe, identidade ou
payload de rede. Status de bloqueio **não comprova causalidade**. Sem
nova consulta real ao VendaERP até a versão seguir CI → merge → publicação
→ deploy healthy. Falhas continuam fail-closed, sem entregar DANFE inválida.

## Ajuste no contrato de quantidade de últimas NFes — 11/10/2026

A quantidade solicitada não é um filtro de mês. A tool `crm_erp_search_recent_invoices`
antes recusava **4 a 20 notas sem `mes_ano`**, embora a intenção seja localizar
as últimas N notas independentemente do mês. O fluxo agora mantém **a mesma
janela regressiva existente (mês atual + até seis anteriores)** e os limites
inalterados de paginação (50 itens/página, 12 páginas/mês e 24 no total), mas
**não exige mês apenas porque N é maior que 3**. O filtro `mes_ano` continua
opcional para consultas dirigidas. Se a prova de recência não couber na janela
ou nos limites, o resultado continua falhando fechado: `consulta_parcial` ou
`janela_fiscal_insuficiente`, nunca uma ausência inventada. Mantidos GET
read-only, documento do destinatário validado, filtragem local, deduplicação
por chave e projeção sem XML ou URL para o agente.

**Limitação separada, ainda aberta na issue #55:** este ajuste apenas destrava a
**busca** de cinco ou mais NFes. Ele **não** amplia o teto geral do agente de
3 envios por turno nem o orçamento de steps, não repara a renderização de DANFE
e não comprova a entrega de N PDFs. Não promover a produção como correção
funcional completa sem gates adicionais.

## ISIS — janela inicial de 30 dias e período solicitado — 11/10/2026

A consulta inicial de NFe de um cliente sem data agora pesquisa **30 dias
civis incluindo hoje**, com base em `America/Sao_Paulo`, sem retroceder
automaticamente até sete meses. O VendaERP mantém o limite por GET de no
máximo um mês e 30 dias inclusivos; datas separadas por fronteira mensal
são pesquisadas em GETs independentes.

A ISIS recebe `periodoConsultado` e `consultaCompleta` para distinguir
ausência comprovada na janela de erro técnico ou consulta parcial. Quando
`notas=[]` com sucesso completo, deve perguntar o período desejado,
sem afirmar ausência histórica nem ampliar a busca silenciosamente.
O cliente já resolvido é preservado como contexto conversacional.

Consultas dirigidas usam `data_inicio` e `data_fim` (até 30 dias),
o mesmo dia nos dois campos para data exata, ou `mes_ano` para um mês
explícito (particionado quando tiver 31 dias). Pedido singular genérico
com várias NFes exige número/data antes de preparar qualquer DANFE.

A seleção mantém identidade fiscal comprovada, filtro local, data de
emissão real, deduplicação por chave, GET READ-ONLY e saída sanitizada.
Esse contrato **não demonstra PDF ou entrega real**, que seguem pendentes
de CI/merge/publicação/deploy/canário humano.

## DANFE HTML VendaERP — dependências públicas comprovadas pelo navegador (11/10/2026)

Um navegador humano renderizou a DANFE como **HTML imprimível**, com `document.readyState=complete`, `document.body.innerText` contendo 2.524 caracteres, `DANFE` e `CHAVE DE ACESSO`, sem iframes. O PDF nasce da impressão desse HTML, não de um arquivo PDF servido diretamente.

No Network foram comprovadas as seguintes requisições da mesma página (sem conservar parâmetros ou segredos):

- `POST` com HTTP 200 em `https://novaapi.vendaerp.com.br/v3/CriaDANFE/GetDanfeInfoPublic`, com parâmetro `g` validado;
- `GET` com HTTP 200 de `main.<hash>.js`, `styles.<hash>.css` e `fiscal-nfe-nfe-module.<hash>.js` em `https://d1fkuoqvag3bur.cloudfront.net/v3/`.

Outras origens de recursos foram observadas (`fonts.googleapis.com`, `cdn.jsdelivr.net`, `code.jquery.com`, `s3-sa-east-1.amazonaws.com`), **sem paths/métodos comprovados nesta evidência**. Elas não são liberadas automaticamente; caso tenham importância para integridade visual/fiscal, exigir prova específica antes de ampliar a policy.

O renderer antigo só permitia `GET/HEAD` para a origem `app.vendaerp.com.br`; portanto barrava de forma determinística a API de montagem da DANFE e os bundles citados. Isso explica uma incompatibilidade entre navegadores. O bloqueio registrado no canário anterior é consistente, mas não prova por si só que o novo renderer será suficiente.

**Slice de correção:** `erp.vendaerp.danfe_to_pdf` opta por allowlist finita e proxy HTTPS com TLS/SNI do hostname, IP público resolvido e fixado antes da requisição, corpo limitado, headers sensíveis filtrados e redirects HTTP 3xx recusados. O Chromium recebe as respostas por `route.fulfill` (sem socket externo para subrecursos); o bootstrap HTTP local com nonce permanece. Chamadas de API fiscal autenticada, envio WhatsApp, XML, storage e providers externos não mudam.

**Gates:** testes adversariais offline → PR/CI → merge/publicação de imagem e deploy healthy → canário real. Prova de funcionamento continua sendo PDF íntegro e fiscalmente correspondente, aceito no sender canônico e recebido pelo administrador. Não reconsultar VendaERP real para diagnosticar, não aumentar timeout sem evidência e não logar URLs fiscais, `t`, `g`, XML ou PII.

## Diagnóstico HTTPS do renderer — revisão offline de 12/10/2026

O canário de 11/10/2026 às 23h48 (Brasília), mesmo após a PR #100, confirmou busca
fiscal, mas duas falhas `danfe_download_failed` e nenhum PDF enviado. O campo
`evidencia_egress_browser=destino_fora_origem` mostra que houve bloqueio de
recurso externo, mas não prova que **esse recurso** causou o DOM/PDF vazio.
Um transporte HTTPS previamente autorizado também podia falhar sem categoria na auditoria.

A revisão isolada acrescenta `evidencia_transporte_browser` ao diagnóstico
de falha da DANFE. É uma enumeração fechada: família `post` (recurso público
autorizado), `get` (subrecurso autorizado) ou `origem` (página principal),
com causa `http_recusado`, `timeout` ou `falhou`. O campo é independente
da evidência de egress. Só são aceitos valores finitos na auditoria; URL,
querystring, credenciais, HTML, PDF e identidade fiscal não são registrados.
O proxy passa a preservar seu código sanitizado de timeout, antes mascarado
como falha genérica. Nenhum destino ou método novo foi autorizado.

**Limite de prova:** RED→GREEN de testes sintéticos e CI não resolvem por si
só a geração da DANFE real. Esta instrumentação permite diferenciar a
falha do transporte autorizado do bloqueio de recursos não autorizados
em um futuro turno legítimo. Não repetir o canário nem chamar o VendaERP
somente para diagnóstico. O aceite segue condicionado à DANFE válida
recebida na conversa autorizada.

## DANFE: ordem de texto do PDF comprovado — 12/10/2026

O documento administrativo **realmente recebido** no WhatsApp em 05/10
foi reaberto somente em memória a partir do `whatsapp-media` privado,
sem nova chamada VendaERP ou publicação de dados fiscais. Seu PDF contém
uma página, texto extraível e os rótulos DANFE/CHAVE DE ACESSO. A extração
retorna os 44 dígitos da chave **antes** do rótulo, e não imediatamente
depois, como exigia a validação anterior.

A validação foi ajustada para exigir **uma única** chave candidata de
44 dígitos no corpo principal do documento, coincidindo com a chave
fiscal estruturada já comprovada no ERP. As seções marcadas de documentos
fiscais referenciados não contam como identidade principal. Zero ou mais
de uma candidata falham fechado; nunca usar número da NFe como substituto
da chave ou texto de erro como comprovação. Testes sintéticos cobrem
inversão da ordem, chave principal divergente, referência fiscal e
sequências artificiais de dígitos.

**Limite:** corrigir a validação de um PDF gerado não faz a SPA do
VendaERP voltar a carregar. O canário de 11/10 às 23h48 gerou PDF sem
texto/DOM fiscal não confirmado. **Geração/impressão ainda precisa de
correção separada e aceite real de uma DANFE no WhatsApp**; não reverter
proteções SSRF/egress nem repetir VendaERP para investigar.

## Bootstrap controlado — prova real offline no Alpine (12/10/2026)

A comparação sintética no worker publicado `5aaa69ca` comprovou que entregar
um bootstrap HTTP 302 por `route.fulfill` **não** faz a continuação do redirect
receber nova interceptação Playwright. O renderer controlado tentava conexão
direta para a página principal, saltando o transporte HTTPS pinado. Sob
`--network none`, falhou em `chromium_navegacao`; o controle PR #37 imprimiu a
mesma SPA local com conteúdo fiscal correto.

A correção valida o bootstrap existente, mas entrega HTML 200 efêmero com uma
nova navegação JavaScript interceptável. Allowlist, DNS/TLS pinado, identidade
fiscal e sender da PR #36 foram preservados. Prova final: cinco casos reais
na imagem Alpine, PDFs com chave/produto/total sintéticos conferidos pelo extrator
canônico; o comando de workflow passou 68/68. Isto não comprova que o bootstrap
foi a única causa do canário anterior nem substitui UMA DANFE real após os gates.
Resultados, RED→GREEN, PDFs e limitação preexistente de `release:conferir`:
[`danfe-bootstrap-offline-20261012.md`](../testing/danfe-bootstrap-offline-20261012.md).

## DANFE — impressão direta da página carregada (proposta de 12/10/2026)

O proprietário solicita imprimir o conteúdo da página pública do VendaERP
imediatamente após o evento `load` do Chromium, sem validação de conteúdo fiscal.
O modo `impressaoDireta` é opt-in na policy `erp.vendaerp.danfe_to_pdf`:

- esperar `load` e imprimir uma única vez sob `media=screen`;
- não ler DOM fiscal, não verificar DANFE, chave de acesso nem extrair texto do PDF;
- reaproveitar o bucket privado `whatsapp-media`, a mensagem e sender canônicos;
- manter restrições de navegação, egress/SSRF, auth, tamanho/formato de mídia
  do sender, before_send e ledger, sem novo provider/bucket;
- limite explícito: evento `load` não confirma que os dados assíncronos da SPA
  terminaram; um PDF pode retratar tela em branco ou erro. Isso não equivale a
  aceite fiscal nem funcional de duas DANFEs corretas.

Não executar canário real antes de CI green, merge, imagens e deploy saudável.

## Impressão direta de SPA assíncrona — revisão offline proposta 12/10/2026

O canário real das 17h27 BRT após PR #105 enviou um documento
`application/pdf` (status `read`), mas o proprietário abriu o arquivo e
constatou que a **página estava em branco**. Assim, entrega de PDF não significa
renderização bem-sucedida. O evento `load` do navegador é insuficiente para
aplicações que buscam dados públicos depois da navegação.

A proposta preserva `impressaoDireta` (sem procurar textos `DANFE` ou chave,
sem extrair/comparar conteúdo fiscal do PDF), mas aguarda a resposta COMPLETA
e HTTP 2xx da chamada pública específica de montagem,
`POST /v3/CriaDANFE/GetDanfeInfoPublic?g=<uuid já autorizado>`, observando-a
via Playwright antes da navegação. Depois espera `networkidle` e dois frames
do navegador com CSS de tela, para que JavaScript assíncrono consiga atualizar
a página antes da **única** impressão.

Não são liberados novos hosts, métodos ou URLs; o transporte HTTPS fixado,
a policy de egress/SSRF, o storage privado e o sender canônico continuam.
Se a chamada não ocorrer, falhar ou a rede não estabilizar no prazo já
existente, **não envia PDF incompleto**. O critério é exclusivamente
prontidão de carregamento HTTP e navegador, **não validação de NFe**.

Mesmo essas condições não garantem que toda SPA desenhou conteúdo correto:
esta é uma hipótese de correção técnica e deve ter teste Chromium offline
antes de PR green, merge, imagens, deploy saudável e novo canário controlado.
Nenhuma chamada real VendaERP é feita para investigar esta hipótese.

## Canário administrativo 20h19 — 12/10/2026: falha na navegação do Chromium

Após o operador desligar o JEV, a mensagem administrativa de 20h19min41s
(Brasília) foi recebida; o agente respondeu às 20h21min06s, em **texto**
(status final `read`), sem anexo PDF. Auditoria `api_audit_log` da mesma
execução comprova:

- `crm_erp_prepare_admin_danfe`, `success=false`, motivo
  `danfe_download_failed`, código `download_falhou`,
  `etapa_renderizacao=chromium_navegacao`,
  `autenticacao_same_origin=false`;
- `crm_erp_get_invoice`, `success=true`, minutos depois, no mesmo request;
- ledger aceitou somente uma mensagem de texto, nenhuma mídia PDF.

**Limite da prova:** a categoria `chromium_navegacao` pode indicar falha
do bootstrap, da transição JS, do evento `load` ou da montagem pública
esperada pela SPA. Ausência de `evidencia_transporte_browser` na auditoria
não prova que a rede funcionou ou que o destino foi bloqueado. Não extrair
ou registrar URLs fiscais/HTML/texto do PDF para tentar resolver a dúvida.

**Correção defensiva proposta (offline, não implantada):** no modo de
recursos controlados do navegador, aguardar apenas `commit` no bootstrap
local HTTP 200, validar que ele realmente ocorreu e então aguardar
`waitForURL` da URL fiscal HTTPS **exata**, com `domcontentloaded`.
A navegação genérica sem `recursosBrowser` mantém o fluxo anterior.
O renderer não deve aceitar uma página intermediária como DANFE,
nem contornar pinning/allowlists por falha de navegação.

Os testes adicionados reproduziram **RED 2 novos / 61 existentes PASS**
no código anterior e **GREEN 63/63** após o ajuste, sem chamada ao
VendaERP. Isso **não comprova** que a transição seja a única causa da
falha real; falta validação na imagem de worker e um canário novo **apenas
após** CI green, merge, publicação e deploy healthy. A issue #55 permanece
aberta até conteúdo real correto da DANFE e envio no WhatsApp.

## DANFE — chunks webpack do CloudFront (13/10/2026)

O diagnóstico trazido pelo operador após a falha de 12/10 identificou que a
página pública fiscal possui chunks compartilhados webpack com `~` no nome
(`default~fiscal-nfe-nfe-module~fiscal-nfse-nfse-module.*.js`).
A `main` em `318eb9bacba1295a7e25622e34e14b7cfac3503e` ainda
aceitava no CDN apenas `[a-z0-9_-]+` seguido de hash hexadecimal e extensão
`.js`/`.css`: essa política recusava deterministicamente os nomes apresentados,
independentemente de a URL fiscal principal ser válida.

Reprodução **offline no código antigo:** 23/24 testes passaram, 1 falhou
exatamente ao exigir liberação desses chunks. Com a adição restrita de
`~` ao segmento do nome, o conjunto de segurança do adapter, os
testes do renderer e os de PDF genérico passaram **92/92**. Permanecem
proibidos hosts alternativos, métodos não previstos, query/fragment do
CDN, hashes não hexadecimais, extensões arbitrárias, paths fora de
`/v3/` e traversal. Não mudaram egress/SSRF, credenciais, DNS pinado,
timeout, XML, consulta ERP nem sender WhatsApp.

**Distinção de evidência:** o teste com navegador real e `ChunkLoadError`
foi relatado pelo operador, não repetido nesta sessão. O defeito da regex
e a regressão RED→GREEN foram comprovados localmente. Outros riscos
continuam **não medidos**: arquivo `main.js` maior que o limite por
recurso, prazo de rede no worker e efeitos de scripts externos não
autorizados. Não ampliar os controles apenas por hipótese.

**Aceite:** a correção da allowlist só poderá ser considerada funcional após
CI green, merge, publicação de ambas as imagens, deploy saudável por SHA
exato e um único canário WhatsApp com DANFE fiscal correta e legível.
A issue #55 permanece aberta até duas notas comprovadamente mais recentes
e dois PDFs enviados na conversa correta.

## DANFE — transporte HTTPS pinado e orçamento confirmado em reprodução externa (13/10/2026)

**Evidência do operador / GLM-5.3:** a DANFE pública foi reproduzida em um
navegador e depois pelo renderer controlado fiel ao commit `b008542`.
Sem `User-Agent` explícito, o CDN retornou `200 text/html` com cerca
de 2,3 KiB no lugar dos bundles JavaScript; o browser não montou o
Angular nem disparou o POST público da DANFE. Com `User-Agent`, surgiu o
segundo bloqueio: `main.js` tinha aproximadamente 10,9 MB, maior que o
limite de 8 MiB dos bytes HTTP e do corpo descomprimido. Segundo o
experimento relatado, o ajuste de headers, tamanho e prazos gerou um PDF
fiscal legível em cerca de 7,4s. O PDF e a URL reais **não foram lidos
nem repetidos nesta sessão**; a prova específica do experimento foi
fornecida pelo operador, não por um teste independente desta branch.

**Revisão do núcleo reaproveitado (não abrir novo provider):**
- `recurso-browser-pdf-pinado.ts` envia `User-Agent` literal
  `HeadlessChrome/156` controlado pelo servidor, sem propagar header
  fornecido pela SPA. Anuncia somente `gzip, br`; reutiliza a
  descompressão já implementada. Eleva o limite de bytes recebidos e
  descomprimidos para **16 MiB**, mantendo vedação de bomba de compressão.
  Prazo por operação até **12s**.
- `renderizar-url-pdf-controlado.ts` usa deadline por etapa de **12s**
  e aceita até **60s totais** apenas quando a política explicitamente
  solicita. Fluxo genérico sem prazo informado mantém os 28s anteriores.
  `vendaerp-danfe-pdf.ts` já solicitava `timeoutMs: 60_000`.
- **Invariantes preservadas:** DNS público e IP pinado, TLS+SNI por
  hostname, host/path/método allowlisted, sem cookies/Authorization,
  sem redirects 3xx, resposta redigida, CSP/CORS selecionados, sem
  mudança no sender, armazenamento, identidade fiscal ou ERP READ-ONLY.

**Teste local offline em checkout isolado:** 3 testes RED no código
anterior (UA, limite 11 MiB, prazo 12s); os casos de gzip/br e limite
descomprimido já passavam. A implementação exige regressões de 11 MiB,
corpo acima de 16 MiB, inflação gzip acima de 16 MiB, headers seguros,
prazos, renderer e PDF genérico. Não se deve confundir essa cobertura
com uma segunda reprodução real contra o VendaERP.

**Aceite pendente:** CI `green` → merge `main` → publicação de app/worker
pelo SHA → deploy Portainer seguro → saúde/version exatas → **um** canário
WhatsApp administrativo. Issue #55 não é resolvida até a entrega de
duas DANFEs corretas e legíveis das duas NFes mais recentes distintas.
