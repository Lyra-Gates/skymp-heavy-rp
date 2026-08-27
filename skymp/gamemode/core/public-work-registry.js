/**
 * Catálogo executável de Trabalho Público.
 *
 * Uma definição só entra aqui quando possui rota física e valores concretos.
 * Trabalhos aprovados nos documentos não recebem FormDesc/recompensa fictícios:
 * conteúdo incompleto falha fechado e não aparece como jogável.
 */
'use strict';

const CODE_SHAPE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const FORM_DESC_SHAPE = /^[0-9a-fA-F]+:.+\.(?:esm|esp|esl)$/i;
// O MVP implementa somente token persistente, não item transferível.
const CARGO_POLICIES = Object.freeze({ TOKEN: 'token' });
const _definitions = new Map();

function _positiveInt(value) { return Number.isSafeInteger(value) && value > 0; }
function _formDesc(value) {
  return typeof value === 'string' && value.length <= 128 && FORM_DESC_SHAPE.test(value);
}

function register(input) {
  const fail = message => { throw new Error(`[public-work-registry] ${message}`); };
  if (!input || typeof input !== 'object') fail('descritor ausente');
  const {
    code, label, boardFormDesc, originFormDesc, originLabel, destinationFormDesc, destinationLabel,
    rewardAmount, timeLimitSeconds, cooldownSeconds, cooldownGroup,
    cargoPolicy = CARGO_POLICIES.TOKEN
  } = input;

  if (!CODE_SHAPE.test(String(code)) || String(code).length > 32) fail(`code invalido '${code}'`);
  if (_definitions.has(code)) fail(`'${code}' registrado duas vezes`);
  if (typeof label !== 'string' || !label.trim() || label.length > 80) fail(`'${code}' sem label valido`);
  if (typeof originLabel !== 'string' || !originLabel.trim() || originLabel.length > 80) fail(`'${code}' sem originLabel valido`);
  if (typeof destinationLabel !== 'string' || !destinationLabel.trim() || destinationLabel.length > 80) fail(`'${code}' sem destinationLabel valido`);
  for (const [field, value] of Object.entries({ boardFormDesc, originFormDesc, destinationFormDesc })) {
    if (!_formDesc(value)) fail(`'${code}' com ${field} invalido`);
  }
  if (!_positiveInt(rewardAmount) || rewardAmount > 1_000_000) fail(`'${code}' com rewardAmount invalido`);
  if (!_positiveInt(timeLimitSeconds) || timeLimitSeconds < 60 || timeLimitSeconds > 86_400) fail(`'${code}' com timeLimitSeconds invalido`);
  if (!_positiveInt(cooldownSeconds) || cooldownSeconds > 86_400) fail(`'${code}' com cooldownSeconds invalido`);
  if (!CODE_SHAPE.test(String(cooldownGroup))) fail(`'${code}' com cooldownGroup invalido`);
  if (!Object.values(CARGO_POLICIES).includes(cargoPolicy)) fail(`'${code}' com cargoPolicy invalido`);
  if (originFormDesc === destinationFormDesc) fail(`'${code}' usa a mesma origem e destino`);

  const definition = Object.freeze({
    code, label: label.trim(), boardFormDesc,
    originFormDesc, originLabel: originLabel.trim(),
    destinationFormDesc, destinationLabel: destinationLabel.trim(),
    rewardAmount, timeLimitSeconds, cooldownSeconds, cooldownGroup, cargoPolicy
  });
  _definitions.set(code, definition);
  return definition;
}

function get(code) { return _definitions.get(code) || null; }
function list() { return [..._definitions.values()]; }
function listByBoard(boardFormDesc) {
  return list().filter(definition => definition.boardFormDesc === boardFormDesc);
}
function _reset() { _definitions.clear(); }

module.exports = { CARGO_POLICIES, register, get, list, listByBoard, _reset };
