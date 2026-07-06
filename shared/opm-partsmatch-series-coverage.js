/**
 * Series Coverage (dev) — Parts Match catalog lifecycle + SKU decode lookup.
 * Filters: Brand → Class → Entry; table lists part numbers (series prefixes) + status.
 */
(function () {
  const MSG_READY =
    "Select product category and series, or enter a part number and click Search.";
  const MSG_NEED_FILTERS =
    "Select product category and series, or enter a part number to search.";
  const MSG_LOADING = "Catalog is still loading. Wait a moment and click Search again.";
  const MSG_SEARCHING = "Looking up part number…";

  const BRAND_PLACEHOLDER = "Select product category…";
  const CLASS_PLACEHOLDER = "Select product series…";
  const ENTRY_PLACEHOLDER = "Select part number…";

  /** @type {Array<CatalogRow>} */
  let catalogRows = [];
  let lastDataSource = "ready";
  let catalogRefreshHint = "";
  let searchGeneration = 0;

  /**
   * @typedef {Object} CatalogRow
   * @property {string} entry
   * @property {string} brand
   * @property {string} klass
   * @property {string|undefined} status
   * @property {string[]} superseded_by
   * @property {Array<{name?: string, prefixes?: string[]}>} series
   */

  /**
   * @typedef {Object} PartRow
   * @property {string} part_number
   * @property {string|undefined} status
   * @property {string} entry
   * @property {string} brand
   * @property {string} klass
   * @property {string[]} superseded_by
   */

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function formatLifecycleStatus(status) {
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

  function normalizeCatalogPayload(data) {
    const entries = Array.isArray(data?.entries)
      ? data.entries
      : Array.isArray(data)
        ? data
        : [];
    return entries
      .filter((row) => row && row.entry)
      .map((row) => ({
        entry: String(row.entry).trim(),
        brand: String(row.brand || "").trim(),
        klass: String(row.klass || "").trim(),
        status: row.status,
        superseded_by: Array.isArray(row.superseded_by) ? row.superseded_by : [],
        series: Array.isArray(row.series) ? row.series : [],
      }));
  }

  function partNumbersForCatalogRow(row) {
    const prefixes = [];
    for (const series of row.series || []) {
      for (const prefix of series.prefixes || []) {
        const value = String(prefix || "").trim();
        if (value) prefixes.push(value);
      }
    }
    if (!prefixes.length && row.entry) {
      prefixes.push(row.entry);
    }
    return [...new Set(prefixes)];
  }

  /** @param {CatalogRow[]} rows */
  function expandToPartRows(rows) {
    /** @type {PartRow[]} */
    const out = [];
    for (const row of rows) {
      for (const part_number of partNumbersForCatalogRow(row)) {
        out.push({
          part_number,
          status: row.status,
          entry: row.entry,
          brand: row.brand,
          klass: row.klass,
          superseded_by: row.superseded_by || [],
        });
      }
    }
    return out.sort((a, b) =>
      a.part_number.localeCompare(b.part_number, undefined, {
        sensitivity: "base",
      })
    );
  }

  function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }

  function rowsForBrand(brand) {
    return catalogRows.filter((row) => row.brand === brand);
  }

  function rowsForBrandClass(brand, klass) {
    return catalogRows.filter((row) => row.brand === brand && row.klass === klass);
  }

  function findCatalogRowsForSku(sku) {
    const needle = String(sku || "").trim().toLowerCase();
    if (!needle) return [];

    const byPrefix = catalogRows.filter((row) =>
      partNumbersForCatalogRow(row).some(
        (pn) => pn.toLowerCase() === needle
      )
    );
    if (byPrefix.length) return byPrefix;

    return catalogRows.filter(
      (row) => row.entry.toLowerCase() === needle
    );
  }

  function setHintExtra(extra) {
    const hint = document.getElementById("series-data-source");
    if (!hint) return;
    const text = [catalogRefreshHint, extra].filter(Boolean).join(" — ");
    if (!text) {
      hint.hidden = true;
      hint.textContent = "";
      return;
    }
    hint.hidden = false;
    hint.textContent = text;
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

  function renderPartTable(rows, context = {}) {
    const tbody = document.querySelector(".opm-table tbody");
    if (!tbody) return;

    if (!rows.length) {
      const q = (context.searchTerm || "").trim();
      renderTableBody(
        q
          ? `No part numbers matching "${q}". Check the part number or adjust filters.`
          : context.partNumber
            ? `Part number "${context.partNumber}" was not found.`
            : "No part numbers to display for the current filters.",
        true
      );
      return;
    }

    tbody.innerHTML = rows
      .map((row) => {
        const status = formatLifecycleStatus(row.status);
        const successor =
          row.superseded_by?.length > 0
            ? ` → ${escapeHtml(row.superseded_by.join(", "))}`
            : "";
        return `<tr>
          <td>${escapeHtml(row.part_number)}</td>
          <td>${escapeHtml(status)}${successor}</td>
        </tr>`;
      })
      .join("");
    delete tbody.dataset.state;

    const hint = document.getElementById("series-data-source");
    if (hint) {
      const q = (context.searchTerm || "").trim();
      const scope = context.klass
        ? ` in series "${context.klass}"`
        : context.mode === "sku"
          ? ""
          : "";
      hint.textContent = q
        ? `Showing ${rows.length} part number(s) matching "${q}"${scope}`
        : `Showing ${rows.length} part number(s)${scope}`;
      hint.hidden = false;
    }
  }

  function filterPartRows(rows, term, filterPartNumber) {
    let result = [...rows];

    if (filterPartNumber) {
      const needle = filterPartNumber.toLowerCase();
      result = result.filter(
        (row) => row.part_number.toLowerCase() === needle
      );
    }

    const q = (term || "").trim().toLowerCase();
    if (!q) return result;

    return result.filter((row) => {
      const haystack =
        `${row.part_number} ${row.entry} ${row.brand} ${row.klass}`.toLowerCase();
      return haystack.includes(q);
    });
  }

  function initProductFilters(onFilterChange) {
    const brandSelect = document.getElementById("series-filter-category");
    const classSelect = document.getElementById("series-filter-series");
    const entrySelect = document.getElementById("series-filter-part");
    const cache = window.OpmApiCache;
    const api = window.OpmPartsMatchClient;

    if (!brandSelect || !classSelect || !entrySelect || !cache || !api) {
      return;
    }

    if (brandSelect.dataset.opmFiltersBound === "1") {
      return;
    }
    brandSelect.dataset.opmFiltersBound = "1";

    let suppressFilterChange = false;
    let catalogLoadId = 0;

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

    clearSelect(brandSelect, "Loading categories…");
    clearSelect(classSelect, CLASS_PLACEHOLDER);
    clearSelect(entrySelect, ENTRY_PLACEHOLDER);
    classSelect.disabled = true;
    entrySelect.disabled = true;

    function applyCatalogRows(rows, fromCache) {
      catalogRows = rows;
      lastDataSource = fromCache ? "cache" : "cache-refreshed";

      const brands = uniqueSorted(rows.map((row) => row.brand));
      withSuppressedFilterChange(() => {
        fillSelectPreserve(
          brandSelect,
          brands.map((name) => ({ value: name, label: name })),
          BRAND_PLACEHOLDER
        );
      });

      const brand = brandSelect.value;
      if (brand) {
        refreshClassOptions(brand, true);
      }
    }

    function refreshClassOptions(brand, preserve = false) {
      const klasses = uniqueSorted(rowsForBrand(brand).map((row) => row.klass));
      const items = klasses.map((name) => ({ value: name, label: name }));
      withSuppressedFilterChange(() => {
        if (preserve) {
          fillSelectPreserve(classSelect, items, CLASS_PLACEHOLDER);
        } else {
          fillSelect(classSelect, items, CLASS_PLACEHOLDER);
          classSelect.value = "";
        }
        classSelect.disabled = klasses.length === 0;
        clearSelect(entrySelect, ENTRY_PLACEHOLDER);
        entrySelect.disabled = true;
      });
    }

    function refreshEntryOptions(brand, klass, preserve = false) {
      const partRows = expandToPartRows(rowsForBrandClass(brand, klass));
      const items = partRows.map((row) => ({
        value: row.part_number,
        label: row.part_number,
      }));
      withSuppressedFilterChange(() => {
        if (preserve) {
          fillSelectPreserve(entrySelect, items, ENTRY_PLACEHOLDER);
        } else {
          fillSelect(entrySelect, items, ENTRY_PLACEHOLDER);
          entrySelect.value = "";
        }
        entrySelect.disabled = items.length === 0;
      });
    }

    async function fetchCatalogFromApi() {
      const res = await api.getCatalogLifecycle();
      if (!res.ok) {
        throw new Error(api.formatApiError(res));
      }
      const rows = normalizeCatalogPayload(res.data);
      if (!rows.length) {
        throw new Error("Catalog returned no entries.");
      }
      return rows;
    }

    async function loadCatalog() {
      const key = cache.cacheKey("pm-catalog-lifecycle");
      const loadId = ++catalogLoadId;

      try {
        await cache.staleWhileRevalidate(key, fetchCatalogFromApi, {
          onData(rows, fromCache) {
            if (loadId !== catalogLoadId || !rows?.length) return;
            applyCatalogRows(rows, fromCache);
            catalogRefreshHint = fromCache
              ? "catalog from cache; refreshing…"
              : "";
            setHintExtra(catalogRefreshHint);
            if (!fromCache) catalogRefreshHint = "";
          },
        });
      } catch (err) {
        console.error(err);
        if (loadId !== catalogLoadId) return;
        const fallback = normalizeCatalogPayload({ entries: cache.get(key) });
        if (fallback.length) {
          applyCatalogRows(fallback, true);
          setHintExtra("catalog from cache (API unavailable)");
        } else {
          withSuppressedFilterChange(() => {
            clearSelect(brandSelect, "Catalog unavailable");
          });
          setHintExtra(err.message || "Catalog unavailable");
        }
      }
    }

    loadCatalog();

    brandSelect.addEventListener("change", () => {
      if (suppressFilterChange) return;
      const brand = brandSelect.value;
      withSuppressedFilterChange(() => {
        classSelect.value = "";
        entrySelect.value = "";
      });
      if (brand) {
        refreshClassOptions(brand);
      } else {
        classSelect.disabled = true;
        clearSelect(classSelect, CLASS_PLACEHOLDER);
        entrySelect.disabled = true;
        clearSelect(entrySelect, ENTRY_PLACEHOLDER);
      }
      notifyFilterChange();
    });

    classSelect.addEventListener("change", () => {
      if (suppressFilterChange) return;
      const brand = brandSelect.value;
      const klass = classSelect.value;
      withSuppressedFilterChange(() => {
        entrySelect.value = "";
      });
      if (brand && klass) {
        refreshEntryOptions(brand, klass);
      } else {
        entrySelect.disabled = true;
        clearSelect(entrySelect, ENTRY_PLACEHOLDER);
      }
      notifyFilterChange();
    });

    entrySelect.addEventListener("change", () => {
      if (suppressFilterChange) return;
      const searchInput = document.getElementById("series-search");
      const partNumber = entrySelect.value;
      if (searchInput) {
        searchInput.value = partNumber || "";
      }
      notifyFilterChange();
    });

    return {
      syncFiltersFromCatalogRow(row) {
        if (!row) return;
        withSuppressedFilterChange(() => {
          if (row.brand) {
            brandSelect.value = row.brand;
            refreshClassOptions(row.brand, true);
          }
          if (row.klass) {
            classSelect.value = row.klass;
            refreshEntryOptions(row.brand, row.klass, true);
          }
          if (row.part_number) {
            entrySelect.value = row.part_number;
          }
        });
      },
    };
  }

  function init() {
    const searchInput = document.getElementById("series-search");
    const form =
      document.getElementById("series-search-form") ||
      searchInput?.closest("form");
    const searchBtn =
      document.getElementById("series-search-btn") ||
      form?.querySelector('button[type="submit"]');
    const api = window.OpmPartsMatchClient;

    let hasSearched = false;
    let filterApi = null;
    let lastRenderedRows = [];

    function getFilterState() {
      return {
        brand: document.getElementById("series-filter-category")?.value || "",
        klass: document.getElementById("series-filter-series")?.value || "",
        partNumber: document.getElementById("series-filter-part")?.value || "",
      };
    }

    async function resolveSkuSearch(sku) {
      const needle = String(sku || "").trim();
      if (!needle) return [];

      const needleLower = needle.toLowerCase();
      let catalogMatches = findCatalogRowsForSku(needle);

      if (!catalogMatches.length && api) {
        const res = await api.decodePart(needle);
        if (res.ok && res.data?.entry) {
          const entry = String(res.data.entry).trim();
          catalogMatches = catalogRows.filter((row) => row.entry === entry);
        }
      }

      const expanded = expandToPartRows(catalogMatches);
      const exact = expanded.filter(
        (row) => row.part_number.toLowerCase() === needleLower
      );
      if (exact.length) return exact;

      return expanded.filter((row) => row.entry.toLowerCase() === needleLower);
    }

    async function runSearch() {
      hasSearched = true;
      const gen = ++searchGeneration;
      const { brand, klass, partNumber } = getFilterState();
      let term = (searchInput?.value ?? "").trim();
      const usePartFilter = Boolean(partNumber && !term);

      if (usePartFilter) {
        term = partNumber;
        if (searchInput) searchInput.value = partNumber;
      }

      if (!catalogRows.length) {
        renderTableBody(MSG_LOADING, true);
        return;
      }

      const skuLookup = term.length > 0;
      const browseMode = brand && klass && !skuLookup;

      if (!skuLookup && !browseMode) {
        renderTableBody(MSG_NEED_FILTERS, true);
        return;
      }

      if (skuLookup) {
        renderTableBody(MSG_SEARCHING, true);
        try {
          let rows = await resolveSkuSearch(term);
          if (gen !== searchGeneration) return;

          if (!rows.length) {
            renderPartTable([], {
              searchTerm: term,
              mode: "sku",
            });
            return;
          }

          if (brand || klass) {
            rows = rows.filter((row) => {
              if (brand && row.brand !== brand) return false;
              if (klass && row.klass !== klass) return false;
              return true;
            });
          }

          if (!rows.length) {
            renderPartTable([], {
              searchTerm: term,
              mode: "sku",
            });
            return;
          }

          lastDataSource = "decode";
          lastRenderedRows = rows;
          filterApi?.syncFiltersFromCatalogRow(rows[0]);
          renderPartTable(rows, {
            searchTerm: term,
            klass: rows[0]?.klass,
            mode: "sku",
          });
        } catch (err) {
          console.error(err);
          if (gen !== searchGeneration) return;
          renderTableBody(
            err.message || "Part number lookup failed.",
            true
          );
        }
        return;
      }

      const scoped = expandToPartRows(rowsForBrandClass(brand, klass));
      const filtered = filterPartRows(
        scoped,
        "",
        usePartFilter ? partNumber : null
      );
      lastDataSource = "api";
      lastRenderedRows = filtered;
      renderPartTable(filtered, {
        searchTerm: term,
        klass,
        partNumber,
      });
    }

    function runDownload() {
      if (!lastRenderedRows.length) return;

      const csv = [
        "Part Number,Status,Superseded By",
        ...lastRenderedRows.map((r) => {
          const status = formatLifecycleStatus(r.status);
          const superseded = (r.superseded_by || []).join("; ");
          return `"${String(r.part_number).replace(/"/g, '""')}","${status.replace(/"/g, '""')}","${superseded.replace(/"/g, '""')}"`;
        }),
      ].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "series-coverage-parts.csv";
      a.click();
      URL.revokeObjectURL(a.href);
    }

    filterApi = initProductFilters(() => {
      if (hasSearched) runSearch();
    });

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

    document
      .getElementById("series-download-btn")
      ?.addEventListener("click", runDownload);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
