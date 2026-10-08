# Integrações ERP — V1

## Decisão

`Integrações ERP` é um **módulo oficial opcional com tabelas próprias**, instalado na instância pela mesma porta da ADR-0002 usada por Honorários. Não é extensão declarativa e não depende de serviço externo da Wandora.

O primeiro provider é `vendaerp`.

## Escopo da primeira etapa

A primeira etapa é **somente leitura**. O provider expõe estas capacidades:

- `products.search`
- `stock.read`
- `customers.search`
- `orders.search`
- `invoice.get`

O contrato já nomeia as capacidades futuras de escrita, mas elas ficam `habilitada: false`:

- `orders.save`
- `orders.invoice`
- `invoice.issue_nfe`
- `invoice.issue_nfce`
- `orders.delete`

Isso impede que a primeira entrega tenha uma rota acidental de mutação e permite evoluir sem trocar a fronteira do módulo.

## Fonte do contrato VendaERP

O Swagger entregue para esta integração declara:

- autenticação pelos headers `Authorization-Token`, `User` e `App`;
- limite de 1.000 requests/hora por chave;
- leitura de produtos em `Produtos/Pesquisar`;
- descoberta de depósitos em `Depositos/GetTodosDepositos`;
- leitura de estoque em `Estoque/BuscarQuantidades`;
- leitura de pessoas/clientes em `Pessoas/Pesquisar`;
- leitura de pedidos em `Pedidos/Pesquisar`;
- consulta de informações fiscais por venda em `Fiscal/InformacoesVenda`;
- consulta de NFe/NFCe em `Fiscal/ConsultarNFE`;
- criação/alteração de pedido em `Pedidos/Salvar`;
- salvar e faturar em `Pedidos/SalvarEFaturar`;
- emissão em `Fiscal/EmitirNFE` e `Fiscal/EmitirNFCE`.

As últimas quatro operações não são expostas na V1.

## Instalação e dados

A migration `0502_integracoes_erp_modulo_oficial` cria somente a função
`fn_integracoes_erp_provisionar()`.

A tabela `erp_connections` nasce apenas quando o administrador da instalação instala
`integracoes_erp` em `/admin/modulos`.

A conexão é por organização e provider. Nesta versão há no máximo uma conexão VendaERP por organização.

## Credenciais e rede

`Authorization-Token`, `User` e `App` são cifrados com AES-256-GCM antes da gravação.

A tabela de credenciais é fechada a `anon` e `authenticated`; as rotas do host autenticam o usuário, resolvem a organização ativa e só então usam `service_role` com filtro explícito de `organization_id`.

A URL é escolhida pela organização, portanto passa pela mesma guarda de destino externo usada pelos providers personalizados: bloqueio de rede interna, validação DNS e redirect manual. A guarda é reaplicada em cada request para reduzir risco de DNS rebinding.

## Superfícies

- administração da instalação: `/admin/modulos`;
- configuração da organização: `/app/integracoes-erp`;
- API de configuração: `/api/v1/integracoes-erp/conexoes`;
- teste da conexão: `/api/v1/integracoes-erp/conexoes/test`.

O teste usa `Configuracoes/Get`, uma leitura autenticada sem efeito de domínio.

## Evolução

A etapa de escrita deve ser construída sobre o mesmo provider e com gates explícitos de autoridade:

1. pedido;
2. faturamento;
3. emissão fiscal;
4. consulta de autorização/documento;
5. envio ao cliente pela camada de mensagens do Elus.

O provider ERP nunca deve enviar WhatsApp por conta própria. Documento fiscal recuperado do ERP entra na cadeia de mensageria existente, preservando auditoria, status, janela e transporte do CRM.

## Ferramentas do agente

A V1 publica cinco capacidades no catálogo já existente do Elus, todas como read, requiresRole agent, requiresScope mcp:read e condicionadas ao módulo integracoes_erp:

- crm_erp_search_products;
- crm_erp_read_stock;
- crm_erp_search_customers;
- crm_erp_search_orders;
- crm_erp_get_invoice.

