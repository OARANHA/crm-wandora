# HANDOFF — CRM-WANDORA / Elus

> Documento vivo para continuidade entre conversas.  
> Atualizado em: 2026-10-02  
> Repositório: `OARANHA/crm-wandora`  
> Regra: atualizar este arquivo ao fim de cada frente relevante para não depender do histórico do chat.

## 0. Estado canônico de continuidade — 2026-10-02

### Fonte de verdade e ordem de leitura

Este handoff não substitui a doutrina. Ao retomar trabalho, leia e obedeça nesta ordem:

1. `AGENTS.md`;
2. `CLAUDE.md`;
3. spec/ADR da frente;
4. `UPSTREAM.md`;
5. `docs/current-state.md`;
6. este handoff;
7. estado real de `main`, PRs, branches e CI.

Nunca trate texto de chat como fonte de verdade quando o repositório puder ser medido.

### Prioridade atual: sincronizar upstream antes de Planos e Pagamentos

Em 2026-10-02 foi feita uma reconciliação somente-leitura entre o Elus e o DeskcommCRM.

Estado medido:

- `origin/main`: `35834ef00bc6610172b2acb4b22f7d779eae32fb`;
- `upstream/main`: `efed1d5745f87dfeaf3adbe8bc6165bc684a7a75`;
- o snapshot importado pelo Elus corresponde funcionalmente à release upstream **1.69.0**
  (`e8e2912178031d321caf0912b270ee06bd2c36c7`), exceto pelos workflows GitHub não trazidos
  pelo bootstrap;
- depois da 1.69.0, o upstream mergeou #2058, #1978, #1987 e #2071;
- #1987 é `feat/org-operante`: a fundação "suspensão que suspende" que a spec de cobrança exige
  como PR 1;
- portanto **não reimplementar PR 1 no Elus**. Trazer a implementação upstream pelo sync;
- a branch Elus `feat/org-operante`, criada antes dessa descoberta, ficou obsoleta e não deve ser
  continuada nem mergeada;
- produção **não** recebeu esse sync ainda.

### Colisão de migration já conhecida

O upstream usa:

`20260930180000_0501_org_operante_e_suspensao_tipada.sql`

O PR #7 do Elus (VendaERP) também reserva `0501`.

Depois do sync upstream, o VendaERP deve ser renumerado para o próximo número livre antes de merge,
com atualização coerente de migration/baseline/MANIFEST/testes. Não alterar a migration upstream.

### Overlay Elus que precisa sobreviver ao sync

Na `main`, as customizações próprias pós-snapshot estão concentradas em:

- `.changes/elus-worker-runtime-env.md`;
- `UPSTREAM.md`;
- `compose.portainer.yml`;
- `docs/handoffs/HANDOFF-CRM-WANDORA.md`;
- `scripts/wandora-sync-upstream.sh`;
- remoção do workflow temporário de bootstrap.

Além disso, existem trabalhos Elus ainda fora da `main` que devem ser reconciliados **depois**
do sync, não apagados:

- PR #6 / branch `feat/elus-login-branding`;
- PR #7 / branch `feat/integracoes-erp-vendaerp`;
- branch combinada `candidate/elus360-erp`;
- trabalho de entitlement de administração técnica de IA/BYOK feito na candidate, ainda não
  tratado como produção/main.

### Ordem da frente a partir daqui

1. criar/usar branch dedicada de sync upstream a partir da `main` real;
2. trazer conscientemente o delta 1.69.0 → `upstream/main`, preservando o overlay Elus;
3. não importar workflows upstream automaticamente sem revisão;
4. executar gates relevantes e revisar migrations;
5. abrir/validar PR de sync; não fazer deploy direto do upstream;
6. após o sync, renumerar/reconciliar o PR #7 VendaERP e atualizar branches vivas com a nova main;
7. reconciliar login/branding e entitlement de IA;
8. então iniciar a **PR 2 da cobrança — Planos e Limites**, que deve criar a autoridade real de
   planos/assinaturas e alimentar `/admin/cobranca` e `/app/settings/billing`;
