---
type: patch
---

- Adapta da DeskcommCRM v1.84.0 o status acessível da bolinha de comando na lista da Inbox: além da cor, ela anuncia o estado pelo rótulo canônico com `role="img"`, `aria-label` e `title`.
- Uma conversa fechada que conserva o atendente histórico anuncia "Encerrada", não "Em atendimento". A cor da responsabilidade passada não precisa ser alterada para traduzir esse estado.
- O estado vem de `comandoDaConversa`, `ROTULO_DO_COMANDO` e `STATUS_ENCERRADOS` existentes; não cria segunda classificação.
- Testes de regressão cobrindo automático, humano, encerrado com dono, organização sem automático e grupo. Gate focal para typecheck, lint, formatação e testes; acessibilidade E2E e produção não medidas.
- Nenhum schema, provider, ERP, sender, RLS, runtime, imagem ou deploy é alterado.
