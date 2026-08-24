# Plano de soak test

Estado em 24/08/2026: **runner pronto; execução de 6–8 horas bloqueada por
staging/MariaDB e 5–10 jogadores reais**.

## Objetivo e aceite

A sessão dura no mínimo 6 horas, com 5–10 jogadores conectados pelo launcher.
Ela só passa quando:

- nenhum item ou ouro é perdido/duplicado;
- nenhum processo reinicia sem explicação;
- taxa de erro dos health checks fica em até 1%;
- login, reconexão, chat, interação, trade, depot, mineração, crafting, crime e
  socorro têm ao menos uma execução registrada;
- backup pré-teste existe e um responsável acompanha incidentes;
- relatório JSON, telemetria do gamemode e logs dos serviços são preservados.

O runner HTTP mede disponibilidade; ele **não simula jogador Skyrim**, banco,
CEF, Papyrus, inventário ou concorrência InnoDB.

## Preparação

1. Preencher responsáveis e janela no
   [`CLOSED_ALPHA_RUNBOOK.md`](CLOSED_ALPHA_RUNBOOK.md).
2. Subir staging e aplicar migrations até v28 em banco vazio.
3. Executar `check:schema` e criar backup com `Backup-Staging.ps1`.
4. Confirmar manifesto, launcher, UI, FormDescs de nós/estações e duas contas.
5. Abrir canal de incidentes e sincronizar relógio das máquinas.

## Coleta automatizada

No host de staging, com os três serviços expostos apenas em loopback:

```powershell
node scripts/run-service-soak.js `
  --url http://127.0.0.1:3001/health `
  --url http://127.0.0.1:7758/health `
  --url http://127.0.0.1:3002/health `
  --duration-seconds 21600 `
  --workers 5 `
  --interval-ms 1000 `
  --timeout-ms 5000 `
  --max-error-rate 0.01 `
  --output reports/soak-alpha.json
```

Para 8 horas, usar `--duration-seconds 28800`. O arquivo de saída é criado com
modo exclusivo: um relatório existente nunca é sobrescrito. O processo retorna
`0` quando todas as URLs ficam dentro do limite, `2` quando o gate falha e `1`
para configuração inválida.

## Roteiro humano por hora

| Momento | Ação mínima |
|---|---|
| início | login pelo launcher, mesma célula, chat e painel |
| hora 1 | mineração → depot → fundição/crafting |
| hora 2 | trade e barraca concorrentes |
| hora 3 | crime, revista, confisco e restituição |
| hora 4 | downed, socorro, desconexão e reconexão |
| hora 5 | contratos, economia e revisão dos contadores |
| final | logout limpo, balanços, inventários, backup e coleta de logs |

Cada incidente registra horário, jogadores, ação, resultado esperado, resultado
observado, requestId quando visível, severidade, mitigação e link para os logs.

## Critérios de interrupção

Interromper e iniciar rollback se houver duplicação/perda, autenticação
generalizadamente indisponível, corrupção de schema, segredo em log, crash loop
ou impossibilidade de reconstruir uma transferência. Erro cosmético isolado
pode continuar se tiver responsável e não comprometer dados.

## Fechamento

Anexar o JSON do runner, SHA do commit, migration final, número de jogadores,
duração, incidentes e reconciliação econômica ao plano de prontidão. Sem esses
artefatos, F8-005 permanece parcial independentemente de a sessão “parecer boa”.
