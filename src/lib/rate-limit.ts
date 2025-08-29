type Bucket = { count: number; windowStart: number };
const buckets = new Map<string, Bucket>();

export function checkAndConsume(key: string, limit: number, windowMs: number): {
  ok: boolean;
  remaining: number;
  resetIn: number;
} {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { ok: true, remaining: limit - 1, resetIn: windowMs };
  }
  if (bucket.count < limit) {
    bucket.count += 1;
    return { ok: true, remaining: limit - bucket.count, resetIn: windowMs - (now - bucket.windowStart) };
  }
  return { ok: false, remaining: 0, resetIn: windowMs - (now - bucket.windowStart) };
}
