# Backlog de Sistemas de Gameplay - Heavy RP

Data: 2026-07-11

Objetivo: levantar sistemas que melhoram gameplay Heavy RP em SkyMP sem transformar o servidor em um modpack single-player instável. A regra central é: mod pode inspirar, mas todo sistema crítico precisa ser server-authoritative.

---

## Princípios de Design de Sistemas

1. **Server-Authoritative**: O cliente apenas mostra a UI, executa animações e envia a intenção. O servidor valida a permissão, distância, alvo, custo, recompensa, cooldown, altera o inventário persistente e registra os logs.
2. **Mundo Híbrido**: O NPC fornece o mínimo necessário para garantir a jogabilidade; o jogador fornece o melhor resultado (ex: comida melhor, cura mais rápida, minério mais caro).
3. **Especialização Leve**: Qualquer personagem pode realizar atividades simples com eficiência básica. Profissionais recebem maior rendimento, menor desperdício e receitas exclusivas, evitando travar o jogo se os profissionais estiverem offline.
4. **RP acima do Grind**: Sistemas focados em criar cenas, negociações, riscos e consequências, evitando repetições automáticas e exaustivas que apenas inflam números.

---

## Classificação por Fases

### 1. FASE 0 - Pesquisa e Viabilidade (Infraestrutura)
* **Objetivo**: Garantir que a infraestrutura técnica do SkyMP consiga sustentar o básico de rede e sincronização de dois clientes antes do desenvolvimento de lógica de RP.
* **Sistemas Integrados**:
  1. Boot estável local do servidor SkyMP.
  2. Carregamento correto de masters vanilla do Skyrim e load order básico.
  3. Validação visual de spawn do primeiro cliente e sincronização de movimento de dois clientes.
  4. Testes de troca de células (interior/exterior) e persistência do driver de armazenamento SQLite/`file`.

### 2. FASE 1 - Protótipo Técnico (Vertical Slice do RP)
* **Objetivo**: Sandbox controlada com persistência básica de conta/personagem aprovado e mecânicas mínimas de interação social e trabalho.
* **Sistemas Integrados**:
  1. **Identidade**: Nome IC, descrição visual do personagem, spawn controlado por aprovação de whitelist e posição/rota persistente. Nome do jogador oculto antes da apresentação.
  2. **Chat Social**: Canais IC local (distância), sussurro, grito, `/me`, `/do`, canal OOC local e `/report` para staff. Rolagem de dados `/roll` gerada de forma autoritativa no servidor.
  3. **Consequência Inicial**: Estados de vida (saudável, ferido e morto), respawn controlado sem loop destrutivo, perda limitada de itens e registro de responsáveis em audit logs.
  4. **Contratos Básicos**: Quadro de avisos com contratos de coleta e entrega (inspirado em *Missives*). Recompensas geradas e validadas 100% no servidor para prevenir exploits de duplicação.
  5. **Profissão Única (Madeireiro)**: Uma única atividade produtiva inicial para validar todo o ciclo de coleta (recurso esgotável e reduzido no servidor, acão canalizada, transporte e entrega de madeira bruta para pagamento server-side).

### 3. FASE ALFA (Sandbox Expandida e Ferramentas)
* **Objetivo**: Integrar maior profundidade comercial, sobrevivência leve e as ferramentas de suporte para a staff no alfa fechado.
* **Sistemas Integrados**:
  1. **VOIP por Proximidade**: Voz integrada respeitando distância, celulas de interiores e controle de volume.
  2. **Profissões de Coleta Expandidas**: Mineração (veios persistentes), Caça (inspirado em *Hunterborn* e *Simple Hunting Overhaul*, com refino de carcaças) e Pesca.
  3. **Armazenamento e Containers**: Containers e baús persistentes controlados por permissões do servidor, evitando desincronizações de inventário nativo.
  4. **Casas e Propriedades**: Compra e aluguel de imóveis fixos com chaves e acesso de convidados controlados por backend.
  5. **Prisão e Justiça**: Algemas in-game, multas, fianças, fichas criminais e tempo de contenção administrativo/IC auditados.
  6. **Comércio Player-to-Player**: Mecânica segura de troca (*barter*) e lojas geridas por jogadores (*player shops*).

### 4. FASE BETA E PÓS-ALFA (Economia Avançada e Imersão)
* **Objetivo**: Sistemas complexos e de imersão narrativa projetados para ambientes de alta densidade de jogadores.
* **Sistemas Integrados**:
  1. **Economia Regional**: Oferta, demanda e impostos variáveis por Hold (*Trade Routes*).
  2. **Crafting Modular Expandido**: Categorias de crafting integradas com ferramentas especializadas (ex: alfaiataria, forja de alta qualidade) e validação de keywords.
  3. **Sobrevivência Leve**: Fome, sede, fadiga e temperatura (*SunHelm* e *Survival Mode Improved*) operando de forma não punitiva.
  4. **Facções e Territórios**: Fortes capturáveis, cercos e controle de portas por facções com logs.
  5. **NPCs Seletivos**: Povoamento dinâmico de cidades com NPCs de funções estritamente necessárias.

### 5. SISTEMAS ESTACIONADOS (Futuro de Longo Prazo)
* **Objetivo**: Sistemas com alta complexidade de scripting ou alto risco de performance/desync que devem ser avaliados somente em etapas posteriores.
* **Sistemas Integrados**:
  * Cavalos persistentes e reprodução/venda de montarias.
  * Disfarces avançados e manipulação de identidades visuais ligadas a facções secretas.
  * Magia complexa restrita (comunidades de ensino, custos de mana/reagentes diferenciados e aprovações narrativas para feitiços de nível mestre).
  * Doenças persistentes detalhadas e curas por eventos do templo.

### 6. SISTEMAS REJEITADOS OU MUITO ADAPTADOS
* **Objetivo**: Mecânicas incompatíveis com o propósito de roleplay cooperativo e sustentável do servidor público.
* **Sistemas Integrados**:
  * **Loot Total do Corpo (Rejeitado)**: Perda de todos os equipamentos e inventário na morte causa frustração excessiva e incentiva RDM. *Adaptação*: Perda parcial, perda de ouro, ou resgate de itens via sistema de "corpo saqueável" com restrições de regras e timers.
  * **Economia Totalmente Dependente de Players (Rejeitado)**: Trava o servidor se os principais profissionais estiverem offline. *Adaptação*: O mundo híbrido onde NPCs vendem o básico, mas os jogadores oferecem a melhor qualidade.
  * **Prisão Offline Excessiva (Rejeitado)**: Punir o jogador impedindo-o de jogar por longos períodos reais de tempo offline. *Adaptação*: Tempos de prisão escalados e focados no tempo in-game ou substituídos por trabalhos comunitários.
  * **Punições Administrativas sem Auditoria / Banimento sem Recurso (Rejeitado)**: *Adaptação*: Todas as ações da staff exigem motivo, geram logs no banco e permitem abertura de recurso em fórum/web painel.
  * **Manipulação Livre de Props pelo Cliente (Rejeitado)**: Mods como `JaxonzEnhGrab` abrem brechas gravíssimas para exploits visuais, desync de rede e roubo de objetos do cenário. *Adaptação*: Decoração de propriedades controlada por menus rígidos autoritativos no servidor.
