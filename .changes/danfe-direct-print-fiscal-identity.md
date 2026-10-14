---
impacto: correcao
secao: corrigido
titulo: DANFE impressa exige prova da chave fiscal da nota
---
A impressão direta usada pela DANFE VendaERP agora confere a chave fiscal comprovada pelo ERP no PDF final antes de autorizar a entrega, reutilizando a validação existente. A recusa de PDF divergente é fail-closed e gera somente categoria técnica sanitizada. A impressão genérica sem chave informada conserva o comportamento anterior; não muda a allowlist, o transporte HTTPS pinado, o timeout, o ERP read-only nem o sender do WhatsApp. Testes de Chromium real com SPA sintética devem validar o comportamento antes de produção.
