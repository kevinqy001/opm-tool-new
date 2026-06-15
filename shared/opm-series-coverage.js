/**
 * Series Coverage — category / series / part filters with persistent cache.
 * Table and status are part-number based (from GET /partNumbers per series).
 */
(function () {
  const MSG_READY =
    "Select product category and series, then click Search to list part numbers and status.";
  const MSG_NEED_CATEGORY =
    "Select a product category, then choose a product series and click Search.";
  const MSG_NEED_SERIES =
    "Select a product series, then click Search to list part numbers in that series.";
  const MSG_PARTS_LOADING =
    "Part numbers for this series are still loading. Wait a moment and click Search again.";

  const CAT_PLACEHOLDER = "Select product category…";
  const SERIES_PLACEHOLDER = "Select product series…";
  const PART_PLACEHOLDER = "Select part number…";

  let lastDataSource = "ready";
  let categoriesRefreshHint = "";

  /** @type {Map<string, { series_name: string, obsolete_status?: string }[]>} */
  const seriesRowsByCategory = new Map();

  /** @type {Map<string, { part_number: string, obsolete_status?: string }[]>} */
  const partsByCategorySeries = new Map();

  function partsKey(category, seriesName) {
    return `${category}::${seriesName}`;
  }

  function partsLimit() {
    return window.OPM_CONFIG?.PARTS_DROPDOWN_LIMIT ?? 150;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function formatObsoleteStatus(status) {
    if (status == null || status === "") return "—";
    const s = String(status).toLowerCase();
    if (s === "obsolete") return "Obsolete";
    if (s === "active") return "Active";
    return String(status);
  }

  function clearSelect(select, placeholder) {
    if (!select) return;
    select.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = placeholder;
    select.appendChild(opt);
  }

  function fillSelect(select, items, placeholder) {
    clearSelect(select, placeholder);
    items.forEach(({ value, label }) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      select.appendChild(opt);
    });
  }

  /** Rebuild options but keep the current value when it still exists (async refresh safe). */
  function fillSelectPreserve(select, items, placeholder) {
    if (!select) return false;
    const previous = select.value;
    fillSelect(select, items, placeholder);
    if (previous && items.some((item) => item.value === previous)) {
      select.value = previous;
      return true;
    }
    return false;
  }

  function parseCategoriesResponse(data) {
    if (!data) return [];
    if (Array.isArray(data.Categories)) {
      return data.Categories.map((row) => {
        const name =
          row?.Categories ?? row?.categories ?? row?.name ?? row?.category ?? "";
        return String(name).trim();
      }).filter(Boolean);
    }
    if (Array.isArray(data.categories)) {
      return data.categories.map((c) => String(c).trim()).filter(Boolean);
    }
    return [];
  }

  function normalizeSeriesRows(data) {
    return (Array.isArray(data) ? data : [])
      .filter((row) => row && row.series_name)
      .map((row) => ({
        series_name: String(row.series_name),
        obsolete_status: row.obsolete_status,
        product_category: row.product_category,
      }));
  }

  function normalizePartsFromResponse(data) {
    if (!data) return [];
    if (Array.isArray(data)) {
      return data.map(partRowFromPayload).filter((p) => p.part_number);
    }
    const list = Array.isArray(data.parts)
      ? data.parts
      : Array.isArray(data.part_numbers)
        ? data.part_numbers
        : data.part_number
          ? [data]
          : [];
    return list.map(partRowFromPayload).filter((p) => p.part_number);
  }

  function partRowFromPayload(p) {
    if (typeof p === "string") {
      const part_number = p.trim();
      return { part_number, obsolete_status: undefined };
    }
    if (!p || typeof p !== "object") {
      return { part_number: "", obsolete_status: undefined };
    }
    return {
      part_number: String(p.part_number || p.Part_Number || "").trim(),
      obsolete_status: p.obsolete_status,
    };
  }

  /** Support legacy cache entries that stored only part number strings. */
  function normalizeCachedParts(cached) {
    if (!Array.isArray(cached)) return [];
    if (!cached.length) return [];
    if (typeof cached[0] === "string") {
      return cached
        .map((pn) => String(pn).trim())
        .filter(Boolean)
        .map((part_number) => ({ part_number, obsolete_status: undefined }));
    }
    return cached
      .map((p) => ({
        part_number: String(p?.part_number || "").trim(),
        obsolete_status: p?.obsolete_status,
      }))
      .filter((p) => p.part_number);
  }

  function setHintExtra(extra) {
    const hint = document.getElementById("series-data-source");
    if (!hint) return;
    const src =
      lastDataSource === "cache"
        ? "cached data"
        : lastDataSource === "cache-refreshed"
          ? "cache updated from API"
          : lastDataSource === "api"
            ? "live API"
            : "";
    hint.textContent = [MSG_READY, src, categoriesRefreshHint, extra]
      .filter(Boolean)
      .join(" — ");
  }

  function renderTableBody(message, isEmptyState = true) {
    const tbody = document.querySelector(".opm-table tbody");
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="2" class="opm-table__empty">${escapeHtml(message)}</td></tr>`;
    if (isEmptyState) {
      tbody.dataset.state = "placeholder";
    } else {
      delete tbody.dataset.state;
    }
  }

  function renderTable(rows, searchTerm, context = {}) {
    const tbody = document.querySelector(".opm-table tbody");
    if (!tbody) return;

    if (!rows.length) {
      const q = (searchTerm || "").trim();
      renderTableBody(
        q
          ? `No part numbers matching "${q}". Adjust filters or search text.`
          : context.partNumber
            ? `Part number "${context.partNumber}" was not found in this series.`
            : "No part numbers to display for the current filters.",
        true
      );
      return;
    }

    tbody.innerHTML = rows
      .map(
        (row) => `<tr>
          <td>${escapeHtml(row.part_number ?? "—")}</td>
          <td>${escapeHtml(formatObsoleteStatus(row.obsolete_status))}</td>
        </tr>`
      )
      .join("");
    delete tbody.dataset.state;

    const q = (searchTerm || "").trim();
    const hint = document.getElementById("series-data-source");
    if (hint) {
      const src =
        lastDataSource === "cache" || lastDataSource === "cache-refreshed"
          ? "cached/API"
          : "API";
      const scope = context.seriesName
        ? ` in series "${context.seriesName}"`
        : "";
      hint.textContent = q
        ? `Showing ${rows.length} part number(s) matching "${q}"${scope} (${src})`
        : `Showing ${rows.length} part number(s)${scope} (${src})`;
    }
  }

  function filterPartRows(parts, term, filterPartNumber) {
    let result = [...parts];

    if (filterPartNumber) {
      result = result.filter((p) => p.part_number === filterPartNumber);
    }

    const q = (term || "").trim().toLowerCase();
    if (!q) return result;

    return result.filter((p) =>
      String(p.part_number || "")
        .toLowerCase()
        .includes(q)
    );
  }

  function applySeriesRows(category, rows, source) {
    seriesRowsByCategory.set(category, rows);
    lastDataSource = source;
  }

  function applyPartsRows(category, seriesName, parts, source) {
    partsByCategorySeries.set(partsKey(category, seriesName), parts);
    lastDataSource = source;
  }

  function initProductFilters(onFilterChange, onPartsLoaded) {
    const categorySelect = document.getElementById("series-filter-category");
    const seriesSelect = document.getElementById("series-filter-series");
    const partSelect = document.getElementById("series-filter-part");
    const cache = window.OpmApiCache;
    const api = window.OpmApiClient;

    if (!categorySelect || !seriesSelect || !partSelect || !cache || !api) {
      return;
    }

    if (categorySelect.dataset.opmFiltersBound === "1") {
      return;
    }
    categorySelect.dataset.opmFiltersBound = "1";

    let suppressFilterChange = false;
    let categoriesLoadId = 0;
    let seriesLoadId = 0;
    let partsLoadId = 0;
    let loadedSeriesCategory = "";
    let loadedPartsKey = "";

    function withSuppressedFilterChange(fn) {
      suppressFilterChange = true;
      try {
        fn();
      } finally {
        suppressFilterChange = false;
      }
    }

    function notifyFilterChange() {
      if (!suppressFilterChange) onFilterChange();
    }

    clearSelect(categorySelect, "Loading categories…");
    clearSelect(seriesSelect, SERIES_PLACEHOLDER);
    clearSelect(partSelect, PART_PLACEHOLDER);
    seriesSelect.disabled = true;
    partSelect.disabled = true;

    function fillCategoryDropdown(names) {
      const items = names
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
        .map((name) => ({ value: name, label: name }));
      withSuppressedFilterChange(() => {
        fillSelectPreserve(categorySelect, items, CAT_PLACEHOLDER);
      });
    }

    async function fetchCategoriesFromApi() {
      const res = await api.getProductCategories();
      if (!res.ok) {
        if (res.timedOut) throw new Error(api.formatApiError(res));
        throw new Error(
          res.data?.detail || res.data?.message || `HTTP ${res.status}`
        );
      }
      return parseCategoriesResponse(res.data);
    }

    async function loadCategories() {
      const key = cache.cacheKey("categories");
      const loadId = ++categoriesLoadId;

      try {
        await cache.staleWhileRevalidate(key, fetchCategoriesFromApi, {
          onData(names, fromCache) {
            if (loadId !== categoriesLoadId || !names?.length) return;
            fillCategoryDropdown(names);
            categoriesRefreshHint = fromCache
              ? "categories from cache; refreshing…"
              : "";
            setHintExtra(categoriesRefreshHint);
            if (!fromCache) categoriesRefreshHint = "";
          },
        });
      } catch (err) {
        console.error(err);
        if (loadId !== categoriesLoadId) return;
        const fallback = cache.get(key);
        if (fallback?.length) {
          fillCategoryDropdown(fallback);
          setHintExtra("categories from cache (API unavailable)");
        } else {
          withSuppressedFilterChange(() => {
            clearSelect(categorySelect, "Categories unavailable");
          });
        }
      }
    }

    async function fetchSeriesFromApi(category) {
      const res = await api.getGcmatchSeriesByCategory(category);
      if (!res.ok) {
        if (res.timedOut) throw new Error(api.formatApiError(res));
        throw new Error(
          res.data?.detail || res.data?.message || `HTTP ${res.status}`
        );
      }
      return normalizeSeriesRows(res.data);
    }

    function seriesItemsFromRows(rows) {
      return rows
        .map((row) => ({
          value: row.series_name,
          label: row.series_name,
        }))
        .sort((a, b) =>
          a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
        );
    }

    async function loadSeriesForCategory(category) {
      const loadId = ++seriesLoadId;
      const categoryChanged = category !== loadedSeriesCategory;

      if (!category) {
        loadedSeriesCategory = "";
        withSuppressedFilterChange(() => {
          clearSelect(seriesSelect, SERIES_PLACEHOLDER);
          seriesSelect.disabled = true;
          clearSelect(partSelect, PART_PLACEHOLDER);
          partSelect.disabled = true;
        });
        return;
      }

      if (categoryChanged) {
        loadedSeriesCategory = category;
        withSuppressedFilterChange(() => {
          clearSelect(seriesSelect, "Loading series…");
          seriesSelect.disabled = true;
          clearSelect(partSelect, PART_PLACEHOLDER);
          partSelect.disabled = true;
        });
      }

      const mem = seriesRowsByCategory.get(category);
      if (mem?.length) {
        const items = seriesItemsFromRows(mem);
        withSuppressedFilterChange(() => {
          fillSelectPreserve(seriesSelect, items, SERIES_PLACEHOLDER);
          seriesSelect.disabled = false;
        });
      }

      const key = cache.cacheKey("series", category);

      try {
        await cache.staleWhileRevalidate(key, () => fetchSeriesFromApi(category), {
          onData(rows, fromCache) {
            if (loadId !== seriesLoadId) return;
            if (categorySelect.value !== category) return;

            if (!rows?.length && !mem?.length) {
              withSuppressedFilterChange(() => {
                clearSelect(seriesSelect, "No series found");
                seriesSelect.disabled = true;
              });
              return;
            }
            if (rows?.length) {
              applySeriesRows(
                category,
                rows,
                fromCache ? "cache" : "cache-refreshed"
              );
              const items = seriesItemsFromRows(rows);
              withSuppressedFilterChange(() => {
                fillSelectPreserve(seriesSelect, items, SERIES_PLACEHOLDER);
                seriesSelect.disabled = false;
              });
            }
          },
        });
      } catch (err) {
        console.error(err);
        if (loadId !== seriesLoadId || categorySelect.value !== category) return;
        if (!mem?.length) {
          withSuppressedFilterChange(() => {
            clearSelect(
              seriesSelect,
              err.message?.includes("timed out")
                ? "Series load timed out"
                : "Series unavailable"
            );
            seriesSelect.disabled = true;
          });
        }
      }
    }

    async function fetchPartsFromApi(category, seriesName) {
      const res = await api.getPartNumbers(category, seriesName, {
        timeoutMs: 90000,
      });
      if (res.ok) {
        const fromGet = normalizePartsFromResponse(res.data);
        if (fromGet.length) return fromGet;
      } else if (res.timedOut) {
        throw new Error(api.formatApiError(res));
      }

      const fallback = await api.searchParts(
        { product_category: category, product_series: seriesName },
        { timeoutMs: 90000 }
      );
      if (!fallback.ok) {
        if (res.ok) return [];
        if (fallback.timedOut) throw new Error(api.formatApiError(fallback));
        throw new Error(
          fallback.data?.detail ||
            fallback.data?.message ||
            res.data?.detail ||
            res.data?.message ||
            `HTTP ${fallback.status}`
        );
      }
      return normalizePartsFromResponse(fallback.data);
    }

    async function loadPartsForSeries(category, seriesName) {
      const loadId = ++partsLoadId;
      const pk = partsKey(category, seriesName);
      const partsTargetChanged = pk !== loadedPartsKey;

      if (!category || !seriesName) {
        loadedPartsKey = "";
        withSuppressedFilterChange(() => {
          clearSelect(partSelect, PART_PLACEHOLDER);
          partSelect.disabled = true;
        });
        return;
      }

      if (partsTargetChanged) {
        loadedPartsKey = pk;
        withSuppressedFilterChange(() => {
          clearSelect(partSelect, "Loading part numbers…");
          partSelect.disabled = true;
        });
      }

      const key = cache.cacheKey("parts", category, seriesName);
      const limit = partsLimit();

      function applyPartList(parts, fromCache) {
        if (loadId !== partsLoadId) return;
        if (
          categorySelect.value !== category ||
          seriesSelect.value !== seriesName
        ) {
          return;
        }

        applyPartsRows(category, seriesName, parts, fromCache ? "cache" : "api");

        if (!parts.length) {
          withSuppressedFilterChange(() => {
            clearSelect(partSelect, "No part numbers in this series");
            partSelect.disabled = true;
          });
          return;
        }
        const slice = parts.slice(0, limit);
        const items = slice.map((p) => ({
          value: p.part_number,
          label: p.part_number,
        }));
        let placeholder = PART_PLACEHOLDER;
        if (parts.length > limit) {
          placeholder = `First ${limit} of ${parts.length} part numbers…`;
        }
        withSuppressedFilterChange(() => {
          fillSelectPreserve(partSelect, items, placeholder);
          partSelect.disabled = false;
        });
        if (parts.length > limit && fromCache === false) {
          setHintExtra(`part number dropdown capped at ${limit}`);
        }
        onPartsLoaded?.();
      }

      const cached = normalizeCachedParts(cache.get(key));
      if (cached.length) {
        applyPartList(cached, true);
      }

      try {
        await cache.staleWhileRevalidate(
          key,
          () => fetchPartsFromApi(category, seriesName),
          {
            onData(parts, fromCache) {
              if (loadId !== partsLoadId) return;
              if (
                categorySelect.value !== category ||
                seriesSelect.value !== seriesName
              ) {
                return;
              }
              const normalized = normalizeCachedParts(parts);
              if (normalized.length) {
                applyPartList(normalized, fromCache);
              } else if (!cached.length) {
                partsByCategorySeries.delete(pk);
                withSuppressedFilterChange(() => {
                  clearSelect(partSelect, "No part numbers found");
                  partSelect.disabled = true;
                });
              }
            },
          }
        );
      } catch (err) {
        console.error(err);
        if (loadId !== partsLoadId) return;
        if (
          categorySelect.value !== category ||
          seriesSelect.value !== seriesName
        ) {
          return;
        }
        if (!cached.length) {
          withSuppressedFilterChange(() => {
            clearSelect(
              partSelect,
              err.message?.includes("timed out")
                ? "Part numbers load timed out"
                : "Part numbers unavailable"
            );
            partSelect.disabled = true;
          });
        }
      }
    }

    loadCategories();

    categorySelect.addEventListener("change", () => {
      if (suppressFilterChange) return;
      const category = categorySelect.value;
      withSuppressedFilterChange(() => {
        seriesSelect.value = "";
        partSelect.value = "";
      });
      loadSeriesForCategory(category);
      notifyFilterChange();
    });

    seriesSelect.addEventListener("change", () => {
      if (suppressFilterChange) return;
      const category = categorySelect.value;
      const seriesName = seriesSelect.value;
      withSuppressedFilterChange(() => {
        partSelect.value = "";
      });
      loadPartsForSeries(category, seriesName);
      notifyFilterChange();
    });

    partSelect.addEventListener("change", () => {
      if (suppressFilterChange) return;
      const searchInput = document.getElementById("series-search");
      const pn = partSelect.value;
      if (searchInput) {
        searchInput.value = pn || "";
      }
      notifyFilterChange();
    });
  }

  function init() {
    const searchInput = document.getElementById("series-search");
    const form =
      document.getElementById("series-search-form") ||
      searchInput?.closest("form");
    const searchBtn =
      document.getElementById("series-search-btn") ||
      form?.querySelector('button[type="submit"]');

    let hasSearched = false;

    function getFilterState() {
      return {
        category: document.getElementById("series-filter-category")?.value || "",
        seriesName: document.getElementById("series-filter-series")?.value || "",
        partNumber: document.getElementById("series-filter-part")?.value || "",
      };
    }

    function getPartsForSeries(category, seriesName) {
      return partsByCategorySeries.get(partsKey(category, seriesName)) || [];
    }

    function runSearch() {
      hasSearched = true;
      const { category, seriesName, partNumber } = getFilterState();

      if (!category) {
        renderTableBody(MSG_NEED_CATEGORY, true);
        return;
      }

      if (!seriesName) {
        renderTableBody(MSG_NEED_SERIES, true);
        return;
      }

      const parts = getPartsForSeries(category, seriesName);
      if (!parts.length) {
        renderTableBody(MSG_PARTS_LOADING, true);
        return;
      }

      let term = searchInput?.value ?? "";
      const termTrimmed = term.trim();
      const usePartFilter = Boolean(partNumber && !termTrimmed);

      if (usePartFilter) {
        term = partNumber;
        if (searchInput) searchInput.value = partNumber;
      }

      const filtered = filterPartRows(
        parts,
        term,
        usePartFilter ? partNumber : null
      );
      renderTable(filtered, term, { category, seriesName, partNumber });
    }

    function runDownload() {
      const { category, seriesName, partNumber } = getFilterState();
      if (!category || !seriesName) return;

      const parts = getPartsForSeries(category, seriesName);
      if (!parts.length) return;

      const term = searchInput?.value ?? "";
      const usePartFilter = Boolean(partNumber && !term.trim());
      const rows = filterPartRows(
        parts,
        usePartFilter ? partNumber : term,
        usePartFilter ? partNumber : null
      );
      const csv = [
        "Part Number,Status",
        ...rows.map(
          (r) =>
            `"${String(r.part_number || "").replace(/"/g, '""')}","${formatObsoleteStatus(r.obsolete_status).replace(/"/g, '""')}"`
        ),
      ].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "series-coverage-parts.csv";
      a.click();
      URL.revokeObjectURL(a.href);
    }

    initProductFilters(
      () => {
        if (hasSearched) runSearch();
      },
      () => {
        if (hasSearched) runSearch();
      }
    );

    if (searchInput) searchInput.disabled = false;
    if (searchBtn) searchBtn.disabled = false;
    renderTableBody(MSG_READY, true);
    setHintExtra("");

    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      runSearch();
    });

    searchBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      runSearch();
    });

    document.getElementById("series-download-btn")?.addEventListener("click", runDownload);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
