# Regras Globais do Projeto: SkyMP Heavy RP

Estas regras devem ser estritamente seguidas ao trabalhar neste projeto:

1. **Contexto do Projeto:** 
   - Este é um servidor público de **Skyrim Heavy RP**, desenvolvido usando o framework **SkyMP**.
   - O projeto adota a separação estrita entre a plataforma RP (painel web, whitelist, loja) e o estado nativo in-game (posições, mundo).

2. **Banco de Dados (CRÍTICO):**
   - O banco de dados relacional oficial do projeto é o **MariaDB / MySQL**. 
   - **NUNCA** sugira, migre ou crie schemas para PostgreSQL.
   - Todo o código backend interage com o banco utilizando a biblioteca `mysql2/promise`.

3. **Arquitetura e Código:**
   - O código principal do gamemode fica em `skymp/gamemode/`.
   - Modificações na estrutura do banco de dados exigem a atualização obrigatória do arquivo de migration em `skymp/packages/database/schema.sql`.

4. **Regras de Produto e Game Design:**
   - O servidor é focado em RP Estrito (Heavy RP). Ações devem ter motivações in-game plausíveis.
   - Sistemas de progressão e economia devem ser intencionalmente lentos.
   - O sistema de monetização (VIP/Apoiador) existe para sustento, mas mecânicas agressivas de Pay-to-Win são proibidas no design.

5. **Gerenciamento de Testes e Setup Técnico:**
   - Para testes locais, sempre assumir `offlineMode=true` no artefato do servidor, permitindo o uso de `profileId`. Em produção isso é expressamente proibido.
   - Scripts de setup, instalação do cliente e boot do servidor devem sempre usar o PowerShell presentes na pasta `scripts/phase0/`.
   - Setup do zero (dependências, banco, `.env`, assets do Skyrim, artefato do servidor, Discord, troubleshooting) está documentado em `docs/technical/FASE_0_SETUP_DO_ZERO.md`. Antes de guiar alguém (humano ou agente) por um boot do zero, siga esse roteiro em vez de reconstruir os passos por conta própria.
