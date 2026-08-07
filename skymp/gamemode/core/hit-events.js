/**
 * core/hit-events.js — agressão relatada pelo cliente, agregada em episódios
 *
 * ─── O que isto é, e o que NÃO é ────────────────────────────────────────────
 *
 * É **evidência**, não enforcement. O evento vem de `mp.makeEventSource`, que
 * injeta JS no cliente — e o `CONTRIBUTING.md` §3.6 é explícito: eventos de
 * cliente são *"uma dica, não uma prova. Aceitável para detectar morte;
 * inaceitável para conceder item ou ouro"*.
 *
 * É aqui que nos separamos do Red House, de onde veio a técnica
 * (`REFERENCE_STUDY_SKYMP_RED_HOUSE.md` §4.1). Eles recalculam o dano no
 * servidor a partir deste evento e aplicam no ActorValue. Nós não: quem manda
 * o evento é a máquina do jogador, então usar isso pra decidir dano entregaria
 * o combate a quem controla o cliente. O que ganhamos é o que o evento serve
 * pra ser — um rastro de quem atacou quem, pra staff arbitrar denúncia de RDM.
 *
 * ─── O que substitui ────────────────────────────────────────────────────────
 *
 * O `checkDamageSpike` do `death-service.js`: uma heurística que chama de
 * agressão qualquer queda de 25 pontos de vida num tick de 2 s. Ela não
 * distingue combate de queda de penhasco, não sabe quem bateu, e só existe
 * porque estava pendurada no polling que queremos remover.
 *
 * ─── Por que agrega em episódio, e não grava golpe a golpe ──────────────────
 *
 * Uma briga de trinta segundos entre duas pessoas gera dezenas de eventos. O
 * Red House podia tratar cada um isoladamente porque o uso deles era efêmero
 * (aplicar dano e esquecer); o nosso é persistente. Gravar linha por golpe em
 * `audit_logs` inutilizaria a tabela justamente na hora em que a staff mais
 * precisa dela — e "sete linhas iguais" responde pior à pergunta *"o que
 * aconteceu ali?"* do que uma só dizendo "A bateu em B sete vezes, duas com
 * power attack, ao longo de doze segundos".
 *
 * O episódio fecha por silêncio (`JANELA_MS` sem golpe novo entre aquele par).
 *
 * ─── Estado de validação ────────────────────────────────────────────────────
 *
 * `mp.makeEventSource` foi confirmada num servidor real em 06/08/2026 — existe
 * e aceita o registro. **O snippet de cliente NÃO foi exercitado**: ele só roda
 * quando alguém conecta, o que é a Fase 0. Até lá, este módulo é código que
 * registra corretamente um evento que ninguém viu chegar.
 *
 * Os dois detalhes abaixo vieram do Red House e economizam a depuração óbvia:
 *
 *   - **`0x14` é o jogador local.** O cliente se reporta com esse FormID; o
 *     servidor precisa trocar pelo `pcFormId` que recebe junto, senão todo
 *     golpe do próprio jogador aponta pro form errado.
 *   - **`ctx.getFormIdInServerFormat()` é obrigatório.** FormID de cliente e de
 *     servidor são espaços diferentes; mandar o número cru daria outro objeto.
 */

const NOME_DO_EVENTO = '_onHitReported';

/** Silêncio que fecha um episódio entre um par. */
const JANELA_MS = 10_000;

/** Teto de golpes contados por episódio — o número exato deixa de importar. */
const MAX_GOLPES_POR_EPISODIO = 200;

/**
 * O trecho que roda NO CLIENTE, dentro do Skyrim Platform.
 *
 * Escrito como string porque é isso que `makeEventSource` recebe: o corpo é
 * serializado e injetado no cliente. Nada aqui tem acesso ao escopo deste
 * arquivo — só ao `ctx` que o SkyMP fornece.
 *
 * Mantido curto de propósito: cada linha aqui roda no loop do jogo da máquina
 * de outra pessoa, e não há como depurar remotamente. A agregação, o
 * throttling e toda a decisão ficam do lado do servidor.
 */
const SNIPPET_DO_CLIENTE = `
  ctx.sp.on('hit', (e) => {
    try {
      // \`agressor\` com essa grafia e o que o Skyrim Platform entrega.
      var alvo = e.target && ctx.getFormIdInServerFormat(e.target.getFormID());
      var quemBateu = e.agressor && ctx.getFormIdInServerFormat(e.agressor.getFormID());
      if (!alvo || !quemBateu) return;
      ctx.sendEvent({
        target: alvo,
        aggressor: quemBateu,
        isPowerAttack: !!e.isPowerAttack,
        isSneakAttack: !!e.isSneakAttack,
        isBashAttack: !!e.isBashAttack,
        isHitBlocked: !!e.isHitBlocked
      });
    } catch (err) {
      // Um erro aqui roda no cliente e nao tem pra onde ir. Engolir e o
      // certo: derrubar o snippet mataria o rastro de todos os golpes
      // seguintes daquele jogador.
    }
  });
`;

/** FormID com que o cliente se refere a si mesmo. */
const JOGADOR_LOCAL = 0x14;

/** `${agressor}:${alvo}` → episódio aberto */
const _episodios = new Map();

