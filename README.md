# SkyMP Heavy RP Ecosystem

Bem-vindo ao repositório principal do servidor SkyMP Heavy RP. 
Este projeto é uma plataforma multijogador de *Roleplay Estrito* para Skyrim, focada em estabilidade, autoridade do servidor, e imersão sem comprometer a sincronização de rede.

## Documentação Oficial do Projeto

A documentação do projeto está dividida em diretórios para fácil manutenção técnica e legal. Por favor, leia os seguintes documentos antes de propor alterações na *Load Order* ou nos módulos Node.js:

1. **[Arquitetura do Sistema (ARCHITECTURE.md)](docs/ARCHITECTURE.md):** Contém a explicação de como o Banco de Dados, o Bot do Discord, o Painel Web, o Launcher e o Gamemode nativo conversam entre si.
2. **[Diretrizes de Modding (MODDING_GUIDELINES.md)](docs/MODDING_GUIDELINES.md):** A nossa Bíblia de arquitetura de mods. Explica as regras de ouro, as fases de lançamento (0A, 0B, 1, Alfa, Beta) e a Lista Negra de mods proibidos (como JK's Skyrim ou Survival Scripts no cliente).
3. **[Registro de Assets (ASSET_LICENSE_REGISTRY.md)](docs/legal/ASSET_LICENSE_REGISTRY.md):** Controle rigoroso de direitos autorais e licenças de todos os assets (.nif, .dds) que inserimos nos nossos próprios plugins ESM.

## Como Executar o Servidor (Desenvolvimento)

Para facilitar a vida dos desenvolvedores, criamos um script de orquestração automatizado que inicia todas as dependências em terminais paralelos.

1. Inicie o seu servidor local de banco de dados (MariaDB/MySQL).
2. Navegue até a pasta `scripts/phase0/`.
3. Execute o script `Start-AllServices.ps1` com o PowerShell.

Isso irá despachar simultaneamente:
- O Painel Web do Staff (`apps/web`)
- O Bot de Autenticação do Discord (`apps/bot-discord`)
- O Gamemode SkyMP Nativo (`skymp/gamemode`)

*(Para testar como jogador, basta rodar o aplicativo de interface do Launcher na pasta `apps/launcher`).*
