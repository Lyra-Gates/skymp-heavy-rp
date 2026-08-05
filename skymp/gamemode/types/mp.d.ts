/**
 * types/mp.d.ts
 *
 * Tipagem da API global `mp` que o servidor SkyMP injeta no gamemode.
 *
 * Por que isto existe: o SkyMP não publica typings. O `skymp5-functions-lib`
 * upstream tem um `src/types/mp.ts`, mas esse diretório não está no
 * repositório público — só o `index.ts`. Sem este arquivo, `mp` é `any`
 * implícito em ~30 arquivos do gamemode, então erro de nome de método ou de
 * ordem de argumento só aparece em runtime, dentro do jogo, onde é caro achar.
 *
 * PROCEDÊNCIA DE CADA ASSINATURA — importa, porque metade veio de documentação
 * oficial e metade de engenharia reversa do nosso próprio uso:
 *
 *   [DOC]  Documentado em github.com/skyrim-multiplayer/skymp, pasta docs/
 *          (docs_serverside_scripting_reference.md, docs_events_system.md,
 *          docs_clientside_scripting_reference.md).
 *   [USO]  NÃO documentado upstream. Assinatura inferida das chamadas reais
 *          neste gamemode, que funcionam contra o servidor. Trate como
 *          "observado", não como contrato garantido — pode mudar sem aviso
 *          numa atualização do SkyMP.
 *
 * Ao descobrir uma assinatura nova em teste real, adicione aqui com [USO] e
 * diga onde foi observada. Ver docs/technical/SKYMP_UPSTREAM_REFERENCE.md.
 */

/** FormID de 32 bits. Atores de jogador ficam na faixa 0xff000000+. */
type FormId = number;

/**
 * Descritor textual de um form, no formato `"<hex>:<nomeDoPlugin>"`
 * (ex: `"162e2:Skyrim.esm"`). É a forma estável de referenciar um form entre
 * servidor e cliente — o FormID numérico depende da load order.
 */
type FormDesc = string;

/** Posição/rotação e célula de um objeto. Property `locationalData`. */
interface LocationalData {
  pos: [number, number, number];
  rot: [number, number, number];
  cellOrWorldDesc: FormDesc;
}

/** Valor que atravessa a ponte Papyrus. Papyrus não tem tipos ricos. */
type PapyrusValue = string | number | boolean | null | PapyrusObject | PapyrusValue[];

/** Referência a um objeto Papyrus, obtida via `Game.getFormEx` e afins. */
interface PapyrusObject {
  type: string;
  desc: FormDesc;
}

/** [DOC] Opções de `mp.makeProperty`. */
interface MakePropertyOptions {
  /** Se false, `updateOwner` nunca roda — o próprio dono não vê o valor. */
  isVisibleByOwner: boolean;
  /** Se false, `updateNeighbor` nunca roda — vizinhos não veem o valor. */
  isVisibleByNeighbors: boolean;
  /**
   * Corpo de função JS executado NO CLIENTE do dono a cada update.
   * É uma string, não uma função: o texto é enviado e avaliado no cliente,
   * então não fecha sobre nada do escopo do servidor. Dentro dele existe
   * `ctx` (ver ClientCtx).
   */
  updateOwner: string;
  /** Igual ao anterior, mas roda no cliente de cada vizinho sincronizado. */
  updateNeighbor: string;
}

/**
 * [DOC] O objeto `ctx` disponível dentro das strings de `updateOwner`,
 * `updateNeighbor` e `makeEventSource`. Existe só no cliente.
 *
 * Declarado aqui para servir de referência ao escrever esses snippets — o
 * TypeScript não checa o conteúdo de uma string, então isto é documentação
 * navegável, não verificação.
 */
