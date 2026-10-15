# ELUS — edição não técnica de agente com autonomia de IA bloqueada

Status: candidata, sem merge ou deploy.
Base: main 35c397cb064c6731cb9fc56003b7431aba7681e1.

## Evidência e escopo

O formulário AgentForm exigia chave global utilizável também para salvar
instruções de uma versão preexistente cuja credencial já não podia ser alterada
pela organização. A autorização no servidor já comparava campos técnicos com
a versão persistida, mas a validação da UI estava mais restritiva para o
caso de gestão técnica exclusiva do Superadmin.

O erro de tela cheia com identificador Sentry informado
NÃO foi vinculado a esse bloqueio. A leitura dos logs existentes não mostrou
esse ID; investigar telemetria client-side independentemente.

## Contrato do patch

Somente edição de versão persistida e escolha técnica integralmente idêntica
permite salvar alterações comuns sem chave global do provedor.
Ficam imutáveis provider, model, credential_id, operator_model na exceção.
Nova versão sem referência ou alteração técnica conserva validação normal.
Publicação mantém checagem independente de chave utilizável, sem bypass.
Backend mantém autorização fail-closed por organização e campo técnico.
Sem mutation de agentes publicados, credenciais, tenants ou ERP.
Nenhuma migration ou alteração de infraestrutura.

## Gates antes de release

Unit tests de valores técnicos iguais/diferentes, criação, publicação, UI e
backend; CI com typecheck + lint + testes de integração e E2E reproduzindo
agente publicado com provider custom, autonomia técnica desligada e chave
de instalação ausente. Separadamente correlacionar o ID do erro no Sentry.
Sem polling de CI; usuário informa GREEN/RED.
