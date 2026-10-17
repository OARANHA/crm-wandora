---
type: patch
---

- Porta a unificação do catálogo de fusos horários disponível em DeskcommCRM v1.84.0: primeiro acesso, Configurações › Empresa e Configurações › Perfil passam a ler `lib/tempo/fusos.ts`.
- Opções anteriormente presentes apenas no onboarding (como Cuiabá, Rio Branco, Madri, Nova York e Los Angeles) continuam disponíveis na edição posterior; Roma e Guayaquil entram no catálogo sem alterar o fuso de contas existentes.
- `FUSO_PADRAO` permanece `America/Sao_Paulo`; não há ajuste automático ou gravação de fuso, nem mudança na lógica anti-ban/agenda.
- Teste de regressão protege a unicidade e verifica a aceitação de cada código IANA via `Intl`. Testes de navegador e produção não executados.
- Sem banco, schema, migrations, ERP, provider ou deploy.
