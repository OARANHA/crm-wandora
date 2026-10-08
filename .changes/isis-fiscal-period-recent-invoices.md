# ISIS — últimas NFes por período fiscal (read-only)

- Adiciona busca de NFes emitidas por janela fiscal regressiva dentro do adapter VendaERP existente.
- Mantém `Pedidos/Pesquisar` intacto; tool administrativa específica prioriza período e data fiscal comprovada.
- Até 3 notas automaticamente; acima de 3, exige mês e ano.
- Filtragem local por destinatário fiscal comprovado, deduplicação por chave, paginação com limites e falha fechada.
- XML, destinatário e URL externa não são repassados ao agente; DANFE continua no sender canônico.
- Nenhum write ERP, deploy ou chamada de canário adicionados.
