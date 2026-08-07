/**
 * core/module-registry.js
 *
 * Registro central do ciclo de vida de módulos.
 *
 * Cada módulo declara:
 *   - id: identificador único
 *   - enabledBy: variável de ambiente que ativa o módulo (process.env[enabledBy] === 'true')
 *   - phase: 'core' | 'lab' | 'parked' (informativo, ajuda no diagnóstico)
 *   - dependencies: IDs de outros módulos que devem estar ativos
 *   - commands: lista de comandos registrados (para cleanup automático)
 *   - actions: lista de ações registradas na action-policy
 *   - initialize(path): função de inicialização
 *   - shutdown(): função de desligamento (opcional)
 *   - healthCheck(): função de verificação de saúde (opcional, retorna boolean)
 *
 * Fluxo:
 *   1. Módulos chamam moduleRegistry.register(descriptor) ao carregar
 *   2. phase0-basic.js chama moduleRegistry.bootAll() no startup
 *   3. bootAll() verifica env var, resolve dependências e chama initialize()
 *   4. Comandos são registrados no commandRegistry automaticamente se o módulo estiver ativo
 *   5. Na desconexão/shutdown, shutdown() é chamado e comandos são removidos
 *
 * ─── Distribuição de eventos de jogo: ADIADA, e por quê ─────────────────────
 *
 * O sistema de módulos do Red House distribui eventos de jogo (`onHit`,
 * `onCellChange`) para qualquer módulo que queira escutar — não só para quem o
 * evento foi originalmente escrito. Este registry só tem ciclo de vida
 * (`initialize`/`shutdown`/`healthCheck`), e o estudo registrou aquilo como
 * "um dia pode valer"
 * (`docs/technical/REFERENCE_STUDY_SKYMP_RED_HOUSE.md` §4.1, "Outras coisas
 * que aprendemos").
 *
 * **Avaliado em 06/08/2026 e deliberadamente não feito.** O censo dos seis
 * módulos registrados hoje (`phase0-basic.js`):
 *
 *   | módulo        | evento de jogo que escutaria |
 *   |---------------|------------------------------|
 *   | death         | hit — e só ele                |
 *   | governance    | nenhum                        |
 *   | market-stalls | nenhum                        |
 *   | player-panel  | nenhum (faz polling de Papyrus e assina o panel-refresh-bus, que é interno, não evento de jogo) |
 *   | voip          | nenhum                        |
 *   | npc-cleaner   | nenhum                        |
 *
 * **Um consumidor, um tipo de evento.** `core/hit-events.js` entrega o episódio
 * direto ao assinante que o `death-service` passa em `hitEvents.start(cb)` —
 * uma linha, sem indireção. Um despacho genérico aqui trocaria essa linha por
 * um barramento que serve a um só, e o `descriptor.on = { hit, cellChange }`
 * teria uma chave viva e uma morta desde o primeiro dia.
 *
 * `onCellChange` **não tem consumidor nenhum**, nem sequer um: `safe-zones.js`
 * consulta `mp.get(actorId, 'locationalData')` sob demanda — é leitura de
 * property, servida do cache do servidor, sem o custo de ida ao Papyrus —, e o
 * sistema de território que motivaria o evento está em "Pós-Alfa" no
 * `HEAVY_RP_GAMEPLAY_SYSTEMS_BACKLOG.md`. Construir a distribuição por causa
 * dele seria construir infraestrutura para uma feature que ainda não passou
 * pelas 15 perguntas da Constituição §15.
 *
 * O precedente do próprio projeto diz o mesmo: quando um segundo consumidor
 * apareceu de verdade — governança precisando avisar o painel —, a resposta foi
 * `core/panel-refresh-bus.js`, um barramento pequeno e nomeado, não um canal
 * genérico no registry. Serve de modelo se um terceiro caso aparecer.
 *
 * **O gatilho para reabrir isto**, para quem chegar aqui depois: um segundo
 * módulo que precise de um evento de jogo já capturado por outro. Aí o desenho
 * é `descriptor.on = { hit: fn, cellChange: fn }` opcional no `register()`,
 * despachado a partir de onde o evento já é capturado hoje
 * (`core/hit-events.js`), com teste no padrão do resto deste arquivo. Até lá,
 * generalizar seria abstração prematura — a mesma que a §15 pede para evitar na
 * camada de mecânica de mundo, pelo mesmo motivo.
 */

const commandRegistry = require('./command-registry');

// ─────────────────────────────────────────────────────────────────────────────
// Registro interno
// ─────────────────────────────────────────────────────────────────────────────

// Mapa de id → descriptor completo
const _modules = new Map();

// Módulos que foram inicializados com sucesso
const _active = new Set();

