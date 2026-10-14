---
type: patch
---

Corrige a assinatura inválida encontrada no adaptador offline Chutes Qwen3 introduzido pela PR #119 e impede que uma família declarada ou modelo de índice desconhecido seja tratado silenciosamente como OpenAI. A indexação e a busca falham fechado até haver integração explícita da família, sem alterar credenciais, dados ou comportamento das famílias OpenAI/Google já reconhecidas.