interface ClientCtx {
  /** API do Skyrim Platform (`ctx.sp.Game`, `ctx.sp.on`, ...). */
  sp: any;
  /** Em `updateOwner`, equivale a `ctx.sp.Game.getPlayer()`. Em `makeProperty`, undefined. */
  refr: any;
  /** Valor atual da property sendo processada. */
  value: any;
  /** Objeto gravável que persiste entre chamadas. Compartilhado entre properties. */
  state: Record<string, any>;
  get(propertyName: string): any;
  /** Só em `makeEventSource`: manda um evento pro servidor. */
  sendEvent(payload?: any): void;
  /** Respawna `ctx.refr` imediatamente. */
  respawn(): void;
  getFormIdInServerFormat(clientFormId: FormId): FormId;
  getFormIdInClientFormat(serverFormId: FormId): FormId;
}

/** Evento vindo da UI CEF via `mp.onUiEvent`. */
interface UiEvent {
  /** Prefixado por módulo (`governance:*`, `panel:*`) — ver core/ui-event-router.js. */
  type: string;
  data?: any;
  [key: string]: any;
}

interface Mp {
  // ───────────────────────────────────────────────────────────────────────
  // Properties e eventos — [DOC]
  // ───────────────────────────────────────────────────────────────────────

  /**
   * [DOC] Cria uma property anexada a todos os MpActor/MpObjectReference.
   * Valores são persistidos automaticamente pelo servidor.
   */
  makeProperty(propertyName: string, options: MakePropertyOptions): void;

  /**
   * [DOC] Cria uma fonte de evento cliente→servidor injetando JS no cliente.
   * O handler no servidor é `mp._nomeDoEvento = (pcFormId) => {}`.
   *
   * ATENÇÃO: nome customizado TEM que começar com underscore.
   *
   * É a alternativa nativa ao polling — ver
   * docs/technical/SKYMP_UPSTREAM_REFERENCE.md §2. Lembre que o snippet roda
   * no cliente, que não é confiável: o evento é uma dica, não uma prova.
   */
  makeEventSource(eventName: string, functionBody: string): void;

  /** [DOC] Lê uma property. `undefined` se não houver valor. */
  get(formId: FormId, propertyName: string): any;

  /** [DOC] Escreve uma property. */
  set(formId: FormId, propertyName: string, newValue: any): void;

  /** [DOC] Limpa properties e event sources adicionados. */
  clear(): void;

  // ───────────────────────────────────────────────────────────────────────
  // Papyrus — [USO]
  // ───────────────────────────────────────────────────────────────────────

  /**
   * [USO] Chama uma função Papyrus no cliente. É a única forma de o servidor
   * fazer o jogo executar algo.
   *
   * @param callType 'global' para função estática, 'method' para método de instância
   * @param className Classe Papyrus ('Debug', 'Game', 'Actor', 'ObjectReference')
   * @param functionName Nome da função
   * @param self Objeto alvo em 'method'; `null` em 'global'. VER AVISO ABAIXO.
   * @param args Argumentos
   *
   * ⚠️ AMBIGUIDADE NÃO RESOLVIDA no parâmetro `self`.
   *
   * Este gamemode usa DUAS formas incompatíveis pro mesmo parâmetro:
   *
   *   objeto  `{ type: 'form', desc: mp.getDescFromId(actorId) }`
   *           — death-service.js, player-panel-service.js (2 arquivos)
   *   cru     `actorId` direto, um number
   *           — outros 22 pontos, incluindo core/transaction-service.js,
   *             inventory-service.js, npc-cleaner.js, governance-service.js
   *
   * As duas nasceram no mesmo commit (82625d2, 11/07/2026) — não houve
   * migração de uma pra outra, é inconsistência desde o início. A documentação
   * do SkyMP não especifica, e **nada disso foi testado em jogo**.
   *
   * Se a forma de objeto for a única válida, então 22 chamadas falham em
   * silêncio — e entre elas está a entrega de item do transaction-service, ou
   * seja, o banco ficaria certo e o inventário do jogador vazio.
   *
   * O tipo aceita as duas de propósito: transformar um palpite em erro de
   * compilação faria alguém "consertar" 22 lugares que talvez estejam certos.
   * Isto é o item nº 1 a conferir no primeiro teste in-game — ver
   * docs/technical/QA_REPORT_2026-08.md 2.13.
   *
   * Vocabulário em uso hoje neste gamemode:
   *   global  Debug.notification, Debug.SendAnimationEvent, Game.getFormEx
   *   method  Actor.getActorValue, Actor.SetActorValue, Actor.GetItemCount,
   *           Actor.PlayIdle, Actor.Resurrect,
   *           ObjectReference.AddItem, ObjectReference.RemoveItem,
   *           ObjectReference.disable, ObjectReference.delete
   */
  callPapyrusFunction(
    callType: 'global' | 'method',
    className: string,
    functionName: string,
    self: PapyrusObject | FormId | null,
    args: PapyrusValue[]
  ): any;

