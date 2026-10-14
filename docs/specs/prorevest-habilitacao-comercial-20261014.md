# Prorevest — habilitação comercial e técnica no ELUS (gate de 14/10/2026)

> Diagnóstico operacional e plano de implantação progressivo. O estado abaixo foi
> medido na organização real `prorevest` via consultas estritamente `SELECT`,
> conferido contra o código e `main` em
> `18d7e338d5e8f0779aa841163deedb32f7aa8407`.
> Os materiais fornecidos pelo proprietário permanecem fora do GitHub e fora do
> banco enquanto a indexação e as regras de publicação não estiverem validadas.
> **Não é atestado de atendimento funcional em produção.**

## 1. Estado real

- A organização Pro Revest Tintas e Revestimentos está ativa.
- Três agentes publicados, ativos e em modo `automatic`:
  **Consultor Prorevest** v2, **Especialista Industrial Prorevest** v2,
  **ISIS — Assistente Administrativa Prorevest** v7. A sessão WhatsApp
  compartilhada está `WORKING`.
- `Roteador Prorevest` está ativo, com três intenções:
  `linha_geral` (Consultor), `linha_industrial` (Especialista),
  `administrativo_isis` (ISIS). O fallback publicado é o Consultor.
  **Roteamento não concede** `erp.admin.read`: a autorização administrativa
  continua no usuário/binding do WhatsApp e na capability.
- O Consultor publica acesso a duas fontes FAQ; o Especialista, à FAQ
  industrial. Existem **9** perguntas/respostas na FAQ geral e **7** na FAQ
  industrial, porém **ambas** registram `last_index_status=sem_credencial`,
  `chunks_count=0`, sem versão ativa de KB.
- Em `catalog_products` e `nuvemshop_products` há **zero** produtos dessa
  organização; não confundir com disponibilidade comercial no VendaERP.
- Os agentes comerciais expõem `crm_search_knowledge`,
  `crm_erp_search_products` e `crm_erp_read_stock`. As últimas capabilities
  acessam o VendaERP **somente em leitura** e seus resultados precisam ser
  tratados como fonte estruturada; não inferir preço, estoque, SKU ou prazo.
- O tenant possui credenciais `custom` e `typesafe`, mas nenhuma credencial
  `openai`, `openrouter` ou `google` registrada como ativa para esse escopo,
  nem vínculo registrado para `embedding_indexar` e
  `embedding_consultar`. O resolvedor também pode utilizar configurações
  de instalação que não foram medidas neste gate. A evidência decisiva do
  bloqueio é o próprio estado `sem_credencial` gravado pelo indexador.
- Não há busca registrada em `knowledge_searches` para o tenant; não existem
  testes de atendimento real dos dois agentes comerciais comprovados por
  `ai_agent_runs` na janela consultada.

## 2. Autoridades e capacidades a reutilizar

1. `lib/ai/embeddings/chave.ts` — seleção canônica da família/credencial de
   embeddings, com isolamento por organização. Configurar credenciais
   utilizáveis **pela interface autenticada**, sem inserções SQL de chaves.
2. `app/api/v1/ai/knowledge/sources/[id]/reindex/route.ts` — reindexação
   governada das 2 FAQs existentes, sem duplicar fonte. A worker
   `workers/rag-indexer.ts` é dono de extração, chunks, embedding e versão.
3. `app/api/v1/ai/knowledge/sources/upload/route.ts` — upload autenticado
   de PDF, Markdown, CSV ou texto, até 20 MB, com storage privado, validação
   de extração, evento e indexação pelo worker. **XLSX não é admitido.**
4. `ai_agent_versions.knowledge_source_ids` — escopo das fontes por versão
   publicada: manter o documento geral no Consultor e o industrial no
   Especialista, permitindo ao Consultor usar ambos apenas após revisão.
5. `ai_routers` / `ai_router_members` — roteamento já implementado. Não
   criar um segundo classificador ou substituir a ISIS administrativa.

## 3. Fontes originais — ainda não importadas

- `Catalogo Pro Revest(1).pdf` — 15 páginas: linha geral, preparação,
  texturas, massas, tintas, esmaltes, vernizes, resinas e solventes.
  Apresenta rendimento, acabamento, embalagem e usos declarados pelo
  fabricante; **não** equivale a preço/estoque vigente.
- `CATALOGO-INDUSTRIAL Pro Revest(1).pdf` — 6 páginas: primers,
  anticorrosivos, epóxi, poliuretano e demarcação, com secagem, rendimento e
  ressalvas de compatibilidade. A recomendação industrial exige distinguir
  superfície, preparação, sistema de pintura e condição ambiental; não
  improvisar normas ou compatibilidade.
