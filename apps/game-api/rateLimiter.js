'use strict';

const DEFAULT_MAX_BUCKETS = 10_000;
const SWEEP_INTERVAL = 256;

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function createMemoryRateLimiter({ now = Date.now, maxBuckets = DEFAULT_MAX_BUCKETS } = {}) {
  const buckets = new Map();
  const bucketLimit = positiveInteger(maxBuckets, DEFAULT_MAX_BUCKETS);
  let operations = 0;

  function sweep(timestamp) {
    for (const [key, bucket] of buckets) {
      if (timestamp - bucket.startedAt >= bucket.windowMs) buckets.delete(key);
    }
  }

  function isRateLimited(key, maxRequests, windowMs) {
    const requestLimit = positiveInteger(maxRequests, 1);
    const resolvedWindowMs = positiveInteger(windowMs, 60_000);
    const timestamp = now();

    operations++;
    if (operations % SWEEP_INTERVAL === 0) sweep(timestamp);

    let bucket = buckets.get(key);
    if (!bucket || timestamp - bucket.startedAt >= bucket.windowMs) {
      if (!bucket && buckets.size >= bucketLimit) {
        buckets.delete(buckets.keys().next().value);
      }
      bucket = { startedAt: timestamp, count: 0, windowMs: resolvedWindowMs };
      buckets.set(key, bucket);
    }

    if (bucket.count >= requestLimit) return true;
    bucket.count++;
    return false;
  }

  return { isRateLimited, size: () => buckets.size };
}

module.exports = { createMemoryRateLimiter, DEFAULT_MAX_BUCKETS };
