/** Beleefde HTTP-client: robots.txt, rate limiting per host, retries met backoff. */
import { isAllowed, crawlDelay } from './robots.mjs';

export const DEFAULT_USER_AGENT =
  'BabyprijsBot/1.0 (prijsvergelijker voor babyproducten; +https://github.com/geobrein/baby)';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

export class Fetcher {
  constructor(options = {}) {
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.defaultDelayMs = options.defaultDelayMs ?? 3000;
    this.timeoutMs = options.timeoutMs ?? 20000;
    this.maxRetries = options.maxRetries ?? 2;
    this.respectRobots = options.respectRobots !== false;
    this.log = options.log ?? (() => {});
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.lastRequestAt = new Map();
    this.robotsCache = new Map();
  }

  /** Wacht tot de host weer aan de beurt is. */
  async #throttle(host, delayMs) {
    const wait = delayMs ?? this.defaultDelayMs;
    const last = this.lastRequestAt.get(host) ?? 0;
    const elapsed = Date.now() - last;
    if (elapsed < wait) await sleep(wait - elapsed);
    this.lastRequestAt.set(host, Date.now());
  }

  async #robots(origin) {
    if (this.robotsCache.has(origin)) return this.robotsCache.get(origin);
    const promise = (async () => {
      try {
        const res = await this.fetchImpl(`${origin}/robots.txt`, {
          headers: { 'user-agent': this.userAgent, accept: 'text/plain,*/*' },
          signal: AbortSignal.timeout(this.timeoutMs),
          redirect: 'follow',
        });
        if (!res.ok) return '';
        return await res.text();
      } catch {
        return '';
      }
    })();
    this.robotsCache.set(origin, promise);
    return promise;
  }

  /**
   * Haalt een URL op als tekst.
   * @returns {Promise<{ok: boolean, status: number|null, body: string|null, url: string, error: string|null}>}
   */
  async text(url, { delayMs } = {}) {
    let target;
    try {
      target = new URL(url);
    } catch {
      return { ok: false, status: null, body: null, url, error: 'ongeldige URL' };
    }
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      return { ok: false, status: null, body: null, url, error: 'protocol niet toegestaan' };
    }

    let wait = delayMs ?? this.defaultDelayMs;
    if (this.respectRobots) {
      const robots = await this.#robots(target.origin);
      if (!isAllowed(robots, target.pathname + target.search, this.userAgent)) {
        this.log(`robots.txt verbiedt ${url}`);
        return { ok: false, status: null, body: null, url, error: 'geblokkeerd door robots.txt' };
      }
      const declared = crawlDelay(robots, this.userAgent);
      if (declared) wait = Math.max(wait, declared * 1000);
    }

    let lastError = 'onbekende fout';
    let lastStatus = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      await this.#throttle(target.host, wait);
      try {
        const res = await this.fetchImpl(target.href, {
          headers: {
            'user-agent': this.userAgent,
            accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
            'accept-language': 'nl-NL,nl;q=0.9,en;q=0.6',
          },
          signal: AbortSignal.timeout(this.timeoutMs),
          redirect: 'follow',
        });
        lastStatus = res.status;
        if (res.ok) {
          return { ok: true, status: res.status, body: await res.text(), url: res.url || target.href, error: null };
        }
        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number.parseFloat(res.headers.get('retry-after') ?? '');
          const backoff = Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000 * 2 ** attempt;
          lastError = `HTTP ${res.status}`;
          if (attempt < this.maxRetries) {
            this.log(`${lastError} voor ${url}, opnieuw over ${Math.round(backoff / 1000)}s`);
            await sleep(backoff);
            continue;
          }
        } else {
          return { ok: false, status: res.status, body: null, url: target.href, error: `HTTP ${res.status}` };
        }
      } catch (err) {
        lastError = err?.name === 'TimeoutError' ? 'timeout' : (err?.message ?? String(err));
        if (attempt < this.maxRetries) {
          const backoff = 2000 * 2 ** attempt;
          this.log(`${lastError} voor ${url}, opnieuw over ${Math.round(backoff / 1000)}s`);
          await sleep(backoff);
          continue;
        }
      }
    }
    return { ok: false, status: lastStatus, body: null, url: target.href, error: lastError };
  }
}
