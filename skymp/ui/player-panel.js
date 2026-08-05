/**
 * player-panel.js
 *
 * Painel do jogador (Status | Governança | Economia | Social).
 * Depende de globals já definidos em index.html: `mp`, `sendUiEvent`,
 * `normalizePayload`. Deve ser incluído DEPOIS do script inline de index.html.
 *
 * Fluxo:
 *   - Servidor chama openPanel() (via /painel) → seta browserVisible/Focused
 *     e envia um snapshot de cada seção pela property `panelData`.
 *   - `window.handlePanelData({channel, data})` é chamado pelo client SkyMP
 *     (ver phase0-basic.js, property 'panelData') e atualiza a aba correspondente.
 *   - Trocar de aba pede um refresh sob demanda via `panel:refresh:<secao>`.
 */

(function () {
  const ppState = {
    open: false,
    activeTab: 'status',
    data: { status: null, governance: null, economy: null, social: null }
  };

  const STATE_LABELS = {
    NORMAL: 'Normal',
    BUSY: 'Ocupado',
    DOWNED: 'Abatido',
    DEAD: 'Morto',
    RESTRAINED: 'Algemado',
    IMPRISONED: 'Preso',
    IN_TRADE: 'Negociando',
    IN_CRAFT: 'Fabricando',
    IN_DIALOG: 'Em diálogo'
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
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

  function vitalRow(label, value, cls) {
    const v = Number(value) || 0;
    return `
      <div class="pp-bar-row">
        <span>${label}</span>
        <div class="pp-bar-track"><div class="pp-bar-fill ${cls}" style="width:${Math.max(0, Math.min(100, v))}%"></div></div>
        <span>${Math.round(v)}</span>
      </div>
    `;
  }

  function renderStatus(data) {
    const body = $('pp-section-status');
    if (!data) {
      body.innerHTML = '<div class="pp-empty">Sem dados de status ainda.</div>';
      return;
    }

    const v = data.vitals || { health: 0, magicka: 0, stamina: 0 };
    const stateLabel = STATE_LABELS[data.state] || data.state || 'Normal';
    const badgeClass = data.state && data.state !== 'NORMAL' ? 'pp-badge warn' : 'pp-badge';

    body.innerHTML = `
      <div class="pp-stat-grid">
        <div class="pp-stat-card">
          <div class="pp-stat-label">Personagem</div>
          <div class="pp-stat-value">${escapeHtml(data.name)}</div>
        </div>
        <div class="pp-stat-card">
          <div class="pp-stat-label">Ouro</div>
          <div class="pp-stat-value gold">${Number(data.gold || 0).toLocaleString('pt-BR')}g</div>
        </div>
      </div>
      <div style="margin: 10px 0 14px;"><span class="${badgeClass}">${escapeHtml(stateLabel)}</span></div>
      <div class="pp-vitals">
        ${vitalRow('Vida', v.health, 'health')}
        ${vitalRow('Magicka', v.magicka, 'magicka')}
        ${vitalRow('Stamina', v.stamina, 'stamina')}
      </div>
    `;
  }

  function renderGovernance(data) {
    const body = $('pp-section-governance');
    if (!data) {
      body.innerHTML = '<div class="pp-empty">Sem registros de governança.</div>';
      return;
    }

    const memberships = (data.memberships || []).map(m => `
      <div class="pp-list-item">
        <span class="main">${escapeHtml(m.label || m.role)}${m.onDuty ? ' · em serviço' : ''}</span>
        <span class="sub">${escapeHtml(m.scopeType)}:${escapeHtml(String(m.scopeId))}</span>
      </div>
    `).join('');

    const warrant = data.activeWarrant ? `
      <div class="pp-list-item">
        <span class="main">Mandado ativo</span>
        <span class="sub">${escapeHtml(data.activeWarrant.severity)} — ${escapeHtml(data.activeWarrant.reason || '')}</span>
      </div>
    ` : '';

    const fines = (data.recentFines || []).map(f => `
      <div class="pp-list-item">
        <span class="main">Multa ${Number(f.amount || 0).toLocaleString('pt-BR')}g</span>
        <span class="sub">${escapeHtml(f.reason || '')}</span>
      </div>
    `).join('');

    const items = memberships + warrant + fines;
    body.innerHTML = `
      <div class="pp-list">${items || '<div class="pp-empty">Sem cargos, mandados ou multas.</div>'}</div>
      <div class="pp-hint">Ações de guarda continuam pelo menu de interação (clique direito em outro jogador).</div>
    `;
  }

  function renderEconomy(data) {
    const body = $('pp-section-economy');
    if (!data) {
      body.innerHTML = '<div class="pp-empty">Sem dados de economia ainda.</div>';
      return;
    }

    const stalls = (data.stalls || []).map(s => `
      <div class="pp-list-item">
        <span class="main">${escapeHtml(s.name)}</span>
        <span class="sub">${s.items} itens · ${escapeHtml(s.status)}</span>
      </div>
    `).join('') || '<div class="pp-empty">Você não tem barracas ativas.</div>';

    body.innerHTML = `
      <div class="pp-stat-grid">
        <div class="pp-stat-card">
          <div class="pp-stat-label">Ouro</div>
          <div class="pp-stat-value gold">${Number(data.gold || 0).toLocaleString('pt-BR')}g</div>
        </div>
        <div class="pp-stat-card">
          <div class="pp-stat-label">Imposto local</div>
          <div class="pp-stat-value">${Math.round((data.localTaxRate || 0) * 100)}%</div>
        </div>
      </div>
      <div class="pp-list" style="margin-top:12px;">${stalls}</div>
      <div class="pp-hint">Use o menu de interação em uma barraca para comprar, vender ou gerenciar itens.</div>
    `;
  }

  function renderSocial(data) {
    const body = $('pp-section-social');
    if (!data) {
      body.innerHTML = '<div class="pp-empty">Sem contatos conhecidos ainda.</div>';
      return;
    }

    const known = (data.knownPeople || []).map(p => `
      <div class="pp-list-item">
        <span class="main">${escapeHtml(p.name)}</span>
        <span class="sub">${escapeHtml(p.source || '')}</span>
      </div>
    `).join('') || '<div class="pp-empty">Você ainda não conhece ninguém.</div>';

    body.innerHTML = `
      <div class="pp-list">${known}</div>
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
    if (!ppState.open) openPlayerPanelShell();
    if (ppState.activeTab === msg.channel) renderTab(msg.channel);
  };

  // ── Inicialização (script carregado no fim do <body>, DOM já pronto) ─────
  for (const btn of document.querySelectorAll('.pp-tab')) {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  }
  const closeBtn = $('pp-close');
  if (closeBtn) closeBtn.addEventListener('click', closePlayerPanel);
  renderTab('status');

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && ppState.open) closePlayerPanel();
    // Atalho local de conveniência (o gatilho real em jogo é o comando /painel).
    if (event.key === 'F2') window.togglePlayerPanel();
  });
})();
