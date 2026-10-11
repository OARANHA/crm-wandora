# ISIS — janela fiscal de 30 dias e pergunta de período

- Consulta inicial limitada a 30 dias civis incluindo hoje, fuso Brasília, sem regressão automática.
- Data exata ou intervalo dirigido: até 30 dias inclusivos por pesquisa; mês explícito de 31 dias particionado.
- Nenhuma NFe em consulta completa resulta em retorno vazio com período e pergunta sobre o intervalo desejado; erro e consulta parcial continuam fail-closed.
- Pedido singular vago com mais de uma NFe exige data ou número antes de preparar DANFE.
- Preservados VendaERP READ-ONLY, autoridade administrativa, vínculo fiscal, dados sensíveis fora do modelo e sender canônico.
- Não representa aceite de PDF nem envio em produção.
