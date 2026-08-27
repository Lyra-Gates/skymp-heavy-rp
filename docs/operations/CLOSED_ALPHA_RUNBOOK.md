# Runbook da alfa fechada

Este documento transforma F9 em uma operação verificável. Campos entre `< >`
precisam ser preenchidos por uma pessoa antes da janela; ausência de responsável
é `NO-GO`, não um valor implícito.

**Baseline revalidada em 26/08/2026:** migrations lineares até v29; Public Work
continua LAB e só entra na janela depois de receber rotas/FormDescs reais.

## Ficha da janela

| Campo | Valor |
|---|---|
| início/fim | `<data e timezone>` |
| release/commit | `<SHA>` |
| incident commander | `<nome e contato>` |
| operador de infraestrutura | `<nome e contato>` |
| responsável pelo jogo/economia | `<nome e contato>` |
| canal de incidentes | `<canal>` |
| janela de manutenção | `<horário>` |
| backup pré-release | `<arquivo + SHA-256>` |
| release anterior para rollback | `<tag/SHA>` |

## Gate antes de convidar jogadores

- [ ] domínio/HTTPS, Discord OAuth e segredos de produção configurados;
- [ ] MariaDB de staging saudável, migrations até v29 e schema drift limpo;
- [ ] backup restaurável criado e rollback ensaiado;
- [ ] launcher assinado, timestamp válido e instalação Windows limpa aprovada;
- [ ] dois clientes completam login, seleção, reconexão e UI CEF;
- [ ] FormDescs físicos, rotas de Public Work e receita de Ferreiro do modpack confirmados;
- [ ] observabilidade acessível e runner de soak iniciado;
- [ ] responsáveis e canal acima preenchidos.

Qualquer caixa vazia exige decisão explícita de risco. Segurança, perda de dados,
backup, autenticação ou assinatura não podem ser dispensados informalmente.

## Rotina de duas semanas

Diariamente: revisar saúde, falhas de login, conexões, rejeições, CPU/memória,
erros DB e incidentes; confirmar backup; registrar mudança implantada. Duas
vezes por semana: reconciliar ouro e itens, revisar inflação/produção por hora e
amostrar trade, depot, barraca e contratos. Toda mudança usa changelog, SHA,
backup e plano de rollback.

Incidentes usam severidade:

| Nível | Exemplo | Resposta |
|---|---|---|
| SEV-1 | perda/duplicação, vazamento, corrupção | parar alfa e rollback |
| SEV-2 | login indisponível, crash repetido | congelar entradas e mitigar |
| SEV-3 | feature isolada quebrada | desabilitar módulo e acompanhar |
| SEV-4 | visual/texto sem impacto | registrar para próxima janela |

## Decisão de abertura

Ao final, registrar uma única decisão assinada:

- `GO`: todos os gates obrigatórios e duas semanas sem perda de dados;
- `GO COM RESTRIÇÕES`: somente limitações não críticas, com owner e prazo;
- `NO-GO`: qualquer evidência crítica ausente, SEV-1 aberto ou gate de dados,
  segurança, autenticação, rollback ou assinatura reprovado.

A ata deve incluir participantes, período, jogadores únicos, horas-jogador,
incidentes por severidade, relatório de soak, reconciliação econômica, riscos
aceitos, responsáveis e próxima revisão.
