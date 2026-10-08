# ELUS / CRM-WANDORA — deploy canônico na VPS do Vigia

> **AUTORIDADE OPERACIONAL DO ELUS.** Este runbook é específico do fork
> `OARANHA/crm-wandora`; as instruções genéricas de self-host e HostGator
> (`docs/runbooks/deploy.md`) não substituem a configuração real da stack ELUS.
> Antes de cada ação, conferir o estado real; os SHAs abaixo são histórico, não
> valores fixos para a próxima publicação.

## Ambiente correto — não confundir Portainers

| Campo | Valor da instalação ELUS |
| --- | --- |
| Portainer correto | **https://ops-vigia.wandora.com.br/** |
| VPS | **Vigia** (não a VPS principal da Wandora) |
| Stack | `elus` |
| Stack ID observado em 08/10/2026 | `5` |
| Endpoint ID observado em 08/10/2026 | `3` |
| Git Stack | `https://github.com/OARANHA/crm-wandora` |
| Referência Git | `refs/heads/main` |
| Compose | `compose.portainer.yml` |
| Aplicação | `https://elus.wandora.com.br` |
| Imagens oficiais | `ghcr.io/oaranha/elus-app` e `ghcr.io/oaranha/elus-worker` |
| Target operacional no Vigia | `vigia-managed-admin` (capability autorizada) |

**BLOQUEIO:** o conector MCP genérico de Portainer foi observado em 08/10/2026
apontando para `https://portainer.wandora.com.br`, que **não é** o Portainer
do ELUS. Ele retornou lista vazia de stacks e HTTP 404 para a stack 5.
**Nunca use esse conector para deploy ELUS** enquanto sua URL, instância,
endpoint e stack não forem comprovadamente reconciliados com o Vigia.
O nome `local` ou o endpoint ID `3`, isoladamente, não provam identidade
de instância. Não crie uma stack substituta na instância errada.

O `elus_vendaerp_danfe_canary_preflight` de `vigia-elus` confirmou, em
08/10/2026, a instância local do Vigia, stack `elus` de ID `5` e endpoint
`3`. Esse preflight **não faz deploy**. O caminho operacional validado
para o deploy é a **API local do Portainer na própria VPS do Vigia**, acessível
pela capacidade governada do target `vigia-managed-admin`, com autenticação
guardada no próprio servidor. Nunca transportar chave/token/cookie para
este repositório, para o modelo ou para o WhatsApp.

## Sequência obrigatória

1. **Real now e autoridade:** conferir `CLAUDE.md`, `AGENTS.md`,
   `docs/index.md`, este runbook e `compose.portainer.yml`; depois
   `main`, PR, merge SHA e o estado real da stack **no Vigia**.
2. **CI:** trabalhar em branch própria; obter `green` informado pelo
   usuário; **nunca fazer polling do GitHub Actions**. Só fazer merge
   após reconciliar HEAD/mergeability.
3. **Duas imagens:** o workflow `Publish Elus images` publica `elus-app`
   e `elus-worker` no GHCR com a tag do **mesmo SHA de `main`**.
   Conferir `docker-content-digest` do manifesto de **ambas** as tags
   `ghcr.io/oaranha/{elus-app,elus-worker}:<SHA>`; usar referências
   imutáveis `@sha256:...`. `green` sozinho não prova os digests.
4. **Pré-deploy:** conferir no Portainer *correto* `Name=elus`, ID,
   endpoint, Git URL, `refs/heads/main`, env obrigatória presente,
   espaço livre e contêineres atuais saudáveis. Registrar exatamente
   `APP_IMAGE` e `WORKER_IMAGE` em execução (digests) para rollback,
   sem imprimir os demais valores de `Env`.