Elas usam o mesmo catálogo MCP do restante do produto; não existe uma segunda infraestrutura de tools para ERP. O mesmo gate de módulo retira as capacidades do agente, do MCP externo e da tela quando integracoes_erp não está instalado.

Os filtros de busca são redigidos antes de entrar no log de auditoria. O payload do VendaERP não é entregue cru ao modelo: Produto, Pessoa e Pedido passam por projeções internas do Elus.

## Customer Resolution / ERP Identity Link V1

A busca de cliente deixa de ser apenas uma consulta textual e passa a poder materializar uma
identidade reutilizável no Elus. O vínculo pertence ao `contact` canônico, nunca ao lead, e
fica em `erp_customer_identity_links`, tabela opcional do próprio módulo.

O contrato separa duas coisas que não podem ser confundidas:

- `external_id`: identidade estável da Pessoa no provider; no VendaERP é `Pessoa.id`;
- `provider_lookup_label`: texto aceito pela busca downstream do provider; não é identidade.

A resolução pública distingue `resolved`, `ambiguous`, `not_found` e `unresolved`.
Erro do provider nunca vira `not_found`, e ambiguidade nunca seleciona o primeiro resultado.
Uma resolução por nome compara de forma normalizada `nome`, `nomeFantasia` e
`razaoSocial` retornados pela Pessoa. Quando CPF/CNPJ ou e-mail também são informados, esses
sinais precisam concordar; um vínculo antigo por rótulo não pode ignorá-los.

O Swagger de `Pessoas/Pesquisar` expõe `nomefantasia`, CPF/CNPJ, e-mail e Identificador
Único como filtros, mas não documenta um filtro separado `razaoSocial`. Por isso a V1 não
inventa esse parâmetro. A resolução por nome tenta primeiro `nomefantasia`; se essa chamada não
trouxer correspondência exata, faz uma varredura paginada e limitada somente de clientes,
comparando `nomeFantasia` e `razaoSocial` no backend. Se o limite for atingido sem provar
unicidade, o estado permanece `unresolved` e pede um identificador mais forte, em vez de
declarar `not_found`. Se a busca direta respondeu mas essa varredura opcional expirar, o estado
também permanece `unresolved/busca_nome_incompleta`: o timeout do fallback não vira indisponibilidade
do cadastro e candidatos seguros da busca direta podem ser preservados para confirmação. Razão social
também é preservada como rótulo de lookup quando um endpoint downstream documenta Nome/Razão Social.

Para `Pedidos/Pesquisar`, o Swagger documenta o filtro `cliente` como **Nome/Razão Social**
e o schema do pedido contém `pessoaID`. Não há filtro comprovado por `pessoaID`. Assim,
`crm_erp_search_orders(cliente_contact_id=...)` usa o rótulo persistido apenas para estreitar
a chamada e, antes de expor qualquer pedido, filtra novamente o retorno por
`Pedido.pessoaID === external_id`. Se nada do retorno confirma essa identidade, falha fechado.

Quando a pergunta já é sobre pedidos, compras, notas ou NFes e o administrador informou apenas
Nome/Razão Social, `crm_erp_search_orders(cliente=...)` é o caminho direto documentado e
`crm_erp_search_customers` não é pré-requisito. Se um `cliente_contact_id` já foi resolvido,
ele continua preferível por permitir a revalidação forte por `pessoaID`. Para uma NFe específica,
o número localizado nos pedidos alimenta `crm_erp_get_invoice`.

Quando o administrador pedir **a última nota** ou **as últimas N notas** de um cliente, a
capability recebe `ultimas_notas=N`, pagina os pedidos do cliente e só então seleciona localmente
os itens cujo retorno realmente contém `numeroNFe`, antes de ordenar pela data fiscal comprovada.
O parâmetro documentado `possuiNotaFiscal=true` não é usado como autoridade de filtragem: no
canário real de 2026-10-07 às 17:06 ele devolveu conjunto vazio para a Eco Projetos, embora uma
consulta do mesmo turno sem esse filtro tenha localizado uma NFe confirmada. Se
`Pedido.dataFaturamento` estiver ausente, o backend reaproveita `Fiscal/InformacoesVenda` pelo
código da venda para obter `dataEmissao`; se nem essa visão fiscal fornecer uma data utilizável,
a consulta falha fechado em vez de usar número de NFe, código do pedido ou ordem do provider
como aproximação temporal.

