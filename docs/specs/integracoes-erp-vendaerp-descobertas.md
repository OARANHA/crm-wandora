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
