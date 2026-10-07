---
impacto: correcao
secao: corrigido
titulo: Consulta de notas preserva pedidos e materializa cliente por identidade ERP
---

Quando a busca por pedidos no VendaERP encontra resultados por Nome/Razão Social e todos os pedidos carregam a mesma `pessoaID`, o Elus reutiliza ou cria o vínculo do cliente automaticamente pela autoridade já existente, sem uma segunda varredura em `Pessoas/Pesquisar`. A resposta traz o `contact_id` estável junto dos pedidos.

Buscas paralelas de cliente pelo mesmo nome aguardam esse resultado e só são bloqueadas quando a identidade dos pedidos já foi resolvida. Resultado vazio, `pessoaID` ausente/inconsistente ou materialização não comprovada continuam permitindo o fallback de resolução de cliente. Mais de uma `pessoaID` falha fechado como ambiguidade.
