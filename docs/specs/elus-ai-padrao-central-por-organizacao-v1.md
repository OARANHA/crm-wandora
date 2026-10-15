# ELUS — IA da plataforma por organização (V1)

Status: implementação candidata, sem merge nem deploy.
Base: OARANHA/crm-wandora main 35c397cb064c6731cb9fc56003b7431aba7681e1.

## Autoridade e reuso

A página Tenants/[id] recebe a seção IA fornecida pela plataforma. O valor já
consumido pelo runtime está em organizations.settings.llm (provider, default_model).
Não duplicar provider, executor, credencial ou capability. Modelos vêm de ai_models;
provedores de lib/ai/pontos/provedores.ts e disponibilidade de chaves do helper
lerAmbiente e metadados seguros de ai_provider_credentials. Nenhuma chave é exibida.

O padrão é POR ORGANIZAÇÃO. Não existe nesta V1 uma nova configuração global
em cascata: criar uma organização continua usando o fallback/seed existente.

## Precedência e comportamento

O default aplica-se somente a pontos elegíveis que não tenham configuração
com prioridade superior. Permanecem invariantes pontos fixos; agentes com
versão publicada e seu provider/model/credential_id; ai_purpose_bindings
habilitados; herança dos pontos auxiliares e knobs de ambiente, segundo
lib/ai/pontos/resolver.ts. Nenhuma alteração em ai_agents, ai_agent_versions,
ai_purpose_bindings ou organizações vizinhas. Não afeta o vínculo ERP/ISIS.

## Segurança

GET exige requirePlatformAdmin e só expõe metadados sem segredos.
PATCH exige UUID validado, requireSupportWrite e
requirePlatformAdminEscrita (full, MFA aplicável, sem suporte).
Provedor passa no catálogo único ehProvedorSuportado; modelo é checado em
ai_models, recusado se desconhecido quando o catálogo do provedor não está
vazio. Catálogo vazio preserva a entrada manual, com aviso explícito.
Leitura/merge de organizations.settings com comparação otimista
.eq(settings, JSON.stringify(settingsAnterior)), retornando 409 em conflito;
branding e security preservados, autonomia em coluna independente intocada.
Auditoria registra exclusivamente fornecedor/modelo anterior e novo.

## Gates de aceite

Prova de isolamento A/B; escrita full + MFA, recusas para manager, suporte e
support_readonly; versão publicada e binding próprio imutáveis; concorrência
gera 409; disponibilidade de credenciais não promete execução de modelo.
Typecheck, lint, unit, invariantes DB e E2E na CI, sem polling de Actions.
Não fazer merge nem deploy nesta rodada. O proprietário informa GREEN/RED.

Fora do escopo: cadastrar chaves em texto, faturamento/quotas por tenant,
catálogo global de pacotes de modelos e mudança automática de agentes publicados.

## Esclarecimento de UX após deploy (15/10/2026)

O seletor da V1 exibia apenas ids técnicos, inclusive custom, sem explicar
a diferença entre registrar padrão e provisionar a credencial. A correção
mostra o nome da organização selecionada, usa o rótulo do registry único e
explica que um gateway personalizado requer Base URL HTTPS e token em
IA > Chaves de acesso à IA, com a organização ativa correta. Esta tela
não grava tokens nem endpoints e não habilita por si só modelos inexistentes.
Quando a empresa não tem credencial validada, salvar um modelo não a cria.

A administração delegada de credenciais por organização a partir do
Superadmin permanece fora do escopo deste ajuste de copy: deverá reutilizar
o mecanismo existente de credenciais com autorização full/MFA e proteção
contra suporte, jamais duplicar armazenamento de segredos.

A falha de abertura do editor de agentes reportada por evento Sentry
não está atribuída a esta interface; requer stack trace de telemetria ou
erro reproduzível em navegador autenticado antes de corrigir a causa.

## Evolução V2 — credenciais no Superadmin

A V1 original excluía cadastrar chaves e endpoints no Superadmin.
Essa limitação gerou uma tela incapaz de provisionar o tenant sem entrar
na conta da empresa. O contrato governado posterior está em
[elus-credenciais-plataforma-superadmin-v1.md](elus-credenciais-plataforma-superadmin-v1.md).
Ele reutiliza ai_provider_credentials/AES-GCM, valida antes de ativar
e acrescenta credential_id explícito ao settings.llm do tenant.
