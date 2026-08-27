'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, afterEach } = require('node:test');
const config = require('./public-work-config');
const registry = require('./public-work-registry');

const tempFiles = [];
function temp(contents) {
  const file = path.join(os.tmpdir(), `public-work-${process.pid}-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(file, contents);
  tempFiles.push(file);
  return file;
}
afterEach(() => {
  registry._reset();
  for (const file of tempFiles.splice(0)) fs.rmSync(file, { force: true });
});

describe('public-work-config', () => {
  it('falha claramente sem arquivo em vez de inventar rota', () => {
    assert.throws(() => config.load({ filePath: path.join(os.tmpdir(), 'nao-existe-public-work.json'), registry }), /ENABLE_PUBLIC_WORK_SERVICE=false/);
  });

  it('carrega somente array não vazio e passa toda validação pelo registry', () => {
    const filePath = temp(JSON.stringify([{
      code: 'hay_delivery', label: 'Levar fardo', boardFormDesc: '100:Skyrim.esm',
      originFormDesc: '101:Skyrim.esm', originLabel: 'Fardos do campo',
      destinationFormDesc: '102:Skyrim.esm', destinationLabel: 'Celeiro principal',
      rewardAmount: 5, timeLimitSeconds: 900, cooldownSeconds: 600,
      cooldownGroup: 'public_delivery', cargoPolicy: 'token'
    }]));
    const result = config.load({ filePath, registry });
    assert.equal(result.count, 1);
    assert.equal(registry.get('hay_delivery').rewardAmount, 5);
  });

  it('recusa JSON vazio, malformado e definição incompleta', () => {
    assert.throws(() => config.load({ filePath: temp('[]'), registry }), /array nao-vazio/);
    assert.throws(() => config.load({ filePath: temp('{'), registry }), /JSON invalido/);
    assert.throws(() => config.load({ filePath: temp('[{"code":"hay_delivery"}]'), registry }), /label/);
  });
});
