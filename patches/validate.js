#!/usr/bin/env node
/**
 * Valida `patches/manifest.json`.
 *
 * O ponto não é checar tipo por checar. É que um registro de patch incompleto
 * é pior que nenhum: ele parece controle e não é. Os dois campos que existem
 * por experiência do ecossistema, e não por gosto por schema, são:
 *
 * - `loss_condition`, porque patch que some em silêncio vira bug novo meses
 *   depois sem ninguém ligar uma coisa à outra;
 * - `upstream_pr`, que aceita `null` mas exige `notes` explicando — patch que
 *   deveria virar PR e nunca vira é um fork começando devagar.
 *
 * Sem dependências de propósito: roda na CI com `node patches/validate.js`,
 * sem `npm ci`.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const TARGETS = ['skymp', 'skyrim-platform'];

const REQUIRED_STRINGS = [
  'id', 'target', 'file', 'upstream_commit', 'reason',
  'impact', 'loss_condition', 'removal_strategy', 'added'
];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Valida o manifesto já parseado. `fileExists` é injetado para o teste não
 * precisar tocar o disco.
 *
 * Devolve `{ ok, errors }` em vez de lançar: um manifesto pode ter vários
 * problemas, e mostrar todos de uma vez economiza rodadas.
 */
function validateManifest(manifest, { fileExists }) {
  const errors = [];
  const err = (msg) => errors.push(msg);

  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, errors: ['manifest.json não é um objeto'] };
  }
  if (manifest.version !== 1) {
    err(`version deve ser 1, veio ${JSON.stringify(manifest.version)}`);
  }
  if (!Array.isArray(manifest.patches)) {
    return { ok: false, errors: errors.concat('patches deve ser uma lista') };
  }

  const seen = new Set();

  manifest.patches.forEach((patch, i) => {
    const label = isNonEmptyString(patch && patch.id) ? `patches[${i}] (${patch.id})` : `patches[${i}]`;

    if (!patch || typeof patch !== 'object') {
      err(`${label}: não é um objeto`);
      return;
    }

    for (const field of REQUIRED_STRINGS) {
      if (!isNonEmptyString(patch[field])) {
        err(`${label}: campo obrigatório "${field}" ausente ou vazio`);
      }
    }

    if (isNonEmptyString(patch.id)) {
      if (seen.has(patch.id)) err(`${label}: id duplicado`);
      seen.add(patch.id);
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(patch.id)) {
        err(`${label}: id deve ser kebab-case`);
      }
    }

    if (patch.target !== undefined && !TARGETS.includes(patch.target)) {
      err(`${label}: target deve ser um de ${TARGETS.join(', ')}`);
    }

    if (isNonEmptyString(patch.file) && !fileExists(patch.file)) {
      err(`${label}: arquivo "${patch.file}" não existe`);
    }

    if (!Array.isArray(patch.files_touched) || patch.files_touched.length === 0) {
      err(`${label}: files_touched deve ser uma lista não vazia`);
    }

    // `test` pode ser null, mas então `notes` precisa justificar. Patch sem
    // teste e sem justificativa é exatamente o que a regra §34 proíbe.
    if (!isNonEmptyString(patch.test) && patch.test !== null) {
      err(`${label}: test deve ser uma string ou null`);
    }
    if (patch.test === null && !isNonEmptyString(patch.notes)) {
      err(`${label}: test é null, então notes precisa explicar por quê`);
    }

    // Idem para upstream_pr: null é aceitável, silêncio não.
    if (!Object.prototype.hasOwnProperty.call(patch, 'upstream_pr')) {
      err(`${label}: upstream_pr é obrigatório (use null com notes se não couber upstream)`);
    } else if (patch.upstream_pr !== null && !isNonEmptyString(patch.upstream_pr)) {
      err(`${label}: upstream_pr deve ser uma URL ou null`);
    } else if (patch.upstream_pr === null && !isNonEmptyString(patch.notes)) {
      err(`${label}: upstream_pr é null, então notes precisa explicar por quê`);
    }

    if (isNonEmptyString(patch.added) && !/^\d{4}-\d{2}-\d{2}$/.test(patch.added)) {
      err(`${label}: added deve ser uma data ISO (AAAA-MM-DD)`);
    }
  });

  return { ok: errors.length === 0, errors };
}

function main() {
  const dir = __dirname;
  const manifestPath = path.join(dir, 'manifest.json');

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    console.error(`[patches] Não consegui ler manifest.json: ${e.message}`);
    process.exit(1);
  }

  const { ok, errors } = validateManifest(manifest, {
    fileExists: (rel) => fs.existsSync(path.join(dir, rel))
  });

  if (!ok) {
    console.error('[patches] manifest.json inválido:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const n = manifest.patches.length;
  console.log(
    n === 0
      ? '[patches] Nenhum patch registrado — é a situação preferida.'
      : `[patches] ${n} patch(es) registrado(s), manifesto válido.`
  );
}

if (require.main === module) main();

module.exports = { validateManifest };