- `RGB Cores.xlsx` — aba `Plan1`, 1.549 códigos próprios distintos;
  sem duplicação após normalização de espaços e caixa no código:
  - **943** nomes com HEX válido, para _prévia digital aproximada_;
  - **595** nomes sem HEX, consultáveis por código/nome, mas sem prévia;
  - **1** registro com HEX malformado, a corrigir;
  - **10** registros sem nome, a revisar antes da publicação;
  - **39** nomes repetidos em códigos diferentes (não colapsar códigos).
    Um CSV de **1.539** cores nomeadas e uma auditoria XLSX foram preparados
    **fora do repositório e fora da produção**; o CSV não é cadastro de SKU e
    não deve ser importado como produto vendável.
- Site e Instagram são canais de comunicação e podem orientar linguagem e
  posicionamento, mas conteúdo dinâmico não substitui ficha técnica. Endereço
  e contatos entre fontes exigem reconciliação com o responsável comercial.

## 4. Modelo de atendimento esperado

- **Linha geral:** perguntar superfície, ambiente (interno/externo),
  metragem, preparação, acabamento, preferência de cor, produto e quantidade;
  calcular apenas estimativa com rendimento/por demão comprovado e aviso
  de variação por substrato e diluição.
- **Industrial:** perguntar substrato, condição, exposição, preparação,
  resistência requerida, método, espessura e sistema de pintura;
  orientar com referência explícita no catálogo, ou encaminhar ao técnico
  se faltar informação essencial.
- **Cores:** reconhecer `PR001`, `PR1000` etc., nome e HEX válido;
  distinguir `referência digital` de fórmula tintométrica e de amostra
  física. Personalização é **solicitação de orçamento/validação técnica**,
  nunca confirmação automática de viabilidade, tom idêntico ou prazo.
- **Venda:** preço, estoque e produto/variante somente das tools
  estruturadas autorizadas, mantendo VendaERP `READ-ONLY`. Nenhuma
  ferramenta de criação de pedido ou emissão fiscal é autorizada neste slice.
- **ISIS:** apenas solicitações administrativas de WhatsApp cujo vínculo
  real prove `erp.admin.read`. Pedido administrativo por texto não confere
  permissão ao usuário.
- **Handoff:** solicitar pessoa humana quando cor especial, orçamento,
  aplicação industrial crítica, preço, estoque ou disponibilidade não puderem
  ser demonstrados com a fonte correta.

## 5. Gates sequenciais

1. **G0, concluído — diagnóstico sem escrita:** verificar a organização,
   versões, roteador, FAQs, credenciais, catálogo e fontes; preservar
   auditoria em documentação. Não houve alteração em banco/produção.
2. **G1, pendente — habilitar embedding:** configurar/validar na interface
   da organização credencial suportada para `embedding_indexar` e
   `embedding_consultar`. Não copiar secret ou chave para repositório/chat.
   Verificar familia/modelo com a base. Sem autorização/credencial, **NO-GO**.
3. **G2, pendente — FAQ existente:** reindexar as 2 fontes via capability
   oficial, provar `chunks_count>0`, versão `ready`/ativa e busca real
   de um fato já registrado, no tenant correto.
4. **G3, pendente — catálogos:** enviar ambos os PDFs originais pelo
   upload autenticado; aguardar worker; verificar extração, checksum,
   `chunks_count`, versão e `knowledge_source_ids` publicados. Não
   reprocessar PDFs em chamadas LLM ad hoc.
5. **G4, pendente — cores:** confirmar registro sem nome e HEX malformado
   antes de publicar; guardar catálogo completo com identidade estável.
   O CSV de 1.539 referências serve à preparação e _não_ prova
   disponibilidade. Para busca EXATA por código/nome em escala,
   avaliar primeiro uma capability estruturada já existente; só propor
   schema novo para cores após evidência de lacuna real, sem tabela paralela
   como atalho.
6. **G5, pendente — testes offline e canário autorizado:** verificar
   roteamento geral/industrial/ISIS, perguntas de tinta de gesso, Galvalit
   em galvanizado a fogo, cálculo de cobertura com unidades, cor por nome,
   cor sem HEX, personalização, preço/estoque ausentes, orçamento humano e
   proteção da ISIS contra usuário não autorizado. Prova em par agente/tool
   quando aplicável. Não acionar VendaERP real para diagnóstico.

## 6. Critério de aceite

Não basta `is_active=true`, um chatbot gerar texto, ou CI verde.
O aceite requer conteúdo técnico consultável por fontes ativas, não
alucinar preço, estoque, cor produzível, fórmula, prazo ou norma,
respeitar identidade externa, roteamento, handoff e isolamento por
organização. Uma resposta de ausência de produto não pode mascarar
falha de capability. Confirmar funcionamento em canal autorizado
apenas após gate de código/CI/publicação/deploy correspondente.

**Decisão:** utilizar capacidades já existentes de acervo, worker,
roteamento e ERP read-only. Manter o pacote de preparação dos três
materiais em armazenamento do operador, não publicá-lo no GitHub,
não importar dados em `catalog_products` nem escrever credenciais por SQL.
