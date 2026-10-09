# DANFE — evidência sanitizada de egress no timeout

- Observa somente classes finitas de requisições HTTP recusadas durante
  a validação do DOM fiscal no browser, sem destinos ou métodos brutos.
- Preserva fail-closed, limites, DNS fixado, sender e armazenamento privados.
- Adiciona testes offline para quatro classes, propagação e auditoria.
- Não corrige comprovadamente a DANFE real; não amplia allowlist.
