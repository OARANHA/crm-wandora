# ISIS: aviso técnico após falha de DANFE não fica mudo por `spinning`

- Canário administrativo em 09/10/2026 às 21h37: mensagem recebida; consultas fiscais executadas; `crm_erp_prepare_admin_danfe` falhou em `pdf_validacao`; nenhuma mensagem ou PDF enviados.
- `before_send_traces` registrou 19 vetos `spinning/mass_identical` para o job e o worker reiniciou o turno com indicador de digitação. `llm_calls` também mostrou falhas posteriores em `checkpoint`, não resolvidas por esta alteração.
- Isenção **somente** de `spinning` para o texto técnico literal `AVISO_FALHA_DANFE`, após uma falha registrada, sem PDF preparado, sem aviso já enviado, e fora de preview.
- Os demais gates `before_send` permanecem ativos, incluindo opt-out, LGPD, pacing, janela, limites, before_send trace, ledger e sender canônico. Mensagens normais não recebem isenção.
- Sem alteração do VendaERP/read-only, PDF, conta ou geração fiscal. A issue #55 permanece aberta até entrega comprovada de duas DANFEs válidas e distintas na conversa correta.
