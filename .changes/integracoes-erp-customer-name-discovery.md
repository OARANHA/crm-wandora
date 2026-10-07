---
impacto: correcao
secao: corrigido
titulo: Busca de cliente ERP também encontra razão social
---

A resolução de cliente do VendaERP não desiste quando o nome informado existe apenas como razão social. Depois da tentativa direta por nome fantasia, o Elus faz uma varredura paginada e limitada de clientes e compara razão social no backend. Se não conseguir provar unicidade dentro do limite, pede CPF/CNPJ ou e-mail em vez de declarar que o cliente não existe.
