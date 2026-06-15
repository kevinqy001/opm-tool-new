/**
 * Recent OPM searches — shared via localStorage (full history retained).
 */
(function (global) {
  const STORAGE_KEY = "opm_recent_ticket_queries";
  /** Badges on Search History show this many most recent searches. */
  const RECENT_BADGE_LIMIT = 10;

  const PART_HINT_PATTERNS = [
    /\b(?:part\s*(?:no\.?|number|#)?|p\/n|pn)\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9\-_/]{5,})/i,
    /\b(?:replacement|replace(?:ment)?)\s+for\s+([A-Za-z0-9][A-Za-z0-9\-_/]{5,})/i,
    /\bfor\s+([A-Za-z0-9][A-Za-z0-9\-_/]{8,})\b/i,
  ];

  function looksLikePartNumber(value) {
    const t = String(value || "").trim();
    if (t.length < 6 || t.length > 48) return false;
    if (!/^[A-Za-z0-9][A-Za-z0-9\-_.]*$/.test(t)) return false;
    return /[0-9]/.test(t) && /[A-Za-z]/.test(t);
  }

  function sanitizeApiPart(value) {
    const t = String(value ?? "").trim();
    if (!t || t.length > 64) return "";
    return t;
  }

  /** Part number from recommend_from_ticket API response (authoritative fallback). */
  function partFromRecommendationResponse(body) {
    if (!body || typeof body !== "object") return "";

    const root = sanitizeApiPart(body.requested_part_number);
    if (root) return root;

    const requested =
      body.recommendations?.[0]?.comparison_table?.requested_part;
    if (requested && typeof requested === "object") {
      const fromTable = sanitizeApiPart(
        requested["Part Number"] || requested.part_number
      );
      if (fromTable) return fromTable;
    }

    return "";
  }

  function extractPartNumber(text) {
    const raw = String(text || "").trim();
    if (!raw) return "";

    if (looksLikePartNumber(raw)) return raw;

    for (const pattern of PART_HINT_PATTERNS) {
      const match = raw.match(pattern);
      if (match?.[1] && looksLikePartNumber(match[1])) {
        return match[1];
      }
    }

    const tokens = raw.match(/[A-Za-z0-9][A-Za-z0-9\-_.]{5,}/g) || [];
    const candidates = tokens.filter(looksLikePartNumber);
    if (!candidates.length) return "";

    candidates.sort((a, b) => b.length - a.length);
    return candidates[0];
  }

  /**
   * Resolve fill part: parse query text first, then API response as fallback.
   */
  function resolvePartNumber(query, options = {}) {
    const extracted = extractPartNumber(query);
    if (extracted) return extracted;

    const fromResponse = partFromRecommendationResponse(options.response);
    if (fromResponse) return fromResponse;

    const apiOnly = sanitizeApiPart(options.apiPartNumber);
    if (apiOnly) return apiOnly;

    return null;
  }

  function readStore() {
    try {
      const raw = global.localStorage?.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeStore(items) {
    try {
      global.localStorage?.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (err) {
      console.warn("[OPM] Could not save recent queries:", err);
    }
  }

  function recommendedPartFromRec(rec) {
    if (!rec || typeof rec !== "object") return null;
    return (
      sanitizeApiPart(rec.recommended_part_number) ||
      sanitizeApiPart(rec.comparison_table?.recommended_part?.["Part Number"]) ||
      sanitizeApiPart(rec.comparison_table?.recommended?.["Part Number"]) ||
      sanitizeApiPart(rec.comparison_table?.recommended_part?.part_number) ||
      null
    );
  }

  function slimResponse(body) {
    if (!body || typeof body !== "object") return null;
    const recommendations = Array.isArray(body.recommendations)
      ? body.recommendations
          .map((rec) => ({
            recommended_part_number: recommendedPartFromRec(rec),
          }))
          .filter((rec) => rec.recommended_part_number)
      : [];

    return {
      requested_part_number: sanitizeApiPart(body.requested_part_number) || null,
      recommendations,
    };
  }

  function normalizeEntry(text, options = {}) {
    const query = String(text || "").trim();
    if (!query) return null;

    const opts =
      typeof options === "string" ? { apiPartNumber: options } : options || {};

    const apiPartNumber = partFromRecommendationResponse(opts.response)
      || sanitizeApiPart(opts.apiPartNumber)
      || null;

    return {
      text: query,
      partNumber: resolvePartNumber(query, opts),
      apiPartNumber,
      response: slimResponse(opts.response),
      searchedAt: new Date().toISOString(),
    };
  }

  function add(text, options) {
    const entry = normalizeEntry(text, options);
    if (!entry) return [];

    const list = readStore().filter(
      (item) => item && item.text && item.text !== entry.text
    );
    list.unshift(entry);
    writeStore(list);
    return list;
  }

  function getList() {
    return readStore().filter((item) => item && item.text);
  }

  /** Part number label for Saved Drafts recent badges and search fill. */
  function getPartNumberLabel(item) {
    return getFillValue(item);
  }

  function normalizePartKey(value) {
    return String(value || "").trim().toLowerCase();
  }

  /** Most recent history entry matching a part number (case-insensitive). */
  function findByPartNumber(partNumber) {
    const key = normalizePartKey(partNumber);
    if (!key) return null;

    return (
      getList().find((item) => normalizePartKey(getFillValue(item)) === key) ||
      null
    );
  }

  /** Requested / recommended rows from a stored OPM recommendation response. */
  function getRecommendationRows(entry) {
    if (!entry) return [];

    const requested =
      sanitizeApiPart(entry.response?.requested_part_number) ||
      getFillValue(entry) ||
      "";

    const recs = entry.response?.recommendations;
    if (!requested || !Array.isArray(recs) || !recs.length) return [];

    return recs.map((rec) => ({
      requested,
      recommended: rec.recommended_part_number || "—",
    }));
  }

  /** Most recent searches for badges (newest first, max RECENT_BADGE_LIMIT). */
  function getPartNumberList(limit = RECENT_BADGE_LIMIT) {
    const result = [];

    for (const item of getList()) {
      if (!item?.text) continue;
      const partNumber = getFillValue(item) || String(item.text).trim();
      if (!partNumber) continue;
      result.push({ item, partNumber });
      if (result.length >= limit) break;
    }

    return result;
  }

  /** Flatten OPM searches into requested / recommended table rows (all history by default). */
  function getRecentHistoryRows(limit) {
    const rows = [];
    const items =
      limit == null ? getList() : getList().slice(0, Math.max(0, limit));

    for (const item of items) {
      const entryRows = getRecommendationRows(item);
      if (entryRows.length) {
        rows.push(...entryRows);
        continue;
      }

      const requested = getFillValue(item);
      if (requested) {
        rows.push({ requested, recommended: "—" });
      }
    }

    return rows;
  }

  /** Value for Saved Drafts search — stored resolve, then API fallback, then re-parse. */
  function getFillValue(item) {
    if (!item) return "";

    const stored = item.partNumber && String(item.partNumber).trim();
    if (stored) return stored;

    const api = item.apiPartNumber && String(item.apiPartNumber).trim();
    if (api) return api;

    return extractPartNumber(item.text) || "";
  }

  global.OpmRecentQueries = {
    STORAGE_KEY,
    RECENT_BADGE_LIMIT,
    add,
    getList,
    getPartNumberList,
    getPartNumberLabel,
    findByPartNumber,
    getRecommendationRows,
    getRecentHistoryRows,
    extractPartNumber,
    partFromRecommendationResponse,
    resolvePartNumber,
    getFillValue,
    looksLikePartNumber,
  };
})(window);
