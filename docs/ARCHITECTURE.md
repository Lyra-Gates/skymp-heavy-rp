# Arquitetura do Sistema (SkyMP Heavy RP)

O servidor de SkyMP Heavy RP opera utilizando uma arquitetura distribuída, separando os serviços críticos para garantir segurança, estabilidade e aderência rígida à regra de **Autoridade do Servidor**.

## 1. Topologia do Servidor

A infraestrutura é dividida nos seguintes módulos:

### 1.1 Banco de Dados (MariaDB/MySQL)
O **MariaDB** é a fonte absoluta de verdade. Todos os serviços se conectam a ele.
- **Tabelas Principais:** `characters`, `factions`, `houses`, `economy`, `crafting_recipes`, `crafting_ingredients`.
- **Regra Restrita:** Nenhuma alteração de estado no jogo (dinheiro, posições, itens) acontece sem ser gravada ou lida do MariaDB. O Node.js não confia em dados soltos na memória por períodos longos sem persistência.

### 1.2 Aplicativo Web e API (`apps/web`)
Desenvolvido em **Express.js / Node.js**.
- Fornece o Painel Web (Whitelist, Staff, Painel do Jogador).
- Fornece os Endpoints da API para o **Launcher** (download de manifesto de mods, versões atualizadas, controle de acesso).
- Autenticação obrigatória utilizando `passport-discord`.

### 1.3 Bot do Discord (`apps/bot-discord`)
Desenvolvido em **discord.js**.
- Facilita o envio de logs do servidor para canais da moderação.
- Realiza a ponte entre a conta do Discord do usuário e o seu `profileId` no jogo.

### 1.4 Servidor Nativo SkyMP (Gamemode)
Localizado em `skymp/gamemode/`.
- Executado em Node.js usando as bibliotecas internas do SkyMP (`mp.events`, `mp.players`).
- Lida com o ciclo de vida do jogador: conexão, desconexão, spawn, combate, comandos de chat e persistência de itens em tempo real.
- Delega regras de negócios a serviços internos (`survival-service.js`, `economy-service.js`, `crafting-service.js`, `jobs-service.js`).

### 1.5 Launcher do Cliente (`apps/launcher`)
Desenvolvido em **Electron / React**.
- Lê o Manifesto da API Web e faz a validação criptográfica (Hashes) da *Load Order* do jogador.
- Garante que a versão dos ESMs, texturas aprovadas, e SKSE estejam idênticas à do servidor.

## 2. Fluxo de Decisão (A Regra de Ouro)

No nosso servidor, a autoridade nunca é delegada ao cliente.

**Exemplo de Fluxo (Pescaria ou Forja):**
1. O jogador (Cliente) aperta um botão para interagir.
2. O Gamemode (Servidor) recebe a requisição, checa se ele tem a vara/recurso e a habilidade necessária no Banco de Dados.
3. O Servidor altera o banco, salva o novo item.
4. O Servidor dispara o `mp.callPapyrusFunction` apenas para o cliente fazer a animação e receber o aviso visual de sucesso.
*(Se um mod local tentar pular a etapa 2, ele falha silenciosamente, protegendo a economia).*
