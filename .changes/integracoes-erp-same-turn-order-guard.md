---
impacto: correcao
secao: corrigido
titulo: Consulta de notas preserva pedidos já encontrados
---

Quando a busca por pedidos no VendaERP encontra resultados por Nome/Razão Social, o agente não volta a tentar resolver o mesmo cliente apenas para validar o cadastro no mesmo turno. Buscas paralelas pelo mesmo nome aguardam o resultado dos pedidos; se não houver pedidos, a resolução de cliente continua disponível.
