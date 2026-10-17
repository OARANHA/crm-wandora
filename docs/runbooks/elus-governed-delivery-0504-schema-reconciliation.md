# ELUS — gate de reconciliação do schema 0504 em produção

> **ESTADO: PREPARAÇÃO / NO-GO PARA DDL.** Este documento não autoriza
> alteração de produção. Operador deve obter autorização administrativa explícita,
> provar backup/recuperação, executar preflight imediatamente antes da janela
> e registrar resultado verificável. Não contém credencial ou dado de cliente.
>
> Esta mudança trata exclusivamente a instalação **ELUS atual**. Não é o upgrade
> DeskcommCRM 1.84.0 e **não** libera importação massiva de migrations.

## Autoridade e evidência

- Repositório: `OARANHA/crm-wandora`, `main` observada em
  `5201cabe2c40dae7eb30b4cc3bf80530c3465e8c` (PR #133 integrada).
- SQL canônico, **único dono da definição**:
  `supabase/migrations/20261005150000_0504_integracoes_erp_entrega_danfe_governada.sql`;
  Git blob `acca2acd88d467706f664cd0bce97dd9c16eb471`.
  `supabase/baseline.sql` já incorpora os mesmos requisitos.
  **Não** criar migration concorrente, renomear a 0504 ou editar baseline para
  contornar o desvio de produção.
- A PR [#133](https://github.com/OARANHA/crm-wandora/pull/133) comprovou
  replay **duas vezes** da migration canônica em bancos **descartáveis**
  PostgreSQL 15 e 17, incluindo inserção de `governed_delivery`
  e unicidade de `origin_job_id + operation + codigo_nfe`.
  Essa prova não mediu locks, backup ou tabelas reais de produção.
- Identidade técnica verificada a partir de `elus-app` na VPS Vigia:
  Supabase project ref `xxhilhvtxfqcvpwxfsgb`, identificado no conector
  como `elo.wandora`. A comparação foi feita por **project ref**,
  não por nome amigável. A URL completa do pooler e credenciais não foram
  copiadas/exibidas. Não assumir que o conector genérico do Portainer aponta
  para a instância Vigia.
- Consulta **read-only** em 17/10/2026, nesse projeto, confirmou:
  `public.job_queue` com `job_queue_kind_check` e
  `job_queue_turn_needs_contact` válidas, mas **ambas sem**
  `governed_delivery`; índice parcial
  `uniq_job_queue_governed_delivery_origin_invoice` ausente.
  O ledger tinha 55 registros na inspeção anterior, nenhum identificado
  como 0504. O catálogo real prevalece sobre a inferência baseada no ledger.
- Volume na inspeção: `n_live_tup=82` **estimado**, tamanho total
  `221184` bytes (216 KiB), heap 81920 bytes, índices 98304 bytes;
  sem locks de relação observados **naquele instante**. Nem volume nem
  ausência pontual de locks garantem janela segura.

### Por que isso importa

`lib/integracoes-erp/entrega-danfe-terceiro.ts` chama
`job_queue.insert({ kind: "governed_delivery", ... })` depois de
materializar uma DANFE em storage privado. O CHECK antigo rejeita
essa inserção. O chamador tenta limpar a mídia e devolve `queue_failed`;
`workers/agent-worker/main.ts` já conhece o handler do job.
**Não afirmar que um canário ou DANFE específica falhou por essa causa**
sem correlacionar a auditoria existente. Não chamar VendaERP real para provar
este diagnóstico.

## Gates obrigatórios — ordem de execução

1. **Reconciliação do alvo:** confirmar `main`, SHA da imagem app/worker em
   produção, stack `elus` na instância correta do Vigia, health e conexão
   Supabase project ref. Não assumir que merge de teste implantou imagem.
2. **Preflight exclusivamente de leitura:** repetir queries abaixo diretamente
   pelo conector oficial do **mesmo projeto**, sem dados ou payloads reais.
   Confirmar **exatamente** duas CHECKs antigas válidas, ausência do índice
   0504, nenhum outro CHECK concorrente e ausência de alteração inesperada.
   Se a realidade já mudou, **parar**; não reaplicar por memória.
3. **Recuperação:** comprovar política de backup/PITR **realmente disponível**
   neste projeto, ponto de restauração recente, responsável, procedimento
   de recuperação e custos/tempo aceitáveis. Não alegar rollback de schema
   apenas porque imagens Docker antigas estão disponíveis.
4. **Concorrência:** dimensionar `job_queue` novamente, conferir locks,
   transações longas e jobs concorrentes na janela (somente agregados).
   O SQL 0504 faz `ALTER TABLE ... DROP/ADD CONSTRAINT`
   (`ACCESS EXCLUSIVE`) e `CREATE UNIQUE INDEX` padrão, com
   bloqueio de escrita durante a criação. Preferir janela de baixo tráfego
   e `lock_timeout`/timeout da operação explícitos; se não puder conter
   a janela ou não houver operador para abortar, **NO-GO**.
5. **Autorização:** obter uma aprovação administrativa **específica**
   para DDL no projeto certo, com SQL/hash, janela e rollback.
   `GREEN` de CI, esta PR ou aprovação de deploy não são aprovação de DDL.
6. **Execução planejada, ainda NÃO realizada:** aplicar **somente** o texto
   imutável da migration 0504, com atomicidade/rollback da transação, limites
   de lock e falha fechada. O executor escolhido deve garantir execução
   atômica e trilha auditável; não dividir o arquivo em commits parciais.
   Decidir **antes** como a aplicação será registrada sem falsificar
   `supabase_migrations.schema_migrations`: `migration repair`,
   `db push --include-all` e inserção manual de ledger são proibidos.
   A simples ausência do timestamp Git no ledger não prova SQL ausente.
7. **Postflight imediato:** confirmar as duas CHECKs válidas contendo
   `governed_delivery` com o mesmo vocabulário canônico, índice único
   parcial presente com `indisvalid=true` e `indisready=true`;
   confirmar health e worker, sem job real de teste nem PDF/WhatsApp
   automático. Registrar ticket, horário, erro ou sucesso e evidência
   redigida. Se qualquer validação falhar, parar e aplicar plano de
   recuperação aprovado, não tentar reparos improvisados.

## SELECTs de preflight/postflight (nunca INSERT, UPDATE ou DDL)

Usar conexão **somente de leitura** para estas consultas; consultar a identidade
do projeto pelo conector antes de qualquer SQL. Capturar apenas metadados.

```sql
SELECT conname, convalidated, pg_get_constraintdef(oid) AS definition
FROM pg_catalog.pg_constraint
WHERE conrelid = 'public.job_queue'::regclass
  AND contype = 'c'
  AND (conname IN ('job_queue_kind_check','job_queue_turn_needs_contact')
       OR pg_get_constraintdef(oid) ILIKE '%governed_delivery%')
ORDER BY conname;

SELECT idx.relname AS index_name, i.indisunique, i.indisvalid,
       i.indisready, pg_get_indexdef(i.indexrelid) AS definition
FROM pg_catalog.pg_index i
JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
WHERE i.indrelid = 'public.job_queue'::regclass
  AND idx.relname = 'uniq_job_queue_governed_delivery_origin_invoice';

SELECT s.n_live_tup AS estimated_rows,
       pg_total_relation_size('public.job_queue') AS total_bytes,
       pg_relation_size('public.job_queue') AS heap_bytes,
       pg_indexes_size('public.job_queue') AS indexes_bytes
FROM pg_catalog.pg_stat_user_tables s
WHERE s.relid = 'public.job_queue'::regclass;

SELECT mode, granted, COUNT(*) AS n
FROM pg_catalog.pg_locks
WHERE locktype = 'relation' AND relation = 'public.job_queue'::regclass
GROUP BY mode, granted
ORDER BY mode, granted;
```

Para aceitar o **estado antigo**: duas constraints com `convalidated=true`,
sem `governed_delivery`, mais índice ausente. Para aceitar o **estado novo**:
duas constraints válidas e contendo `governed_delivery`,
**mesmos predicados do SQL canônico**, e índice único parcial idêntico com
`indisvalid` e `indisready`. Outros estados são **inconclusivos/NO-GO**.
Consultar somente metadados; não listar `payload`, contatos, NFe, usuários,
chaves, documentos ou conversas.

## Falha e recuperação

- **Falha antes de COMMIT:** operação atômica devidamente configurada deve
  fazer rollback integral da transação; verificar catálogo e saúde antes
  de declarar estado intacto. Um timeout não garante, sozinho, que não houve
  commit — exigir readback.
- **Falha após COMMIT, antes do novo job:** avaliar reversão de DDL somente
  com autorização separada e recuperação comprovada. Não suprimir constraints
  nem deixar o índice ausente por improviso.
- **Após um `governed_delivery` real enfileirado:** as CHECKs antigas
  não permitem esse valor; reverter para o estado antigo pode falhar,
  bloquear a fila ou inviabilizar o replay. Priorizar correção prospectiva,
  suspensão governada da funcionalidade ou restauração validada, jamais
  `DELETE` de jobs/ledger para forçar rollback. Não reenviar DANFE.
- Exigir pós-gate humano e auditável da funcionalidade **somente quando**
  a versão adequada de app/worker estiver comprovadamente saudável.
  Problemas independentes de Chromium/DANFE não se resolvem com essa DDL.

## Escopo explicitamente excluído

Nenhum deploy, alteração em `main`, SQL de produção, `apply_migration`,
`migration repair`, envio WhatsApp, chamada VendaERP, manipulação de notas
ou alteração do ledger está autorizado por esta preparação. A importação das
106 migrations upstream (89 anteriores à última migration ELUS) continua
em uma trilha distinta e bloqueada.
