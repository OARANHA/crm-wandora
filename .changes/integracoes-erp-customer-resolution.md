---
impacto: capacidade_nova
secao: adicionado
titulo: Clientes do ERP ganham identidade reutilizável
---

A consulta de clientes do módulo Integrações ERP passa a resolver uma identidade estável no Elus e devolver um `contact_id` reutilizável. O vínculo usa o ID externo como autoridade, falha fechado em ambiguidade e não transforma erro do provider em “não encontrado”. No VendaERP, consultas de pedidos podem reutilizar esse vínculo: Nome/Razão Social apenas estreita a busca e o backend confirma `pessoaID` antes de expor os pedidos. O ERP continua somente leitura.
