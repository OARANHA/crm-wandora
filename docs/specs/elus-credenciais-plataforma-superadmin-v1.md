# ELUS — Provisionamento governado de IA pela plataforma (V1)

Status: implementação em avaliação; sem deploy, credencial real ou mudança de tenant.
Autoridade: CLAUDE.md > docs/specs > docs/prd > handoffs.
Base inicialmente reconciliada: main afffed57f1f8f2609caa5101283b418fcda1a035.

## Intenção e fluxo verificável

O Superadmin escolhe a organização EXPLICITAMENTE por UUID no path,
sem se tornar membro e sem entrar na conta da empresa.
Na seção IA fornecida pela plataforma, o administrador de escopo full
seleciona custom; preenche nome, Base URL HTTPS de API compatível
com OpenAI e token; faz teste autenticado GET /models; cadastra a
credencial no storage EXISTENTE, sem variáveis de ambiente por tenant;
recebe validação síncrona antes da gravação; escolhe a credencial pelo ID e o modelo
comprovado e só então ativa o padrão daquela organização.

A configuração ativa é organizations.settings.llm:
{provider, default_model, credential_id}, preservando todos
os demais campos do settings e do llm. Não existe armazenamento
alternativo de chaves ou provider executável paralelo.

## Reutilização obrigatória

- Lista/identidade de provider: lib/ai/pontos/provedores.ts.
- Validador e SSRF: lib/ai/provider-validators.ts / fetchParaDestinoDaOrganizacao.
- Guardar/criptografar/auditar, com validação síncrona confirmada pelo servidor:
  lib/ai/credenciais/guardar.ts e ai_provider_credentials.
- GET da lista: ai_provider_credentials_safe (sem bytes cifrados).
- Runtime: lib/agent-engine/edge/llm/credentials.ts,
  lib/ai/gateway-binding.ts, lib/ai/pontos/resolver.ts.
- Publicações preservadas: ai_agents, ai_agent_versions imutáveis,
  ai_purpose_bindings com prioridade própria.

## Autorização e isolamento

Toda escrita exige requirePlatformAdminEscrita (scope full,
MFA aplicável), requireSupportWrite(orgId) e UUID no path.
Não usar o cookie de organização ativa para decidir o alvo.
Operações service-role exigem .eq(organization_id, orgId),
inclusive na ativação de credential_id de mesmo provider, validada
e ativa. Negar 422 ao usar credencial de outra empresa, revogada,
ainda não validada ou de provider diferente. GET somente platform admin.

A chave plaintext só existe no POST de teste e criação, nunca em GET,
audit, mensagem de erro, URL de provider, log ou resultado JSON.
Ao salvar, guardarCredencial faz AES-GCM e auditoria canônica; a
validação async deve ser comprovada antes da ativação. Não usar a
validação do navegador como autorização de escrita: repetir no servidor.

## Precedência e runtime

A organização escolhe credencial estável; mudar a chave "mais recente"
não altera automaticamente esse vínculo. Agentes publicados conservam
o provider/model/credential_id da versão publicada; bindings próprios
conservam a prioridade anterior. O resolvedor da organização usa
credencial_id pinado somente onde o padrão é a fonte da decisão,
validando organização+provider+ativa+validada. Credencial pinada
revogada NÃO autoriza fallback silencioso para chave da instalação
nem credencial recém-cadastrada em outra linha. Onde a versão
publicada possui sua própria credencial, preserva-se a semântica
pré-existente fora deste slice.

O teste GET /models deve retornar ao menos um modelo utilizável e confirma conectividade/autenticação e catálogo
quando o endpoint o disponibiliza; NÃO substitui uma prova futura
de inferência com o modelo selecionado, ferramentas e custo real.

## Gates antes de considerar concluído

1. Unitários: isolamento A/B, RBAC/MFA/suporte, SSRF, credencial
   revogada/ausente, troca de provider, CAS de settings, modelo
   fora de models_available, versão publicada e binding precedendo.
2. Typecheck, lint e testes do workflow governado, GREEN informado
   pelo proprietário (sem polling do GitHub Actions).
3. Sem merge antes de CI GREEN, sem deploy antes de imagens e rollback.
4. Teste autenticado do proprietário: cadastrar custom para org de
   teste ou 28ZERO, ver credential validada e ativar modelo correto;
   confirmar que outra empresa e agente publicado não mudaram.
5. Não executar teste real de modelo/ERP sem gate de produção novo.

O incidente Sentry do editor de agentes é independente.

## Novos agentes e primeira publicação

O formulário de criação de agente recebe provider/modelo/credential_id
do padrão persistido da própria organização sem alterar versões publicadas.
A primeira publicação via onboarding, quando existe credencial pinada e o
provider é custom, usa o modelo explícito somente se models_available
confirmar esse ID. Modelos custom não dependem de ai_models global.
Credencial fixada revogada não permite fallback à chave da instalação.

O onboarding continua sujeito ao gate podeConfigurarIa(..., credentials):
empresa sem autonomia não pode trocar a chave fornecida pela plataforma.
