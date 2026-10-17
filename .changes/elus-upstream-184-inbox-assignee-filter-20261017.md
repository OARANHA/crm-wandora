---
type: minor
---

- Importa de DeskcommCRM v1.84.0 a seleção de atendente na Inbox para gerentes e administradores. A seleção utiliza a capability existente de membros atribuíveis, alcança a consulta das conversas e a rota de contagens da mesma organização, mantendo filtros por canal, etiqueta e não lidas.
- A aba **Minhas** tem precedência sobre qualquer escolha anterior de outro atendente e limpa o filtro oculto ao entrar nela. A contagem de Minhas ignora filtros de atendente de terceiros pela mesma fábrica de queries, preservando o filtro organization_id, o cliente autenticado e a RLS.
- Seleção de UUID de usuário validada na contagem; nomes de filtro e seletor traduzidos. Testes upstream e prova UI de gate por papel, complementando as invariantes de badge/lista e limpeza de filtros.
- A integração foi feita como overlay cirúrgico, sem substituir os componentes inteiros do upstream, nem alterar esquema, migrations, RLS, ISIS, VendaERP, DANFE ou Portainer.
- **Pendente:** validação por CI, teste de interface end-to-end e deploy. Esta é uma etapa do upgrade cumulativo, não a versão 1.84.0 completa.
