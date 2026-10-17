---
type: patch
---

- Porta seletivamente do upstream DeskcommCRM v1.84.0 a barra de ações horizontal rolável no cabeçalho da conversa em telas menores que `md`, impedindo que múltiplas fileiras de botões consumam a altura do chat.
- Mantém todos os botões no DOM, sem menu de ações ocultas; o `flex-wrap` segue valendo em telas médias/grandes. Reduz apenas o padding/gap no celular e restaura o espaçamento original a partir de `md`.
- Amplia a catraca `tests/unit/inbox-header-nao-trava.test.tsx` para exigir `max-md:flex-nowrap`, rolagem horizontal, filhos sem encolhimento, largura da coluna e padding responsivo. Testes de layout em jsdom validam classes, não largura visual.
- Sem API, Auth, schema, migration, ERP, envio, provider, alteração no banco ou deploy. Sonda visual em navegador real e canário de produção permanecem pendentes.
