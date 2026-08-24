#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');

const LATENCY_BUCKETS_MS = [25, 50, 100, 250, 500, 1000, 2500, 5000, Infinity];

function usage() {
  return [
    'Uso: node scripts/run-service-soak.js --url <health-url> [--url <url> ...]',
    '  --duration-seconds <n>  duração total (default: 60)',
    '  --workers <n>           clientes concorrentes por URL (default: 5)',
    '  --interval-ms <n>       pausa mínima por worker (default: 1000)',
    '  --timeout-ms <n>        timeout de cada GET (default: 5000)',
    '  --max-error-rate <n>    fração 0..1 que define sucesso (default: 0.01)',
    '  --output <arquivo>      relatório JSON (default: reports/soak-<data>.json)'
  ].join('\n');
}

function parseNumber(value, name, { min, max }) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${name} deve estar entre ${min} e ${max}.`);
  }
  return number;
}

function parseArgs(argv) {
  const options = {
    urls: [], durationSeconds: 60, workers: 5, intervalMs: 1000,
    timeoutMs: 5000, maxErrorRate: 0.01, output: null
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (!arg.startsWith('--') || value === undefined) throw new Error(`Argumento inválido: ${arg}`);
    index++;
    if (arg === '--url') options.urls.push(value);
    else if (arg === '--duration-seconds') options.durationSeconds = parseNumber(value, arg, { min: 1, max: 86400 });
    else if (arg === '--workers') options.workers = parseNumber(value, arg, { min: 1, max: 100 });
    else if (arg === '--interval-ms') options.intervalMs = parseNumber(value, arg, { min: 100, max: 60000 });
    else if (arg === '--timeout-ms') options.timeoutMs = parseNumber(value, arg, { min: 100, max: 60000 });
    else if (arg === '--max-error-rate') options.maxErrorRate = parseNumber(value, arg, { min: 0, max: 1 });
    else if (arg === '--output') options.output = value;
    else throw new Error(`Opção desconhecida: ${arg}`);
  }
  if (options.urls.length === 0) throw new Error('Informe pelo menos um --url.');
  options.urls = [...new Set(options.urls.map((raw) => {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Protocolo não permitido: ${url.protocol}`);
    url.username = '';
    url.password = '';
    return url.toString();
  }))];
  return options;
}

function createStats(url) {
  return {
    url, requests: 0, successes: 0, failures: 0, timeouts: 0,
    statusClasses: {}, errors: {}, latencyBuckets: Object.fromEntries(LATENCY_BUCKETS_MS.map((b) => [String(b), 0])),
    latencyTotalMs: 0, latencyMaxMs: 0
  };
}

function recordLatency(stats, elapsedMs) {
  stats.latencyTotalMs += elapsedMs;
  stats.latencyMaxMs = Math.max(stats.latencyMaxMs, elapsedMs);
  const bucket = LATENCY_BUCKETS_MS.find((limit) => elapsedMs <= limit);
  stats.latencyBuckets[String(bucket)]++;
}

function percentileUpperBound(stats, percentile) {
  if (stats.requests === 0) return null;
  const target = Math.ceil(stats.requests * percentile);
  let count = 0;
  for (const bucket of LATENCY_BUCKETS_MS) {
    count += stats.latencyBuckets[String(bucket)];
    if (count >= target) return Number.isFinite(bucket) ? bucket : null;
  }
  return null;
}

async function probe(url, timeoutMs, stats, fetchImpl = fetch) {
  const started = performance.now();
  stats.requests++;
  try {
    const response = await fetchImpl(url, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json', 'x-request-id': crypto.randomUUID() }
    });
    const statusClass = `${Math.floor(response.status / 100)}xx`;
    stats.statusClasses[statusClass] = (stats.statusClasses[statusClass] || 0) + 1;
    if (response.ok) stats.successes++;
    else stats.failures++;
    await response.body?.cancel();
  } catch (error) {
    stats.failures++;
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    if (timeout) stats.timeouts++;
    const code = timeout ? 'timeout' : (error?.cause?.code || error?.code || error?.name || 'request_error');
    stats.errors[code] = (stats.errors[code] || 0) + 1;
  } finally {
    recordLatency(stats, performance.now() - started);
  }
}

async function runSoak(options, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || fetch;
  const now = dependencies.now || (() => Date.now());
  const sleep = dependencies.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const startedAt = now();
  const deadline = startedAt + options.durationSeconds * 1000;
  const statsByUrl = new Map(options.urls.map((url) => [url, createStats(url)]));

  async function worker(url) {
    while (now() < deadline) {
      const iterationStarted = now();
      await probe(url, options.timeoutMs, statsByUrl.get(url), fetchImpl);
      const remaining = options.intervalMs - (now() - iterationStarted);
      if (remaining > 0 && now() < deadline) await sleep(remaining);
    }
  }

  await Promise.all(options.urls.flatMap((url) =>
    Array.from({ length: options.workers }, () => worker(url))
  ));

  const targets = [...statsByUrl.values()].map((stats) => ({
    ...stats,
    errorRate: stats.requests === 0 ? 1 : stats.failures / stats.requests,
    latencyAverageMs: stats.requests === 0 ? null : stats.latencyTotalMs / stats.requests,
    latencyP95UpperBoundMs: percentileUpperBound(stats, 0.95)
  }));
  const passed = targets.every((target) => target.requests > 0 && target.errorRate <= options.maxErrorRate);
  return {
    schemaVersion: 1,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(now()).toISOString(),
    configuration: {
      durationSeconds: options.durationSeconds, workersPerUrl: options.workers,
      intervalMs: options.intervalMs, timeoutMs: options.timeoutMs,
      maxErrorRate: options.maxErrorRate
    },
    passed,
    targets
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const report = await runSoak(options);
  const output = path.resolve(options.output || path.join('reports', `soak-${report.startedAt.replace(/[:.]/g, '-')}.json`));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  console.log(`[soak] ${report.passed ? 'PASS' : 'FAIL'} — relatório: ${output}`);
  return report.passed ? 0 : 2;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(`[soak] ${error.message}`);
    console.error(usage());
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, probe, runSoak, percentileUpperBound, usage };
