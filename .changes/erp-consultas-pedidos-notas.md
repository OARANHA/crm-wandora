---
impacto: comportamento
secao: corrigido
titulo: Consultas de pedidos e notas respeitam a data certa
---

O agente pode consultar pedidos e notas no mesmo turno com filtros por período e ordenação sem confundir data de cadastro com data de faturamento. Consultas que precisam provar “últimas” ou “maiores” paginam o conjunto e falham fechado quando o volume excede o limite seguro, em vez de apresentar um ranking parcial como se fosse completo. Na superfície administrativa Testar agente, a consulta de pedidos/notas pode ser exercitada em dry-run/read-only sem inventar um contato WhatsApp; essa exceção é interna, restrita a `crm_erp_search_orders` e não libera DANFE nem escrita. A integração continua somente leitura e usa a mesma capability ERP, a mesma auditoria e os gates de autoridade já existentes nos turnos reais.
