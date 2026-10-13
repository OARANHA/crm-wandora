---
impacto: nada_mudou
secao: corrigido
titulo: DANFE admite chunks webpack compartilhados do CDN fiscal
---

A allowlist estrita dos recursos públicos da DANFE VendaERP passa a aceitar
`~` nos nomes de bundles JS/CSS versionados do CDN autorizado. Isso permite
chunks compartilhados gerados por code-splitting sem ampliar domínios,
origens, métodos HTTP, formatos, caminhos, parâmetros ou extensão de hash.

A falha anterior foi reproduzida por teste unitário vermelho, e os testes
offline voltaram a passar após a alteração. O aceite funcional continua
dependendo de DANFEs corretas e legíveis enviadas pelo WhatsApp.
