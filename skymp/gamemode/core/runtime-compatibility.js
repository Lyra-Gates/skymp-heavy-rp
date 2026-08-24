'use strict';

function normalizeLoadOrder(value) {
  if (!Array.isArray(value)) return null;
  return value.map(entry => String(entry).trim().toLowerCase());
}

function verifyRuntimeCompatibility(mpApi) {
  if (!mpApi || typeof mpApi.getServerSettings !== 'function') {
    throw new Error('[compat] mp.getServerSettings indisponivel no binario SkyMP.');
  }
  if (typeof mpApi.getEspmLoadOrder !== 'function') {
    throw new Error('[compat] mp.getEspmLoadOrder indisponivel no binario SkyMP.');
  }

  const settings = mpApi.getServerSettings();
  const expected = normalizeLoadOrder(settings && settings.loadOrder);
  const actual = normalizeLoadOrder(mpApi.getEspmLoadOrder());
  if (!expected || expected.length === 0) {
    throw new Error('[compat] server settings sem loadOrder valida.');
  }
  if (!actual || actual.length === 0) {
    throw new Error('[compat] SkyMP nao reportou a load order efetiva.');
  }

  const same = expected.length === actual.length
    && expected.every((plugin, index) => plugin === actual[index]);
  if (!same) {
    throw new Error(
      `[compat] load order efetiva diverge da configurada: esperada=${expected.join(',')} efetiva=${actual.join(',')}`
    );
  }

  return { loadOrder: actual, settings };
}

module.exports = { normalizeLoadOrder, verifyRuntimeCompatibility };
