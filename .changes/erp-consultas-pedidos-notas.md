---
impacto: comportamento
secao: corrigido
titulo: Consultas de pedidos e notas respeitam a data certa
---

O agente pode consultar pedidos e notas no mesmo turno com filtros por período e ordenação sem confundir data de cadastro com data de faturamento. Consultas que precisam provar “últimas” ou “maiores” paginam o conjunto e falham fechado quando o volume excede o limite seguro, em vez de apresentar um ranking parcial como se fosse completo. A integração continua somente leitura e usa a mesma capability ERP, a mesma autoridade e a mesma auditoria já existentes.
