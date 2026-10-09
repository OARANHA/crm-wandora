# Diagnóstico seguro da renderização de DANFE

- Divide a etapa agregada de Chromium pós-redirect entre espera do conteúdo
  fiscal e impressão do PDF, sem revelar URLs nem identidade fiscal.
- Mantém os gates de SSRF, DNS público fixado, mídia privada e sender canônico.
- Inclui testes offline de timeout e cleanup; não altera o tempo limite,
  não chama o VendaERP e não atesta a entrega real das DANFEs.
