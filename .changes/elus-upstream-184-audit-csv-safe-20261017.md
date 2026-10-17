---
type: patch
---

- Importa de DeskcommCRM `v1.84.0` a correção de `GET /api/v1/audit/export`: paginação determinística por `created_at` e `id`, contagem exata na primeira página e teto de 10.000 registros, mesmo quando o PostgREST limita cada resposta a 1.000 (ou menos).
- Reutiliza o helper upstream `lib/csv/neutralizar-formula.ts` para reduzir execução de fórmulas de planilha nos campos exportados, com testes originais de regressão para entrada potencialmente maliciosa, filtros e limites.
- Escopo isolado: sem migration, DDL, alteração de tenants, AI, ISIS, VendaERP, DANFE ou configuração de produção. Não importa workflows nem modifica o tema/branding ELUS.
- Fonte: `melgarafael/DeskcommCRM` tag `v1.84.0`, arquivos e blobs conferidos na branch. Esta mudança é um slice incremental, **não** sincronização completa do upstream.
