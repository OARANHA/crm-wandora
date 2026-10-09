---
impacto: capacidade_nova
secao: corrigido
titulo: Consulta fiscal recupera identidade de pedidos vinculados antigos
---
A busca administrativa de notas passa a reutilizar a identificação fiscal de pedidos
apenas quando o ID externo comprova o mesmo cliente e a paginação é completa.
Caso contrário, retorna um erro seguro, sem informar ausência de notas.