let _aoFecharEpisodio = null;
let _timerDeVarredura = null;
let _registrado = false;

/**
 * Normaliza o FormID que o cliente reportou.
 *
 * O cliente manda `0x14` para si mesmo — é o form do jogador local dentro do
 * processo dele. Do lado do servidor esse número não identifica ninguém, então
 * troca pelo `pcFormId`, que é quem de fato mandou o evento.
 */
function _resolverAtor(formId, pcFormId) {
  return formId === JOGADOR_LOCAL ? pcFormId : formId;
}

/**
 * Contabiliza um golpe. Exportada para teste — é a regra de agregação, e ela
 * precisa ser exercitável sem cliente, sem servidor e sem relógio real.
 *
 * @param {number} pcFormId  quem mandou o evento
 * @param {object} evento    o payload do snippet
 * @param {number} [agora]   injetável no teste
 */
function registrarGolpe(pcFormId, evento, agora = Date.now()) {
  if (!evento || typeof evento !== 'object') return null;

  const agressor = _resolverAtor(Number(evento.aggressor), pcFormId);
  const alvo = _resolverAtor(Number(evento.target), pcFormId);

  if (!Number.isFinite(agressor) || !Number.isFinite(alvo)) return null;
  // Dano em si mesmo (queda, veneno, fogo amigo do proprio feitico) nao e
  // agressao entre pessoas e nao interessa a arbitragem de RDM.
  if (agressor === alvo) return null;

  const chave = `${agressor}:${alvo}`;
  let ep = _episodios.get(chave);

  if (!ep) {
    ep = {
      agressor,
      alvo,
      golpes: 0,
      powerAttacks: 0,
      sneakAttacks: 0,
      bashAttacks: 0,
      bloqueados: 0,
      inicio: agora,
      ultimo: agora
    };
    _episodios.set(chave, ep);
  }

  if (ep.golpes < MAX_GOLPES_POR_EPISODIO) ep.golpes++;
  if (evento.isPowerAttack) ep.powerAttacks++;
  if (evento.isSneakAttack) ep.sneakAttacks++;
  if (evento.isBashAttack) ep.bashAttacks++;
  if (evento.isHitBlocked) ep.bloqueados++;
  ep.ultimo = agora;

  return ep;
}

/**
 * Fecha os episódios sem golpe novo há `JANELA_MS` e entrega ao assinante.
 * Exportada para teste pelo mesmo motivo de `registrarGolpe`.
 */
function fecharEpisodiosVencidos(agora = Date.now()) {
  const fechados = [];
  for (const [chave, ep] of _episodios.entries()) {
    if (agora - ep.ultimo < JANELA_MS) continue;
    _episodios.delete(chave);
    fechados.push({ ...ep, duracaoMs: ep.ultimo - ep.inicio });
  }

  if (_aoFecharEpisodio) {
    for (const ep of fechados) {
      try {
        _aoFecharEpisodio(ep);
      } catch (err) {
        console.error('[hit-events] Assinante falhou ao receber episodio:', err.message);
      }
    }
  }
  return fechados;
}

/**
 * Registra o event source e começa a varrer episódios vencidos.
 *
 * @param {(episodio: object) => void} aoFecharEpisodio
 * @returns {boolean} se o registro aconteceu
 */
function start(aoFecharEpisodio) {
  _aoFecharEpisodio = aoFecharEpisodio || null;

  if (!_timerDeVarredura) {
    // A varredura e barata: percorre um Map pequeno, sem tocar Papyrus nem
    // banco. Nao tem relacao com o polling de 2 s que estamos removendo.
    _timerDeVarredura = setInterval(() => {
      try {
        fecharEpisodiosVencidos();
      } catch (err) {
        console.error('[hit-events] Falha ao fechar episodios:', err.message);
      }
    }, JANELA_MS);
    if (typeof _timerDeVarredura.unref === 'function') _timerDeVarredura.unref();
  }

  if (typeof mp === 'undefined' || typeof mp.makeEventSource !== 'function') {
    console.warn('[hit-events] mp.makeEventSource indisponivel — nenhum golpe sera reportado.');
    return false;
  }
  if (_registrado) return true;

  try {
    mp.makeEventSource(NOME_DO_EVENTO, SNIPPET_DO_CLIENTE);
    mp[NOME_DO_EVENTO] = (pcFormId, evento) => {
      try {
        registrarGolpe(pcFormId, evento);
      } catch (err) {
        console.error('[hit-events] Falha ao registrar golpe:', err.message);
      }
    };
    _registrado = true;
    console.log('[hit-events] Evento de agressao registrado (evidencia, nao enforcement).');
    return true;
  } catch (err) {
    console.error('[hit-events] Falha ao registrar o event source:', err.message);
    return false;
  }
}

function stop() {
  if (_timerDeVarredura) clearInterval(_timerDeVarredura);
  _timerDeVarredura = null;
  _episodios.clear();
  _aoFecharEpisodio = null;
  _registrado = false;
}

module.exports = {
  NOME_DO_EVENTO,
  JANELA_MS,
  MAX_GOLPES_POR_EPISODIO,
  SNIPPET_DO_CLIENTE,
  start,
  stop,
  registrarGolpe,
  fecharEpisodiosVencidos,
  _episodios
};
