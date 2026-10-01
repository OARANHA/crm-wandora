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
- leitura de estoque em `Estoque/BuscarQuantidades`;
- leitura de pessoas/clientes em `Pessoas/Pesquisar`;
- leitura de pedidos em `Pedidos/Pesquisar`;
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

### Lacunas do Swagger recebido

O Swagger recebido não declara schema de resposta para Estoque/BuscarQuantidades nem para Fiscal/ConsultarNFE. A V1 não adivinha esses corpos.

Para a superfície do agente:

- stock.read usa uma única chamada a Produtos/Pesquisar, que aceita deposito e cujo schema Produto documenta estoqueSaldo e estoqueUnidade;
- invoice.get usa uma única chamada a Pedidos/Pesquisar?numeroNFe=..., porque o schema Pedido documenta numeroNFe, dataFaturamento, chaveAcessoNFe, danfeURL e urlSefaz.

Os endpoints dedicados de estoque e fiscal continuam mapeados no provider para uso futuro, mas seus payloads não entram no contexto do agente até que exista contrato de resposta verificável.
