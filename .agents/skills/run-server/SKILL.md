---
name: run_skymp_server
description: Habilidade para inicializar e testar o servidor local do SkyMP de forma segura e autônoma, analisando logs e verificando as portas de conexão.
---

# Instruções de Inicialização e Teste do Servidor SkyMP

Sempre que o usuário pedir para "testar o servidor", "iniciar o servidor" ou "verificar se o servidor está rodando", siga os passos abaixo.

Isto assume que o setup do zero já foi feito (dependências instaladas, banco migrado, `.env` preenchidos, assets do Skyrim em `skymp/data/`, artefato do servidor instalado em `skymp/server/`). Se qualquer um desses ainda não existir — por exemplo `skymp/server/dist_back/skymp5-server.js` não existe, ou `skymp/data/*.esm` está ausente — não tente contornar: siga `docs/technical/FASE_0_SETUP_DO_ZERO.md` do começo, incluindo a seção de problemas conhecidos.

1. **Garantir a Inicialização das Configurações Locais:**
   Se os arquivos locais não existirem em `skymp/config/`, execute no terminal:
   `.\scripts\phase0\Initialize-LocalConfig.ps1`

2. **Iniciar o Servidor em Background:**
   Execute o script de start usando a ferramenta de linha de comando (`run_command`), seja enviando-o para o background ou rodando por X segundos (para não bloquear sua execução contínua):
   `.\scripts\phase0\Start-Phase0Server.ps1`
   Se precisar apenas validar o boot (teste rápido de vida), rode:
   `.\scripts\phase0\Start-Phase0Server.ps1 -Seconds 15`

3. **Analisar Logs de Saída:**
   Verifique no output do terminal as seguintes strings de sucesso:
   - "Using data dir"
   - "[phase0] SkyMP Heavy RP gamemode loaded"
   - "Server resources folder is listening on 3000"

4. **Verificar Conexão:**
   Certifique-se de que a porta principal UDP `7777` está listada nos outputs do terminal.

5. **Relatório:**
   Ao final, sempre resuma para o usuário de forma concisa se o servidor subiu com sucesso, quais portas abriu e se ocorreu algum erro crítico no output.
