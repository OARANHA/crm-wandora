---
impacto: nada_mudou
secao: corrigido
titulo: Consulta fiscal administrativa não é interrompida por sentimento negativo
---

Mensagens de WhatsApp pertencentes a um administrador comprovado pelo vínculo
da organização, membership ativo e capacidade `erp.admin.read` não são
automaticamente transferidas ao atendimento humano apenas pela classificação
negativa do JEV. A proteção por sentimento continua funcionando para contatos
comuns e para quem não tem a autoridade administrativa comprovada.

A mudança reutiliza o guard existente e não altera chamadas ao VendaERP,
autorização de tools, PDFs, sender ou dados fiscais. Conversas já transferidas
continuam exigindo a ação humana `Devolver ao automático`.
