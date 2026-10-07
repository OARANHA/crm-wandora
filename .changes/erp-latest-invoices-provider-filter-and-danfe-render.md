---
type: patch
---

A consulta administrativa de últimas notas deixa de depender do filtro remoto `possuiNotaFiscal=true`, que retornou falso vazio em canário real, e passa a paginar pedidos normalmente e selecionar localmente somente os que possuem `numeroNFe`.

A renderização da DANFE pública do VendaERP deixa de navegar via `file://` + JavaScript e usa um redirect HTTP efêmero em `127.0.0.1` com nonce. A URL externa continua fora do argv do Chromium e nenhuma credencial do ERP é enviada ao host público.
