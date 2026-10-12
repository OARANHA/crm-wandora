# DANFE: validação da chave fiscal na ordem extraída

- Corrigida a exigência indevida de adjacência do rótulo `CHAVE DE ACESSO`
  ao número principal no texto linear do PDF. O PDF real entregue em
  05/10/2026 contém chave antes do rótulo, apesar de ser válido visualmente.
- Exige uma única chave candidata no corpo fiscal principal com identidade
  igual à chave estruturada do ERP; ignora área de notas referenciadas
  e falha fechado em ambiguidade.
- Acrescentados testes de regressão sintéticos.
- Não modifica renderização, egress, provider, armazenamento ou WhatsApp.
  Impressão da SPA ainda precisa de correção; não declarar DANFE resolvida.