  // ───────────────────────────────────────────────────────────────────────
  // Forms e atores — [USO]
  // ───────────────────────────────────────────────────────────────────────

  /** [USO] FormID → descritor textual. Use pra atravessar a ponte Papyrus. */
  getDescFromId(formId: FormId): FormDesc;

  /** [USO] Descritor textual → FormID. */
  getIdFromDesc(desc: FormDesc): FormId;

  /**
   * [USO] Atores associados a um profileId. `0` devolve os atores que o
   * servidor reconheceu sem perfil.
   *
   * É assim que descobrimos o profileId de um ator hoje: varrendo profileIds
   * e procurando o actorId na lista (ver phase0-basic.js). Não é bonito, mas
   * é o que a API oferece.
   */
  getActorsByProfileId(profileId: number): FormId[] | undefined;

  /** [USO] Cria uma instância de um baseId no mundo. Devolve `{ desc }`. */
  place(baseId: FormId): { desc: FormDesc };

  // ───────────────────────────────────────────────────────────────────────
  // Conexões — [USO]
  // ───────────────────────────────────────────────────────────────────────

  /** [USO] Se o userId está conectado. Base do nosso polling de conexão. */
  isConnected(userId: number): boolean;

  /**
   * [USO] Ator de um usuário conectado.
   *
   * ATENÇÃO: falha/retorna nada no momento em que a desconexão é detectada —
   * a engine já destruiu o ator. Por isso phase0-basic.js mantém um cache
   * `userActorMap` (userId → actorId) enquanto o jogador está conectado.
   */
  getUserActor(userId: number): FormId | undefined;

  /** [USO] Desconecta um usuário. Aceita userId em phase0-basic; actorId em admin-service. */
  kick(userIdOrActorId: number): void;

  /** [USO] Dispara um evento nomeado no cliente daquele ator. */
  triggerClient(actorId: FormId, eventName: string, ...args: any[]): void;

  // ───────────────────────────────────────────────────────────────────────
  // Callbacks que o gamemode ATRIBUI (não chama) — [USO]
  // ───────────────────────────────────────────────────────────────────────

  /** [USO] Atribua uma função aqui para receber eventos da UI CEF. */
  onUiEvent: (pcFormId: FormId, uiEvent: UiEvent) => void;

  /**
   * Handlers de `makeEventSource`. Nomes customizados começam com underscore,
   * então não dá pra declará-los um a um — este index signature os cobre.
   */
  [customEventHandler: string]: any;
}

/**
 * A global que o servidor SkyMP injeta.
 *
 * Fora do servidor (testes com `node --test`) ela NÃO existe — por isso todo
 * serviço deste gamemode começa com `if (typeof mp === 'undefined') return;`.
 * O tipo é não-opcional aqui porque `typeof mp === 'undefined'` já é o guard
 * idiomático do projeto e declarar `mp` como possivelmente undefined obrigaria
 * a checagem redundante em todo lugar.
 */
declare const mp: Mp;
