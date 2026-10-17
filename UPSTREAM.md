# Upstream strategy

This repository is the Wandora/Elus distribution of DeskcommCRM.

- **origin**: https://github.com/OARANHA/crm-wandora.git
- **upstream**: https://github.com/melgarafael/DeskcommCRM.git
- **deployment branch**: `main`
- **deployment target**: Elus / Wandora

## Rules

1. Never deploy directly from the upstream repository.
2. Never force-reset Elus `main` to `upstream/main`.
3. Fetch upstream changes first and review them in a dedicated branch/PR.
4. Resolve conflicts in favor of preserving Elus-specific branding, integrations and deployment configuration unless an upstream fix intentionally replaces them.
5. Keep the upstream MIT license and attribution.

## Configure a clone

Run:

```bash
git remote set-url origin https://github.com/OARANHA/crm-wandora.git
./scripts/wandora-sync-upstream.sh
```

The helper only configures/fetches `upstream`; it does **not** merge anything into `main`.

## Baseline medido da distribuição

Última reconciliação manual: **2026-10-02**.

- A árvore importada que originou o Elus corresponde funcionalmente à release upstream **1.69.0**
  (merge upstream `e8e2912178031d321caf0912b270ee06bd2c36c7`), com a exceção deliberada dos workflows
  GitHub que o bootstrap da distribuição não trouxe.
- `origin/main` medido em 2026-10-02: `35834ef00bc6610172b2acb4b22f7d779eae32fb`.
- `upstream/main` medido em 2026-10-02: `efed1d5745f87dfeaf3adbe8bc6165bc684a7a75`.
- Entre a release 1.69.0 e esse `upstream/main`, os merges de primeiro pai relevantes são:
  - #2058 — correção da Agenda na virada do mês;
  - #1978 — correção do hook de migrations;
  - #1987 — `feat/org-operante`, a fundação de suspensão real exigida pela cobrança;
  - #2071 — cache do Playwright no CI/E2E.
- A migration upstream de `org-operante` é
  `supabase/migrations/20260930180000_0501_org_operante_e_suspensao_tipada.sql`.

Este bloco é uma fotografia, não uma licença para confiar nos SHAs para sempre. Antes de cada
sync, rode o fetch e meça novamente. Se `upstream/main` avançou, a nova medição substitui esta.

## Overlay que pertence ao Elus

Depois do snapshot inicial, as customizações próprias da `main` do Elus estavam concentradas em:

- `.changes/elus-worker-runtime-env.md`;
- `UPSTREAM.md`;
- `compose.portainer.yml`;
- `docs/handoffs/HANDOFF-CRM-WANDORA.md`;
- `scripts/wandora-sync-upstream.sh`;
- remoção do workflow temporário de bootstrap.

Esses caminhos não autorizam escolher "ours" cegamente num conflito: servem para chamar atenção
do revisor. Branding, integrações e deploy próprios que vivam em branches ainda não mergeadas
também precisam ser reconciliados depois do sync da `main`.

## Regra operacional de sync

1. Não implementar de novo uma capacidade antes de verificar se ela já chegou ao upstream.
2. Criar branch dedicada a partir da `main` atual do Elus.
3. Buscar `upstream/main` e medir o delta contra o baseline upstream já absorvido.
4. Trazer o delta conscientemente; não resetar nem substituir a `main`.
5. Preservar o overlay Elus e não importar workflows upstream automaticamente sem revisão explícita.
6. Reconciliar migrations pelo número real disponível na `main` + PRs abertos.
7. Rodar os gates exigidos por `AGENTS.md`/`CLAUDE.md`.
8. Só então abrir PR de sync para a `main`.
9. Depois do merge do sync, atualizar/rebasear por merge as branches vivas antes de retomá-las.

### Colisão conhecida em 2026-10-02

O PR #7 do Elus (VendaERP) usa hoje uma migration `0501`. O upstream também passou a usar
`0501` para `org-operante`. Portanto, depois de absorver o upstream e antes de mergear o PR #7,
a migration VendaERP precisa ser renumerada para o próximo número livre, atualizando migration,
baseline/MANIFEST e qualquer referência/teste correspondente. Não editar a migration upstream já
aplicada.

## Preflight de atualização para DeskcommCRM 1.84.0 — 2026-10-16

> **Somente levantamento, não sincronização concluída.** Não houve importação da release,
> aplicação de migration, merge, publicação de imagens nem deploy nesta etapa.

### Evidência de versão e distância

