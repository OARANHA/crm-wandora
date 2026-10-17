---
type: patch
---

- Porta seletivamente a correção de tema da DeskcommCRM v1.84.0: a conversa selecionada na lista do Inbox usa `bg-accent-soft` (token próprio dos temas claro/escuro) em vez de `bg-accent-50`, que permanece quase branco no tema escuro e dificulta a leitura.
- Reutiliza o token de design `--color-accent-soft` já presente na distribuição Elus; nenhum CSS novo, banco, API, migração, provider ou acesso diferente.
- Teste de componente adaptado do upstream assegura classe de seleção e ausência dela nas outras linhas e mede contraste teórico de nome/prévia pelos tokens para ambos os temas. A funcionalidade upstream de seleção em lote não é importada nessa fatia.
- Workflow focal valida typecheck, lint e regressão unitária. Contraste computado no navegador, acessibilidade visual E2E e funcionamento em produção permanecem não medidos.
