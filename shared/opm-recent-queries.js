/**
 * Recent OPM searches — shared via localStorage (full history retained).
 */
(function (global) {
  const STORAGE_KEY = "opm_recent_ticket_queries";
  /** Badges on Search History show this many most recent searches. */
  const RECENT_BADGE_LIMIT = 10;

  const PART_HINT_PATTERNS = [
    /\b(?:part\s*(?:no\.?|number|#)?|p\/n|pn)\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9\-_/]{3,})/i,
    /\b(?:replacement|replace(?:ment)?)\s+for\s+([A-Za-z0-9][A-Za-z0-9\-_/]{3,})/i,
    /\bfor\s+([A-Za-z0-9][A-Za-z0-9\-_/]{4,})\b/i,
  ];

  function looksLikePartNumber(value) {
    const t = String(value || "").trim();
    if (t.length < 4 || t.length > 48) return false;
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

    const root =
      sanitizeApiPart(body.requested_part_number) ||
      sanitizeApiPart(body.obs_sku);
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

    const tokens = raw.match(/[A-Za-z0-9][A-Za-z0-9\-_.]{3,}/g) || [];
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
      sanitizeApiPart(rec.sku) ||
      sanitizeApiPart(rec.entry) ||
      sanitizeApiPart(rec.comparison_table?.recommended_part?.["Part Number"]) ||
      sanitizeApiPart(rec.comparison_table?.recommended?.["Part Number"]) ||
      sanitizeApiPart(rec.comparison_table?.recommended_part?.part_number) ||
      null
    );
  }

  function scoreFromRec(rec) {
    if (!rec || typeof rec !== "object") return null;
    const raw =
      rec.score ??
      rec.sku_result?.aggregate ??
      rec.confidence_score;
    if (raw == null || raw === "") return null;
    return raw;
  }

  function scoreToPercent(score) {
    if (score == null || score === "") return null;
    const n = Number(score);
    if (Number.isNaN(n)) return null;
    if (n <= 1) return Math.round(n * 100);
    return Math.round(n);
  }

  function formatScoreLabel(score) {
    const pct = scoreToPercent(score);
    if (pct == null) return null;
    return `${pct}%`;
  }

  /** Same hue scale as OPM recommendation cards. */
  function matchScoreColor(percent) {
    if (percent == null) return null;
    const p = Math.max(0, Math.min(100, percent));

    let hue;
    if (p < 50) {
      hue = 0;
    } else if (p < 75) {
      hue = 28 + ((p - 50) / 25) * 20;
    } else if (p < 90) {
      hue = 48 + ((p - 75) / 15) * 42;
    } else {
      hue = 90 + ((p - 90) / 10) * 30;
    }

    return `hsl(${Math.round(hue)}, 72%, 38%)`;
  }

  function slimResponse(body) {
    if (!body || typeof body !== "object") return null;

    if (Array.isArray(body.results)) {
      const recommendations = body.results
        .map((rec) => ({
          recommended_part_number: recommendedPartFromRec(rec),
          score: scoreFromRec(rec),
        }))
        .filter((rec) => rec.recommended_part_number);

      return {
        requested_part_number:
          sanitizeApiPart(body.obs_sku) ||
          sanitizeApiPart(body.requested_part_number) ||
          null,
        recommendations,
      };
    }

    const recommendations = Array.isArray(body.recommendations)
      ? body.recommendations
          .map((rec) => ({
            recommended_part_number: recommendedPartFromRec(rec),
            score: scoreFromRec(rec),
          }))
          .filter((rec) => rec.recommended_part_number)
      : [];

    return {
      requested_part_number:
        sanitizeApiPart(body.requested_part_number) ||
        sanitizeApiPart(body.obs_sku) ||
        null,
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

  function repairEntry(item) {
    if (!item) return item;

    const repaired = { ...item };

    if (repaired.response && Array.isArray(repaired.response.results)) {
      repaired.response = slimResponse(repaired.response);
    }

    if (!repaired.partNumber) {
      repaired.partNumber = resolvePartNumber(repaired.text, {
        response: repaired.response,
        apiPartNumber: repaired.apiPartNumber,
      });
    }

    if (!repaired.apiPartNumber && repaired.response) {
      repaired.apiPartNumber =
        partFromRecommendationResponse(repaired.response) || null;
    }

    return repaired;
  }

  function entryPartKey(item) {
    const label = getRequestedLabel(repairEntry(item));
    return normalizePartKey(label || item?.text);
  }

  function add(text, options) {
    const entry = normalizeEntry(text, options);
    if (!entry) return [];

    const list = readStore()
      .filter((item) => item && item.text)
      .map(repairEntry);
    list.unshift(entry);
    writeStore(list);
    return list;
  }

  function getList() {
    const raw = readStore().filter((item) => item && item.text);
    let dirty = false;
    const repaired = raw.map((item) => {
      const next = repairEntry(item);
      if (JSON.stringify(next) !== JSON.stringify(item)) dirty = true;
      return next;
    });
    if (dirty) writeStore(repaired);
    return repaired;
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

  /** Display label for requested part — matches badge fallback logic. */
  function getRequestedLabel(item) {
    if (!item) return "";
    return (
      sanitizeApiPart(item.response?.requested_part_number) ||
      getFillValue(item) ||
      String(item.text || "").trim()
    );
  }

  /** Requested / recommended rows from a stored OPM recommendation response. */
  function getRecommendationRows(entry) {
    if (!entry) return [];

    const requested = getRequestedLabel(entry);
    const raw = entry.response;
    const response =
      raw && Array.isArray(raw.results) ? slimResponse(raw) : raw;

    const recs = response?.recommendations;
    if (!requested || !Array.isArray(recs) || !recs.length) return [];

    return recs.map((rec) => ({
      requested,
      recommended: rec.recommended_part_number || "—",
      score: rec.score ?? null,
    }));
  }

  function formatSearchDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  /** Most recent searches for badges (newest first, max RECENT_BADGE_LIMIT). */
  function getPartNumberList(limit = RECENT_BADGE_LIMIT) {
    const result = [];
    const seen = new Set();

    for (const item of getList()) {
      if (!item?.text) continue;
      const partNumber = getRequestedLabel(item);
      if (!partNumber) continue;
      const key = normalizePartKey(partNumber);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ item, partNumber });
      if (result.length >= limit) break;
    }

    return result;
  }

  /** One row per OPM search — recommendations joined, with search date. */
  function getRecentHistoryRows(limit) {
    const rows = [];
    const items =
      limit == null ? getList() : getList().slice(0, Math.max(0, limit));

    for (const item of items) {
      const requested = getRequestedLabel(item);
      if (!requested) continue;

      const entryRows = getRecommendationRows(item);
      const recommendations = entryRows
        .filter((row) => row.recommended && row.recommended !== "—")
        .map((row) => ({
          partNumber: row.recommended,
          score: row.score ?? null,
        }));

      rows.push({
        requested,
        recommendations,
        searchedAt: formatSearchDate(item.searchedAt),
      });
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
    getRequestedLabel,
    getFillValue,
    looksLikePartNumber,
    formatSearchDate,
    scoreToPercent,
    formatScoreLabel,
    matchScoreColor,
  };
})(window);
