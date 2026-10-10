# DANFE: recuperação da impressão por validação do próprio PDF

- Regressão reproduzida antes do patch: o timeout do DOM abortava a DANFE antes de imprimir mesmo quando o PDF sintético estava pronto.
- Com chave fiscal comprovada, timeout estritamente da leitura do DOM pode continuar à impressão controlada, respeitando o prazo global.
- Exige PDF válido, texto DANFE/CHAVE DE ACESSO e a chave exata; recusa documento indisponível, divergente ou ilegível.
- Reutiliza o extrator de PDF já canônico em subprocesso com limite de memória e deadline, sem expor conteúdo fiscal.
- Preserva egress SSRF/DNS, nonce/loopback, API do ERP somente leitura, storage privado, sender e a ordem de anexação.
- Testes offline não são canário real; issue #55 permanece aberta até duas DANFEs corretas e duas notas mais recentes comprovadas.