O canário de 2026-10-08 às 08h17 demonstrou uma perda de contexto no fallback: o agente chamou
`crm_erp_search_orders(cliente=..., ultimas_notas=2)` e recebeu conjunto vazio; em seguida
tentou `crm_erp_search_orders(cliente_contact_id=..., limite=20)` **sem** `ultimas_notas`.
Um resultado positivo da segunda consulta não comprova recência fiscal. Por isso, quando uma
busca por nome com `ultimas_notas=N` retornar vazia, a capability preserva temporariamente,
somente no mesmo `organizationId + requestId`, **a quantidade** pedida, sem gravar nome ou
identidade em cache. Uma continuação por `cliente_contact_id` que omitir `ultimas_notas`
recebe `continuacao_notas_sem_ranking`, antes de nova consulta ao ERP, e orienta repetir
a mesma busca com `ultimas_notas=N` após confirmar o vínculo correto. O guard não inventa
identidade ou notas, não substitui a validação do vínculo e não considera uma lista limitada
de pedidos como ranking fiscal.

No WhatsApp administrativo, **última(s) nota(s)** também significa entregar as respectivas
DANFEs ao administrador na conversa corrente. Para cada NFe selecionada, o agente prepara uma
DANFE e imediatamente executa o `send_message` que consome aquele documento; só então prepara a
próxima. Assim cada PDF atravessa o sender canônico, `before_send`, ledger e guardrails existentes,
sem URL externa nem `storage_path` no contexto do modelo.

A coordenação do mesmo turno é determinística: uma busca de pedidos por Nome/Razão Social registra
seu resultado pelo `requestId`. Quando todos os pedidos encontrados carregam a mesma `pessoaID`,
o backend reutiliza a autoridade de identidade da PR #45: procura vínculo ativo por
`organization/provider/external_id`, tenta localizar um contato local compatível por sinais fortes
já presentes no pedido (por exemplo e-mail; nome sozinho não é prova) e, se não houver, materializa
o contact e grava o vínculo pela mesma RPC transacional `fn_integracoes_erp_vincular_cliente`.
Esse caminho não chama `Pessoas/Pesquisar` e não cria um segundo contact quando já há vínculo
externo ou contato local inequivocamente compatível.

Se `pessoaID` vier ausente em parte ou em todos os pedidos, mas os pedidos trouxerem um único
CPF/CNPJ e/ou e-mail consistente, o backend pode fazer **uma única consulta direta** a
`Pessoas/Pesquisar` usando o sinal forte (CPF/CNPJ é preferido para estreitar a chamada) e exige
correspondência exata com todos os sinais fortes presentes. Uma `pessoaID` parcial, quando existe,
também precisa concordar com o `id` da Pessoa resolvida antes de qualquer materialização. Esse
fallback nunca faz varredura por nome/razão social. Sem sinal forte, com sinais conflitantes ou com
identidade divergente, o fluxo falha fechado e não expõe os pedidos.

A tool devolve `resolucao_cliente.contact_id` junto dos pedidos quando a identidade foi provada.
Uma resolução apenas por esse mesmo nome aguarda a busca se ela estiver em andamento e só é
bloqueada quando os pedidos já produziram uma identidade resolvida/materializada. Mais de uma
`pessoaID` no mesmo resultado é ambiguidade. Outro cliente, CPF/CNPJ, e-mail e outro turno não são
bloqueados. Falhas de identidade preservam no audit um subtipo seguro (sem PII) para distinguir
ausência de sinal, inconsistência, falha do provider ou ambiguidade.

Criação mínima de contato + vínculo é transacional e idempotente. Uniques parciais protegem o
mesmo `external_id` e o mesmo `contact/provider`; advisory locks fecham corrida de retries.
Correção invalida o vínculo antigo sem apagar o histórico. A tabela é server-only e declara sua
seção de LGPD pelo mecanismo D8 da ADR-0002.

