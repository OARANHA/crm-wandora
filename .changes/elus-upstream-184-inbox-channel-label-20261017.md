---
type: patch
---

- Porta da DeskcommCRM v1.84.0 o identificador do canal no cabeçalho da conversa aberta. Antes o operador via apenas o ícone do provider, idêntico para várias linhas da mesma plataforma.
- O rótulo é compartilhado com o item da lista, usando a capability canônica `nomeDoCanal`: prefere o nome configurado em Conexões e utiliza o telefone do próprio canal somente sem apelido.
- Quando faltam apelido e número, omite o badge; nunca usa `waha_session_name` como nome amigável. O badge é limitado em largura e preserva `title` completo.
- Não altera tenant, autorização, RLS, SQL, provider, persistência ou produção. Testes cobrem lista, cabeçalho e resolução pura; contraste/layout real em navegador não medidos.
