---
type: patch
---

O fluxo administrativo de DANFE agora entrega o PDF pelo sender canônico do agente: a capability prepara o documento no bucket privado da conversa, mantém o storage_path apenas no runtime e a próxima send_message envia o arquivo como `document` sob os mesmos guardrails, ledger e adapter de WhatsApp.

Nenhuma URL externa do VendaERP nem caminho interno de storage é exposto ao modelo.
