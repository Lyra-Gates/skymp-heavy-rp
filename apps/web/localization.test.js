'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const readPublic = (name) => fs.readFileSync(path.join(__dirname, 'public', name), 'utf8');

test('le panel du staff expose son interface en français', () => {
  const html = readPublic('index.html');

  for (const text of [
    '<html lang="fr">',
    'Panel du staff',
    'Tableau de bord',
    'Candidatures',
    'Casiers judiciaires',
    'Journal d’audit'
  ]) {
    assert.ok(html.includes(text), `texte français absent du panel : ${text}`);
  }

  for (const text of ['Painel de Staff', 'Personagens', 'Facções Ativas', 'Presos Ativos', 'Audit Log']) {
    assert.equal(html.includes(text), false, `texte portugais encore visible dans le panel : ${text}`);
  }
});

test('le formulaire de candidature expose son interface en français', () => {
  const html = readPublic('apply.html');

  for (const text of [
    '<html lang="fr">',
    'Candidature à la liste blanche',
    'Se connecter avec Discord',
    'Faiblesses et limites',
    'Envoyer la candidature'
  ]) {
    assert.ok(html.includes(text), `texte français absent du formulaire : ${text}`);
  }

  for (const text of ['Aplicação de Whitelist', 'Entrar com Discord', 'Enviar Aplicação']) {
    assert.equal(html.includes(text), false, `texte portugais encore visible dans le formulaire : ${text}`);
  }
});
