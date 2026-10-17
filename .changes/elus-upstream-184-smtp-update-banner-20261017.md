---
type: patch
---

- Porta seletivamente da DeskcommCRM v1.84.0 a tarja de diagnóstico **Sem SMTP configurado** no painel Configurações › Atualização do sistema, somente para administradores da plataforma em instalações de servidor único.
- O leitor canônico `getSmtpConfig` agora delega a `lerSmtp`, que também informa se o banco respondeu. O aviso não nasce de falha de leitura, ausência de sessão, instalação com Supabase separado ou um único campo SMTP preenchido; a regra usa host E remetente, sem apresentar credenciais.
- A resposta `GET /api/v1/system/version` acrescenta somente `smtp_configured: boolean` para `is_platform_admin`, jamais para membros comuns. O mesmo estado atravessa atualização em andamento, carregamento e reinício. Sem mudança no comportamento real de envio ou no login.
- Nenhuma migration, segredo, alteração de banco, novo provider, envio de e-mail, deploy ou canário. Tests focais unitários e UI; uso real de SMTP/GoTrue e produção **não medidos**.
