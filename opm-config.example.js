/**
 * Copy this file to opm-config.js and set your API endpoint.
 * opm-config.js is optional — defaults apply if the file is missing.
 */
window.OPM_CONFIG = {
  API_BASE_URL: "http://localhost:3050",
  GCMATCH_API_BASE_URL:
    "https://con-gcmatch.blueplant-16804982.westus2.azurecontainerapps.io",
  GCMATCH_USE_SAME_ORIGIN_PROXY: true,
  OPM_DEV_PORT: 8765,
  TOP_N: 3,
  API_KEY: "",
  USE_MOCK_WHEN_UNAVAILABLE: true,
  API_TIMEOUT_MS: 45000,
  API_TIMEOUT_RECOMMEND_MS: 180000,
  CACHE_TTL_MS: 86400000,
  PARTS_DROPDOWN_LIMIT: 150,
};
