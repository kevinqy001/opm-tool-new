/**
 * OPM page — Parts Match POST /api/match (no draft email).
 * Used by dev/index.html.
 */
(function () {
  const SPEC_LIMIT_TOP10 = 10;
  const SPEC_LIMIT_TOP40 = 40;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function humanizeAttrName(name) {
    return String(name || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function formatScore(score) {
    if (score == null || score === "") return "—";
    const n = Number(score);
    if (Number.isNaN(n)) return String(score);
    if (n <= 1) return `${Math.round(n * 100)}%`;
    return `${Math.round(n)}%`;
  }

  function formatAttrValue(attr) {
    if (!attr || attr.value === undefined || attr.value === null) return "—";
    const v = attr.value;
    if (Array.isArray(v)) return v.map(String).join(", ");
    if (typeof v === "boolean") return v ? "Yes" : "No";
    if (attr.unit) return `${v} ${attr.unit}`;
    return String(v);
  }

  function matchBarColor(percent) {
    const p = Math.max(0, Math.min(100, percent));
    if (p === 0) return { fill: "#ef4444", track: "#fee2e2", label: "#b91c1c" };
    if (p === 100) return { fill: "#22c55e", track: "#dcfce7", label: "#15803d" };
    const hue = Math.round((p / 100) * 120);
    return {
      fill: `hsl(${hue}, 72%, 42%)`,
      track: `hsl(${hue}, 65%, 92%)`,
      label: `hsl(${hue}, 65%, 32%)`,
    };
  }

  function matchPercentBar(percent) {
    if (percent === null) {
      return `<div class="opm-rec-match-bar opm-rec-match-bar--na" aria-label="No match data">
        <span class="opm-rec-match-bar__label">—</span>
      </div>`;
    }

    const p = Math.max(0, Math.min(100, percent));
    const colors = matchBarColor(p);

    return `<div class="opm-rec-match-bar" aria-label="${p}% match">
      <div class="opm-rec-match-bar__track" style="background:${colors.track}">
        <div
          class="opm-rec-match-bar__fill"
          style="width:${p}%;background:${colors.fill}"
        ></div>
      </div>
      <span class="opm-rec-match-bar__label" style="color:${colors.label}">${p}%</span>
    </div>`;
  }

  function breakdownMatchPercent(item) {
    if (item?.score_is_skip || item?.score == null) return null;
    return Math.round(Number(item.score) * 100);
  }

  function getSpecVisibleLimit(specViewLevel, totalCount) {
    if (specViewLevel === "all") return totalCount;
    if (specViewLevel === "top40") {
      return Math.min(SPEC_LIMIT_TOP40, totalCount);
    }
    return Math.min(SPEC_LIMIT_TOP10, totalCount);
  }

  function getSpecExpandButtonLabel(specViewLevel, totalCount) {
    if (specViewLevel === "top10" && totalCount > SPEC_LIMIT_TOP10) {
      return "Show more";
    }
    if (specViewLevel === "top40") return "Show all";
    if (specViewLevel === "all") return "Collapse";
    return null;
  }

  function advanceSpecViewLevel(specViewLevel) {
    if (specViewLevel === "top10") return "top40";
    if (specViewLevel === "top40") return "all";
    return "top10";
  }

  function getBreakdownItems(data, selectedIndex) {
    const result = data.results?.[selectedIndex];
    const breakdown = result?.sku_result?.breakdown || [];
    return breakdown.filter(
      (item) => !item.score_is_skip || item.obs || item.cand
    );
  }

  function renderSpecComparison(
    data,
    selectedIndex,
    { specViewLevel = "top10", specViewMode = "table" } = {}
  ) {
    const result = data.results?.[selectedIndex];
    const visibleItems = getBreakdownItems(data, selectedIndex);

    if (!visibleItems.length) {
      return '<p class="opm-rec__muted">No specification comparison available.</p>';
    }

    const reqLabel = data.obs_sku || data.obs_sku_canonical || "Requested";
    const recLabel = result?.sku || result?.entry || "Recommended";

    const totalCount = visibleItems.length;
    const visibleLimit = getSpecVisibleLimit(specViewLevel, totalCount);
    const visibleRows = visibleItems.slice(0, visibleLimit);
    const buttonLabel = getSpecExpandButtonLabel(specViewLevel, totalCount);

    const hintText =
      visibleLimit >= totalCount
        ? `Showing all ${totalCount} attributes`
        : `Showing ${visibleLimit} of ${totalCount} attributes`;

    const expandButton = buttonLabel
      ? `<button
          type="button"
          id="opm-spec-expand-btn"
          class="opm-btn opm-btn--breakdown"
          aria-expanded="${specViewLevel !== "top10" ? "true" : "false"}"
        >
          ${buttonLabel}
        </button>`
      : "";

    const viewToggleLabel =
      specViewMode === "table" ? "Show in graph" : "Show in table";

    const specToolbar = `<div class="opm-rec-spec-toolbar">
        <div class="opm-rec-spec-toolbar__left">
          ${expandButton}
          <span class="opm-rec-spec-toolbar__hint">${hintText}</span>
        </div>
        <button
          type="button"
          id="opm-spec-view-toggle"
          class="opm-btn opm-btn--graph-toggle"
          aria-pressed="${specViewMode === "graph" ? "true" : "false"}"
        >
          ${viewToggleLabel}
        </button>
      </div>`;

    let body = "";
    if (specViewMode === "graph" && window.OpmPartsMatchGraph) {
      body = window.OpmPartsMatchGraph.renderGraph(visibleRows, {
        reqLabel,
        recLabel,
      });
    } else {
      body = renderComparisonTableBody(visibleRows, reqLabel, recLabel);
    }

    return `${specToolbar}<div class="opm-rec-spec-panel" id="opm-rec-spec-panel" data-spec-view="${specViewMode}">
          ${body}
        </div>`;
  }

  function renderComparisonTableBody(visibleRows, reqLabel, recLabel) {
    const rows = visibleRows
      .map((item) => {
        const reqDisplay = formatAttrValue(item.obs);
        const recDisplay = formatAttrValue(item.cand);
        const matchPct = breakdownMatchPercent(item);
        const isExact =
          matchPct === 100 &&
          reqDisplay !== "—" &&
          recDisplay !== "—";
        const gateNote =
          item.role === "gate" && item.gate_status
            ? ` (${item.gate_status})`
            : "";

        return `<tr>
          <th scope="row">${escapeHtml(humanizeAttrName(item.name))}${escapeHtml(gateNote)}</th>
          <td class="opm-rec-table__col--match-pct">${matchPercentBar(matchPct)}</td>
          <td>${escapeHtml(reqDisplay)}</td>
          <td class="opm-rec-table__col--selected${
            isExact ? " opm-rec-table__cell--match" : ""
          }">${escapeHtml(recDisplay)}</td>
        </tr>`;
      })
      .join("");

    return `<div class="opm-table-wrap opm-rec-table-wrap">
            <table class="opm-table opm-rec-table opm-rec-table--pair">
              <thead>
                <tr>
                  <th scope="col">Attribute</th>
                  <th scope="col">Match</th>
                  <th scope="col">${escapeHtml(reqLabel)}</th>
                  <th scope="col" class="opm-rec-table__col--selected">${escapeHtml(recLabel)}</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <p class="opm-rec__muted opm-rec-spec-footnote">Match % comes from the Parts Match algorithm (per-attribute score).</p>`;
  }

  function renderResults(data, selectedIndex, partNumber, options = {}) {
    const { specViewLevel = "top10", specViewMode = "table" } = options;
    const results = data.results || [];
    const selected = results[selectedIndex] || results[0];

    const cards = results
      .map((rec, i) => {
        const active = i === selectedIndex ? " is-active" : "";
        const series = rec.series?.[0]?.name
          ? `<p class="opm-rec-card__series">Entry ${escapeHtml(rec.entry || rec.series[0].name)}</p>`
          : rec.entry
            ? `<p class="opm-rec-card__series">Entry ${escapeHtml(rec.entry)}</p>`
            : "";
        const partNum = rec.sku || rec.entry || "—";
        const aggregate = rec.sku_result?.aggregate;
        const blocked = rec.sku_result?.gate_block
          ? `<p class="opm-rec-card__series">Gate blocked</p>`
          : "";

        return `<button type="button" class="opm-rec-card${active}" data-rec-index="${i}">
          <span class="opm-rec-card__rank">#${i + 1}</span>
          <div class="opm-rec-card__body">
            <span class="opm-rec-card__main">
              <span class="opm-rec-card__part">${escapeHtml(partNum)}</span>
              ${series}
              ${blocked}
            </span>
            <span class="opm-rec-card__score" aria-label="Match score">${escapeHtml(formatScore(aggregate))}</span>
          </div>
        </button>`;
      })
      .join("");

    const modeNote =
      data.match_mode === "series"
        ? `<p class="opm-rec__hint">Series-level match — enter a full SKU for SKU-level comparison when available.</p>`
        : "";

    const metaBits = [];
    if (data.obs_entry) {
      metaBits.push(`Entry ${escapeHtml(data.obs_entry)}`);
    }
    if (data.obs_brand) {
      metaBits.push(escapeHtml(data.obs_brand));
    }
    if (data.obs_class) {
      metaBits.push(escapeHtml(data.obs_class));
    }
    const metaLine = metaBits.length
      ? `<p class="opm-rec__context-meta">${metaBits.join(" · ")}</p>`
      : "";

    return `
      <section class="opm-rec" aria-label="Recommendation results">
        <div class="opm-rec__context">
          <h2 class="opm-rec__title">Requested part: ${escapeHtml(data.obs_sku || partNumber || "—")}</h2>
          ${metaLine}
          ${modeNote}
        </div>

        <h3 class="opm-rec__subtitle opm-rec__subtitle--first">Recommendations (${results.length})</h3>
        <p class="opm-rec__hint">Select a card to compare that recommendation against the requested part.</p>
        <div class="opm-rec__cards" role="listbox" aria-label="Recommended parts">
          ${cards || '<p class="opm-rec__muted">No recommendations returned.</p>'}
        </div>

        ${
          selected
            ? `<h3 class="opm-rec__subtitle">Specification comparison</h3>
        ${renderSpecComparison(data, selectedIndex, { specViewLevel, specViewMode })}`
            : ""
        }
      </section>
    `;
  }

  function showMessage(container, type, message) {
    container.hidden = false;
    container.className = `opm-alert opm-alert--${type}`;
    container.textContent = message;
  }

  function clearMessage(alertEl) {
    alertEl.hidden = true;
    alertEl.textContent = "";
    alertEl.className = "opm-alert";
  }

  function getLocalEntryPath() {
    return "/dev/index.html";
  }

  function getDevServerUrl() {
    const cfg = window.OPM_CONFIG || {};
    const port = cfg.OPM_DEV_PORT ?? 8765;
    return `http://127.0.0.1:${port}${getLocalEntryPath()}`;
  }

  function getServeContextError() {
    const cfg = window.OPM_CONFIG || {};
    const devPort = cfg.OPM_DEV_PORT ?? 8765;

    if (location.protocol === "file:") {
      return (
        "This page was opened as a local file. Run python opm-dev-server.py and open " +
        getDevServerUrl() +
        " in your browser."
      );
    }

    const onLocalHost =
      location.hostname === "localhost" || location.hostname === "127.0.0.1";

    if (onLocalHost && Number(location.port) !== devPort) {
      return (
        "Parts Match local proxy requires opm-dev-server.py. Open " +
        getDevServerUrl() +
        " (not Live Server or other ports)."
      );
    }

    return null;
  }

  function initPartsMatchOpmPage() {
    const form = document.getElementById("opm-main-form");
    const partInput = document.getElementById("opm-part-input");
    const includeObsoleteEl = document.getElementById("opm-include-obsolete");
    const submitBtn = form?.querySelector('button[type="submit"]');
    const resultsPanel = document.getElementById("opm-rec-panel");
    const resultsRoot = document.getElementById("opm-results-root");
    const alertEl = document.getElementById("opm-results-alert");
    const loadingEl = document.getElementById("opm-results-loading");
    const loadingTextEl = document.getElementById("opm-results-loading-text");

    if (!form || !partInput || !resultsRoot || !window.OpmPartsMatchClient) return;

    let lastData = null;
    let selectedIndex = 0;
    let lastPartNumber = "";
    let specViewLevel = "top10";
    let specViewMode = "table";
    let loadingTimer = null;

    function paintResults() {
      if (!lastData) return;
      resultsRoot.innerHTML = renderResults(
        lastData,
        selectedIndex,
        lastPartNumber,
        { specViewLevel, specViewMode }
      );
      bindResultInteractions();
    }

    function setResultsPanelVisible(visible) {
      if (resultsPanel) {
        resultsPanel.classList.toggle("opm-rec-panel--hidden", !visible);
      }
    }

    const serveError = getServeContextError();
    if (serveError) {
      setResultsPanelVisible(true);
      showMessage(alertEl, "error", serveError);
    }

    function setLoading(isLoading) {
      if (loadingEl) loadingEl.hidden = !isLoading;
      if (submitBtn) submitBtn.disabled = isLoading;

      if (loadingTimer) {
        clearInterval(loadingTimer);
        loadingTimer = null;
      }

      if (isLoading && loadingTextEl) {
        const started = Date.now();
        loadingTextEl.textContent = "Finding replacements…";
        loadingTimer = setInterval(() => {
          const secs = Math.floor((Date.now() - started) / 1000);
          loadingTextEl.textContent = `Finding replacements… (${secs}s elapsed)`;
        }, 1000);
      } else if (loadingTextEl) {
        loadingTextEl.textContent = "Finding replacements…";
      }
    }

    setResultsPanelVisible(false);
    setLoading(false);

    function bindResultInteractions() {
      resultsRoot.querySelectorAll(".opm-rec-card").forEach((card) => {
        card.addEventListener("click", () => {
          const idx = Number(card.dataset.recIndex);
          if (Number.isNaN(idx) || !lastData) return;
          selectedIndex = idx;
          specViewLevel = "top10";
          specViewMode = "table";
          paintResults();
        });
      });

      resultsRoot.querySelector("#opm-spec-expand-btn")?.addEventListener("click", () => {
        specViewLevel = advanceSpecViewLevel(specViewLevel);
        paintResults();
      });

      resultsRoot
        .querySelector("#opm-spec-view-toggle")
        ?.addEventListener("click", () => {
          specViewMode = specViewMode === "table" ? "graph" : "table";
          paintResults();
        });

      if (specViewMode === "graph" && window.OpmPartsMatchGraph) {
        requestAnimationFrame(() => {
          window.OpmPartsMatchGraph.wireGraphLinks(resultsRoot);
        });
        window.addEventListener(
          "resize",
          () => window.OpmPartsMatchGraph.wireGraphLinks(resultsRoot),
          { once: true }
        );
      }
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const contextError = getServeContextError();
      if (contextError) {
        setResultsPanelVisible(true);
        showMessage(alertEl, "error", contextError);
        return;
      }

      const partNumber = String(partInput.value || "").trim();

      if (!partNumber) {
        setResultsPanelVisible(true);
        showMessage(
          alertEl,
          "error",
          "Please enter a part number before getting a recommendation."
        );
        resultsRoot.innerHTML = "";
        setLoading(false);
        return;
      }

      setResultsPanelVisible(true);
      clearMessage(alertEl);
      setLoading(true);
      resultsRoot.innerHTML = "";
      lastPartNumber = partNumber;

      try {
        const res = await window.OpmPartsMatchClient.matchPart(partNumber, {
          includeObsolete: includeObsoleteEl?.checked,
        });

        if (!res.ok) {
          showMessage(
            alertEl,
            "error",
            window.OpmPartsMatchClient.formatApiError(res)
          );
          return;
        }

        const body = res.data;

        if (!body?.results?.length) {
          showMessage(
            alertEl,
            "warning",
            `No active replacement was found for “${partNumber}”. Try a different part number or enable “Include obsolete candidates”.`
          );
          if (body?.obs_sku) {
            lastData = body;
            selectedIndex = 0;
            specViewLevel = "top10";
            specViewMode = "table";
            paintResults();
          }
          return;
        }

        lastData = body;
        selectedIndex = 0;
        specViewLevel = "top10";
        specViewMode = "table";
        paintResults();
      } catch (err) {
        console.error(err);
        showMessage(
          alertEl,
          "error",
          err.message === "Failed to fetch"
            ? getServeContextError() ||
              "Could not reach the Parts Match API. Ensure python opm-dev-server.py is running."
            : `Network error: ${err.message}`
        );
      } finally {
        setLoading(false);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", initPartsMatchOpmPage);
})();
