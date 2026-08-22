/**
 * interaction-prompt.js
 *
 * Tarefa 11 — o `[E] <rótulo>` no centro da tela. Recebe o que o servidor
 * decidiu (`core/interaction-prompt-service.js`, canal `interactionPrompt`,
 * repassado por `window.handleInteractionPrompt`) e, ao apertar E (detectado
 * no cliente — ver `SNIPPET_DO_CLIENTE` do serviço), abre o MESMO menu de
 * interação que já existe (`openInteractionMenu`, definida no script
 * principal de `index.html`) — nenhum menu novo, nenhuma duplicação.
 *
 * `openInteractionMenu`/`sendUiEvent` são globais (funções `function` no
 * script principal, que carrega ANTES deste arquivo).
 */

(function () {
  'use strict';

  /**
   * Som de "menu abriu". Nenhum outro arquivo da CEF toca som nativo ainda
   * — guardado do mesmo jeito que `sendUiEvent` guarda `window.skyrimPlatform`.
   * ⚠️ 'UIMenuOpen' é um EDID plausível de um som de UI do Skyrim (é o
   * padrão de nomes do jogo base), mas este projeto nunca confirmou que é
   * esse o som certo nem que `playSound` aceita EDID — só uma sessão em
   * bancada fecha isso, mesma ressalva do resto da família de labs.
   */
  function tocarSomDeMenu() {
    try {
      if (window.skyrimPlatform && typeof window.skyrimPlatform.playSound === 'function') {
        window.skyrimPlatform.playSound('UIMenuOpen');
      }
    } catch (err) {
      // som e decoracao, nunca pode travar a UI
    }
  }

  function handleInteractionPrompt(payload) {
    const d = normalizePayload(payload);
    const el = document.getElementById('interaction-prompt');
    if (!el) return;

    if (!d || d.targetId === null || d.targetId === undefined) {
      el.classList.remove('visible');
      el.setAttribute('aria-hidden', 'true');
      return;
    }

    document.getElementById('interaction-prompt-label').textContent = d.label || 'Interagir';
    el.classList.add('visible');
    el.setAttribute('aria-hidden', 'false');
  }

  function handleInteractionPromptKey(payload) {
    const d = normalizePayload(payload);
    if (!d || d.targetId === null || d.targetId === undefined) return;
    // Um menu já aberto (o jogador abriu de outro jeito, ou apertou E duas
    // vezes rápido) não reabre por cima de si mesmo.
    if (document.getElementById('interaction-menu').classList.contains('open')) return;

    tocarSomDeMenu();
    openInteractionMenu({ targetActorId: d.targetId, targetType: d.targetType });
  }

  window.handleInteractionPrompt = handleInteractionPrompt;
  window.handleInteractionPromptKey = handleInteractionPromptKey;
})();