### Evidência complementar e lacunas do Swagger

O Swagger recebido não declara schema de resposta para Estoque/BuscarQuantidades nem para Fiscal/ConsultarNFE. A V1 não inventa esses corpos.

Em 2026-10-01 foi observada, por teste manual autenticado no próprio Swagger UI, a resposta real de Estoque/BuscarQuantidades com envelope EstoqueItens e os campos ProdutoCodigo, EstoqueAtual e SaldoReservado. A tool stock.read passou então a usar o endpoint dedicado. Esses dois números são preservados separadamente; o Elus não calcula "disponível" enquanto a semântica dessa relação não estiver documentada.

Depositos/GetTodosDepositos é formalmente documentado no Swagger como Deposito[]. O teste manual também confirmou que o parâmetro deposito de BuscarQuantidades aceita o nome do depósito. Se a tool não receber depósito, o provider lista os depósitos: com um único, usa-o; com vários, devolve as opções e não escolhe sozinho.

O Swagger continua sem tipar o corpo dos dois endpoints fiscais, mas em 2026-10-01 foram observadas respostas reais para ambos. invoice.get passou a usar Fiscal/ConsultarNFE diretamente e projeta somente código/mensagem de status, número, chave, lote e URL do DANFE. O campo Xml retornado pelo provider é descartado antes de chegar ao agente. Fiscal/InformacoesVenda também foi mapeado no provider por código da venda, com tipo, número, série, chave, data de emissão e URL de impressão; ele permanece como leitura interna nesta V1, sem criar uma sexta capability pública.

O histórico de evidência, decisões e pendências fica em docs/specs/integracoes-erp-vendaerp-descobertas.md.

## ERP → Atendimento/WhatsApp — entrega controlada de DANFE

Destino arquitetural: **extensão/módulo oficial opcional**, consumindo capacidades core já
existentes. Nenhum ponto novo de envio é criado no núcleo.

O Inbox é a autoridade de associação cliente/conversa. A superfície contextual
`ErpDanfeCard` vive no painel da conversa e só aparece para quem já tem a
capacidade normal `inbox.reply` (papel `agent+`). Portanto:

- viewer não ganha envio;
- manager/admin herdam a mesma autoridade normal do Inbox;
- o agente de IA continua apenas com as cinco tools ERP `read`; nenhuma tool
  autônoma de envio de DANFE é criada;
- o provider VendaERP termina sua responsabilidade ao fornecer a referência de
  DANFE.

A preparação do documento acontece em
`POST /api/v1/conversations/[id]/erp`. Antes de reconsultar a NFe/NFCe, a rota
localiza o pedido da nota e prova no backend que o cliente do pedido é o mesmo
contato da conversa. A prova usa somente identificadores determinísticos que já
existem nos contratos: `pessoaID`, CPF/CNPJ e e-mail do `Pedido`; `id`,
CPF/CNPJ, e-mail, telefone e celular da `Pessoa`; e CPF hash/e-mail/telefone do
contato canônico do Elus. Nome nunca autoriza documento. Ambiguidade, ausência
de identidade comparável ou conflito falham fechado e nenhum DANFE é
materializado.

A rota nunca aceita uma URL de documento enviada pelo browser e nunca envia credenciais do
VendaERP para a referência de DANFE. A URL normalizada é buscada com
`fetchParaDestinoDaOrganizacao()`, que reaplica SSRF/DNS e não segue redirect. Quando a referência
é a SPA pública estritamente allowlisted do VendaERP e precisa de Chromium para virar PDF, a URL
sensível não entra no argv/process list: o renderer abre um endpoint efêmero somente em
`127.0.0.1`, protegido por nonce, que responde o redirect HTTP para o destino já autorizado enquanto a renderização estiver ativa.
Isso substitui o salto anterior por `file://` + JavaScript, que continuou expirando no canário real
de 2026-10-07 às 17:06 mesmo com timeout de 60 segundos.
O corpo é limitado a 50 MB e precisa ser reconhecido pela allowlist documental
já usada pelo upload outbound. Não se presume PDF: `application/octet-stream`
só vira PDF quando os próprios bytes contêm assinatura `%PDF-`.

