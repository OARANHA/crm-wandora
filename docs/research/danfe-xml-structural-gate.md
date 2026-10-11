# DANFE XML — gate estrutural (slice exclusivamente offline)

## Estado real e autoridade
Reconciliado contra main `aa8e705670abb21a0f2946e66935983e6c728a33`. Issue #55 continua aberta. A PR #94 é experimento em Draft e seu green demonstrou apenas geração de PDF com XML fictício. A impressão da SPA via Chromium ainda não demonstrou entrega de duas DANFEs corretas.

O contrato VendaERP existente usa `Fiscal/ConsultarNFE` (GET read-only) e já observou o campo `Xml` em 01/10/2026, mas o normalizador deliberadamente não o projeta ao agente. O Swagger não tipa o corpo HTTP 200 e não garante que `Xml` venha assinado, completo ou autorizado.

## Propósito da mudança
Apenas testar uma política de **candidatura estrutural**, independente da geração de DANFE. Não alterar produção, dependências da aplicação, o provider, autenticação administrativa, mensagem, sender, storage ou Chromium.

O script `scripts/diagnostics/validar-envelope-nfe-offline.mjs` usa exclusivamente entradas sintéticas e parser `fast-xml-parser@5.11.2` instalado em diretório temporário da CI. O gate exige limite de bytes, complexidade e profundidade; rejeita DTD, entidades declaradas, CDATA, instruções XML intermediárias e documento malformado; exige envelope único `nfeProc` em namespace NF-e e versão 4.00; compara chave fiscal de 44 dígitos e número esperados externamente com `infNFe`; modelo 55/ambiente 1; emitente/destinatário/itens/totais presentes; protocolo único com chave coincidente, status literal 100, data e número formatados.

Em todos os casos, a saída é apenas um código finito de rejeição ou **`candidato_estrutural_sem_autenticidade_comprovada`**. O XML, a chave e os dados fiscais nunca entram em logs ou artefatos de CI. Os testes falsificam deliberadamente `cStat=100` para provar que consistência interna **não equivale** à autorização fiscal.

## NO-GO para uso operacional
A validação é um experimento e **não comprova assinatura criptográfica, protocolo autêntico nem consulta real à SEFAZ**. Em particular, `cStat=100`, `nProt` e uma tag de assinatura dentro de XML não confiável são declarações não verificadas. Uma DANFE jamais poderá ser liberada com base somente nesse gate.

A produção só poderá considerar XML após: comprovar formato real na autoridade do provider sem reconsultar apenas por investigação; verificar autorização e integridade por fonte confiável independente; estabelecer parser seguro sob limites e aderência fiscal do layout; comparar chave/NFe/emitente/destinatário e testar diferenças; compor o resultado como seam interno na MESMA leitura GET, mantendo armazenamento privado, `before_send`, ledger e sender canônico.

A execução CI é em contêiner sem rede, root filesystem read-only, usuário sem privilégios, sem elevação de privilégios e com recursos limitados. Nenhuma imagem app/worker é construída ou publicada; sem canário real. PR deve permanecer Draft. `green` só valida o experimento sintético.
