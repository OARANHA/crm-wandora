---
type: patch
---

O agente administrativo do Elus passa a receber uma regra explícita de uso para DANFE: pedidos de mandar, enviar, ver, baixar, obter ou receber uma DANFE com número de NFe/NFCe devem chamar `crm_erp_prepare_admin_danfe` antes de qualquer resposta textual ou `send_message`.

A mudança não cria novo sender nem novo provider e mantém o VendaERP somente leitura.
