---
type: patch
---

- Porta do DeskcommCRM `v1.84.0` o normalizador `mensagemDeErro` para falhas estruturadas de PostgREST nos executores de automação: envios WhatsApp, mensagens por IA, webhooks e movimentação de leads. Mantém texto de `Error`, mostra `message` e `code` quando presentes, e evita `[object Object]` ou exposição de valores arbitrários de objetos sem campos de erro.
- Testes unitários derivados do upstream cobrem entrada PostgREST, `Error`, primitivas, objeto circular, limite de tamanho e dois caminhos de execução de `send_ai_message`; regressões relacionadas continuam na CI focal.
- Nenhuma alteração em schema, envio de mensagens, regras de consentimento, isolamento por organização, identidade de clientes, VendaERP, ISIS, DANFE, branding ou stack de produção.
- Esta é uma etapa incremental do upgrade, **não** a sincronização completa com DeskcommCRM v1.84.0. Ainda exige validação CI antes do merge.
