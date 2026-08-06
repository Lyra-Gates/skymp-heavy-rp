## O que muda

<!-- Uma ou duas frases. O "porquê" importa mais que o "o quê" — o diff já mostra o quê. -->

## Serviços tocados

<!-- Marque o que você mexeu. Ajuda quem revisa a saber onde olhar. -->

- [ ] `skymp/gamemode`
- [ ] `apps/web` (painel)
- [ ] `apps/game-api` (porta 7758)
- [ ] `apps/bot-discord`
- [ ] `apps/launcher`
- [ ] Schema / migrations
- [ ] Só documentação

## Como você verificou

<!-- Cole a saída dos testes, ou diga o que rodou manualmente. -->

- [ ] Testes passam nos serviços tocados
- [ ] `npm run typecheck` limpo (gamemode e/ou launcher)
- [ ] Teste novo cobrindo o comportamento novo

**Isto foi validado em jogo?**

- [ ] Sim, rodei numa sessão real
- [ ] Não — só teste automatizado

> Se marcou "não", tudo bem: quase tudo neste projeto está nessa situação. Só é importante ser explícito, porque o `mp` mockado aceita qualquer coisa e teste verde não prova que funciona em jogo.

## Checklist

- [ ] Nenhum segredo, `.env` real ou asset da Bethesda no diff
- [ ] Ouro e item passam pelo `core/transaction-service` (se aplicável)
- [ ] Chamada Papyrus usa `actorRef`/`baseRef` (se aplicável)
- [ ] Documentação atualizada, se mudou comportamento ou arquitetura
- [ ] Li o [CONTRIBUTING.md](../CONTRIBUTING.md) §3 — as regras que não são óbvias

## Notas para quem revisa

<!-- Alguma decisão que você tomou e que merece discussão? Alguma parte que você -->
<!-- não teve certeza? Dizer isso agora economiza uma rodada de review. -->
