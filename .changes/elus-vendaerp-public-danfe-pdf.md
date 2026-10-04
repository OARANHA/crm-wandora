---
type: patch
---

O Elus passa a materializar o DANFE público do VendaERP quando a `UrlImpressaoDanfe` aponta para a SPA oficial `app.vendaerp.com.br/v3/public/NFe/Danfe`.

O fallback é fechado para host, path e parâmetros conhecidos, não envia credenciais do ERP ao navegador, gera o PDF em diretório temporário e remove os artefatos ao final. URLs HTML de outros destinos continuam recusadas.