Depois da validação, os bytes entram no bucket privado `whatsapp-media` no
path canônico da organização/conversa. A UI recebe apenas o path interno, MIME,
tamanho e uma signed URL temporária do próprio Storage; a `danfeUrl` externa
não é devolvida ao browser.

O clique **Enviar DANFE no WhatsApp** usa `useSendMessage` e, portanto, o mesmo
`POST /api/v1/messages` / `sendMessageHandler` / `lib/channels` de qualquer
documento enviado pelo atendente. A mensagem resultante usa a tabela
`messages`, a auditoria `message.sent`, o `event_log`, status e histórico
normais. Não existe segundo sender, segunda auditoria ou chamada de WhatsApp
dentro do provider ERP.

### Falha fechada e lacuna externa

Ainda não há evidência contratual de que a `danfeUrl` observada devolva bytes
sem autenticação adicional, qual MIME real ela usa ou se todos os ambientes do
VendaERP entregam o mesmo formato. Enquanto não houver canário explicitamente
autorizado, isso permanece **não provado**. Se a referência exigir credencial,
redirecionar, exceder o teto ou devolver HTML/MIME não documental, a preparação
falha sem enviar nada ao cliente.

### Laço de retorno / Sistema Vivo

- entrada real: conversa do Inbox + código de pedido/NFe;
- saída real: documento outbound pelo sender core;
- atividade/prova: `integracao_erp.danfe_preparada` na auditoria e
  `message.sent`/mensagem no histórico quando o humano envia;
- erro de preparação: fica na própria ação da UI e nada é enviado;
- erro de transporte: segue o status/erro normal da mensagem, visível no thread;
- continuidade IA↔humano: a IA pode localizar pedido/nota por tools read, mas a
  ação de preparar/enviar fica fora do catálogo MCP do agente.

## Admin WhatsApp Read-Only V1

Esta frente adiciona uma autoridade **administrativa de conversa** sem alterar a
autoridade de cliente da seção DANFE acima. As duas permanecem separadas:

```text
cliente WhatsApp
→ contato da conversa
→ Pedido/Pessoa VendaERP
→ CPF/e-mail/telefone conferem
→ documento daquele cliente

admin WhatsApp
→ contato da conversa
→ erp_admin_whatsapp_bindings
→ usuário Elus
→ user_organizations da MESMA organização, role=admin e não revogado
→ capability erp.admin.read
→ consultas administrativas read-only da organização
```

O vínculo é explícito e tenant-scoped. O V1 permite ao próprio administrador
ativo vincular o seu número em **Integrações ERP → WhatsApp administrativo**.
Não se usa uma identidade do VendaERP para autenticar o administrador e não
existe telefone mágico. A credencial VendaERP continua pertencendo à
organização.

No turno do agente, `crm_erp_search_customers`,
`crm_erp_search_orders` e `crm_erp_get_invoice` só entram no toolset quando
a autoridade administrativa acima foi resolvida. O gate é reaplicado antes da
execução. Quando a mesma autoridade existe e a consulta de NFe está habilitada,
o bridge acrescenta `crm_erp_prepare_admin_danfe`: ela materializa o documento
com o mesmo guard de egress, grava no bucket privado da própria conversa e
devolve um `preview_url` assinado por 10 minutos. A URL externa do VendaERP não
entra no contexto do modelo. O modelo devolve o preview ao administrador pelo
`send_message` normal. Produto/estoque continuam seguindo o contrato read-only
anterior. Nenhuma tool de write no VendaERP é acrescentada.

A resposta continua saindo pelo sender normal do agente para a conversa que
originou o turno. Não existe sender administrativo, provider paralelo ou troca
de telefone de cliente.

Cada consulta administrativa gera `integracao_erp.admin_consulta` com
`actor_user_id` do usuário Elus, organização, canal, capability, tool e
desfecho. Telefone, valor pesquisado, token ERP, XML e URL de DANFE não entram
nessa linha.

