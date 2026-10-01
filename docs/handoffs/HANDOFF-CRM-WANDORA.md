# HANDOFF — CRM-WANDORA / Elus

> Documento vivo para continuidade entre conversas.  
> Atualizado em: 2026-10-01  
> Repositório: `OARANHA/crm-wandora`  
> Regra: atualizar este arquivo ao fim de cada frente relevante para não depender do histórico do chat.

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

No próximo chat, começar diretamente por:

1. localizar a implementação de branding do Elus;
2. reproduzir o bug de upload PNG -> erro de SVG;
3. corrigir validação/upload;
4. aplicar logo completo e ícone;
5. corrigir cores e tela de login;
6. revisar branding do app principal e Admin Plataforma;
7. depois voltar ao agente:
   - capacidades;
   - modelo rápido;
   - router Chutes;
   - publicação;
   - liberação do WhatsApp.

## 16. Regra de continuidade

Ao abrir novo chat, pedir:

> Leia `docs/handoffs/HANDOFF-CRM-WANDORA.md` no repositório `OARANHA/crm-wandora` e continue da seção “Branding / customização — PRÓXIMA FRENTE”.

Assim a conversa pode continuar sem depender do contexto anterior.
