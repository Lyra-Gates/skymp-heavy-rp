# Estudo de referência — Trabalhos públicos em Skyrim RP

**Data:** 25/08/2026 · **Natureza:** pesquisa de produto e padrões; não prova o
estado do nosso código · **Decisão derivada:**
[ADR 011 — Public Work](../technical/ADR_011_PUBLIC_WORK.md)

## Objetivo

Responder quatro perguntas antes de implementar Public Work:

1. Que atividades servidores de Skyrim RP oferecem a iniciantes?
2. Como evitam que trabalho público substitua profissão?
3. Como o jogador descobre e executa o trabalho?
4. Quais padrões são adequados ao nosso Heavy RP?

## Hierarquia das fontes

1. Código, documentação técnica e histórico do repositório oficial.
2. Site e changelog oficial do projeto.
3. Documentação publicada pelo autor de um sistema.
4. Guia comunitário, usado apenas como pista e nunca como prova exclusiva.

Relatos de Reddit e vídeos não fundamentam decisões abaixo quando existe fonte
primária. O gamemode do Keizaal não é público; por isso o estudo descreve
comportamento anunciado, não sua implementação interna.

## Rede de forks do SkyMP

### `skyrim-roleplay/skymp` (Keizaal)

Em 25/08/2026, a comparação pública da branch padrão com o upstream mostrava
**0 commits à frente e 4 atrás**. Portanto, essa branch é um espelho quase atual
do core e não contém a implementação pública dos trabalhos do Keizaal. A página
de forks ajuda a localizar projetos, mas não prova que a branch padrão possua um
gamemode próprio.

