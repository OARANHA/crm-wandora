---
type: patch
---

O renderer interno de documentos passa a iniciar o Chromium com `--no-sandbox` no runner containerizado do Elus. O container não concede os namespaces exigidos pelo sandbox interno do navegador; sem a flag o Chromium abortava com EPERM antes de carregar o DANFE.
