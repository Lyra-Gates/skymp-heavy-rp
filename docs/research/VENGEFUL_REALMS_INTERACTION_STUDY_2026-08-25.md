# Estudo completo — Vengeful Realms como espelho arquitetural

**Data:** 25/08/2026 · **Escopo:** interação contextual, mira, input,
sessões, mineração e lenhador · **Uso:** aprender e redesenhar; não copiar.

## 1. O que foi realmente auditado

A análise não ficou limitada ao README. Foram lidos:

- os dez artefatos de `docs/vgr_player_interactions`;
- o frontend de interação, mineração, lenhador, trading e UI manager;
- os serviços públicos do cliente SkyMP relacionados a ativação e input;
- `CHANGELOG.md` e `CHANGELOG_PLAYER_INTERACTIONS.md`;
- todo o conteúdo de `tools/VGR_Player_Interactions_Patch.zip`.

O ZIP é importante: apesar de `vgr-gamemode` não aparecer na árvore normal do
repositório, o pacote versionado contém o código de servidor de interações,
mineração e lenhador usado pelo patch. Portanto, a conclusão anterior de que
esses serviços eram inteiramente privados estava incompleta.

Fontes primárias:

- [README do subsistema](https://github.com/Vengeful-Realms/vgr-skymp/blob/main/docs/vgr_player_interactions/README.md)
- [Notas de segurança](https://github.com/Vengeful-Realms/vgr-skymp/blob/main/docs/vgr_player_interactions/SECURITY_NOTES.md)
- [Hipóteses de API](https://github.com/Vengeful-Realms/vgr-skymp/blob/main/docs/vgr_player_interactions/API_ASSUMPTIONS.md)
- [Testes manuais](https://github.com/Vengeful-Realms/vgr-skymp/blob/main/docs/vgr_player_interactions/MANUAL_ACCEPTANCE_TESTS.md)
- [Manifesto de arquivos](https://github.com/Vengeful-Realms/vgr-skymp/blob/main/docs/vgr_player_interactions/FILE_MANIFEST.md)
- [Pacote público do patch](https://github.com/Vengeful-Realms/vgr-skymp/blob/main/tools/VGR_Player_Interactions_Patch.zip)
- [Changelog específico](https://github.com/Vengeful-Realms/vgr-skymp/blob/main/CHANGELOG_PLAYER_INTERACTIONS.md)

## 2. Arquitetura observada

```text
crosshair / E ou X
  → Skyrim Platform obtém a referência
  → converte FormID cliente → servidor
  → event source envia somente targetFormId + intenção
  → servidor classifica e valida alvo
  → servidor emite sessão opaca e ações permitidas
  → CEF apenas desenha
  → seleção retorna sessionId + actionId
  → servidor revalida sessão, alvo, alcance, célula e estado
```

Boas decisões observadas:

1. `Game.getCurrentCrosshairRef()` escolhe o alvo exato.
2. O alvo é relido no momento do input, não reaproveitado por proximidade.
3. `buttonEvent` possui debounce de pressionar/soltar.
4. Menus nativos e input de texto bloqueiam o atalho.
5. O servidor ignora decisões de identidade, nome, permissão e ação do browser.
6. A sessão usa token aleatório, TTL e vínculo ator→alvo.
7. Cada seleção revalida online, self-target, vida, célula e distância.
8. Ações indisponíveis permanecem visíveis/desabilitadas em algumas telas,
   enquanto a autoridade continua no servidor.
9. O teste de três clientes verifica o caso em que o alvo mirado não é o mais
   próximo.
10. Desconexão e mudança de célula encerram contexto e UI.

## 3. O que não deve ser reproduzido

### 3.1 Mineração

O servidor verifica o tempo transcorrido, portanto o timer visual não é a única
barreira. Ainda assim, o fluxo público possui riscos importantes:

- `oreType` nasce da leitura client-side do nome do objeto e é aceito pelo
  servidor após apenas passar por uma allowlist textual;
- início e coleta não revalidam distância, célula nem referência sob a mira;
- não há verificação autoritativa de picareta no fluxo auditado;
- a sessão persistida guarda tempo/tipo/veio, mas não é consumida/invalidada de
  forma idempotente após uma coleta;
- um cliente modificado pode repetir `collect` depois do prazo;
- disponibilidade é lida e atualizada em operações Mongo separadas, permitindo
  corrida entre coletores;
- inventário é creditado antes do update do veio, sem transação comum;
- a suíte publicada para player interactions tem quatro testes de helpers e
  não prova o fluxo econômico completo.

### 3.2 Lenhador

- a sessão começa por evento de animação, sem estar vinculada a uma árvore;
- o servidor guarda apenas timestamp por jogador;
- não revalida local, alvo, alcance, ferramenta ou cooldown;
- após o tempo mínimo, concede lenha diretamente ao inventário.

### 3.3 Limites gerais

- o servidor pode provar alcance e estado, mas não consegue provar a direção
  física da câmera; o FormID do crosshair continua sendo uma sugestão do
  cliente;
- sobrescrever/encadear um handler global de `mp.onActivate` exige teste de
  compatibilidade com todos os consumidores;
- polling de prompt a cada 100 ms e refresh de rede periódico precisa de
  medição com população real;
- verificações de prompt nativo, cuff visual e restrição de movimento continuam
  explicitamente não homologadas pelo próprio projeto.

## 4. Decisão original para este projeto

Adotamos o formato mental, não o código:

| Tema | VGR | Nosso desenho |
|---|---|---|
| Alvo | crosshair exato | crosshair exato compartilhado |
| Tipo do alvo | roteador próprio | inferido no servidor pelo nosso registry |
| UI | frontend VGR | CEF e `browserModal` existentes |
| Segurança | sessão + revalidação | pipeline `query/execute`, distância e idempotência existentes; contexto opaco será uma fase própria |
| Mineração | serviço próprio Mongo | Resource Node + Transaction/Inventory boundaries existentes |
| Descoberta | polling client-side | polling client-side; servidor calcula o rótulo |
| Input | X contextual e E activation | um único listener contextual de E |
| Economia | escrita direta/fluxos separados | nenhuma recompensa fora dos boundaries oficiais |

Implementação criada:

- `core/interaction-prompt-service.js` agora usa
  `Game.getCurrentCrosshairRef()`, conversão de FormID e `buttonEvent`;
- o cliente não envia `targetType`; o servidor classifica `player` versus
  `object` e passa pelo nosso `peek`;
- o E relê a mira e só abre o menu após o servidor confirmar que existe ação;
- respostas assíncronas antigas não podem substituir um alvo mais recente;
- nearest-player/nearest-anchor e o fallback SELF foram removidos da autoridade
  do prompt;
- Minerador deixou de publicar todos os nós ao registry de proximidade porque
  o crosshair não precisa enumerar anchors para descobrir a pedra;
- a CEF apenas desenha o prompt; não abre menu usando um alvo visual em cache.

## 5. Gates antes de produção

1. Homologar `getCurrentCrosshairRef`, conversões e `buttonEvent` na nossa build.
2. Confirmar se E causa dupla ativação vanilla + contextual em pedra, porta,
   contêiner e NPC.
3. Executar o teste A/B/C: B mais perto, C sob a mira, somente C selecionado.
4. Testar mira vazia, troca rápida de alvo e resposta server-side atrasada.
5. Medir eventos de polling e writes de property com população simulada.
6. Projetar `interactionContextId` comum no Interaction Framework; não dentro
   de Minerador ou Public Work.
7. Transformar mineração instantânea em sessão temporal autoritativa somente
   depois do alvo exato estar homologado.
8. Manter Public Work bloqueado até os gates 1–4 passarem.

## 6. Veredito

O Vengeful Realms é um bom espelho para **aquisição de alvo, separação UI/
servidor, sessão curta e testes de alvo exato**. Não é um modelo seguro para
copiar o domínio econômico de mineração ou lenhador. Nosso caminho aproveita as
ideias comprováveis e mantém Resource Nodes, transações, inventário,
idempotência e auditoria como autoridades locais.
