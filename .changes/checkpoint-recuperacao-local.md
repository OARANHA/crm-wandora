# Checkpoint do agente: recuperação local de JSON

- Se o modelo produzir JSON inválido no fechamento do turno, o runtime repete **somente a chamada de checkpoint**, até três respostas no total.
- A recuperação preserva a validação de declaração, não inventa checkpoint, não reexecuta ferramentas do ERP nem o sender enquanto tenta recuperar o formato.
- Erros da infraestrutura do modelo continuam propagando sem repetição adicional de chamadas.
- Limite explícito: três saídas inválidas ainda propagam falha à fila. Evitar todo replay de turno após esse caso extremo requer continuidade em issue #55.
- Testes unitários novos para sucesso imediato, recuperação em terceira chamada, falha terminal, falha de infraestrutura e validação estrita.

Sem migration, chamada real ao VendaERP, WhatsApp ou alteração de produção.
