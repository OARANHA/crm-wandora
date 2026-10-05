# Governed Cross-Conversation Delivery Seam V1

## Estado

Implementado como seam interno de mensageria. O primeiro consumidor real é o fluxo
existente de `approved_reply`. Este documento não autoriza ainda o agente administrativo
nem o ERP a escolher uma conversa de terceiro.

## Problema

Uma ação pode nascer numa conversa e precisar produzir uma mensagem em outra conversa.
Trocar apenas `conversationId` no fim é incorreto: `before_send` teria avaliado
opt-out, LGPD, pacing e sessão do contato de origem, enquanto o sink enviaria para outro
destinatário.

A regra é: **o contexto avaliado precisa ser o contexto do destino**.

## Seam canônico

`lib/agent-engine/agent/governed-conversation-delivery.ts` recebe somente identificadores
internos já resolvidos pelo chamador e:

1. carrega a conversa pelo par `organization_id + conversation_id`;
2. reidrata `contact_id` e `channel_session_id` a partir dessa conversa;
3. carrega do contato destino os campos usados para derivar LGPD;
4. carrega da sessão destino o limite diário;
5. falha fechado se conversa, contato esperado ou sessão esperada não conferirem;
6. quando há mídia, exige `whatsapp-media/{organization}/{conversation}/...` da conversa
   destino;
7. chama `runBeforeSend` com `leadId`, sessão, LGPD e limites do destino;
8. somente depois chama `RuntimeSendChannel`.

A camada abaixo permanece única:

`RuntimeSendChannel → WahaChannelAdapter → sendTurnMessage → send_ledger → sendMessageHandler → adapter`.

O `sendMessageHandler` continua sendo a última defesa: relê a conversa com filtro de
organização, recusa contato bloqueado, revalida ownership de `media_storage_path`, resolve
o canal real da conversa, grava a mensagem, audita `message.sent` e emite o evento normal.

## Duas autoridades, sem mistura

O seam **não decide quem pode ordenar uma entrega** e não resolve cliente, telefone ou
conversa por texto do modelo. Essa autoridade fica no chamador e deve produzir IDs internos
já autorizados.

Depois disso, o seam aplica os guardrails do destinatário real. Autorização administrativa
não substitui opt-out, LGPD, política do canal, pacing ou ownership da mídia do destino.

## Reuso de approved reply

`approved_reply` já possuía o padrão correto: policy persistida de destino, reidratação de
contato/sessão, `before_send` e sender canônico. Ele agora usa o seam compartilhado, mas
mantém sua semântica própria:

- `assertApprovedReplyPg` continua sendo a autoridade do reply;
- `contact_id` e `channel_session_id` da policy são tratados como expectativas e
  confrontados com a conversa reidratada;
- a policy é revalidada novamente imediatamente antes do dispatch;
- receipt/reconciliação/settle continuam no handler de `approved_reply`.

Portanto o novo seam compartilha a camada inferior; ele não transforma outras entregas em
`approved_reply`.

## Service boundary e jobs

O sender canônico ainda exige o `job_queue` e a fronteira de serviço vigente.
Consequentemente, uma futura ação administrativa para terceiro **não pode reutilizar o job
da conversa administrativa** e apenas trocar o destino. O futuro chamador precisará criar
ou usar uma intenção/job governada cuja fronteira seja compatível com a conversa destino.

Essa restrição é deliberada: impede que este V1 vire um bypass cross-conversation.

## Mídia

O seam aceita apenas referência interna de storage. Para documento:

- `kind=document`;
- MIME esperado para DANFE: `application/pdf`;
- path precisa pertencer à organização e à conversa destino.

Ele não recebe URL VendaERP e não materializa DANFE. A produção do documento é
responsabilidade da camada que o origina; a entrega é responsabilidade da mensageria.

## Auditoria

Este V1 não cria uma trilha paralela. As provas continuam nas camadas canônicas:

- `before_send_traces` para os guardrails;
- `send_ledger` para a intenção/idempotência;
- `messages` para o objeto outbound;
- `api_audit_log` via `message.sent`;
- eventos normais de mensagem.

A futura capability que ordenar uma entrega a terceiro deve auditar separadamente a
**autoridade para ordenar a ação** (ator, origem, destino e operação) antes de chamar o seam.
Isso não deve ser confundido com os guardrails do destinatário.

## Não objetivos deste V1

Não implementa:

- NFe → cliente → contato → conversa;
- escolha de destinatário pelo modelo;
- telefone arbitrário;
- novo sender;
- novo provider de canal;
- escrita no VendaERP;
- chamada real ao VendaERP;
- envio real de WhatsApp;
- bypass de service boundary;
- cópia de mídia da conversa administrativa para a conversa destino.

## Provas adicionadas

Os testes do seam cobrem:

- same-tenant por consulta da conversa;
- conversa inexistente;
- contato esperado inconsistente;
- sessão esperada inconsistente;
- `before_send` recebendo contato, sessão, limite e LGPD do destino;
- sender recebendo a `conversationId` destino;
- documento PDF preservado como documento;
- rejeição de path pertencente a outra conversa.

As garantias de `send_ledger`, `sendMessageHandler`, opt-out e ownership no sink continuam
nos testes das respectivas camadas canônicas; o seam não as reimplementa.

## Primeiro consumidor: DANFE do cliente vinculado à nota

A composição ERP mantém a autoridade administrativa da origem separada da identidade do cliente e
dos guardrails do destino. O backend resolve pedido/Pessoa ERP, reconcilia um único contato CRM,
exige uma única conversa não terminal com sessão ativa e captura a `fn_service_boundary` dessa
conversa.

O PDF é materializado diretamente no namespace da conversa destino. Um job `governed_delivery`
revalida a fronteira e termina neste seam; não troca o `conversation_id` de um turno administrativo
já em execução.

## Cliente identificado sem conversa anterior

Se a NFe resolve para um único contato CRM já existente, mas ele ainda não possui conversa
elegível, a composição pode iniciar o thread do cliente sem reutilizar a fronteira do admin.
A origem administrativa é revalidada; a sessão escolhida é a mesma da conversa administrativa;
e a nova fronteira nasce exclusivamente de `fn_service_begin` para o contato do cliente.

O contato precisa já existir, estar ativo e possuir telefone discável. Não há criação de contato,
fuzzy match, `fn_upsert_wa_contact` nem telefone arbitrário vindo do modelo. A fronteira
retornada pelo RPC pertence ao destinatário e é a única que segue para `governed_delivery`.

