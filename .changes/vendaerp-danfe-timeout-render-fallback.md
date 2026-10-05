---
type: patch
---

O DANFE público do VendaERP agora usa a capability de renderização por Chromium como fallback quando o fetch HTTP direto expira. O fallback só é permitido para a rota pública estritamente allowlisted do VendaERP; URLs fora dessa allowlist continuam falhando por timeout sem renderização.

A mudança mantém o VendaERP somente leitura, não amplia egress e não expõe a URL externa do DANFE ao modelo.
