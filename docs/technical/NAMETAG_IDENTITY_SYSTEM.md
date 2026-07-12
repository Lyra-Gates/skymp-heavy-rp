# Sistema de Nametag e Identidade Social

Data: 2026-07-12

Objetivo: impedir que jogadores descubram o nome IC de outro personagem apenas por proximidade, interface ou chat. O nome exibido deve depender do conhecimento do personagem observador.

## Estado Atual

Implementado em laboratorio:

- Servico server-side: `skymp/gamemode/identity-service.js`.
- Relacao persistente: `character_known_identities`.
- Integracao com chat local: `rp-chat-service.js` resolve nomes por destinatario.
- Comandos:
  - `/apresentar <actorId>`: apresenta o proprio personagem ao alvo.
  - `/apelido <actorId> <nome>`: salva um nome privado para reconhecer alguem.
  - Aliases tecnicos: `/introduce` e `/alias`.

Ainda pendente:

- Nametag visual acima da cabeca.
- UI de lista curta de pessoas proximas.
- Validacao em jogo com dois clientes.
- Integracao completa com disfarces.

## Regra de Exibicao

Para cada observador, o servidor resolve o nome do alvo assim:

1. Proprio personagem: nome real.
2. Staff futura: nome real, com permissao auditada.
3. Identidade conhecida: nome registrado em `character_known_identities`.
4. Desconhecido: `Desconhecido`.

O cliente nao escolhe nem envia o nome exibido.

## Apresentacao

`/apresentar <actorId>` e unilateral.

Exemplo:

- A usa `/apresentar B`.
- B passa a conhecer A pelo nome real de A.
- A nao passa a conhecer B automaticamente.
- Se B quiser revelar o proprio nome, B usa `/apresentar A`.

Motivo: a cena precisa acontecer em RP. O sistema nao deve transformar proximidade em metagaming automatico.

## Apelido

`/apelido <actorId> <nome>` salva conhecimento privado do observador.

Usos esperados:

- `Ferreiro de Whiterun`
- `Guarda ruivo`
- `Homem encapuzado`
- `Mercadora da taverna`

Esse nome aparece apenas para quem definiu o apelido.

## Referencia Keizaal Online

Nao foi encontrada documentacao tecnica publica confirmando a implementacao exata de nametags do Keizaal Online.

Decisao: usar o comportamento como referencia de design relatada/observada, nao como fonte tecnica confirmada.

Fontes publicas usadas como contexto:

- `https://keizaal.com/`
- `https://keizaal.com/play`
- `https://github.com/skyrim-roleplay`
- `https://github.com/skyrim-multiplayer/skymp`

## Requisitos Para Alfa

- Dois clientes devem ver nomes diferentes para o mesmo alvo conforme conhecimento.
- O nome real nao pode aparecer no chat para personagem desconhecido.
- Reconexao deve preservar conhecidos e apelidos.
- Restart do servidor deve preservar conhecidos e apelidos.
- Disfarce ativo deve poder sobrescrever nome publico sem alterar conhecimento real.
- Staff deve ter comando auditado para revelar identidade.
