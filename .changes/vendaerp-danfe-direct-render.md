---
type: patch
---

A rota pública allowlisted do DANFE VendaERP agora é renderizada diretamente pelo Chromium, sem gastar antes o timeout do fetch HTTP genérico. A policy especializada do VendaERP usa timeout de 60s; a capability genérica permanece com 35s.

URLs de outros ERPs continuam no caminho genérico existente.
