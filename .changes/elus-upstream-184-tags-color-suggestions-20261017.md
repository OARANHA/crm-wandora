---
type: patch
---

- Porta seletivamente da DeskcommCRM v1.84.0 a escolha de cor antes de anexar uma **etiqueta sugerida** nos editores de contato e conversa da Inbox. Clicar na sugestão abre um diálogo para o gerente; cancelar não grava a etiqueta e confirmar grava a etiqueta e, se alterada, a cor do vocabulário.
- Reutiliza sem criar provider ou rota a escrita canônica `POST /api/v1/tags/vocabulario` (`acao=definir_cor`, `manager + MFA`) e o provider de leitura `CoresDasEtiquetas`. Para papéis inferiores a gerente o clique segue direto, sem oferecer seletor que a API recusaria. O servidor continua dono da autorização.
- Centraliza os nomes acessíveis dos tons em `lib/tags/cor-da-etiqueta.ts`, reutilizados em Configurações e nos novos seletores, **sem alterar os oito valores hex atuais do ELUS** (dois diferem do upstream).
- Testes upstream adaptados: seleção/confirmar/cancelar, permissões, tom existente e corrida de leitura; teste focal novo para preservar a paleta ELUS. Nenhuma migration, alteração no auth, banco, ERP, envio, provider, secrets ou deploy. CI e fluxo real em navegador ainda pendentes.
