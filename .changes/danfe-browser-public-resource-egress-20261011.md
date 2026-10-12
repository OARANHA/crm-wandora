# fix(danfe): carregar recursos públicos necessários à impressão do VendaERP

- Adiciona allowlist exclusiva do renderer `erp.vendaerp.danfe_to_pdf` para o `POST/OPTIONS` comprovado de `GetDanfeInfoPublic` e bundles JS/CSS versionados do CloudFront em `/v3/`.
- O renderer genérico mantém a política anterior. Recursos externos da DANFE autorizados são obtidos por HTTPS com IP público previamente validado e fixado, verificação TLS/SNI, corpo e prazo limitados, sem seguir 3xx, sem cookies/Authorization/Referer sensível; respostas entram no Chromium via `route.fulfill`.
- A DANFE continua sendo o HTML já montado pelo VendaERP, impresso por Playwright. PDF permanece sujeito à validação estrutural e à chave fiscal comprovada; storage privado e sender WhatsApp não mudam.
- A evidência veio do Network/DOM em navegador do proprietário (11/10/2026). Não houve nova consulta real ao VendaERP nem canário de produção. Permanece fail-closed para dependências adicionais não comprovadas, timeout/erro de rede, redirect, falha de identidade fiscal e PDF inválido.
- Testes de allowlist, bloqueio de IP interno, recusa de redirects e guardas do renderer. Aceite real exige novo canário após CI green, merge, publicação e deploy healthy.
