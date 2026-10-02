# Evidência visual — Elus login + Integrações ERP

Entrega: `candidate/elus-login-erp-20261002`.

Arquivos versionados:

- `login-elus-desktop.png` — fachada Elus em desktop;
- `login-elus-mobile.png` — fachada Elus em viewport mobile;
- `integracoes-erp-vendaerp.png` — módulo instalado, VendaERP visível em modo “Somente leitura”.

As superfícies foram inspecionadas a partir dos artifacts dos gates focados no head funcional
`3782d82acfcc04d81abb9a83305359b5735ffe71`:

- Elus login verification, run `36987807665`, artifact `elus-login-visual-evidence`;
- ERP browser verification, run `36987808174`, artifact `erp-browser-visual-evidence`.

A prova ERP de navegador não usa credencial real nem chama o VendaERP: a spec usa
`https://127.0.0.1:54321` e exige `unsafe_url:private_host` antes de qualquer fetch.
Os assets aprovados em `public/brand/elus/` não são alterados por esta pasta.
