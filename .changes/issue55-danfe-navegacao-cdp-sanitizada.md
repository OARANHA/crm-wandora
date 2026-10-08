# Diagnóstico sanitizado de navegação de DANFE

- No renderer existente, a policy especializada VendaERP pode ativar observação de Chromium por pipe privado (sem porta de depuração).
- O Chromium recebe apenas o URL efêmero `127.0.0.1` e usa perfil exclusivo dentro do diretório temporário do renderizador.
- Em erro, a auditoria administrativa recebe opcionalmente somente um diagnóstico de navegação enumerado; nenhum URL, query, token, cabeçalho, conteúdo fiscal, arquivo ou stderr é persistido.
- Sem mudança no VendaERP read-only, sender WhatsApp, autorização administrativa, teto de timeout ou contrato de envio de PDFs.
- Prova exigida em CI: testes de sanitização e renderização real offline com Chromium, sem solicitar DANFE ao VendaERP.
- Essa observabilidade **não** comprova por si só causa do timeout em produção e requer deploy seguro e canário real autorizado antes de encerrar a issue #55.
