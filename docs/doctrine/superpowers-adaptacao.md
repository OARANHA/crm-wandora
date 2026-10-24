# Superpowers — adaptação operacional para CRM-WANDORA / ELUS

> **Guia complementar**, não uma nova doutrina e não uma instalação de plugin.
> Referência externa: [obra/superpowers](https://github.com/obra/superpowers),
> licença MIT (Jesse Vincent). Síntese própria das habilidades
> [systematic-debugging](https://github.com/obra/superpowers/tree/main/skills/systematic-debugging),
> [test-driven-development](https://github.com/obra/superpowers/tree/main/skills/test-driven-development),
> [verification-before-completion](https://github.com/obra/superpowers/tree/main/skills/verification-before-completion)
> e [requesting-code-review](https://github.com/obra/superpowers/tree/main/skills/requesting-code-review).
> Não vendorizamos scripts, hooks, skills ou código externo.

## Autoridade — vem primeiro

1. Comece por `AGENTS.md`, leia `CLAUDE.md` e use `docs/index.md`
   para localizar a spec e a ADR relevantes. Precedência existente:
   `CLAUDE.md > docs/specs/ > docs/prd/ > HANDOFF-*.md > README.md`.
2. Meça o estado real de `main`, SHA, PRs, código, testes e CI. Handoffs e
   `docs/current-state.md` são retratos; memória de chat não é autoridade.
3. Siga o método de `AGENTS.md`:
   **REAL NOW → PROVEN EVIDENCE → GAPS → REUSE GATE → CORE/PROVIDER GATE → DECISION**.
4. Este guia só descreve *como trabalhar*. Não revoga tenancy, RLS, LGPD,
   idempotência, autorização, o DoD ou a
   [prova em par](./prova-em-par.md). Em conflito, vence a doutrina local.
   Consulte `UPSTREAM.md` antes de tocar em código herdado; nunca altere
   `melgarafael/DeskcommCRM` diretamente.

## 1. Systematic debugging — prove a causa

- Registre sintoma, intenção do usuário, entrada, resultado esperado e
  observado, SHA e evidência com dados sintéticos.
- Reproduza com fixture offline antes de mudar código. Se não reproduzir,
  classifique **NÃO MEDIDO** e obtenha sinais seguros; não escolha uma causa
  por intuição.
- Rastreie fronteiras: agente/prompt → roteador/tool → autorização →
  capability → provider/adapter → normalização → persistência → sender.
  Localize a primeira divergência de entrada/saída.
- Compare hipóteses com contratos, alterações recentes e testes; separe
  **CONFIRMADO**, **INFERIDO** e **NÃO MEDIDO**. Corrija na camada de origem,
  não no prompt para encobrir falha de ferramenta.
- Nunca coloque CPF/CNPJ, contatos, mensagens reais, chaves, URL assinada
  ou XML fiscal em testes, issues, PRs ou logs.

## 2. TDD — RED → GREEN → REFACTOR

1. Escreva um teste mínimo que reproduza o defeito e execute-o **antes**
   do patch. O `RED` precisa falhar pelo motivo pretendido.
2. Passe pelo **REUSE GATE**. Reuse serviços, tabelas, capabilities e sender
   existentes; não crie uma segunda implementação por conveniência.
3. Aplique a menor correção, execute `GREEN`, acrescente casos adversariais
   e refatore mantendo os testes passando.
4. Mudanças de schema, tenancy, RLS, autenticação ou mídia exigem também os
   gates específicos de `CLAUDE.md`; um unitário verde não os substitui.
5. Se RED/GREEN não puder ser executado, registre por quê e **não** alegue
   TDD comprovado.

## 3. Verification before completion + code review

- Cada conclusão precisa de evidência fresca: **comando, saída, exit code,
  SHA e escopo efetivamente coberto**. Distinguir typecheck, testes,
  CI, publicação GHCR, deploy e canário real.
- `workflow green` não prova funcionalidade que não foi testada nem
  jobs ignorados por filtros de caminhos.
- Se o caso passa por IA, adote a
  [prova em par](./prova-em-par.md): agente/canal e ferramenta direta
  precisam concordar para a **mesma intenção e texto cru**.
- Antes de PR/merge, revisar diff contra spec e invariantes, com revisor
  independente quando disponível. Sem revisor, declarar o limite; não
  inventar revisão. Sem confirmação de gate, não publicar.
- Não fazer polling de workflows se o proprietário disse que informará
  `green/red`. Não interpretar autorização de teste como autorização de
  merge, deploy ou chamada real ao ERP.

## Exemplo guiado — duas últimas NF-es do VendaERP

Objetivo: administrador solicita pelo WhatsApp as duas NF-es mais recentes
de um cliente, inclusive quando o CRM ainda precisa criar o vínculo mínimo.

**Investigue separadamente**, usando `docs/specs/integracoes-erp-v1.md`:

1. **Identidade:** `Pedidos/Pesquisar` localizou o cliente? O pedido tem
   `pessoaID` ou sinais fortes? A resolução existente prova identidade e
   evita novo contato duplicado? Nome isolado não autoriza envio fiscal.
2. **Paginação:** compare a resposta para limites 10 e 100 e vários `skip`
   em fixtures. Diferencie vazio verdadeiro, filtro incompatível,
   resposta parcial, fim da paginação e falha de provider.
3. **Recência:** identifique `numeroNFe`, `dataFaturamento` e
   `Fiscal/InformacoesVenda` quando for necessário. Não infira data a
   partir da ordem da lista ou do número da nota.
4. **DANFE:** somente depois de identificar e autorizar as notas, reutilize
   `crm_erp_get_invoice`, `crm_erp_prepare_admin_danfe` e o sender
   canônico (`before_send`/`send_ledger`). Timeout do PDF é problema
   separado de busca fiscal.
5. **Regressões:** fixture sem pedidos, página curta, múltiplas páginas,
   notas sem data, identidade ambígua, uma nota só, duas notas válidas,
   falha no segundo PDF. Registre a prova em par somente após autorização
   expressa para teste real.

O provider permanece **read-only**. Sem consultas reais ao VendaERP, envio
de WhatsApp ou canário sem gate explícito do proprietário.

## Operação enxuta e transferência

- Branch própria no fork, PR para `main`, sem tocar no upstream. Para
  frente documental, não instalar plugin nem adicionar dependências.
- Builds de imagens no GitHub Actions, **não na VPS do Vigia**; evitar
  clones redundantes, caches extras e execução pesada no host.
- Medir antes de limpar. Nunca executar `docker system prune` global,
  remover volumes/imagens em uso ou perder o rollback.
- Fechar cada frente com evidência versionada na PR/issue/handoff relevante:
  causa, decisão, RED/GREEN, testes executados/não executados, SHA, gaps
  e rollback; sempre com dados sanitizados.

**Atenção:** este arquivo documenta procedimentos para agentes. Apenas
colocá-lo em `docs/` **não instala nem ativa** automaticamente o plugin
Superpowers no ChatGPT, Cursor ou outro executor.
