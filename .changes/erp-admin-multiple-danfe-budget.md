# DANFE administrativa — orçamento de até cinco documentos no turno

- Mantém o teto normal de `send_message`/`send_template` para o atendimento comum.
- Permite excepcionalmente o quarto e quinto **envio documental** apenas quando a tool de DANFE do administrador foi montada após autoridade WhatsApp, a recência fiscal foi comprovada no turno, o número da nota pertence à lista confirmada e o PDF está preparado e pendente no sender canônico.
- Impede preparar duas DANFEs simultaneamente ou sobrescrever documento pendente; mantém `prepare → send_message` sequencial, `before_send`, ledger, idempotência, egress e storage privado.
- Ajusta apenas para essa solicitação o orçamento finito de steps do agente; não altera env, mensagens genéricas nem templates.
- Testes unitários sintéticos de autorização, recência, documento pendente, número divergente, quantidade máxima e limites deliberadamente menores.
- Contabiliza uma DANFE apenas após o aceite pelo sender (`sent`, `already_sent` ou `queued`), sem consumir quota quando a tentativa é bloqueada ou falha; novo preparo aguarda o término da reserva documental anterior.
- **Não muda o renderer**. Aceite real da issue #55 permanece pendente até PDFs corretos e distintos entregues.
