/**
 * In-memory JSON cache for OPM pages.
 * Preloads on page load; falls back to mock data when API is unavailable.
 */
(function (global) {
  const MOCK_SERIES = [
    { series_name: "267", obsolete_status: "Active" },
    { series_name: "3100", obsolete_status: "Active" },
    { series_name: "LS-7", obsolete_status: "Obsolete" },
    { series_name: "SRH", obsolete_status: "Active" },
    { series_name: "RFS", obsolete_status: "Active" },
  ];

  const MOCK_SAVED_DRAFTS = [
    {
      id: 1,
      requested_part_number: "2671105WGCT11B0500",
      selected_recommended_part_number: "2671205WGCT11B0500",
      edited_draft: "Demo draft — replace with API data.",
      created_at: "2026-01-15T10:00:00",
    },
  ];

  /** @type {{ series: unknown[], savedDrafts: unknown[] }} */
  const cache = {
    series: [],
    savedDrafts: [],
  };

  /** @type {Record<string, { state: string, error: string|null, source: string|null, loadedAt: string|null }>} */
  const meta = {
    series: { state: "idle", error: null, source: null, loadedAt: null },
    savedDrafts: {
      state: "idle",
      error: null,
      source: null,
      loadedAt: null,
    },
  };

  const readyPromises = {};

  function useMockWhenUnavailable() {
    const cfg = global.OPM_CONFIG || {};
    return cfg.USE_MOCK_WHEN_UNAVAILABLE !== false;
  }

  function normalizeArray(data) {
    return Array.isArray(data) ? data : [];
  }

  function setBucket(key, rows, source) {
    cache[key] = normalizeArray(rows);
    meta[key] = {
      state: "ready",
      error: null,
      source,
      loadedAt: new Date().toISOString(),
    };
    resolveReady(key);
    global.dispatchEvent(
      new CustomEvent("opm:cache-updated", {
        detail: { key, rows: cache[key], meta: { ...meta[key] } },
      })
    );
  }

  function setError(key, error) {
    meta[key] = {
      ...meta[key],
      state: "error",
      error: String(error),
      loadedAt: new Date().toISOString(),
    };
    resolveReady(key);
    global.dispatchEvent(
      new CustomEvent("opm:cache-error", {
        detail: { key, error: meta[key].error },
      })
    );
  }

  function resolveReady(key) {
    if (readyPromises[key]) {
      readyPromises[key].resolve(get(key));
      delete readyPromises[key];
    }
  }

  function detectPage() {
    const fromBody = document.body?.dataset?.opmPage;
    if (fromBody) return fromBody;
    const path = (global.location?.pathname || "").toLowerCase();
    if (path.includes("series-coverage")) return "series-coverage";
    if (path.includes("saved-drafts")) return "saved-drafts";
    if (path.includes("opm-opm") || /opm\.html$/i.test(path)) return "opm";
    return "unknown";
  }

  async function loadSeries() {
    if (meta.series.state === "loading") return whenReady("series");
    if (meta.series.state === "ready") return get("series");

    meta.series.state = "loading";
    try {
      const res = await global.OpmApiClient.getGcmatchSeries();
      if (res.ok) {
        setBucket("series", res.data, "gcmatch-api");
        return cache.series;
      }
      throw new Error(
        res.data?.detail || res.data?.message || `HTTP ${res.status}`
      );
    } catch (err) {
      if (useMockWhenUnavailable()) {
        setBucket("series", MOCK_SERIES, "mock");
        meta.series.error = String(err.message || err);
        return cache.series;
      }
      setError("series", err.message || err);
      cache.series = [];
      return cache.series;
    }
  }

  async function loadSavedDrafts() {
    if (meta.savedDrafts.state === "loading") return whenReady("savedDrafts");
    if (meta.savedDrafts.state === "ready") return get("savedDrafts");

    meta.savedDrafts.state = "loading";
    try {
      const res = await global.OpmApiClient.getSavedDrafts("");
      if (res.ok) {
        setBucket("savedDrafts", res.data, "api");
        return cache.savedDrafts;
      }
      throw new Error(
        res.data?.detail || res.data?.message || `HTTP ${res.status}`
      );
    } catch (err) {
      if (useMockWhenUnavailable()) {
        setBucket("savedDrafts", MOCK_SAVED_DRAFTS, "mock");
        meta.savedDrafts.error = String(err.message || err);
        return cache.savedDrafts;
      }
      setError("savedDrafts", err.message || err);
      cache.savedDrafts = [];
      return cache.savedDrafts;
    }
  }

  const PAGE_LOADERS = {
    "series-coverage": async () => {
      /* Series Coverage uses cached per-category APIs; no full GET /series preload. */
      meta.series.state = "ready";
      meta.series.source = "skipped";
      meta.series.loadedAt = new Date().toISOString();
      return { skipped: true };
    },
    "saved-drafts": async () => {
      /* Search History page filters localStorage history only (no API on Search). */
      return { skipped: true };
    },
    opm: async () => {
      /* OPM recommendations stay on-demand (Get Recommendation). */
      return { skipped: true };
    },
  };

  async function preloadForPage(page) {
    const loader = PAGE_LOADERS[page];
    if (!loader) return { page, loaded: [] };
    await loader();
    return { page, loaded: Object.keys(cache) };
  }

  async function preloadForCurrentPage() {
    const page = detectPage();
    document.body?.setAttribute("data-opm-page", page);
    const result = await preloadForPage(page);
    global.dispatchEvent(
      new CustomEvent("opm:data-ready", { detail: { page, cache: snapshot() } })
    );
    return result;
  }

  function whenReady(key) {
    if (meta[key]?.state === "ready" || meta[key]?.state === "error") {
      return Promise.resolve(get(key));
    }
    if (!readyPromises[key]) {
      readyPromises[key] = {};
      readyPromises[key].promise = new Promise((resolve, reject) => {
        readyPromises[key].resolve = resolve;
        readyPromises[key].reject = reject;
      });
    }
    return readyPromises[key].promise;
  }

  function get(key) {
    if (key === "series") return [...cache.series];
    if (key === "savedDrafts") return [...cache.savedDrafts];
    return snapshot();
  }

  function snapshot() {
    return {
      series: [...cache.series],
      savedDrafts: [...cache.savedDrafts],
      meta: JSON.parse(JSON.stringify(meta)),
    };
  }

  global.OpmDataStore = {
    cache,
    meta,
    detectPage,
    preloadForPage,
    preloadForCurrentPage,
    loadSeries,
    loadSavedDrafts,
    whenReady,
    get,
    snapshot,
  };
})(window);
