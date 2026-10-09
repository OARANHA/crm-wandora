# DANFE: proteção de prontidão contra página de erro

- Fecha falso positivo demonstrado por fixture offline: erro que repete
  chave fiscal de 44 dígitos não prova DANFE imprimível.
- Exige rótulos DANFE / CHAVE DE ACESSO, rejeita avisos explícitos de erro,
  e mantém vínculo à chave fiscal estruturada.
- Sem mudanças de rede, timeout, navegador, autenticação, storage ou sender.
- Não prova que o timeout do provider foi corrigido nem entrega real.
