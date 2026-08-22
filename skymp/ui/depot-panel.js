/**
 * depot-panel.js
 *
 * Tarefa 10 (UI-Depot-Bridge): renderiza o painel do Depósito Regional e
 * manda depósito/saque de volta pro servidor pelo MESMO pipeline que o menu
 * de interação já usa (`interaction:execute`, `core/interaction-service.js`).
 * Este arquivo não fala com o banco nem decide nada — só desenha o que o
 * servidor mandou em `depot:open`/`depot:update` (`core/depot-service.js`,
 * `sendModal`) e traduz clique em botão pra `sendUiEvent`.
 *
 * `sendUiEvent` e `normalizePayload` são globais definidos no <script>
 * principal de `index.html` (função `function`, não `const`, então viram
 * propriedade de `window`) — este arquivo carrega DEPOIS dele.
 */

(function () {
  'use strict';

  const state = {
    open: false,
    holdId: null,
    targetId: null,
    capacity: 0
  };

  function $(id) {
    return document.getElementById(id);
  }

  /**
   * Nenhum precedente de som nativo existe no projeto ainda (nenhum outro
   * arquivo da CEF chama isto) — guardado do mesmo jeito que `sendUiEvent`
   * guarda `window.skyrimPlatform`, pra nao quebrar se o framework de audio
   * não expuser o método.
   */
  function playInventorySound() {
    try {
      if (window.skyrimPlatform && typeof window.skyrimPlatform.playSound === 'function') {
        window.skyrimPlatform.playSound('ITMPotionUp');
      }
    } catch (err) {
      // silencioso de propósito: som é decoração, nunca pode travar a UI
    }
  }

  function formId(id) {
    return '0x' + Number(id).toString(16);
  }

  function buildRow(item, actionLabel, onAction) {
    const row = document.createElement('div');
    row.className = 'dp-row';

    const info = document.createElement('div');
    info.className = 'dp-row-info';
    const name = document.createElement('span');
    name.className = 'dp-row-name';
    name.textContent = formId(item.baseId);
    const count = document.createElement('span');
    count.className = 'dp-row-count';
    count.textContent = 'x' + item.count;
    info.appendChild(name);
    info.appendChild(count);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dp-row-btn';
    btn.textContent = actionLabel;
    btn.onclick = () => onAction(item);

    row.appendChild(info);
    row.appendChild(btn);
    return row;
  }

  function renderList(containerId, items, actionLabel, onAction) {
    const container = $(containerId);
    container.innerHTML = '';
    if (!items || items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'dp-empty';
      empty.textContent = 'Vazio.';
      container.appendChild(empty);
      return;
    }
    for (const item of items) {
      container.appendChild(buildRow(item, actionLabel, onAction));
    }
  }

  function requestMove(action, baseId, count) {
    if (!state.targetId) return;
    playInventorySound();
    // `requestId` não é usado aqui: `depot.deposit`/`depot.withdraw` não são
    // `idempotent` no registro (`core/depot-service.js`), então
    // `interaction-service.js` não exige um. Duplo clique em rede lenta é um
    // risco aceito — o mesmo que qualquer outra ação não-idempotente do menu.
    sendUiEvent('interaction:execute', {
      action,
      targetId: state.targetId,
      data: { baseId, count }
    });
  }

  function render(data) {
    state.holdId = data.holdId != null ? data.holdId : state.holdId;
    if (data.targetId != null) state.targetId = data.targetId;
    state.capacity = data.capacity != null ? data.capacity : state.capacity;

    $('dp-hold-name').textContent = state.holdId ? String(state.holdId) : '—';
    $('dp-gold').textContent = (data.gold != null ? data.gold : 0) + ' ouro';

    const depotTotal = (data.contents || []).reduce((sum, it) => sum + it.count, 0);
    $('dp-capacity-value').textContent = depotTotal + ' / ' + state.capacity;
    const pct = state.capacity > 0 ? Math.min(100, (depotTotal / state.capacity) * 100) : 0;
    const fill = $('dp-capacity-fill');
    fill.style.width = pct + '%';
    fill.classList.toggle('full', pct >= 100);
    fill.classList.toggle('warn', pct >= 85 && pct < 100);

    renderList('dp-carried-list', data.carried, 'Depositar', (item) => {
      requestMove('depot.deposit', item.baseId, 1);
    });
    renderList('dp-depot-list', data.contents, 'Retirar', (item) => {
      requestMove('depot.withdraw', item.baseId, 1);
    });
  }

  function open(data) {
    render(normalizePayload(data));
    state.open = true;
    const el = $('depot-panel');
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
  }

  function update(data) {
    // Só redesenha se o painel já estiver de pé — um `depot:update` chegando
    // depois que o jogador fechou (saque/depósito lento) não deve reabrir a
    // tela sozinho na cara dele.
    if (!state.open) return;
    render(normalizePayload(data));
  }

  function close() {
    state.open = false;
    const el = $('depot-panel');
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
  }

  function isOpen() {
    return state.open;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = $('dp-close');
    if (closeBtn) closeBtn.onclick = close;
  });

  window.DepotPanel = { open, update, close, isOpen };
})();
