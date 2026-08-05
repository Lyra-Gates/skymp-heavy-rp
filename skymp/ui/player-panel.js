/**
 * player-panel.js
 *
 * Painel do jogador (Status | Governança | Economia | Social).
 * Identidade visual emprestada do próprio Prisma UI (prismaui.dev): glass card
 * escuro, chip de status "ao vivo", pílulas, dados em lista limpa.
 *
 * Depende de globals já definidos em index.html: `mp`, `sendUiEvent`,
 * `normalizePayload`. Deve ser incluído DEPOIS do script inline de index.html.
 *
 * Fluxo:
 *   - Servidor chama openPanel() (via /painel) → seta browserVisible/Focused
 *     e envia um snapshot de cada seção pela property `panelData`.
 *   - `window.handlePanelData({channel, data})` é chamado pelo client SkyMP
 *     (ver phase0-basic.js, property 'panelData') e atualiza a aba correspondente.
 *   - Nome e chip de status no cabeçalho (canal 'status') ficam visíveis em
 *     qualquer aba — são a identidade do painel, não pertencem só à aba Status.
 *   - Trocar de aba pede um refresh sob demanda via `panel:refresh:<secao>`.
 */

(function () {
  const ppState = {
    open: false,
    activeTab: 'status',
    data: { status: null, governance: null, economy: null, social: null }
  };

  const STATE_LABELS = {
    NORMAL: 'Em ordem', BUSY: 'Ocupado', DOWNED: 'Abatido', DEAD: 'Morto',
    RESTRAINED: 'Algemado', IMPRISONED: 'Preso', IN_TRADE: 'Em negócio',
    IN_CRAFT: 'Em ofício', IN_DIALOG: 'Em audiência'
  };
  const BAD_STATES = new Set(['RESTRAINED', 'IMPRISONED', 'DOWNED', 'DEAD']);
  const KNOWN_SOURCE_LABELS = { introduced: 'apresentado', alias: 'apelido', staff: 'staff', disguise: 'disfarce' };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function gold(value) {
    return `${Number(value || 0).toLocaleString('pt-BR')}g`;
  }

  /** Linha de dado limpa: rótulo à esquerda, valor à direita, hairline embaixo. */
  function row(label, value, opts = {}) {
    const valueClass = opts.valueClass ? ` ${opts.valueClass}` : '';
    const sub = opts.sub ? `<span class="sub">${escapeHtml(opts.sub)}</span>` : '';
    return `
      <div class="pp-row">
        <span class="label">${escapeHtml(label)}${sub}</span>
        <span class="value${valueClass}">${value}</span>
      </div>
    `;
  }

  function openPlayerPanelShell() {
    ppState.open = true;
    $('player-panel').classList.add('open');
  }

  function closePlayerPanel() {
    ppState.open = false;
    $('player-panel').classList.remove('open');
    sendUiEvent('panel:close', {});
  }

  function switchTab(tab) {
    ppState.activeTab = tab;
    for (const btn of document.querySelectorAll('.pp-tab')) {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    }
    for (const section of document.querySelectorAll('.pp-section')) {
      section.classList.toggle('active', section.id === `pp-section-${tab}`);
    }
    sendUiEvent(`panel:refresh:${tab}`, {});
    renderTab(tab);
  }

  function renderTab(tab) {
    const data = ppState.data[tab];
    if (tab === 'status') renderStatus(data);
    else if (tab === 'governance') renderGovernance(data);
    else if (tab === 'economy') renderEconomy(data);
    else if (tab === 'social') renderSocial(data);
  }

  /** Nome e chip de status no cabeçalho — sempre visíveis, qualquer que seja a aba aberta. */
  function updateHeader(data) {
    $('pp-char-name').textContent = data ? data.name : '—';
    const chip = $('pp-status-chip');
    const isBad = data && BAD_STATES.has(data.state);
    chip.classList.toggle('warn', Boolean(isBad));
    $('pp-status-text').textContent = data ? (STATE_LABELS[data.state] || data.state) : 'Em ordem';
  }

  function gaugeRow(label, value, cls) {
    const raw = Number(value) || 0;
    const v = Math.max(0, Math.min(100, raw));
    return `
      <div class="pp-gauge">
        <div class="pp-gauge-label"><span>${label}</span><span class="value">${Math.round(raw)}</span></div>
        <div class="pp-gauge-track"><div class="pp-gauge-fill ${cls}" style="width:${v}%"></div></div>
      </div>
    `;
  }

  function renderStatus(data) {
    const body = $('pp-section-status');
    if (!data) {
      body.innerHTML = '<div class="pp-empty">Nenhum dado recebido do servidor ainda.</div>';
      return;
    }

    const v = data.vitals || { health: 0, magicka: 0, stamina: 0 };

    body.innerHTML = `
      <div class="pp-h">Vitalidade</div>
      ${gaugeRow('Vida', v.health, 'health')}
      ${gaugeRow('Magicka', v.magicka, 'magicka')}
      ${gaugeRow('Stamina', v.stamina, 'stamina')}

      <div class="pp-h">Resumo</div>
      ${row('Ouro', gold(data.gold), { valueClass: 'accent' })}
      ${row('Condição', escapeHtml(STATE_LABELS[data.state] || data.state), { valueClass: BAD_STATES.has(data.state) ? 'warn' : '' })}
    `;
  }

  function renderGovernance(data) {
    const body = $('pp-section-governance');
    if (!data) {
      body.innerHTML = '<div class="pp-empty">Sem registros de cargo, mandado ou multa.</div>';
      return;
    }

    const memberships = (data.memberships || [])
      .map(m => row(m.label || m.role, m.onDuty ? 'Em serviço' : 'Fora', { sub: ` · ${m.scopeType}:${m.scopeId}` }))
      .join('');

    const warrant = data.activeWarrant
      ? row('Mandado ativo', escapeHtml(data.activeWarrant.severity), { valueClass: 'warn', sub: data.activeWarrant.reason ? ` · ${data.activeWarrant.reason}` : '' })
      : '';

    const fines = (data.recentFines || [])
      .map(f => row('Multa', gold(f.amount), { sub: f.reason ? ` · ${f.reason}` : '' }))
      .join('');

    const items = memberships + warrant + fines;
    body.innerHTML = `
      <div class="pp-h">Cargo &amp; Justiça</div>
      ${items || '<div class="pp-empty">Nenhum cargo, mandado ou multa em seu nome.</div>'}
      <div class="pp-hint">Ações de guarda continuam pelo menu de interação (clique direito em outro jogador).</div>
    `;
  }

  function renderEconomy(data) {
    const body = $('pp-section-economy');
    if (!data) {
      body.innerHTML = '<div class="pp-empty">Sem dados de economia ainda.</div>';
      return;
    }

    const stalls = (data.stalls || [])
      .map(s => row(s.name, `${s.items} itens`, { sub: ` · ${s.status}` }))
      .join('') || '<div class="pp-empty">Nenhuma barraca registrada em seu nome.</div>';

    body.innerHTML = `
      <div class="pp-h">Tesouro</div>
      ${row('Ouro', gold(data.gold), { valueClass: 'accent' })}
      ${row('Imposto local', `${Math.round((data.localTaxRate || 0) * 100)}%`)}

      <div class="pp-h">Barracas Registradas</div>
      ${stalls}
      <div class="pp-hint">Use o menu de interação em uma barraca para comprar, vender ou gerenciar itens.</div>
    `;
  }

  function renderSocial(data) {
    const body = $('pp-section-social');
    if (!data) {
      body.innerHTML = '<div class="pp-empty">Nenhum contato conhecido ainda.</div>';
      return;
    }

    const known = (data.knownPeople || [])
      .map(p => row(p.name, KNOWN_SOURCE_LABELS[p.source] || p.source || ''))
      .join('') || '<div class="pp-empty">Você ainda não conhece ninguém.</div>';

    body.innerHTML = `
      <div class="pp-h">Rostos Conhecidos</div>
      ${known}
      <div class="pp-hint">${escapeHtml(data.hint || '')}</div>
    `;
  }

  // ── API exposta para o restante da UI / servidor ──────────────────────────
  window.openPlayerPanel = function () {
    openPlayerPanelShell();
    sendUiEvent('panel:open', {});
  };

  window.togglePlayerPanel = function () {
    if (ppState.open) {
      closePlayerPanel();
    } else {
      window.openPlayerPanel();
    }
  };

  window.handlePanelData = function (payload) {
    const msg = normalizePayload(payload);
    if (!msg || !msg.channel) return;
    ppState.data[msg.channel] = msg.data;
    if (msg.channel === 'status') updateHeader(msg.data);
    if (!ppState.open) openPlayerPanelShell();
    if (ppState.activeTab === msg.channel) renderTab(msg.channel);
  };

  // ── Inicialização (script carregado no fim do <body>, DOM já pronto) ─────
  for (const btn of document.querySelectorAll('.pp-tab')) {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  }
  const closeBtn = $('pp-close');
  if (closeBtn) closeBtn.addEventListener('click', closePlayerPanel);
  updateHeader(null);
  renderTab('status');

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && ppState.open) closePlayerPanel();
    // Atalho local de conveniência (o gatilho real em jogo é o comando /painel).
    if (event.key === 'F2') window.togglePlayerPanel();
  });
})();
