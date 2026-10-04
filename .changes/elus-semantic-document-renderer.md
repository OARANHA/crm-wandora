---
type: patch
---

O Elus passa a separar a renderização de documentos da integração ERP: uma capability interna com policy explícita converte URLs autorizadas em PDF, e o VendaERP usa um adapter semântico específico para DANFE.

A capability genérica não é exposta como tool MCP ao modelo, não recebe credenciais do ERP e falha fechado quando a policy rejeita a URL. O contrato administrativo existente permanece compatível.
