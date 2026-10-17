---
type: patch
---

- Corrige a derivação histórica R2 de demandas a partir de conversas: o backfill no `supabase/baseline.sql` ignora conversas `archived` que não possuem demanda anterior. Não transforma um atendimento já arquivado em uma pendência artificial do Radar após `update.sh`.
- O trecho R2 do ELUS foi comparado integralmente com o upstream imutável `melgarafael/DeskcommCRM@v1.84.0`. O bloco era idêntico exceto por `where cv.status <> 'archived'` seguido de `and not exists`, restaurado sem reescrever as regras R1/R3 ou migrações anteriores.
- Porta o invariante de banco upstream com controles positivos para estados abertos/fechados, não derivação de arquivadas, idempotência de duas passadas, preservação de demanda multicanal e reabertura inbound no mesmo tenant. Reusa `tests/invariants/gov-helpers.ts`, cujo SHA é igual ao upstream.
- CI da PR executa `test:db` com baseline install + update em PostgreSQL 15 e 17, além da regressão `atualizacao-nao-reduplica-demanda`, typecheck, ESLint e validação do workflow.
- **Não faz limpeza retroativa** de eventuais demandas antigas já criadas; a correção é preventiva. Sem nova tabela/coluna/migration, sem escrita no VendaERP, sem deploy ou canário.
