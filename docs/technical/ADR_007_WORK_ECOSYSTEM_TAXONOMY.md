# ADR 007 — Taxonomia do Ecossistema de Trabalho

**Status:** Aceito · **Data:** 20/08/2026 · **Revalidado:** 26/08/2026

## Decisão

O projeto trata como conceitos diferentes:

| Conceito | Pergunta que responde |
|---|---|
| Profession | O que o personagem sabe fazer? |
| Specialization | Em qual ramo desse saber ele se aprofundou? |
| Employment | Para quem ele trabalha de forma continuada? |
| Position | Qual posição ocupa naquele emprego? |
| Business | Quem possui e administra a entidade econômica? |
| Public Work | O que qualquer personagem pode fazer sem profissão? |
| Contract | O que partes nomeadas combinaram uma vez? |
| Governance | Quem possui autoridade institucional sobre quem? |

Nenhuma implementação futura pode usar um desses domínios para representar
outro apenas por conveniência.

**Estado da implementação na revalidação:** o domínio genérico de Public Work
já existe em LAB (`public-work-service.js`, migration v29 e quatro ações pelo
Interaction Framework), mas permanece desligado localmente, sem rotas reais e
sem homologação com MariaDB/clientes. Isso implementa a fronteira desta ADR;
não torna Lenhador ou outra profissão um trabalho público.

## Regras de fronteira

1. Profissão concede progressão técnica; emprego não.
2. Trabalho público não ocupa slot nem concede XP de profissão.
3. Cargo privado não concede autoridade institucional.
4. Negócio não guarda uma segunda lista de empregados; essa relação pertence a
   Employment.
5. Contrato é uma obrigação pontual com partes e recompensa nomeadas; não é
   emprego nem trabalho público gerado pelo servidor.
6. Somente Governance pode autorizar revista, prisão, multa, confisco ou outro
   poder institucional.

## Motivação

O código atual possui um Profession Core consistente, mas o legado
`jobs-service.js` agrupa verbos de coleta sem distinguir profissão, trabalho
público e contrato. Sem esta taxonomia, um novo sistema tende a ser encaixado em
`character_professions`, mesmo quando representa uma relação de emprego ou uma
corrida temporária.

A separação também protege a economia: um trabalho público pode oferecer renda
inicial sem virar um caminho alternativo para produzir minério, madeira ou
outros insumos reservados às profissões.

## Consequências

- `character_professions` não recebe campos de emprego, cargo ou negócio.
- Public Work terá catálogo e execuções próprias, conforme
  [ADR 011](ADR_011_PUBLIC_WORK.md).
- Contratos jogador↔jogador continuam no
  [Contract Framework](../gameplay/CONTRACTS.md).
- A fronteira Profession/Specialization continua definida pela
  [ADR 008](ADR_008_PROFESSION_SPECIALIZATION_BOUNDARY.md).

## Alternativas rejeitadas

- **Um sistema genérico chamado Role.** Perderia as garantias de ciclo de vida,
  autorização e schema de cada domínio.
- **Transformar toda atividade remunerada em profissão.** Impediria renda
  inicial e consumiria slots por tarefas sem conhecimento técnico.
- **Transformar todo trabalho público em contrato.** Contrato exige partes
  nomeadas, escrow e confirmação; trabalho público é uma oferta padronizada do
  mundo, com conclusão verificável pelo servidor.