5. **Aplicação:** reutilizar o script operacional governado, com
   pré-condições estritas para SHA, imagens antigas e novas, rollback
   e preservação dos demais envs. Pull somente das imagens do app
   e worker, **sem build na VPS**. Atualizar a stack Git do Portainer
   do Vigia com `prune:false`, sem trocar repo/branch, mantendo
   `APP_PULL_POLICY=missing` e `WORKER_PULL_POLICY=missing` quando
   o script usa imagens já presentes em cache. Não usar `docker
   compose up` avulso, não tocar nas stacks do Vigia/Wandora.
6. **Pós-deploy (aceite técnico):** `elus-app` e `elus-worker`
   **healthy** usando as imagens novas; `elus-redis`,
   `elus-waha`, `elus-srh` e `elus-scheduler` em execução,
   sem dependência unhealthy; `https://elus.wandora.com.br/api/v1/health`
   HTTP 200, `data.status=healthy`, checks `supabase/redis/waha=ok`
   e `data.version` **exatamente o SHA do merge**. Conferir que
   a rota pública abre, não só o probe TCP.
7. **Falha:** **fail-closed**. Se deploy ocorreu mas o pós-gate falhou,
   restaurar `APP_IMAGE` e `WORKER_IMAGE` antigos preservados,
   `prune:false`, e registrar se o rollback foi apenas solicitado ou
   efetivamente comprovado. Não declarar sucesso sem nova checagem.
8. **Canário real:** somente após imagens confirmadas, deploy saudável
   e versão exata. Para VendaERP/ISIS: respeitar READ-ONLY, autorização
   `erp.admin.read`, auditoria, identidade fiscal, DANFE e a regra
   de não repetir chamadas reais apenas para investigar. CI/merge
   não comprovam entrega da DANFE ao WhatsApp.

## Histórico de releases

- **08/10/2026:** PR #71 mergeada em `main`, SHA
  `459a150a5d9e0bc51968fd0cc949d45b33097ed2`.
  Imagens publicadas verificadas via manifesto GHCR:
  - app: `ghcr.io/oaranha/elus-app@sha256:bb7e997638438b96083306ecc68a32ca2039a7d873b100288b4103b0ac7b4b7f`;
  - worker: `ghcr.io/oaranha/elus-worker@sha256:89622364ca5ee761f227b6be25b583139df807f30c990f52ec2c65ba0641afb4`.
  Rollback preservado do deploy anterior:
  - app: `ghcr.io/oaranha/elus-app@sha256:06cab8c8ccff032eaedde24ed460d7e6ed645c0fc4c138b80764a02c30985124`;
  - worker: `ghcr.io/oaranha/elus-worker@sha256:c4bbc68c307370a60df485ac5acdc4e0c5858eb0c7bbd01d7f12adc53038e885`.
  **Status da implantação:** **DEPLOY CONCLUÍDO COM SUCESSO** no Portainer
  local da VPS do Vigia. Execução governada do procedimento
  `deploy-elus-459a150-safe.mjs`: código de saída `0`,
  `ok:true`, `stack=5`, `endpoint=3`, `prune:false`.
  `elus-app` e `elus-worker` running/healthy nas imagens novas;
  `elus-redis` e `elus-scheduler` healthy; `elus-waha`
  e `elus-srh` running. Endpoint público
  `/api/v1/health` HTTP `200`, `data.status=healthy`,
  `data.version=459a150a5d9e0bc51968fd0cc949d45b33097ed2`,
  `supabase/redis/waha=ok`. Rollback anterior preservado.
  **Não significa canário ISIS/DANFE aprovado**; esse aceite exige
  prova funcional real e entrega dos PDFs no WhatsApp correto.

## Continuidade

Em toda nova conversa/operação ELUS, leia **este runbook**, e não use
a configuração default do conector `portainer_*` como se fosse
o Portainer do Vigia. Mesmo quando houver um resumo anterior dizendo
que algo foi implantado, reconcilie main, imagens, stack, contêineres
e health/version antes de agir. Não registrar segredos em docs/logs.
