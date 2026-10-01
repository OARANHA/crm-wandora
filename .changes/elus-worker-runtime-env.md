# Elus worker runtime environment

- Corrige `compose.portainer.yml` para repassar ao `elus-worker` todas as variáveis obrigatórias já usadas pelo `elus-app`.
- Evita loop de restart do worker na imagem DeskcommCRM 1.69.0 por validação de ambiente incompleta.
