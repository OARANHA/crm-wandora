---
impacto: correcao
secao: corrigido
titulo: Consulta de notas resolve cliente por sinais fortes do próprio pedido
---

Quando `Pedidos/Pesquisar` encontra pedidos por Nome/Razão Social mas `pessoaID` vem ausente ou incompleta, o Elus usa CPF/CNPJ ou e-mail consistentes do próprio pedido para uma única resolução direta da Pessoa no VendaERP. Não há varredura ampla por nome, e qualquer `pessoaID` parcial precisa concordar com a identidade resolvida antes de criar ou reutilizar o vínculo local.

O adapter também aceita o casing PascalCase já observado em respostas reais do provider para os campos internos de identidade do pedido. Falhas de identidade agora registram no audit um subtipo seguro, sem PII.
