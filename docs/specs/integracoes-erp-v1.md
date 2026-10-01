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

A migration `0501_integracoes_erp_modulo_oficial` cria somente a função
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

### Evidência complementar e lacunas do Swagger

O Swagger recebido não declara schema de resposta para Estoque/BuscarQuantidades nem para Fiscal/ConsultarNFE. A V1 não inventa esses corpos.

Em 2026-10-01 foi observada, por teste manual autenticado no próprio Swagger UI, a resposta real de Estoque/BuscarQuantidades com envelope EstoqueItens e os campos ProdutoCodigo, EstoqueAtual e SaldoReservado. A tool stock.read passou então a usar o endpoint dedicado. Esses dois números são preservados separadamente; o Elus não calcula "disponível" enquanto a semântica dessa relação não estiver documentada.

Depositos/GetTodosDepositos é formalmente documentado no Swagger como Deposito[]. O teste manual também confirmou que o parâmetro deposito de BuscarQuantidades aceita o nome do depósito. Se a tool não receber depósito, o provider lista os depósitos: com um único, usa-o; com vários, devolve as opções e não escolhe sozinho.

O Swagger continua sem tipar o corpo dos dois endpoints fiscais, mas em 2026-10-01 foram observadas respostas reais para ambos. invoice.get passou a usar Fiscal/ConsultarNFE diretamente e projeta somente código/mensagem de status, número, chave, lote e URL do DANFE. O campo Xml retornado pelo provider é descartado antes de chegar ao agente. Fiscal/InformacoesVenda também foi mapeado no provider por código da venda, com tipo, número, série, chave, data de emissão e URL de impressão; ele permanece como leitura interna nesta V1, sem criar uma sexta capability pública.

O histórico de evidência, decisões e pendências fica em docs/specs/integracoes-erp-vendaerp-descobertas.md.
