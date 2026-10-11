# Busca de últimas NFes sem exigir mês para N maior que três

- Removida restrição arbitrária de `mes_ano` para `quantidade=4..20` em `crm_erp_search_recent_invoices`, mantendo os limites de paginação, janela fiscal regressiva, identidade do destinatário e falha fechada.
- Adicionados testes offline de cinco NFes distintas/ordenadas sem período, projeção sem XML/URL para ISIS e teto de paginação.
- Documentação canônica atualizada para deixar explícito que a busca fiscal e a entrega de múltiplos PDFs são etapas distintas.
- **Não altera o sender, limite global de mensagens, PDF renderer, schema, migrations ou provider VendaERP; não constitui aceite das duas/cinco DANFEs.**