Quando uma renderização expira, a mesma auditoria pode incluir
`evidencia_pdf_timeout`, restrita às categorias `arquivo_ausente`,
`arquivo_vazio`, `sem_assinatura_pdf`, `sem_marcador_final`,
`marcadores_pdf_presentes` ou `inspecao_indisponivel`. A inspeção
é **passiva**: lê exclusivamente trechos limitados do arquivo PDF temporário
gerado pelo Chromium após o timeout. Não abre debug/CDP, não altera a
navegação/impressão e nunca registra bytes da nota, URL, token ou stderr.
`marcadores_pdf_presentes` **não prova** integridade, identidade fiscal ou
entrega do documento; somente informa que cabeçalho e terminador aparentes
estavam presentes no momento da inspeção. Ausência do diagnóstico
significa **não medido**, não ausência de PDF.

A tabela `erp_admin_whatsapp_bindings` é parte do próprio módulo
`integracoes_erp` e segue a ADR-0002: server-only, RLS ligada, sem grants para
`anon/authenticated`, provisionada somente onde o módulo foi instalado.

## ISIS — busca fiscal regressiva de NFes (2026-10-08)

Complemento READ-ONLY ao provider existente. O Swagger entregue nesta data documenta
GET /api/request/Fiscal/ConsultarNfePeriodo, com DataInicial e DataFinal
em mm-dd-aaaa, máximo de **um mês por chamada**, pageSize até 50 e skip.
A chave do VendaERP aceita até 1.000 requisições/hora. O Swagger **não fornece**
filtro por destinatário nem ordenação garantida no endpoint fiscal. O corpo HTTP
200 não tem schema, mas o exemplo real fornecido pelo proprietário contém Tipo,
Numero, Serie, ChaveAcesso, DataEmissao, XML e UrlImpressaoUrl.

Para o administrador WhatsApp com erp.admin.read, a nova ferramenta
crm_erp_search_recent_invoices é a autoridade para **últimas notas emitidas**.
crm_erp_search_orders permanece a capability de busca de pedidos, inclusive
seu parâmetro legado ultimas_notas=N; o agente deve preferir a busca fiscal
para recência de NFe e não inferir emissão pela posição em pedidos.

Política:

- quantidade omitida: **3**; quantidade de 1 a 3: consulta automaticamente
  mês corrente e, se faltar quantidade, retrocede até seis meses anteriores;
- quantidade de 4 a 20: exige mes_ano=AAAA-MM antes de qualquer consulta;
- mês explícito: consulta somente aquele mês; nenhuma chamada cruza meses;
- paginação completa do mês até retorno menor que 50; por chamada, no máximo
  12 páginas/mês e 24 páginas totais; limite atingido retorna
  consulta_parcial, **nunca** conclusão silenciosa;
- a seleção filtra NFes autorizadas e distintas por chave de acesso, ordena
  pelo DataEmissao fiscal validado; não ordena por número, pedido ou ordem
  fornecida pelo ERP;
- nome/CPF/CNPJ/contato vinculado passam pela resolução existente. Quando há
  destinatário indicado, a tool exige CPF/CNPJ confirmado pelo cadastro Pessoa
  e compara localmente com o documento do XML da NFe. Ambiguidade falha fechado;
- o XML, documento destinatário e URL externa do DANFE **não chegam ao LLM**.
  O adapter projeta somente metadados necessários e descarta os demais campos;
- entrega DANFE continua por crm_erp_prepare_admin_danfe e send_message
  sequencial, com controles atuais de sender, Storage privado, auditoria e egress;
- a busca pode falhar fechada quando excede sete meses, o mês retorna volume
  excessivo, o schema está incompleto ou o fornecedor não comprova a emissão.
  Nesse caso ISIS pede mês/ano; não declara ausência de NFes.

**Não incluído neste slice:** atualização de telefone em contatos já existentes
ou criação de contato de terceiro com telefone obrigatório; exige reconciliação
da migration/RPC local e gate de privacidade próprios, sem qualquer escrita
em Pessoas/Salvar do VendaERP.
