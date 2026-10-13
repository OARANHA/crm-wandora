---
impacto: nada_mudou
secao: corrigido
titulo: DANFE corrige recursos do CDN servidos por HTTPS pinado
---

O renderizador fiscal passa a enviar um User-Agent fixo controlado pelo
servidor, anunciar gzip e brotli e permitir bundles JavaScript de até 16 MiB
tanto na leitura HTTP quanto após descompressão. O prazo por recurso passa
a 12 segundos e a política DANFE pode usar o teto explícito de 60 segundos,
mantendo o padrão genérico de 28 segundos sem timeout configurado.

Os controles de origem, host, caminho, método, DNS/IP público pinado,
TLS/SNI, proibição de redirects e credenciais, validação documental e
sender canônico não mudam. Testes offline não substituem o canário real
de PDFs íntegros entregues pelo WhatsApp após publicação e deploy.