- **Elus `main` medido:** `92ed055be0973cc2e4944fd82248a8bc687dbff5`
  ([commit](https://github.com/OARANHA/crm-wandora/commit/92ed055be0973cc2e4944fd82248a8bc687dbff5)).
- **Última sincronização upstream identificada:** [PR #9](https://github.com/OARANHA/crm-wandora/pull/9),
  integrada, baseada no upstream `efed1d5745f87dfeaf3adbe8bc6165bc684a7a75`. Isso
  descreve a âncora do último sync identificado, **não** garante ausência de ports
  individuais posteriores.
- **Versão upstream desejada:** [v1.84.0](https://github.com/melgarafael/DeskcommCRM/releases/tag/v1.84.0),
  publicada em 2026-10-16, tag apontando para o commit
  `a932e33d2cf3dd29a012c469cadbf80ad3a7c3da`.
- **Delta no upstream entre a âncora da PR #9 e v1.84.0:** o compare retornou
  `ahead_by=3645` commits. A API entregou somente os primeiros **300 caminhos**
  no diff desse intervalo; **não** existe aqui um inventário completo de arquivos,
  merges ou conflitos.
- **Delta isolado entre upstream v1.83.0 e v1.84.0:** `187` commits e `227`
  arquivos alterados, incluindo **seis migrations SQL** e `supabase/baseline.sql`.
  Comparação:
  [v1.83.0...v1.84.0](https://github.com/melgarafael/DeskcommCRM/compare/v1.83.0...v1.84.0).

### Benefícios candidatos, ainda NÃO portados nem comprovados no Elus

- Inbox: filtro por atendente, passagem de negócio entre funis, correções de escopo
  de assumir/transferir conversa, handoff concorrente e escolha de agente ativo
  antes do agente pausado.
- Comercial: ações em lote de contatos; atualização opcional de leads repetidos
  em fontes de webhook; origem de anúncio Click-to-WhatsApp disponível para IA.
- Operação: correções em paginação da agenda Google, renderização do Inbox,
  marcação como lida em resposta via WAHA QR e exportação administrativa CSV.
- Cobrança: plano padrão no cadastro, provisionamento com resposta
  `409 plano_obrigatorio` quando aplicável e regras de upgrade proporcional.
- API da IA: acesso a roteadores via token `dsk_` com escopos apropriados.

A existência ou ausência efetiva desses recursos no Elus deve ser provada
**por código, um por um** antes de propor mudanças; a nota de release não é
prova de que a distribuição ainda não os possua.

### Gaps e riscos que bloqueiam um merge amplo

1. **Histórico upstream longo:** não importar somente o patch v1.84.0 sobre
   a âncora de outubro sem reconciliar dependências intermediárias.
2. **Schema:** medir a próxima numeração livre de migration na `main` e
   nas PRs concorrentes; revisar a tripla migration + baseline + MANIFEST e
   testar atualização com dados, banco descartável PostgreSQL 15 e 17.
3. **Produto Elus:** preservar o login/branding, políticas de convite e
   cadastro, IA gerenciada pelo platform admin, autorização por tenant e
   customizações de billing. Verificar especificamente a exigência de plano
   padrão antes de alterar fluxos de cadastro ou provisionamento.
4. **ERP/ISIS:** preservar VendaERP estritamente read-only, resolução fiscal
   fail-closed, vínculo de identidade externa, DANFE e sender WhatsApp canônico.
5. **WhatsApp/RBAC:** mudanças de leitura automática e visibilidade/transferência
   precisam ser compatíveis com WAHA e políticas existentes; não criar bypass.
6. **Infra/CI:** preservar `compose.portainer.yml`, runtime do worker,
   rollback por digest; não importar workflows upstream sem revisão.
7. **Prova ausente:** testes, CI de port da 1.84.0 e saúde de produção
   pós-atualização **não foram realizados** nesta avaliação.

### Decisão e próximos gates

- **NO-GO para merge/deploy direto da v1.84.0.**
- Medir o delta **completo** por árvore/commits no ambiente de desenvolvimento
  autorizado e identificar integrações upstream já absorvidas, sem confundir
  patch de release com atualização de todo o intervalo.
- Dividir a atualização em PRs independentes: **(1)** correções operacionais
  e segurança, **(2)** funcionalidades comerciais/Inbox/webhooks,
  **(3)** cobrança/cadastro e alterações estruturais de schema.
- Para cada fatia: `REAL NOW → PROVEN EVIDENCE → GAPS → REUSE GATE →
  CORE/PROVIDER GATE → DECISION → testes → PR → CI`.
- Após cada CI disparado, não fazer polling; o proprietário informará
  `green` ou `red`. Merge, imagens e deploy requerem gates separados.
- Produção não deve receber imagem upstream direta nem build pesado na VPS;
  o deploy posterior exige SHA exato, digests/rollback, `prune:false` e
  canário funcional.

Este registro é datado e **não substitui** nova reconciliação de `main`,
PRs, migrations ou runtime no momento da execução.
