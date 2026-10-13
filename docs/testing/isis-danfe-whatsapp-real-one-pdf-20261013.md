# ISIS / VendaERP — marco real: uma DANFE gerada e enviada por WhatsApp (13/10/2026)

Status: **sucesso comprovado de uma preparação e entrega de documento PDF**. Não é aceite de múltiplas DANFEs.

## Evidência operacional, sem informações fiscais sensíveis

- Ambiente: ELUS, stack `elus` existente no Portainer Vigia, ID 5 / endpoint 3.
- Versão implantada e previamente conferida por `/api/v1/health`: `628e1332a37343af8ceb041072c1d6e91cefaf1e` (merge da [PR #110](https://github.com/OARANHA/crm-wandora/pull/110)). Na verificação de deploy: app/worker/Redis/scheduler saudáveis, WAHA/SRH em execução, checks Supabase/Redis/WAHA `ok`.
- Operador confirmou que a solicitação das **05h09 (America/Sao_Paulo)** pedia **uma nota**, não duas.
- `messages`: entrada no WhatsApp às **05:09:34.533** de 13/10/2026.
- `job_queue`: `inbound_turn` criado às **05:09:49.815**, `status=done`, **uma tentativa**, sem erro.
- `api_audit_log`: `crm_erp_prepare_admin_danfe` às **05:10:23.517**, `success=true`, sem códigos de falha.
- `send_ledger`: `seq=1`, `status=accepted`, associado a uma mensagem do CRM, sem erro; criado às **05:10:34.359**.
- `messages`: uma saída `type=document`, `media_mime=application/pdf`, `sent_via=ai`, armazenamento privado associado, criada às **05:10:35.462**; `sent_at`, `delivered_at` e `read_at` preenchidos, `status=read`.
- Usuário confirmou a entrega às **05h10**. Foi **uma DANFE**. Nenhum download extra do VendaERP foi realizado nesta auditoria read-only.

**Comprovado:** tool de preparação teve sucesso, sender canônico registrou uma saída PDF, armazenamento privado vinculado e WhatsApp marcou envio/entrega/leitura. **Não comprovado nesta análise:** abertura humana do PDF, conferência visual ou validação externa de seus campos fiscais. Não expor URL pública fiscal/token, dados de cliente, chave de acesso, caminho privado ou payload em documentação.

## Receita técnica que tornou esse fluxo possível

**Não recriar provider, renderer ou sender paralelo**. Reutilizar as capabilities existentes, mantendo VendaERP **READ-ONLY**:

1. **Rota e bootstrap fiscal:** a URL pública autorizada é somente `app.vendaerp.com.br/v3/public/NFe/Danfe`, com parâmetros e host validados no adapter. O bootstrap de navegação é interceptável; o Chromium não ganha acesso irrestrito à rede nem usa cookies de sessão ERP. Base técnica anterior na [PR #108](https://github.com/OARANHA/crm-wandora/pull/108).
2. **Recursos permitidos:** `lib/integracoes-erp/recursos-publicos-danfe.ts` autoriza exclusivamente os bundles JS/CSS versionados do CDN CloudFront sob `/v3/`, inclusive nomes webpack com `~`, e o POST público de montagem da DANFE em `novaapi.vendaerp.com.br/v3/CriaDANFE/GetDanfeInfoPublic`. Mantém validação estrita de método, origem, path, identificador de montagem e formato. Correção da [PR #109](https://github.com/OARANHA/crm-wandora/pull/109), commit `b00854274c24a2709c46c02a366a586247b31138`.
3. **Transporte HTTPS controlado:** `lib/documentos/recurso-browser-pdf-pinado.ts` manda um `User-Agent` **literal** definido pelo servidor (`HeadlessChrome/156`, não herdado da página), solicita `Accept-Encoding: gzip, br`, descomprime com tamanho máximo também sobre bytes descomprimidos, limita recurso a **16 MiB** e aceita até **12 s** por requisição. Não encaminha Authorization/cookies/referrer, não segue 3xx, conserva verificação TLS/SNI com DNS/IP público pinado e filtros SSRF.
4. **Orçamento e identidade:** `lib/documentos/renderizar-url-pdf-controlado.ts` tem etapa de **12 s** e teto **60 s** quando solicitado explicitamente; sem timeout configurado mantém default **28 s**. `lib/integracoes-erp/vendaerp-danfe-pdf.ts` já pede `timeoutMs: 60_000`. Imprimir não é suficiente: a validação fiscal de bytes/texto e chave esperada continua **fail-closed**.
5. **Entrega segura:** a tool administrativa `crm_erp_prepare_admin_danfe` segue autorização `WhatsApp → usuário ELUS → membership → erp.admin.read`; PDF passa por sender canônico, armazenamento privado, validação de mídia, `before_send` e ledger. Para várias notas, nunca preparar todos antes: **prepare #1 → send_message → prepare #2 → send_message**. As mudanças de UA/tamanho/prazo vieram na [PR #110](https://github.com/OARANHA/crm-wandora/pull/110), merge `628e1332a37343af8ceb041072c1d6e91cefaf1e`.

O operador trouxe reprodução em navegador real: sem UA, o CDN retornava `HTTP 200 text/html` em vez dos bundles; com UA, o bundle JS excedia o antigo teto de 8 MiB. O experimento do operador gerou um PDF após esses ajustes; o **canário acima comprova separadamente o envio real pela ISIS em produção**. Não afirmar que apenas um ajuste isolado bastaria.

## Gates para replicar com segurança

1. Reler `CLAUDE.md`, `AGENTS.md`, `docs/index.md`, spec VendaERP, `main` e código/testes atuais. Não assumir que o SHA histórico ainda seja o deploy de hoje.
2. Manter os testes de regressão existentes: `tests/unit/recurso-browser-pdf-pinado.test.ts`, `tests/unit/danfe-renderer-controlado.test.ts`, `tests/unit/vendaerp-danfe-recursos-publicos.test.ts` e `tests/unit/documentos-renderizar-url-pdf.test.ts`. Rodar com `node node_modules/vitest/vitest.mjs run <arquivos> --maxWorkers=1` em ambiente de desenvolvimento/CI; a PR #110 passou **109/109 offline**. Os testes cobrem UA que não pode ser forjado pela página, gzip/br, bundle de 11 MiB, rejeição acima de 16 MiB, bomba de compressão, limites por etapa e tempo total.
3. Se houver mudança de código: branch própria → testes → PR → CI `green` informada pelo operador (sem polling) → merge → publicação app/worker → confirmar **ambos digests imutáveis** no GHCR → preservar rollback → deploy Portainer sem build pesado na VPS e com `prune:false`.
4. Verificar **app/worker saudáveis**, dependências necessárias saudáveis, `GET /api/v1/health` HTTP 200 e `version` exatamente igual ao SHA aprovado. Só depois liberar canário real autorizado; não disparar consulta VendaERP apenas para depurar.
5. Reconstruir uma tentativa existente por `messages`, `job_queue`, `api_audit_log`, `send_ledger`, validação `before_send` e status WhatsApp; documentar somente códigos/resultados redigidos. **HTTP 200 de CDN não garante JavaScript** quando o conteúdo pode ser HTML; problemas de `agent_turn` anteriores à tool não comprovam regressão do PDF.

## Alcance do marco e próximo aceite

- **MARCO ATINGIDO:** 1 DANFE preparada em produção e 1 PDF enviado/entregue/lido na conversa administrativa após PR #110.
- **AINDA PENDENTE NA [issue #55](https://github.com/OARANHA/crm-wandora/issues/55):** demonstrar duas NFes distintas e realmente mais recentes, com dois PDFs corretos e legíveis enviados em sequência na conversa certa; abertura do PDF e correspondência fiscal devem ser confirmadas. Não fechar a issue apenas pelo sucesso unitário aqui.
- Esta nota é um **registro histórico reproduzível**, não concede autorização para novos canários, alterações administrativas, nem liberação dos controles de egress.
