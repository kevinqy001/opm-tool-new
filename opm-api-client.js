/**
 * Low-level HTTP helpers for OPM / GC Match APIs.
 */
(function (global) {
  const DEFAULTS = {
    API_BASE_URL: "http://localhost:3050",
    GCMATCH_API_BASE_URL:
      "https://con-gcmatch.blueplant-16804982.westus2.azurecontainerapps.io",
    API_KEY: "",
    API_TIMEOUT_MS: 45000,
    API_TIMEOUT_RECOMMEND_MS: 180000,
  };

  /** GC Match recommend_from_ticket always requests this many results. */
  const RECOMMEND_TOP_N = 3;

  function getGcmatchBaseUrl() {
    const cfg = global.OPM_CONFIG || {};
    const direct = String(
      cfg.GCMATCH_API_BASE_URL || DEFAULTS.GCMATCH_API_BASE_URL
    ).replace(/\/$/, "");

    if (cfg.GCMATCH_USE_SAME_ORIGIN_PROXY === false) {
      return direct;
    }

    // Same-origin /gcmatch proxy only exists on opm-dev-server.py (localhost:8765).
    // GitHub Pages and other static hosts must call the Azure API directly (CORS).
    if (typeof location !== "undefined") {
      const onLocalDev =
        (location.hostname === "localhost" ||
          location.hostname === "127.0.0.1") &&
        Number(location.port) === (cfg.OPM_DEV_PORT ?? 8765);

      if (onLocalDev) {
        return `${location.origin}/gcmatch`;
      }
    }

    return direct;
  }

  function getConfig() {
    const cfg = global.OPM_CONFIG || {};
    return {
      API_BASE_URL: String(cfg.API_BASE_URL || DEFAULTS.API_BASE_URL).replace(
        /\/$/,
        ""
      ),
      GCMATCH_API_BASE_URL: getGcmatchBaseUrl(),
      API_KEY: cfg.API_KEY || "",
    };
  }

  function timeoutMs(override) {
    const cfg = global.OPM_CONFIG || {};
    if (override != null) return override;
    return cfg.API_TIMEOUT_MS ?? DEFAULTS.API_TIMEOUT_MS;
  }

  function headers(forGet = false) {
    const h = { Accept: "application/json" };
    if (!forGet) {
      h["Content-Type"] = "application/json";
    }
    const key = getConfig().API_KEY;
    if (key) h["x-api-key"] = key;
    return h;
  }

  async function request(method, url, body, options = {}) {
    const ms = timeoutMs(options.timeoutMs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);

    const init = {
      method,
      headers: headers(method === "GET"),
      signal: controller.signal,
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    try {
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
            message: `Request timed out after ${Math.round(ms / 1000)} seconds. Try again or use cached data if available.`,
          },
        };
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Normalize FastAPI / GC Match error payloads for UI display. */
  function formatApiError(res) {
    if (res?.timedOut) {
      return res.data?.message || "Request timed out. Please try again.";
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
    const isPartNotFound =
      /no part or series found/i.test(text) || /no parts found/i.test(text);

    if (isPartNotFound) {
      return (
        "The API could not find this part or series in the GC Match database. " +
        "Your input format is fine — try a part number known to work on this environment, " +
        "for example: Need replacement for 2671001wb111kcd"
      );
    }

    if (status >= 500) {
      return text
        ? `Server error (HTTP ${status}): ${text}`
        : `Server error (HTTP ${status}). Please try again later.`;
    }

    if (text) return text;
    return `Request failed (HTTP ${status}).`;
  }

  global.OpmApiClient = {
    formatApiError,
    getConfig,
    /** GC Match GET /series (all series) — avoid on page load; very slow. */
    getGcmatchSeries(options) {
      const base = getConfig().GCMATCH_API_BASE_URL;
      return request("GET", `${base}/series`, undefined, options);
    },
    getGcmatchSeriesByCategory(productCategory, options) {
      const base = getConfig().GCMATCH_API_BASE_URL;
      const q = encodeURIComponent(String(productCategory || "").trim());
      return request("GET", `${base}/series?product_category=${q}`, undefined, options);
    },
    getProductCategories(options) {
      const base = getConfig().GCMATCH_API_BASE_URL;
      return request("GET", `${base}/productCategories`, undefined, options);
    },
    getPartNumbers(productCategory, productSeries, options) {
      const base = getConfig().GCMATCH_API_BASE_URL;
      const cat = encodeURIComponent(String(productCategory || "").trim());
      const ser = encodeURIComponent(String(productSeries || "").trim());
      return request(
        "GET",
        `${base}/partNumbers?product_category=${cat}&product_series=${ser}`,
        undefined,
        options
      );
    },
    getSeries() {
      return request("GET", `${getConfig().API_BASE_URL}/series`);
    },
    getSavedDrafts(search = "") {
      return request("POST", `${getConfig().API_BASE_URL}/savedDrafts`, {
        search,
      });
    },
    searchParts(payload, options) {
      const base = getConfig().GCMATCH_API_BASE_URL;
      const body =
        typeof payload === "string"
          ? { part_number: payload ?? "" }
          : { ...payload };
      const isBrowse =
        body.product_category && body.product_series && !body.part_number;
      const timeout = options?.timeoutMs ?? (isBrowse ? 90000 : undefined);
      return request("POST", `${base}/searchParts`, body, { timeoutMs: timeout });
    },
    recommendFromTicket(ticketText) {
      const cfg = global.OPM_CONFIG || {};
      const base = getGcmatchBaseUrl();
      return request(
        "POST",
        `${base}/recommend_from_ticket/v3`,
        {
          ticket_text: String(ticketText ?? "").trim(),
          top_n: RECOMMEND_TOP_N,
        },
        {
          timeoutMs:
            cfg.API_TIMEOUT_RECOMMEND_MS ?? DEFAULTS.API_TIMEOUT_RECOMMEND_MS,
        }
      );
    },
    RECOMMEND_TOP_N,
  };
})(window);

