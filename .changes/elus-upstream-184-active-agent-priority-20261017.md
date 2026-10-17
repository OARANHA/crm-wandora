---
type: patch
---

- Importa da DeskcommCRM v1.84.0 a precedência de agentes publicados e ativos sobre agentes pausados no mesmo canal, antes da ordenação por prioridade e data de criação.
- Um agente pausado ainda pode ser encontrado quando é o único publicado, preservando o bloqueio do turno e impedindo que o agente genérico responda por engano.
- Mantém a autoridade por organização, a sessão de canal, o ponteiro de versão publicada e a busca por ID do roteador. Sem migração de banco, mudanças de provedor ERP ou deploy.
- Cobertura de regressão offline para ordenação SQL, isolamento por organização/canal e separação da busca por ID. Aceite produtivo e E2E não medidos.
