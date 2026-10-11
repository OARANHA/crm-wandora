# VendaERP — verificação fiscal privada e fronteiras de confiança

## Reconciliação
Base canônica `main` `aa8e705670abb21a0f2946e66935983e6c728a33`; PRs #94 e #95 continuam Draft (experimentos offline). Issue #55 aberta. Sem nova chamada real ao VendaERP ou canário WhatsApp nesta mudança.

Fonte: `docs/specs/integracoes-erp-vendaerp-descobertas.md` registrou em 01/10/2026 que `Fiscal/ConsultarNFE` respondeu `Xml`, `ChaveNFe`, `Numero`, `CodigoStatus`, `UrlImpressaoDanfe` etc. O Swagger NÃO tipa o corpo 200, logo essa informação não é garantia universal de XML existente/completo/autorizado.

## Implementação: seam de leitura segura

Novo `examinarProvaFiscalDeNfeInterna(admin, organizationId, codigoNfe)` usa `executarLeituraVendaErp` e **exatamente a mesma função** `consultarNfeVendaErp` que alimenta `obterNotaErp`; não cria provider nem rota alternativa. A função só existe server-side e não é invocada pelo agente, pelo sender ou pela ISIS. Quando chamada por um futuro orquestrador autorizado, a operação é UM GET e nunca uma consulta GET adicional além dessa chamada. Não duplicar a consulta de NFe chamando `obterNotaErp` no mesmo preparo: futuramente deve-se compor a partir da mesma resposta.

O callback mantém `Xml` somente em memória local. A resposta de `examinarEnvelopeFiscalDaRespostaPrivada` é um objeto com campos **exclusivamente finitos**: `estado: nao_comprovado`, `integridadeCriptografica: nao_verificada`, `autorizacaoSefaz: nao_verificada` e `motivo` sanitizado. Nem `Xml`, chave, número, NFe, cliente, URLs, XMLHash, certificados, assinatura, `storage_path`, segredos ou payload bruto entram na projeção ou no log. A leitura usa a credencial canônica por organização e o mecanismo de erros já existente.

## O que o pré-gate efetivamente checa
- Número solicitado: inteiro positivo até `int32` antes de buscar credenciais.
- Resposta do provider: objeto, número inteiro, chave de 44 dígitos; o número do retorno precisa bater com o solicitado e com a faixa `nNF` da chave.
- `Xml`: existe como string, dentro de teto de 256 KiB e sem marcadores óbvios de DTD/ENTITY/CDATA/controle. **É somente um filtro preliminar**, não parser XML nem validação de esquema, namespace ou assinatura.
- Todos os cenários, inclusive um `Xml` aparentemente válido com `CodigoStatus=100`, retornam `nao_comprovado`. Não há caminho de sucesso fiscal que gere documento nem envio.

## Limites e critérios para integrar futuramente
A própria XML de NF-e assinada prova, no máximo, integridade criptográfica da estrutura referenciada e origem da chave pública **depois** de validar algoritmo, C14N, digest de `infNFe` exato, anti-wrapping, cadeia ICP-Brasil, validade e revogação sob instante fiscal, e vinculação segura do emissor à chave. Nenhuma dessas provas existe neste slice.

A autorização SEFAZ **não** pode ser inferida de `cStat=100`, `nProt`, `infProt` ou `CodigoStatus` autoafirmados; exige resposta de protocolo obtida por canal/autoridade confiável e correlação forte com a mesma chave, além das verificações fiscais pertinentes. A PR #95 prova apenas estrutura sintética; #94 somente PDF sintético com texto selecionável. A aplicação não dispõe ainda de uma autoridade de protocolo SEFAZ verificável para esse caminho; nunca declarar `autorizada` até existir.

Um futuro PR de composição deverá ligar verificador robusto de XMLDSig + autoridade externa, observar as duas provas, gerar PDF fiel, aplicar validação do PDF/chave e reusar **somente** o storage privado e o sender canônico `before_send → send_ledger → WAHA`, com autorização de ISIS. Falhas e ausência de prova seguem bloqueando envio; nenhuma chamada real ao VendaERP apenas por diagnóstico.

## Testes e aceite
`tests/unit/erp-prova-fiscal-privada.test.ts` usa credenciais e notas *fictícias* com mocks do GET canônico. Cobre uma única chamada, conexão negada, erro redigido, identidade divergente, XML ausente, tipo, teto e marcadores perigosos, além de proibir vazamento de PII sintética. A CI green desta etapa, se obtida, só aprova a **fronteira privada/fail-closed**, não a verificação criptográfica/autorização SEFAZ ou a issue #55. Não fazer merge nem deploy como correção de DANFE enquanto essas provas faltarem.
