# Upstream strategy

This repository is the Wandora/Elo distribution of DeskcommCRM.

- **origin**: https://github.com/OARANHA/crm-wandora.git
- **upstream**: https://github.com/melgarafael/DeskcommCRM.git
- **deployment branch**: `main`
- **deployment target**: Elo / Wandora

## Rules

1. Never deploy directly from the upstream repository.
2. Never force-reset Elo `main` to `upstream/main`.
3. Fetch upstream changes first and review them in a dedicated branch/PR.
4. Resolve conflicts in favor of preserving Elo-specific branding, integrations and deployment configuration unless an upstream fix intentionally replaces them.
5. Keep the upstream MIT license and attribution.

## Configure a clone

Run:

```bash
git remote set-url origin https://github.com/OARANHA/crm-wandora.git
./scripts/wandora-sync-upstream.sh
```

The helper only configures/fetches `upstream`; it does **not** merge anything into `main`.
