---
type: patch
---

- Adiciona no painel lateral da conversa a opção **Levar para outro funil** para quem já pode mover negócios no Kanban. Reutiliza `MoveToOtherPipelineDialog`, `useMoveLeadToPipeline` e a rota canônica `POST /api/v1/leads/[id]/clone`; sem nova rota ou schema.
- O painel identifica o novo negócio pelo ID na releitura do resumo, marca-o como ativo e conserva o histórico da origem encerrada. Cancelamento não altera a escolha; erro continua na mesma mensagem do Kanban.
- Port seletivo `DeskcommCRM@v1.84.0`: somente os trechos da função e do estado necessário em `CRMSidePanel.tsx`, **sem substituir o overlay `ErpDanfeCard`, a leitura fail-closed ou as demais customizações do ELUS**. Botão ausente para viewer e suporte somente-leitura, mantendo a autorização definitiva do servidor.
- Testes de interação upstream e uma catraca de integração ELUS. Sem modificação de VendaERP, banco, faturamento, credenciais, workers ou deploy; CI e navegador real pendentes.
