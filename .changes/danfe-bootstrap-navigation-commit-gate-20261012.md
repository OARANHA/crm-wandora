---
impacto: nada_mudou
secao: corrigido
titulo: DANFE espera carregar a página fiscal depois do bootstrap controlado
---

O renderizador de DANFE passa a distinguir a resposta do bootstrap local
da navegação HTTPS subsequente. Antes de imprimir, ele exige que o Chromium
tenha alcançado a URL fiscal exata, respeitando o mesmo prazo total e os
controles de egress já existentes.

Não altera VendaERP, credenciais, domínio permitido, identidade fiscal,
storage, envio WhatsApp ou renderização genérica de documentos.
Não reprocessa mensagens antigas nem garante automaticamente uma DANFE real:
a confirmação depende do aceite funcional posterior aos gates de deploy.
