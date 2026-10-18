---
type: patch
---

- Impede atendentes de assumir ou transferir conversas que não aparecem no seu escopo de visibilidade. Gestores e administradores continuam operando toda a organização, e `visibility_mode=all` mantém o compartilhamento configurado.
- Reutiliza `fn_can_view_conversation` dentro de `fn_conversation_assign`, com o responsável obtido da linha sob lock. Preserva conflito otimista, service role, roteamento, auditoria transacional, silêncio da IA e nome do atendente.
- A rota de transferência converte a recusa do banco em `403` com mensagem clara e não grava auditoria, atividade ou notificação de sucesso.
- Port seletivo de `DeskcommCRM@v1.84.0` com migration ELUS `0507`, baseline idempotente e testes de API/banco. Sem alteração de VendaERP, DANFE, identidade externa, sender do WhatsApp, infraestrutura ou deploy.
