# Admin WhatsApp Read-Only V1

- adiciona vínculo explícito entre WhatsApp remetente e usuário administrador do Elus por organização;
- revalida membership `admin` no runtime antes de expor consultas de cliente, pedido e NFe;
- mantém VendaERP estritamente read-only e reutiliza conexão, tools, services e sender existentes;
- preserva sem alteração o gate cliente → Pedido/Pessoa → CPF/e-mail/telefone da entrega de DANFE;
- audita consultas administrativas com ator Elus sem persistir telefone, filtro, token, XML ou URL de DANFE;
- adiciona configuração do próprio número em Integrações ERP.
- materializa a DANFE administrativa com o guard existente e devolve preview temporário pelo sender normal, sem expor a URL externa do VendaERP ao modelo.
