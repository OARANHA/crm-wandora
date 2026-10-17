---
type: patch
---

- Importa de DeskcommCRM `v1.84.0` a atualização dos templates de automação: `{{nome}}` e `{{primeiro_nome}}` usam a resolução canônica do contato com fallback de nome do perfil WhatsApp, recusando identificadores técnicos; `{{servico}}` pode resolver `lead.custom_fields.servico` como último recurso, preservando alias e caminhos explícitos.
- Mantém `renderTemplate` compatível com as chamadas existentes e acrescenta `formatarValor` opcional aplicado somente aos valores resolvidos, sem alterar a estrutura do template.
- Portados testes upstream e acrescentadas provas de campo personalizado herdado recusado e de callback aplicado somente aos valores. Reutiliza o gate de CI existente para automações.
- **Sem mudança de schema**, baseline, migrations, provider, VendaERP, ISIS, DANFE, autorização, payloads de cliente ou infraestrutura; bloco incremental, não upgrade integral da release.
