# Diretrizes Oficiais de Modding (SkyMP Heavy RP)

O objetivo técnico deste modpack é manter clientes reproduzíveis, reduzir divergências, controlar versões de forma estrita, facilitar diagnósticos, permitir rollback e **impedir que mods locais tomem decisões de gameplay**. É obrigatório garantir que o servidor e todos os clientes usem os mesmos plugins, FormIDs e configurações críticas.

> **Regra Final: Autoridade do Servidor**
> O servidor decide se a ação aconteceu, quem possui o item, qual recurso foi consumido, qual recompensa foi concedida, qual porta está aberta, qual personagem está ferido, qual propriedade pertence a quem, qual clima oficial está ativo e qual animação de gameplay foi autorizada.
> **O cliente apenas exibe, anima e apresenta o resultado.** Nenhum mod é aprovado apenas por funcionar no Skyrim single-player.

---

## 1. Organização do Modpack e Launcher

O Launcher distribuirá o jogo em três perfis, utilizando como referência os modelos públicos de servidores como *Keizaal* e *Mereth*. Não redistribuiremos automaticamente mods do Nexus quando a licença não permitir (preferiremos API, Collection ou download autorizado).

O launcher deverá controlar estritamente:
`launcher_version`, `skyrim_runtime_version`, `skse_version`, `skymp_client_version`, `mods_version`, `load_order_version`, `gamemode_api_version`, `config_version`, `nemesis_output_version`.

### Perfil 1 — Core Obrigatório
Todos os jogadores usam **exatamente igual**:
- Skyrim SE/AE na versão exata aprovada.
- SKSE64 e Address Library.
- SkyMP Client / SkyrimPlatform (quando exigido pela build).
- SkyUI (somente se necessário).
- Plugins oficiais (ESM/ESP).
- Pacotes customizados da equipe e Output do Nemesis pré-gerado.

### Perfil 2 — Visual Certificado
Diferenças permitidas apenas em performance gráfica (Baixo, Médio, Alto, Ultra). A diferença deve estar somente na resolução de textura, qualidade de mesh, efeitos, distância visual e sombras. Os plugins e FormIDs permanecem idênticos.

### Perfil 3 — QA (Equipe de Testes)
- **Crash Logger SSE AE VR** (Logs detalhados, métricas e comandos controlados).

---

## 2. Fases de Teste e Lançamento (QA por Camadas)

Cada adição ao modpack precisa passar por camadas estritas de Quality Assurance (QA).
*   **Teste A (Cliente único):** boot, carregamento, logs e interação básica.
*   **Teste B (Dois clientes):** late join, reconnect, células diferentes, distância.
*   **Teste C (Persistência):** restart, rollback, estado salvo do inventário e objetos.
*   **Teste D (Carga):** 5 a 10 jogadores, spam controlado, troca de células.

### Fase 0A — Baseline Técnico
Foco total na infraestrutura.
*   **Usar apenas:** Skyrim SE/AE, SKSE64, Address Library, SkyMP Client/Platform.
*   **Não incluir inicialmente:** SMIM, texturas, OAR, Nemesis, IED, TrueHUD, clima ou novos equipamentos.
*   **Testes:** Movimento, spawn, interiores, combate, reconnect e persistência.

### Fase 0B — Baseline Visual
Após a Fase 0A passar, adiciona-se SMIM, Rustic Clothing e texturas selecionadas. 
Testam-se crashes, RAM/VRAM, stutter e colisão.

### Fases Seguintes (Resumo de Backlog estilo Mereth)
*   **Fase 1 (Identidade e Emotes):** OAR, Nemesis pré-gerado, IED (preset bloqueado), pacotes de animações e objetos de RP.
*   **Alfa Inicial:** Voz com alcance ajustável, mineração limitada, durabilidade, sistema médico, quadro de avisos e clima. *(Nota sobre Cathedral Weathers: É apenas um candidato. Se a transição global não puder ser controlada identicamente pelo servidor via reconnect e mudança de célula, não será usado de forma dinâmica).*
*   **Alfa Avançada:** Fabricação de bebidas, panificação, sobrevivência (exaustão adaptada de 100/70/40%, nunca bloqueando gameplay), pickpocketing, rendição.
*   **Beta ou Posterior:** Sincronização global de NPCs, vampiros, lobisomens.

---

## 3. Substituição por Plugins Próprios e Licenciamento

Não utilizaremos mods massivos com permissões fechadas e scripts (como Immersive Armors). Em vez disso, usaremos **Plugins Próprios Controlados** (`HeavyRP_Equipment.esm`, `HeavyRP_Props.esm`, `HeavyRP_Animations`).
Estes plugins contêm registros com FormIDs estáveis, Armor Addons, referências a meshes e texturas, e somente assets com licença ou autorização compatível.

### Fluxo Obrigatório para Criação de Objetos
Objetos nunca são "spawnados pelo cliente". O fluxo é:
1. Cliente solicita interação.
2. Servidor valida jogador, posição e permissão.
3. Servidor cria ou altera o estado.
4. Servidor grava persistência e log.
5. Servidor replica para clientes relevantes.
6. Cliente apenas renderiza.

---

## 🚫 Lista Negra Ampliada e Sistemas Rejeitados

**1. Mods de AI, NPCs e Overhauls de Cidades** (Immersive Citizens, Open Cities, JK's Skyrim).
*   NPCs e cidades no SkyMP precisam ser carregados e controlados conforme as configurações do servidor. Podem entrar futuramente apenas com sincronização comprovada.

**2. Inventário, Crafting e Economia** (Quick Loot, adição de receitas automáticas, alterações de preços locais).
*   Toda economia deve ter validação server-side com catálogo aprovado.

**3. Física e Animação Pesada** (HDT-SMP obrigatório, ragdolls, capas físicas em massa).
*   Os riscos são consumo excessivo de CPU/GPU, física não determinística, divergência visual (FPS dependente), clipping e crashes. Podem ser opções visuais futuras, nunca dependências.

**4. Sistemas Rejeitados:**
*   Invisibilidade de 90% durante furtividade.
*   Bloqueio absoluto de experiência.
*   Objetos criados localmente pelo cliente.
*   Modlist que dependa de instalação manual.
