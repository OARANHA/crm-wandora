---
type: minor
---

Permissões técnicas de IA por organização, negadas por padrão e delegáveis exclusivamente por Superadmin full, respeitando MFA. Provedor, modelo, credencial/BYOK e modelo operador podem ser liberados separadamente. Autorizações valem também para REST, server actions e onboarding; chaves legadas, índices e agentes publicados não são apagados ao revogar. Chutes de instalação permanece destinado a embeddings Qwen3, não à conversa.

Persistência: coluna protegida \`organizations.ai_autonomy\`, separada de \`settings\`
para garantir que gravações concorrentes de configurações comerciais não ressuscitem
autorizações revogadas. Migração 0506 contém trigger fail-closed contra
modificações diretas por sessões authenticated; somente service_role após gate
Superadmin full/MFA atualiza os grants.
