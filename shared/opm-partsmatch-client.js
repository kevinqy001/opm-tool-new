/**
 * Parts Match API — POST /api/match (preview page).
 */
(function (global) {
  const DEFAULTS = {
    PARTSMATCH_API_BASE_URL:
      "https://ca-partsmatch.wonderfulbay-075ecb42.eastus2.azurecontainerapps.io",
    PARTSMATCH_WORKSPACE_ID: "gems-setra",
    PARTSMATCH_API_TIMEOUT_MS: 120000,
  };

  function getPartsMatchBaseUrl() {
    const cfg = global.OPM_CONFIG || {};
    const direct = String(
      cfg.PARTSMATCH_API_BASE_URL || DEFAULTS.PARTSMATCH_API_BASE_URL
    ).replace(/\/$/, "");

    if (cfg.PARTSMATCH_USE_SAME_ORIGIN_PROXY === false) {
      return direct;
    }

    if (typeof location !== "undefined") {
      const onLocalDev =
        (location.hostname === "localhost" ||
          location.hostname === "127.0.0.1") &&
        Number(location.port) === (cfg.OPM_DEV_PORT ?? 8765);

      if (onLocalDev) {
        return `${location.origin}/partsmatch`;
      }
    }

    return direct;
  }

  function workspaceId() {
    const cfg = global.OPM_CONFIG || {};
    return String(cfg.PARTSMATCH_WORKSPACE_ID || DEFAULTS.PARTSMATCH_WORKSPACE_ID);
  }

  function timeoutMs() {
    const cfg = global.OPM_CONFIG || {};
    return cfg.PARTSMATCH_API_TIMEOUT_MS ?? DEFAULTS.PARTSMATCH_API_TIMEOUT_MS;
  }

  function formatApiError(res) {
    if (res?.timedOut) {
      return (
        res.data?.message ||
        "Request timed out. Please try again."
      );
    }

    if (res?.status === 401) {
      const onLocalProxy =
        typeof location !== "undefined" &&
        (location.hostname === "localhost" ||
          location.hostname === "127.0.0.1") &&
        Number(location.port) === (global.OPM_CONFIG?.OPM_DEV_PORT ?? 8765);

      if (onLocalProxy) {
        return (
          "Parts Match authentication failed (HTTP 401). " +
          "Update .env.partsmatch.local with a fresh AppServiceAuthSession " +
          "(Network → POST /api/match), then restart python opm-dev-server.py. " +
          "Check http://127.0.0.1:8765/partsmatch/_auth-check — if cookie_source " +
          "is wrong, run: Remove-Item Env:PARTSMATCH_AUTH_COOKIE"
        );
      }

      return (
        "Parts Match requires Microsoft sign-in. This static site cannot call the API " +
        "directly — use the shared internal deployment or ask the Parts Match team " +
        "to enable API access for the OPM origin."
      );
    }

    const status = res?.status ?? 0;
    const data = res?.data;
    let detail = data?.detail ?? data?.message ?? data?.error;

    if (Array.isArray(detail)) {
      detail = detail
        .map((item) =>
          typeof item === "string"
            ? item
            : item?.msg || item?.message || JSON.stringify(item)
        )
        .join("; ");
    } else if (detail && typeof detail === "object") {
      detail = detail.message || JSON.stringify(detail);
    }

    const text = detail ? String(detail).trim() : "";
    if (status >= 500) {
      return text
        ? `Server error (HTTP ${status}): ${text}`
        : `Server error (HTTP ${status}). Please try again later.`;
    }
    if (text) return text;
    return `Request failed (HTTP ${status}).`;
  }

  async function fetchJson(path, options = {}) {
    const ms = options.timeoutMs ?? timeoutMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);

    const headers = {
      Accept: "application/json",
      "X-Workspace-Id": workspaceId(),
    };

    const method = options.method || "GET";
    const body = options.body;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const init = {
      method,
      headers,
      signal: controller.signal,
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    if (options.credentials) {
      init.credentials = options.credentials;
    }

    try {
      const url = `${getPartsMatchBaseUrl()}${path}`;
      const response = await fetch(url, init);
      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }
      }

      return {
        ok: response.ok,
        status: response.status,
        data,
      };
    } catch (err) {
      if (err?.name === "AbortError") {
        return {
          ok: false,
          status: 0,
          timedOut: true,
          data: {
            message: `Request timed out after ${Math.round(ms / 1000)} seconds.`,
          },
        };
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function decodePart(sku, options = {}) {
    return fetchJson("/api/decode", {
      ...options,
      method: "POST",
      body: { sku: String(sku ?? "").trim() },
    });
  }

  async function getCatalogLifecycle(options = {}) {
    return fetchJson("/api/catalog/lifecycle", options);
  }

  async function getCatalogEntries(options = {}) {
    return fetchJson("/api/catalog/entries", options);
  }

  async function matchPart(sku, options = {}) {
    return fetchJson("/api/match", {
      ...options,
      method: "POST",
      body: {
        sku: String(sku ?? "").trim(),
        include_obsolete: Boolean(options.includeObsolete),
      },
    });
  }

  async function traceMatch(obsSku, candidateEntries, options = {}) {
    return fetchJson("/api/trace", {
      ...options,
      method: "POST",
      body: {
        obs_sku: String(obsSku ?? "").trim(),
        candidate_entries: (candidateEntries || [])
          .map((entry) => String(entry ?? "").trim())
          .filter(Boolean),
      },
    });
  }

  global.OpmPartsMatchClient = {
    formatApiError,
    fetchJson,
    getPartsMatchBaseUrl,
    getCatalogLifecycle,
    getCatalogEntries,
    decodePart,
    matchPart,
    traceMatch,
    workspaceId,
  };
})(window);
