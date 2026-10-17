---
type: patch
---

- Importa da DeskcommCRM v1.84.0 a espera pelo fato `ai/automatico-ativo` antes de consultar a aba Fila da Inbox. Uma organização sem agente ativo passa a consultar diretamente `comando=aguardando,automatico`, sem primeiro fazer uma busca provisória de `aguardando`.
- Outras abas e a consulta de uma conversa por deep-link não esperam pelo fato da organização; a Fila mostra skeleton durante a espera (não estado vazio enganoso).
- Refetch com linhas visíveis conserva o conteúdo. O placeholder só reaproveita a Fila se mudou exclusivamente a condição do automático e o `organization_id` da chave for o mesmo; troca de aba, canal, atendente, etiqueta, busca e tenant não podem mostrar linhas antigas.
- Reutiliza React Query, filtros, rotas e RLS existentes, sem API, provider, migration ou workflow de produção paralelo. Testes da v1.84.0 adaptados e regressões locais.
- CI, prova E2E/visual e funcionamento publicado ainda não medidos.
