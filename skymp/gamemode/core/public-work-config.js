/** Carrega rotas físicas de Public Work sem aceitar defaults fictícios. */
'use strict';

const fs = require('fs');
const path = require('path');

function defaultPath(environment = process.env.NODE_ENV || 'local') {
  return path.resolve(__dirname, '..', '..', 'config', `public-work.${environment}.json`);
}

/** @param {{filePath?: string, registry?: {register: Function, list: Function, _reset: Function}}} [options] */
function load({ filePath = process.env.PUBLIC_WORK_CONFIG || defaultPath(), registry } = {}) {
  if (!registry || typeof registry.register !== 'function') {
    throw new Error('[public-work-config] registry ausente');
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `[public-work-config] arquivo nao encontrado: ${filePath}. ` +
      'Mantenha ENABLE_PUBLIC_WORK_SERVICE=false ate cadastrar FormDesc reais.'
    );
  }
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (err) { throw new Error(`[public-work-config] JSON invalido em ${filePath}: ${err.message}`); }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('[public-work-config] esperado array nao-vazio de definicoes');
  }
  registry._reset();
  for (const definition of parsed) registry.register(definition);
  return { path: filePath, count: registry.list().length, definitions: registry.list() };
}

module.exports = { defaultPath, load };
