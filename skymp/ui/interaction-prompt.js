/**
 * Prompt visual do Interaction Framework.
 *
 * Esta camada apenas desenha o rótulo que o servidor aprovou. O E é tratado
 * pelo event source de mira exata; ele relê o crosshair e pede uma inspeção ao
 * servidor. Depois da validação, `browserModal` abre o menu existente. A CEF
 * nunca reutiliza o alvo visual como autoridade.
 */

(function () {
  'use strict';

  function handleInteractionPrompt(payload) {
    const data = normalizePayload(payload);
    const root = document.getElementById('interaction-prompt');
    if (!root) return;

    if (!data || data.targetId === null || data.targetId === undefined) {
      root.classList.remove('visible');
      root.setAttribute('aria-hidden', 'true');
      return;
    }

    document.getElementById('interaction-prompt-label').textContent = data.label || 'Interagir';
    root.classList.add('visible');
    root.setAttribute('aria-hidden', 'false');
  }

  window.handleInteractionPrompt = handleInteractionPrompt;
})();