9. depois fechar a UX de **Plano e pagamentos**;
10. em seguida voltar ao agente para respostas factuais ("que tipo de tinta tem?", "qual o preço
    da resina?", estoque, nota etc.), sempre por ferramenta/dado estruturado e não por invenção
    do modelo.

### Regra comercial já decidida para IA

Cliente comum de plano gerenciado não deve ver nem administrar OpenAI/Chutes/Google/OpenRouter,
modelos ou chaves. Administração técnica de IA/BYOK é capacidade de plataforma/Enterprise/
white-label. Menu escondido não basta: página e API também devem ser protegidas pela mesma
autoridade de entitlement.

## 1. Objetivo do projeto

O **Elus** é a distribuição Wandora baseada no DeskcommCRM, preparada para operar como CRM + atendimento omnichannel + funcionários digitais com IA.

Direção de produto da Wandora:

- vender o Elus como SaaS;
- oferecer **IA incluída no plano** por padrão;
- permitir **BYOK opcional** para clientes que queiram usar a própria chave;
- abstrair do cliente a complexidade de modelo/provedor quando possível;
- usar roteamento entre modelos para custo, latência e capacidade;
- manter branding, integrações e deploy sob controle da Wandora.

## 2. Infraestrutura atual

### VPS correta do Elus/Vigia

O Elus está instalado na VPS do Vigia, não na VPS principal da Wandora.

- Portainer correto: `https://ops-vigia.wandora.com.br/#!/3/docker/stacks`
- **Runbook canônico do deploy ELUS:** [`docs/runbooks/elus-vigia-portainer.md`](../runbooks/elus-vigia-portainer.md). O conector Portainer central de `portainer.wandora.com.br` **não** aponta para esta instalação e não pode ser usado para redeploy do ELUS sem nova comprovação.
- Stack: `elus`
- Rede externa usada pelo app: `vigia-edge`
- Domínio público: `https://elus.wandora.com.br`

### Estado validado da stack

Após o último redeploy, os serviços estavam em execução:

- `elus-app` — healthy
- `elus-worker` — healthy
- `elus-scheduler` — healthy
- `elus-redis` — healthy
- `elus-srh` — running
- `elus-waha` — running

O domínio respondeu corretamente e redirecionou `/ -> /app`.

### Importante sobre build

Não fazer build local do Next.js nesta VPS como fluxo normal.

Foi confirmado via kernel OOM que `next-build` chegou a consumir mais de 7 GiB de RSS e foi morto pelo sistema. O deploy recomendado usa imagens pré-compiladas e Portainer/Git.

## 3. Deploy e repositório

O deploy do Elus deve vir de:

- repositório: `OARANHA/crm-wandora`
- branch de deploy: `main`
- compose: `compose.portainer.yml`

Não implantar diretamente do upstream `melgarafael/DeskcommCRM`.

### Correção já feita no worker

Foi corrigido o `compose.portainer.yml` porque o `elus-worker` não recebia todas as variáveis obrigatórias do runtime.

Sintoma anterior:

- `elus-worker` em loop de restart.

Correção:

- repasse das variáveis obrigatórias para o worker;
- PR #4 mergeado no `main`;
- commit de merge usado no deploy: `09a2ce1a...`.

Depois disso o worker ficou healthy.

## 4. Supabase

Projeto usado pelo Elus:

- projeto: `elo.wandora`
- schema DeskcommCRM já aplicado;
- migrations/base já existentes;
- não criar outro projeto nem reaplicar baseline sem necessidade.

O primeiro tenant criado foi:

- organização: `Wandora`

### Cadastro

O Elus foi configurado para:

- cadastro apenas por convite: ligado;
- cadastro com aprovação: desligado.

Também foi desligado no Supabase:

- `Authentication -> Sign In / Providers -> Allow new users to sign up`

Objetivo: cadastro público fechado tanto no CRM quanto no Supabase Auth.

## 5. Dono da instalação / Platform Admin

A conta criada inicialmente pelo onboarding já era admin da organização Wandora.

Depois ela foi promovida para:

- **Platform Admin**
- scope: `full`

Painel de dono da instalação:

- `https://elus.wandora.com.br/admin`

O painel mostra o banner:

- `MODO PLATAFORMA — operação cross-tenant`

## 6. WhatsApp

O Elus instalado usa **WAHA**, não Evolution API.

Caminhos suportados pela UI:

- WhatsApp por QR / celular -> WAHA;
- API oficial da Meta;
- provedor parceiro.

Estado observado:

- número conectado;
- IA em modo de teste;
- sem liberação pública ainda.

Não publicar atendimento automático antes de terminar a configuração e os testes do agente.

## 7. IA — estado atual

### Jev / TypeSafe

Existe uma credencial Jev/TypeSafe ativa e validada.

Uso previsto:

- decisões rápidas;
- classificação;
- apoio ao roteamento;
- não é o modelo principal de conversa.

### Chutes

Foi criado um **Provedor personalizado compatível com OpenAI** usando Chutes.

Base URL usada:

`https://llm.chutes.ai/v1`

A credencial Chutes foi:

- salva;
- validada;
- catálogo carregado;
- 14 modelos encontrados no momento da configuração.

Não registrar neste arquivo qualquer API key ou segredo.

### Teste real do agente

Foi testado:

- provider: custom / Chutes;
- modelo: `Qwen/Qwen3.5-397B-A17B-TEE`;
- status: OK;
- resposta foi gerada em dry-run;
- nenhuma mensagem foi enviada ao WhatsApp;
- latência observada: aproximadamente 37,6 s.

Conclusão:

- integração Elus -> Chutes funciona;
- o modelo testado é funcional, mas lento demais para ser o padrão de atendimento em produção.

### Router do Chutes

O Chutes suporta aliases/roteamento por modelo.

Exemplos conceituais discutidos:

- `default`
- `default:latency`
- `default:throughput`

Limitação atual do Elus:

- para provider `custom`, a publicação do agente valida o modelo contra `models_available`;
- um alias de router que não venha no `GET /models` pode ser recusado como `model_not_found`.

Próxima evolução desejada:

- suporte nativo a Chutes/router no fork Elus.

## 8. Modelo comercial de IA desejado

Decisão de produto discutida:

### Padrão desejado

O cliente deve poder comprar:

**Elus com IA Wandora incluída**

Sem precisar obrigatoriamente criar conta em OpenAI, Anthropic, Chutes etc.

### BYOK

Continuar oferecendo opcionalmente:

- OpenAI do cliente;
- Anthropic do cliente;
- Chutes do cliente;
- outros providers compatíveis.

### Gap atual

O Elus já possui conceito de **chave da instalação**, mas o runtime global hoje está preparado principalmente para providers específicos da plataforma.

O Chutes está cadastrado atualmente como `custom` por tenant.

Evolução desejada:

- criar Chutes como provider nativo/plataforma;
- suportar algo equivalente a `CHUTES_API_KEY` da instalação;
- catálogo automático;
- roteamento;
- consumo por tenant;
- limites por plano;
- custo/margem por organização;
- fallback e escolha automática de modelo.

Na interface do cliente, o ideal é algo como:

- `IA do seu plano: Wandora AI`
- opção avançada: `Usar meu próprio provedor`

## 9. Agente atual

O onboarding criou um agente em rascunho.

Estado observado:

- versão: `v1 (rascunho)`;
- teste de conversa funcionando;
- ainda não publicado;
- operação automática aparece disponível, mas não deve ser liberada ainda.

### Capacidades

Em uma das telas de teste, a aba `Capacidades` mostrou 0 capacidades ligadas.

O produto possui pacotes, incluindo:

- `Vender e mover o funil`

Esse pacote é o candidato principal para o agente comercial da Wandora.

Antes de publicar, confirmar:

- capacidades realmente ligadas;
- `pipeline_ids` corretos;
- capacidade de ler/escrever o CRM;
- regras de segurança;
- comportamento de handoff.

### Fluxos de atendimento

**Não são obrigatórios para o agente responder.**

Fluxos de atendimento são um módulo opcional para:

- conduzir roteiro de perguntas;
- coletar respostas;
- gravar campos estruturados na ficha do cliente.

O agente pode conversar e operar CRM sem esse módulo, desde que:

- tenha modelo/chave válidos;
- tenha canal;
- tenha capacidades;
- tenha escopo de funil quando necessário.

## 10. Funil inicial da Wandora

Estrutura sugerida com 7 etapas:

1. Novo contato
2. Qualificado
3. Diagnóstico
4. Demonstração / Proposta
5. Negociação
6. Fechou
7. Não fechou

Não adicionar etapa extra sem necessidade.

## 11. Regras do agente comercial

Direção definida durante o onboarding:

- representar a Wandora com clareza e cordialidade;
- não inventar preços, prazos, funcionalidades ou integrações;
- não prometer desconto sem autorização humana;
- entender necessidade antes de oferecer solução;
- explicar tecnologia de forma simples;
- não pressionar o cliente;
- quando não souber, encaminhar;
- escalar temas jurídicos, reclamações graves e decisões comerciais fora da política;
- nunca pedir senha, token ou chave secreta pelo chat;
- proteger dados pessoais;
- não atacar concorrentes;
- terminar conversas comerciais com próximo passo claro.

## 12. Branding / customização — PRÓXIMA FRENTE

Esta é a prioridade para o próximo chat.

### Problema 1 — branding não aplica corretamente

O usuário quer começar pela customização padrão do Elus:

- tela de login;
- cores;
- logo;
- identidade visual.

Problema observado:

- alterações de marca/cores não estão refletindo corretamente no sistema.

### Problema 2 — upload PNG rejeitado como SVG

Bug observado:

- ao subir uma imagem PNG transparente, o sistema acusa que não pode subir SVG;
- a imagem é PNG, portanto a validação está identificando o tipo incorretamente ou exibindo mensagem errada.

Precisamos investigar:

- validação por MIME;
- extensão do arquivo;
- sniffing de conteúdo;
- caminho de upload;
- mensagens de erro;
- armazenamento e transformação;
- CSP/loader de imagem;
- eventual conversão interna.

### Assets desejados

Foi definido o logo:

- símbolo azul -> roxo em forma de elo/infinito;
- wordmark `elus`;
- subtítulo `by wandora`.

Foram geradas duas variantes nesta conversa:

1. logo completo com fundo transparente;
2. símbolo isolado sem palavras, também transparente.

No próximo passo, colocar os assets definitivos em uma pasta de branding do repositório e apontar o sistema para eles.

## 13. Tela de login — direção desejada

Prioridade imediata:

- aplicar identidade Elus/Wandora corretamente na tela de login;
- garantir logo adequado para fundo escuro;
- aplicar cores/acentos definidos;
- evitar assets genéricos ou branding do upstream;
- deixar o branding consistente no app e no modo plataforma.

## 14. Segurança / pendências

### Destinos internos

Foi visto no painel de Platform Admin:

- um IP individual;
- uma faixa interna ampla `10.1.0.0/16`.

A faixa ampla deve ser revisada.

Preferência:

- liberar apenas destinos realmente necessários;
- não manter CIDR amplo por conveniência.

### Segredos

Nunca registrar neste documento:

- API keys;
- service role;
- JWTs;
- passwords;
- tokens;
- chaves WAHA;
- chaves Chutes/Jev;
- credenciais Portainer.

## 15. Próxima sequência recomendada

A sequência antiga de branding foi superada pelo estado real de 02/10. O login/branding já teve
trabalho posterior nas branches Elus; a prioridade de integração agora é:

1. reconciliar e sincronizar o upstream;
2. atualizar as branches Elus vivas contra a nova `main`;
3. resolver a colisão da migration VendaERP;
4. Planos e Limites / Plano e pagamentos;
5. respostas factuais do agente via ferramentas e VendaERP;
6. Chutes nativo/embedding/router somente depois de a autoridade de plano/entitlement estar estável.

## 16. Regra de continuidade

Ao abrir novo chat, peça para **não confiar no prompt como fonte de verdade** e começar medindo o
repositório:

> Leia `AGENTS.md`, `CLAUDE.md`, `UPSTREAM.md` e
> `docs/handoffs/HANDOFF-CRM-WANDORA.md` no `OARANHA/crm-wandora`. Depois confira a `main`,
> `upstream/main`, PRs abertas, branches e migrations reais antes de qualquer escrita. Continue
> da seção “Estado canônico de continuidade — 2026-10-02”.

Assim a conversa continua a partir do estado verificável do projeto, e não da memória do chat.

---

## 2026-10-01 — Login premium do Elus e correções de branding

Branch de trabalho: `feat/elus-login-branding`.

### Assets do Elus

Os assets foram adicionados manualmente pelo proprietário do projeto, sem geração nem alteração automática:

- `public/brand/elus/login-hero.png`
- `public/brand/elus/logo-horizontal.png`
- `public/brand/elus/logo-symbol.png`

O código usa o hero e o logo horizontal. O símbolo fica reservado para usos futuros.

### Tela de login

`app/(public)/login/page.tsx` foi redesenhada como uma fachada SaaS escura e responsiva:

- hero/mascote à esquerda em desktop;
- card glass escuro à direita;
- logo horizontal do Elus;
- título “Bem-vindo ao Elus”;
- e-mail e senha continuam sendo campos reais;
- mostrar/ocultar senha preservado;
- recuperação de senha preservada;
- CTA com gradiente azul → roxo → magenta;
- fluxo de MFA preservado pela mesma `signInWithPassword`;
- não foi criado “lembrar de mim”, porque o fluxo atual não possui esse recurso.

Decisão de produto nesta etapa:

- não mostrar “Criar conta” no login;
- não mostrar “Entrar com Google” no login;
- cadastro público/landing page/funil ficam para etapa posterior;
- links de convite existentes continuam sendo a porta para criação de acesso quando aplicável;
- backend OAuth não foi removido, apenas deixou de ser exposto na tela de login.

A fachada agora resolve o nome com `marcaDaSaida(null)`, isto é, banco acima do `.env`. Isso elimina a divergência em que metadata/título podiam refletir `platform_branding` enquanto o texto do login ainda lia `branding()` do ambiente.

### PNG transparente acusado de SVG

Causa confirmada:

- a rota procurava padrões como `<?xml` nos primeiros 1 KB **antes** de respeitar a assinatura PNG/JPEG;
- PNGs legítimos podem conter metadados XMP/XML, gerando falso positivo como SVG.

Correção:

- assinatura binária PNG/JPEG tem precedência;
- a heurística textual de SVG só roda para arquivos que não foram reconhecidos como PNG/JPEG;
- `pareceSvg()` também retorna `false` imediatamente para formato binário reconhecido;
- teste de regressão cobre PNG com XML/XMP nos primeiros bytes.

### Cor da marca

A investigação da cadeia atual mostrou:

- gravação de `accent_hex` no banco funciona;
- `updateBranding` invalida o memo e a tela chama `router.refresh()`;
- `app/layout.tsx` injeta os tokens em runtime no `<head>`;
- o CSS da marca sobrescreve os tokens de accent por tema;
- a suíte já cobre serialização, cascata, contraste e escopo organização/instalação.

Importante: o hex escolhido é a **semente** da identidade. O motor deriva tons diferentes para claro/escuro quando necessário para manter contraste, então o botão pode não usar literalmente o mesmo hex. Não foi alterado esse motor de acessibilidade sem evidência de defeito.

### Estado operacional

- upstream `melgarafael/DeskcommCRM`: intocado;
- Vigia: intocado;
- stack Portainer `elus`: sem redeploy;
- nenhum build pesado foi executado na VPS;
- alterações permanecem somente na branch/PR até revisão.
