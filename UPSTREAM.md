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
