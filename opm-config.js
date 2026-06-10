/**
 * API settings for the OPM demo UI.
 * Copy from opm-config.example.js when resetting; do not commit secrets if your repo is public.
 */
window.OPM_CONFIG = {
  API_BASE_URL: "http://localhost:3050",
  GCMATCH_API_BASE_URL:
    "https://con-gcmatch.blueplant-16804982.westus2.azurecontainerapps.io",
  /** Route GC Match via opm-dev-server.py (/gcmatch proxy) on localhost only. */
  GCMATCH_USE_SAME_ORIGIN_PROXY: true,
  OPM_DEV_PORT: 8765,
  TOP_N: 3,
  API_KEY: "15593112-974f-4e39-893f-5a7c5e4756a1",
  USE_MOCK_WHEN_UNAVAILABLE: true,
  /** Default fetch timeout for browse/search APIs (ms) */
  API_TIMEOUT_MS: 45000,
  /** OPM recommend_from_ticket can take 1–2+ minutes */
  API_TIMEOUT_RECOMMEND_MS: 180000,
  /** localStorage cache TTL for categories / series / part lists (ms) */
  CACHE_TTL_MS: 86400000,
  /** Max part numbers in Series Coverage dropdown (API may return 200+) */
  PARTS_DROPDOWN_LIMIT: 150,
};
