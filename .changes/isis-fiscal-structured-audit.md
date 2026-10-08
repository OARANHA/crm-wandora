# ISIS — auditoria de retornos fiscais estruturados

- Corrige a interpretação de `{ erro: codigo }` em `crm_erp_search_recent_invoices`: retorno estruturado de erro passa a ter `success=false`, `desfecho=erro_resultado` e motivo seguro.
- A allowlist de motivos impede vazamento de CPF/CNPJ, nome, XML, NFe, URLs e texto livre do provider; erros desconhecidos recebem `erro_fiscal_nao_classificado`.
- Aplica a mesma classificação no runtime do agente e no MCP externo, sem mudar respostas ao modelo ou autorização administrativa.
- Diferencia consulta fiscal comprovadamente vazia de erro técnico e mantém o gate de recência fail-closed existente.
- Testes offline de ambas as portas, sem VendaERP/WhatsApp reais. Não há alteração de produção ou deploy.
