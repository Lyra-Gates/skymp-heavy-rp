const DEFAULT_LIMITS = {
  maxLength: 240,
  windowMs: 10000,
  maxMessagesPerWindow: 5,
  reportCooldownMs: 60000
};

const RANGES = {
  whisper: 450,
  say: 1200,
  emote: 1500,
  ooc: 2000,
  shout: 3500
};

function createRpChatService(options) {
  const limits = Object.assign({}, DEFAULT_LIMITS, options && options.limits);
  const history = new Map();
  const reportCooldown = new Map();

  function now() {
    return options && options.now ? options.now() : Date.now();
  }

  function random() {
    return options && options.random ? options.random() : Math.random();
  }

  function cleanText(text) {
    if (typeof text !== 'string') return '';
    return text
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limits.maxLength);
  }

  function getCharacterName(actorId) {
    return options.getCharacterName(actorId);
  }

  function getCharacterData(actorId) {
    return options.getCharacterData ? options.getCharacterData(actorId) : null;
  }

  function sendNotification(actorId, message) {
    options.sendNotification(actorId, message);
  }

  function broadcast(actorId, message, radius) {
    options.broadcastProximityMessage(actorId, message, radius);
  }

  function logEvent(actorId, type, message, radius) {
    if (!options.logEvent) return;
    const charData = getCharacterData(actorId);
    Promise.resolve(options.logEvent({
      actorId,
      type,
      message,
      radius,
      characterId: charData && charData.characterId,
      accountId: charData && charData.accountId
    })).catch((err) => {
      console.error('[rp-chat] Failed to log chat event:', err.message);
    });
  }

  function isRateLimited(actorId) {
    const current = now();
    const previous = history.get(actorId) || [];
    const recent = previous.filter((timestamp) => current - timestamp < limits.windowMs);
    if (recent.length >= limits.maxMessagesPerWindow) {
      history.set(actorId, recent);
      return true;
    }
    recent.push(current);
    history.set(actorId, recent);
    return false;
  }

  function canSendReport(actorId) {
    const current = now();
    const lastReport = reportCooldown.get(actorId) || 0;
    if (lastReport && current - lastReport < limits.reportCooldownMs) {
      return false;
    }
    reportCooldown.set(actorId, current);
    return true;
  }

  function parseInput(text) {
    const cleaned = cleanText(text);
    if (!cleaned) {
      return { handled: true, error: null };
    }
    if (!cleaned.startsWith('/')) {
      return { handled: true, command: 'say', args: cleaned };
    }

    const firstSpace = cleaned.indexOf(' ');
    const command = firstSpace === -1 ? cleaned.toLowerCase() : cleaned.slice(0, firstSpace).toLowerCase();
    const args = firstSpace === -1 ? '' : cleaned.slice(firstSpace + 1).trim();
    return { handled: false, command, args };
  }

  function requireArgs(actorId, args, usage) {
    if (args) return true;
    sendNotification(actorId, `Uso correto: ${usage}`);
    return false;
  }

  function handleRoll(actorId, args) {
    let max = 20;
    if (args) {
      const parsed = Number.parseInt(args, 10);
      if (!Number.isInteger(parsed) || parsed < 2 || parsed > 100) {
        sendNotification(actorId, 'Uso correto: /roll [2-100]');
        return true;
      }
      max = parsed;
    }

    const result = Math.floor(random() * max) + 1;
    const message = `* ${getCharacterName(actorId)} rolou um dado d${max} e tirou: ${result}`;
    broadcast(actorId, message, RANGES.emote);
    logEvent(actorId, 'roll', message, RANGES.emote);
    return true;
  }

  function handleTry(actorId, args) {
    if (!requireArgs(actorId, args, '/try <acao>')) return true;
    const success = random() >= 0.5;
    const result = success ? 'conseguiu' : 'falhou';
    const message = `* ${getCharacterName(actorId)} tenta ${args} e ${result}.`;
    broadcast(actorId, message, RANGES.emote);
    logEvent(actorId, 'try', message, RANGES.emote);
    return true;
  }

  function handleReport(actorId, args) {
    if (!requireArgs(actorId, args, '/report <motivo>')) return true;
    if (!canSendReport(actorId)) {
      sendNotification(actorId, 'Aguarde antes de enviar outro report.');
      return true;
    }

    const charName = getCharacterName(actorId);
    const message = `[REPORT] ${charName}: ${args}`;
    sendNotification(actorId, 'Report enviado para a staff.');
    console.log(`[rp-chat] ${message}`);
    logEvent(actorId, 'report', message, 0);
    return true;
  }

  function handleHelp(actorId) {
    sendNotification(actorId, 'Comandos RP: /me /do /s /g /ooc /roll /try /report');
    return true;
  }

  function handleChatInput(actorId, text) {
    const parsed = parseInput(text);
    if (parsed.error) return true;
    if (!parsed.command) return true;

    const command = parsed.command;
    const args = parsed.args || '';
    const charName = getCharacterName(actorId);

    const rpCommands = new Set([
      'say', '/me', '/do', '/ooc', '/b', '/s', '/sussurrar', '/g', '/gritar',
      '/roll', '/try', '/report', '/rphelp', '/ajuda'
    ]);

    if (!rpCommands.has(command)) {
      return false;
    }

    if (command !== '/report' && isRateLimited(actorId)) {
      sendNotification(actorId, 'Voce esta enviando mensagens rapido demais.');
      return true;
    }

    switch (command) {
      case 'say': {
        const message = `${charName} diz: ${args}`;
        broadcast(actorId, message, RANGES.say);
        logEvent(actorId, 'say', message, RANGES.say);
        return true;
      }
      case '/me': {
        if (!requireArgs(actorId, args, '/me <acao>')) return true;
        const message = `* ${charName} ${args}`;
        broadcast(actorId, message, RANGES.emote);
        logEvent(actorId, 'me', message, RANGES.emote);
        return true;
      }
      case '/do': {
        if (!requireArgs(actorId, args, '/do <descricao>')) return true;
        const message = `* ${args} (( ${charName} ))`;
        broadcast(actorId, message, RANGES.emote);
        logEvent(actorId, 'do', message, RANGES.emote);
        return true;
      }
      case '/ooc':
      case '/b': {
        if (!requireArgs(actorId, args, `${command} <mensagem>`)) return true;
        const message = `(( OOC: ${charName}: ${args} ))`;
        broadcast(actorId, message, RANGES.ooc);
        logEvent(actorId, 'ooc', message, RANGES.ooc);
        return true;
      }
      case '/s':
      case '/sussurrar': {
        if (!requireArgs(actorId, args, `${command} <mensagem>`)) return true;
        const message = `${charName} sussurra: ${args}`;
        broadcast(actorId, message, RANGES.whisper);
        logEvent(actorId, 'whisper', message, RANGES.whisper);
        return true;
      }
      case '/g':
      case '/gritar': {
        if (!requireArgs(actorId, args, `${command} <mensagem>`)) return true;
        const message = `${charName} grita: ${args}`;
        broadcast(actorId, message, RANGES.shout);
        logEvent(actorId, 'shout', message, RANGES.shout);
        return true;
      }
      case '/roll':
        return handleRoll(actorId, args);
      case '/try':
        return handleTry(actorId, args);
      case '/report':
        return handleReport(actorId, args);
      case '/rphelp':
      case '/ajuda':
        return handleHelp(actorId);
      default:
        return false;
    }
  }

  return {
    cleanText,
    parseInput,
    handleChatInput
  };
}

module.exports = {
  RANGES,
  createRpChatService
};
