/**
 * Persistent localStorage cache with TTL for slow GC Match GET/list responses.
 */
(function (global) {
  const PREFIX = "opm_gcmatch_";

  function ttlMs() {
    const cfg = global.OPM_CONFIG || {};
    return cfg.CACHE_TTL_MS ?? 24 * 60 * 60 * 1000;
  }

  function get(key) {
    try {
      const raw = global.localStorage?.getItem(PREFIX + key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (!entry || Date.now() > entry.expires) {
        global.localStorage?.removeItem(PREFIX + key);
        return null;
      }
      return entry.data;
    } catch {
      return null;
    }
  }

  function set(key, data) {
    try {
      global.localStorage?.setItem(
        PREFIX + key,
        JSON.stringify({
          data,
          expires: Date.now() + ttlMs(),
          savedAt: new Date().toISOString(),
        })
      );
    } catch (err) {
      console.warn("[OPM] Cache write failed:", key, err);
    }
  }

  function remove(key) {
    try {
      global.localStorage?.removeItem(PREFIX + key);
    } catch {
      /* ignore */
    }
  }

  function cacheKey(type, ...parts) {
    return [type, ...parts.map((p) => String(p || "").trim())]
      .filter(Boolean)
      .join(":");
  }

  /**
   * Return cached data immediately if present; always try refresh in background.
   * @param {string} key
   * @param {() => Promise<*|null>} fetchFresh
   * @param {{ onData?: (data: *, fromCache: boolean) => void }} [opts]
   */
  async function staleWhileRevalidate(key, fetchFresh, opts = {}) {
    const cached = get(key);
    if (cached != null && opts.onData) {
      opts.onData(cached, true);
    }

    try {
      const fresh = await fetchFresh();
      if (fresh != null) {
        set(key, fresh);
        if (opts.onData) {
          opts.onData(fresh, false);
        }
        return fresh;
      }
    } catch (err) {
      if (cached != null) return cached;
      throw err;
    }

    return cached;
  }

  global.OpmApiCache = {
    get,
    set,
    remove,
    cacheKey,
    staleWhileRevalidate,
  };
})(window);