// ─────────────────────────────────────────────────────────────────────────────
// API Pública
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registra um módulo no registry.
 * Deve ser chamado no carregamento do arquivo do módulo, antes do bootAll().
 *
 * @param {object} descriptor
 * @param {string}   descriptor.id           - ID único do módulo (ex: 'woodcutting')
 * @param {string}   descriptor.enabledBy    - Nome da env var que ativa este módulo
 * @param {string}   [descriptor.phase]      - 'core' | 'lab' | 'parked' (padrão: 'parked')
 * @param {string[]} [descriptor.dependencies] - IDs de módulos obrigatórios
 * @param {object[]} [descriptor.commands]   - [{ name, handler, opts }]
 * @param {Function} descriptor.initialize   - async () => void
 * @param {Function} [descriptor.shutdown]   - async () => void
 * @param {Function} [descriptor.healthCheck] - () => boolean
 */
function register(descriptor) {
  const {
    id,
    enabledBy,
    phase = 'parked',
    dependencies = [],
    commands = [],
    initialize,
    shutdown = async () => {},
    healthCheck = () => true
  } = descriptor;

  if (!id) throw new Error('[module-registry] Módulo sem id');
  if (!enabledBy) throw new Error(`[module-registry] Módulo '${id}' sem enabledBy`);
  if (typeof initialize !== 'function') throw new Error(`[module-registry] Módulo '${id}' sem função initialize`);

  _modules.set(id, { id, enabledBy, phase, dependencies, commands, initialize, shutdown, healthCheck });
}

/**
 * Verifica se um módulo está ativo (foi inicializado com sucesso).
 * @param {string} id
 * @returns {boolean}
 */
function isEnabled(id) {
  return _active.has(id);
}

/**
 * Inicializa todos os módulos registrados cujas env vars estejam ativas.
 * Resolve dependências e registra comandos automaticamente.
 *
 * Deve ser chamado UMA VEZ no boot (phase0-basic.js).
 */
async function bootAll() {
  console.log('[module-registry] Iniciando boot de módulos...');

  const results = { enabled: [], disabled: [], failed: [] };

  for (const [id, mod] of _modules.entries()) {
    const shouldEnable = process.env[mod.enabledBy] === 'true';

    if (!shouldEnable) {
      console.log(`[module-registry] [${mod.phase.toUpperCase()}] ${id}: DESATIVADO (${mod.enabledBy}=false ou não definido)`);
      results.disabled.push(id);
      continue;
    }

    // Verificar dependências
    const missingDeps = mod.dependencies.filter(dep => !_active.has(dep));
    if (missingDeps.length > 0) {
      console.error(`[module-registry] ${id}: FALHOU — dependências não ativas: ${missingDeps.join(', ')}`);
      results.failed.push({ id, reason: `dependências ausentes: ${missingDeps.join(', ')}` });
      continue;
    }

    // Inicializar
    try {
      await mod.initialize();
      _active.add(id);

      // Registrar comandos no command-registry
      for (const cmdDef of mod.commands) {
        commandRegistry.register(cmdDef.name, cmdDef.handler, {
          module: id,
          phase: mod.phase,
          description: cmdDef.description || '',
          usage: cmdDef.usage || cmdDef.name
        });
      }

      console.log(`[module-registry] [${mod.phase.toUpperCase()}] ${id}: ATIVO (${mod.commands.length} comandos registrados)`);
      results.enabled.push(id);
    } catch (err) {
      console.error(`[module-registry] ${id}: FALHOU ao inicializar:`, err.message);
      results.failed.push({ id, reason: err.message });
    }
  }

  console.log(`[module-registry] Boot concluído: ${results.enabled.length} ativos, ${results.disabled.length} desativados, ${results.failed.length} com falha`);
  if (results.failed.length > 0) {
    console.error('[module-registry] Módulos com falha:', results.failed.map(f => `${f.id} (${f.reason})`).join('; '));
  }

  return results;
}

/**
 * Desliga todos os módulos ativos ordenadamente.
 * Chamado no shutdown do servidor.
 */
async function shutdownAll() {
  console.log('[module-registry] Iniciando shutdown de módulos...');
  for (const [id, mod] of _modules.entries()) {
    if (!_active.has(id)) continue;
    try {
      // Remover comandos do registry
      for (const cmdDef of mod.commands) {
        commandRegistry.unregister(cmdDef.name);
      }
      await mod.shutdown();
      _active.delete(id);
      console.log(`[module-registry] ${id}: desligado`);
    } catch (err) {
      console.error(`[module-registry] Erro ao desligar ${id}:`, err.message);
    }
  }
}

/**
 * Executa healthCheck em todos os módulos ativos.
 * Retorna relatório para diagnóstico.
 */
function healthCheckAll() {
  const report = [];
  for (const [id, mod] of _modules.entries()) {
    if (!_active.has(id)) continue;
    try {
      const healthy = mod.healthCheck();
      report.push({ id, healthy });
    } catch (err) {
      report.push({ id, healthy: false, error: err.message });
    }
  }
  return report;
}

/**
 * Lista todos os módulos registrados com seu status.
 */
function list() {
  return Array.from(_modules.values()).map(mod => ({
    id: mod.id,
    phase: mod.phase,
    enabled: _active.has(mod.id),
    enabledBy: mod.enabledBy,
    envValue: process.env[mod.enabledBy] || 'não definido',
    commandCount: mod.commands.length
  }));
}

module.exports = { register, isEnabled, bootAll, shutdownAll, healthCheckAll, list };
