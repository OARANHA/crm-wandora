# ERP — notas por razão social sem resolução prévia

- Perguntas administrativas que já são sobre pedidos/notas podem consultar `crm_erp_search_orders` diretamente por Nome/Razão Social; a resolução de cliente deixa de ser pré-requisito.
- Timeout da varredura opcional de Pessoas por razão social agora falha fechado como `busca_nome_incompleta` e preserva candidatos seguros da busca direta.
- VendaERP continua somente leitura; nenhuma rota, credencial ou payload bruto novo é exposto ao agente.