- [Repositório `skyrim-roleplay/skymp`](https://github.com/skyrim-roleplay/skymp)
- [Rede de forks do SkyMP](https://github.com/skyrim-multiplayer/skymp/forks)

Consequência: os changelogs do Keizaal continuam sendo fonte válida sobre o que
o jogador vê, mas não permitem copiar nem auditar sua autoridade, persistência,
cooldown ou anti-exploit.

A árvore inteira foi posteriormente clonada, comparada ao upstream e auditada
nas camadas Skyrim Platform, cliente, servidor, propriedades, testes e roadmap.
Ela não revelou jobs privados, mas confirmou contratos importantes para o
nosso plano: `crosshairRefChanged`, ativação nativa com target/caster, ausência
de range check na ativação base e assinatura opcional de event sources. Ver
[estudo dedicado do core](SKYRIM_ROLEPLAY_SKYMP_CORE_STUDY_2026-08-25.md).

### `Vengeful-Realms/vgr-skymp`

Este fork oferece duas referências técnicas úteis e uma limitação decisiva:

- a documentação de interações usa `Game.getCurrentCrosshairRef()`, converte
  FormIDs entre cliente e servidor e exige validação server-side do alvo exato;
- os testes manuais cobrem o caso crítico “B está mais perto, mas a mira está em
  C”: C deve ser o alvo;
- as UIs públicas de mineração e corte exibem progresso no cliente e depois
  enviam um evento de coleta;
- o pacote versionado `tools/VGR_Player_Interactions_Patch.zip` contém os
  serviços server-side relacionados, embora eles não estejam na árvore normal
  de `vgr-gamemode`;
- esses serviços conferem tempo no servidor, mas a auditoria encontrou ausência
  de vínculo/revalidação suficiente de alvo, distância e ferramenta, além de
  riscos de replay, concorrência e atomicidade na mineração.

Fontes primárias:

- [Player Interactions — README](https://github.com/Vengeful-Realms/vgr-skymp/blob/main/docs/vgr_player_interactions/README.md)
- [Security Notes](https://github.com/Vengeful-Realms/vgr-skymp/blob/main/docs/vgr_player_interactions/SECURITY_NOTES.md)
- [API Assumptions](https://github.com/Vengeful-Realms/vgr-skymp/blob/main/docs/vgr_player_interactions/API_ASSUMPTIONS.md)
- [Manual Acceptance Tests](https://github.com/Vengeful-Realms/vgr-skymp/blob/main/docs/vgr_player_interactions/MANUAL_ACCEPTANCE_TESTS.md)
- [Mining UI](https://github.com/Vengeful-Realms/vgr-skymp/blob/main/vgr-frontend/js/ingame/mining.js)
- [Woodcutting UI](https://github.com/Vengeful-Realms/vgr-skymp/blob/main/vgr-frontend/js/ingame/woodcutting.js)
- [Changelog — limite do gamemode público](https://github.com/Vengeful-Realms/vgr-skymp/blob/main/CHANGELOG.md)
- [Pacote público do patch](https://github.com/Vengeful-Realms/vgr-skymp/blob/main/tools/VGR_Player_Interactions_Patch.zip)
- [Estudo completo local](VENGEFUL_REALMS_INTERACTION_STUDY_2026-08-25.md)

Decisão: adaptar o padrão de **alvo exato e validação**, não copiar o domínio de
mineração/lenhador. A duração e a conclusão continuam autoritativas no servidor.
O Blocker D foi resolvido em código local após este estudo, mas ainda depende de
homologação na nossa build e com três clientes.

## Keizaal Online

### Evidência pública

O Keizaal documenta três trabalhos públicos concretos:

| Trabalho | Evidência pública |
|---|---|
| Entrega de fardos | 2 trigos + 2 septims por entrega |
| Entrega de lenha em Solitude | Existente; recompensa não divulgada |
| Entrega de lenha em Windhelm | Mesmo modelo de Solitude |

As entregas de lenha compartilham cooldown com outros trabalhos. O projeto
também colocou quadros de avisos em Solitude, Whiterun, Riften e Windhelm, ainda
descritos como WIP na publicação original.

Fontes oficiais:

- [Changelog 2.6.14](https://keizaal.com/en/news/changelog-2-6-14)
- [Changelog 2.6.15](https://keizaal.com/en/news/2-6-15-better-bans-fixes)
- [Notice Board & Skooma](https://keizaal.com/en/news/notice-board-skooma)

### Padrão relevante

O trabalho público transporta o recurso; a profissão produz. No mesmo conjunto
de atualizações, o Keizaal restringe corte de madeira ao Lenhador e aumenta a
produção de lenha conforme seu nível. Assim, “entregar lenha” não é uma segunda
forma de ser Lenhador.

O Keizaal não publica duração do cooldown, tecla de cada etapa, modelo da carga,
regras de desconexão nem fórmula das recompensas. Esses detalhes não devem ser
atribuídos a ele.

## Mereth Roleplay

O Mereth usa quadros de missivas em todos os Holds. Qualquer jogador pode fixar
notas, e o guia orienta o recém-chegado a procurar o quadro para encontrar
trabalhos, alertas e reuniões.

Fonte oficial:

- [Start Here — Mereth Roleplay](https://merethroleplay.com/start/)

### Padrão relevante

O quadro é infraestrutura social, não apenas um gerador de tarefas. Ele aproxima
quem precisa de ajuda de quem procura trabalho. Porém, depender somente de
ofertas de jogadores deixa o iniciante sem renda quando a população está baixa.

## Daedric Online

O Daedric Online documenta nove caminhos de profissão, estações exclusivas e
ações físicas/minigames. Sal pode ser coletado por qualquer pessoa, mas o site
não apresenta um sistema de trabalhos públicos ou entregas equivalente ao do
Keizaal.

Fonte oficial:

- [Daedric Online](https://daedriconline.com/)

### Padrão relevante

Permitir um recurso básico universal pode ajudar o onboarding, mas não substitui
um sistema público de serviços. Para o nosso projeto, renda inicial deve vir de
trabalho verificável, não de liberar insumos profissionais importantes.

## Nirn RP

O Nirn RP publica quadros de avisos, diários e troca de itens como ferramentas
de RP. A documentação pública não afirma que o quadro gera automaticamente
trabalhos remunerados.

Fonte oficial:

- [Nirn RP](https://nirnrp.ru/)

### Padrão relevante

Quadro de anúncios e Public Work podem compartilhar a apresentação, mas não a
semântica: anúncio é conteúdo social; corrida pública é uma máquina de estados
com recompensa do sistema.

## Sistemas Skyrim adjacentes

### Andrealletius' Jobs Overhaul

Não é servidor multiplayer, mas é documentação do próprio autor sobre trabalho
contextual em Skyrim. O jogador procura um empregador no local correto, precisa
das ferramentas, trabalha uma janela de tempo, recebe resultado influenciado por
habilidade/reputação e só pode repetir o mesmo empregador depois do reset diário.

- [Andrealletius' Jobs Overhaul](https://www.nexusmods.com/skyrimspecialedition/mods/109363)

Útil para: empregador físico, ferramenta, limite por empregador e reputação
futura. Não adotar: tela preta que simula horas de trabalho; no multiplayer a
atividade precisa existir no mundo compartilhado.

### Crafting Writs de The Elder Scrolls Online

Os writs oficiais são obtidos em quadros, escalam com a disciplina, pedem criação
e entrega de bens e possuem repetição diária. Eles são referência para futuros
contratos de profissão, não para Public Work sem profissão.

- [Bethesda Support — Crafting Writs](https://help.bethesda.net/app/answers/detail/a_id/24630/~/what-are-crafting-writs%3F)

## Síntese comparativa

| Projeto | Oferta do sistema | Oferta por jogador | Limite conhecido | Protege profissão? |
|---|---:|---:|---|---:|
| Keizaal | Sim | Quadro também aceita anúncios | Cooldown compartilhado | Sim |
| Mereth | Não documentada | Sim, missivas livres | Social/regulatório | Sim, por especialização |
| Daedric Online | Não documentada | Não documentada | Progressão/mastery | Sim |
| Nirn RP | Não documentada | Quadro como ferramenta RP | Não documentado | Não conclusivo |

## Decisão para o projeto

Adotar um modelo híbrido:

```text
quadro físico da cidade
├─ trabalhos públicos padronizados, gerados pelo sistema
└─ missivas e contratos publicados por jogadores
```

Os dois tipos podem aparecer na mesma interface, mas precisam de origem,
persistência e regras diferentes. O primeiro MVP implementa apenas trabalhos do
sistema; a integração visual com contratos vem depois que a corrida pública
estiver validada com três clientes.

## Hipóteses que ainda exigem teste próprio

- resolver quadro, carga e destino como objetos reais do SkyMP;
- comportamento de prompts quando vários alvos estão próximos;
- compatibilidade runtime de `crosshairRefChanged`, `activate`, bloqueio
  síncrono de `mp.onActivate` e conversões de FormID com nossa build;
- persistência de carga através de reconnect;
- animação sem bloquear ou dessincronizar o ator;
- recompensa e cooldown adequados à economia real;
- rota suficientemente curta para onboarding e longa para impedir spam;
- concorrência de dois jogadores usando a mesma origem.

Nenhuma dessas hipóteses é considerada resolvida porque outro servidor afirma
ter uma mecânica parecida.
