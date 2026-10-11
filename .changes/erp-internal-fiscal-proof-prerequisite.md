# ERP — seam privado de prova fiscal (fail closed)

- Introduz `examinarProvaFiscalDeNfeInterna` reutilizando o GET estruturado `Fiscal/ConsultarNFE`, sem nova capability exposta, sem provider paralelo e sem XML na resposta.
- Pré-checa número/chave do provider e rejeita XML ausente, excessivo ou com marcadores perigosos; retorna exclusivamente estado `nao_comprovado` e motivo sanitizado.
- Não muda fluxo de DANFE ativo, ISIS, storage, sender, autenticação, schema, migrations ou imagens. Não fornece autorização SEFAZ nem integridade XMLDSig — esses gates continuam bloqueados.
- Testes unitários usam dados fictícios e exigem **uma única chamada** com ausência de conteúdo sensível na saída.
- CI desta PR **não** habilita deploy ou canário; issue #55 permanece aberta até comprovação fiscal real e envio de duas DANFEs válidas.
