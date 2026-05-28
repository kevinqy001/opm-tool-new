/**
 * OPM page — GC Match POST /recommend_from_ticket
 */
(function () {
  const SPEC_SKIP = new Set(["Id", "Row Id", "Cohere Score"]);
  const SPEC_LIMIT_TOP10 = 10;
  const SPEC_LIMIT_TOP40 = 40;
  const SPEC_PRIORITY = [
    "Part Number",
    "Series",
    "Series Name",
    "Product Family",
    "Manufacturer",
    "Pressure Range",
    "Output",
    "Electrical Termination",
    "Pressure Fitting",
    "Accuracy",
    "Obsolete Status",
    "Category",
    "Type",
  ];
  function buildQueryText(value) {
    return (value || "").trim();
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatScore(score) {
    if (score == null || score === "") return "—";
    const n = Number(score);
    if (Number.isNaN(n)) return String(score);
    if (n <= 1) return `${Math.round(n * 100)}%`;
    return `${n}%`;
  }

  function getRecommendedPart(rec) {
    return (
      rec.comparison_table?.recommended_part ||
      rec.comparison_table?.recommended ||
      {}
    );
  }

  function sortSpecKeys(keys) {
    const set = new Set(keys);
    const ordered = [];
    SPEC_PRIORITY.forEach((k) => {
      if (set.has(k)) {
        ordered.push(k);
        set.delete(k);
      }
    });
    return ordered.concat([...set].sort((a, b) => a.localeCompare(b)));
  }

  function comparisonKeys(data, selectedIndex) {
    const keys = new Set();
    const rec = data.recommendations?.[selectedIndex];
    const requested = rec?.comparison_table?.requested_part || {};
    Object.keys(requested).forEach((k) => {
      if (!SPEC_SKIP.has(k)) keys.add(k);
    });
    Object.keys(getRecommendedPart(rec)).forEach((k) => {
      if (!SPEC_SKIP.has(k)) keys.add(k);
    });
    return sortSpecKeys(keys);
  }

  function normalizeSpecValue(val) {
    if (val === undefined || val === null || val === "") return "";
    return String(val).trim().toLowerCase().replace(/\s+/g, " ");
  }

  function formatSpecValue(val) {
    if (val === undefined || val === null || val === "") return "—";
    return val;
  }

  /** Per-spec match % (API has no row-level score; computed client-side). */
  function computeSpecMatchPercent(reqVal, recVal) {
    const a = normalizeSpecValue(reqVal);
    const b = normalizeSpecValue(recVal);
    if (!a && !b) return null;
    if (!a || !b) return 0;
    if (a === b) return 100;

    if (a.includes(b) || b.includes(a)) {
      const shorter = Math.min(a.length, b.length);
      const longer = Math.max(a.length, b.length);
      return Math.round((shorter / longer) * 100);
    }

    const tokensA = a.split(/\s+/).filter(Boolean);
    const tokensB = new Set(b.split(/\s+/).filter(Boolean));
    if (!tokensA.length || !tokensB.size) return 0;

    let inter = 0;
    tokensA.forEach((t) => {
      if (tokensB.has(t)) inter += 1;
    });
    const union = new Set([...tokensA, ...tokensB]).size;
    return Math.round((inter / union) * 100);
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

  function renderContextSummary(queryText) {
    return `
      <div class="opm-rec__context">
        <h3 class="opm-rec__subtitle opm-rec__subtitle--first">Submitted context</h3>
        <details class="opm-rec__context-details">
          <summary>View full submitted text</summary>
          <pre class="opm-rec__context-pre">${escapeHtml(queryText)}</pre>
        </details>
      </div>
    `;
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

  function renderComparisonTable(data, selectedIndex, { specViewLevel = "top10" } = {}) {
    const allKeys = comparisonKeys(data, selectedIndex);
    if (!allKeys.length) {
      return '<p class="opm-rec__muted">No specification comparison available.</p>';
    }

    const selected = data.recommendations[selectedIndex];
    const requested = selected?.comparison_table?.requested_part || {};
    const recPart = getRecommendedPart(selected);
    const recLabel =
      selected?.recommended_part_number ||
      recPart["Part Number"] ||
      "Recommended";
    const reqLabel = data.requested_part_number || "Requested";

    const totalCount = allKeys.length;
    const visibleLimit = getSpecVisibleLimit(specViewLevel, totalCount);
    const visibleKeys = allKeys.slice(0, visibleLimit);
    const buttonLabel = getSpecExpandButtonLabel(specViewLevel, totalCount);

    const rows = visibleKeys
      .map((key) => {
        const reqVal = requested[key];
        const recVal = recPart[key];
        const reqDisplay = formatSpecValue(reqVal);
        const recDisplay = formatSpecValue(recVal);
        const matchPct = computeSpecMatchPercent(reqVal, recVal);
        const isExact =
          matchPct === 100 &&
          reqDisplay !== "—" &&
          recDisplay !== "—";

        return `<tr>
          <th scope="row">${escapeHtml(key)}</th>
          <td class="opm-rec-table__col--match-pct">${matchPercentBar(matchPct)}</td>
          <td>${escapeHtml(reqDisplay)}</td>
          <td class="opm-rec-table__col--selected${
            isExact ? " opm-rec-table__cell--match" : ""
          }">${escapeHtml(recDisplay)}</td>
        </tr>`;
      })
      .join("");

    const hintText =
      visibleLimit >= totalCount
        ? `Showing all ${totalCount} specifications`
        : `Showing ${visibleLimit} of ${totalCount} specifications`;

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

    const specToolbar = `<div class="opm-rec-spec-toolbar">
        ${expandButton}
        <span class="opm-rec-spec-toolbar__hint">${hintText}</span>
      </div>`;

    const tableBlock = `<div class="opm-rec-spec-panel" id="opm-rec-spec-panel">
          <div class="opm-table-wrap opm-rec-table-wrap">
            <table class="opm-table opm-rec-table opm-rec-table--pair">
              <thead>
                <tr>
                  <th scope="col">Specification</th>
                  <th scope="col">Match</th>
                  <th scope="col">${escapeHtml(reqLabel)}</th>
                  <th scope="col" class="opm-rec-table__col--selected">${escapeHtml(recLabel)}</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <p class="opm-rec__muted opm-rec-spec-footnote">Match % is estimated from requested vs. recommended values (not provided per row by the API).</p>
        </div>`;

    return `${specToolbar}${tableBlock}`;
  }

  function renderResults(
    data,
    selectedIndex,
    queryText,
    { draftPanelOpen = false, specViewLevel = "top10" } = {}
  ) {
    const recs = data.recommendations || [];
    const selected = recs[selectedIndex] || recs[0];

    const cards = recs
      .map((rec, i) => {
        const active = i === selectedIndex ? " is-active" : "";
        const series = rec.recommended_series
          ? `<p class="opm-rec-card__series">Series ${escapeHtml(rec.recommended_series)}</p>`
          : "";
        const partNum =
          rec.recommended_part_number ||
          getRecommendedPart(rec)["Part Number"] ||
          "—";
        return `<button type="button" class="opm-rec-card${active}" data-rec-index="${i}">
          <span class="opm-rec-card__rank">#${i + 1}</span>
          <span class="opm-rec-card__main">
            <span class="opm-rec-card__part">${escapeHtml(partNum)}</span>
            ${series}
          </span>
          <span class="opm-rec-card__score" aria-label="Confidence score">${escapeHtml(formatScore(rec.confidence_score))}</span>
        </button>`;
      })
      .join("");

    const pdfLinks = [];
    if (data.datasheet_pdf_requested) {
      pdfLinks.push(
        `<a class="opm-rec__link" href="${escapeHtml(data.datasheet_pdf_requested)}" target="_blank" rel="noopener noreferrer">Requested part datasheet (PDF)</a>`
      );
    }
    if (selected?.datasheet_pdf_recommended) {
      pdfLinks.push(
        `<a class="opm-rec__link" href="${escapeHtml(selected.datasheet_pdf_recommended)}" target="_blank" rel="noopener noreferrer">Selected recommendation datasheet (PDF)</a>`
      );
    }

    const draft = selected?.draft_email || "";

    return `
      <section class="opm-rec" aria-label="Recommendation results">
        ${renderContextSummary(queryText)}

        <div class="opm-rec__meta">
          <h2 class="opm-rec__title">Requested part: ${escapeHtml(data.requested_part_number || "—")}</h2>
          ${pdfLinks.length ? `<div class="opm-rec__links">${pdfLinks.join("")}</div>` : ""}
        </div>

        <h3 class="opm-rec__subtitle">Recommendations (${recs.length})</h3>
        <p class="opm-rec__hint">Select a card to compare that recommendation against the requested part.</p>
        <div class="opm-rec__cards" role="listbox" aria-label="Recommended parts">
          ${cards || '<p class="opm-rec__muted">No recommendations returned.</p>'}
        </div>

        <h3 class="opm-rec__subtitle">Specification comparison</h3>
        ${renderComparisonTable(data, selectedIndex, { specViewLevel })}

        <div class="opm-rec__draft-actions">
          <button
            type="button"
            id="opm-draft-email-btn"
            class="opm-btn"
            ${draftPanelOpen ? "hidden" : ""}
          >
            Draft Email
          </button>
        </div>

        <div
          id="opm-draft-email-panel"
          class="opm-rec__draft-panel"
          ${draftPanelOpen ? "" : "hidden"}
        >
          <h3 class="opm-rec__subtitle">Email draft</h3>
          <textarea id="opm-draft-output" class="opm-textarea opm-rec__draft" rows="10" aria-label="Email draft">${escapeHtml(draft)}</textarea>
        </div>
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

  function initOpmPage() {
    const form = document.getElementById("opm-main-form");
    const queryInput = document.getElementById("opm-query-input");
    const submitBtn = form?.querySelector('button[type="submit"]');
    const resultsPanel = document.getElementById("opm-rec-panel");
    const resultsRoot = document.getElementById("opm-results-root");
    const alertEl = document.getElementById("opm-results-alert");
    const loadingEl = document.getElementById("opm-results-loading");
    const loadingTextEl = document.getElementById("opm-results-loading-text");

    if (!form || !queryInput || !resultsRoot || !window.OpmApiClient) return;

    let lastData = null;
    let selectedIndex = 0;
    let lastQueryText = "";
    let specViewLevel = "top10";

    function setResultsPanelVisible(visible) {
      if (resultsPanel) {
        resultsPanel.classList.toggle("opm-rec-panel--hidden", !visible);
      }
    }

    let loadingTimer = null;

    function setLoading(isLoading) {
      if (loadingEl) loadingEl.hidden = !isLoading;
      if (submitBtn) submitBtn.disabled = isLoading;

      if (loadingTimer) {
        clearInterval(loadingTimer);
        loadingTimer = null;
      }

      if (isLoading && loadingTextEl) {
        const started = Date.now();
        loadingTextEl.textContent =
          "Generating recommendations… This may take 1–2 minutes.";
        loadingTimer = setInterval(() => {
          const secs = Math.floor((Date.now() - started) / 1000);
          loadingTextEl.textContent = `Generating recommendations… (${secs}s elapsed, typically 1–2 minutes)`;
        }, 1000);
      } else if (loadingTextEl) {
        loadingTextEl.textContent =
          "Generating recommendations… This may take 1–2 minutes.";
      }
    }

    setResultsPanelVisible(false);
    setLoading(false);

    function isDraftPanelOpen() {
      const panel = resultsRoot.querySelector("#opm-draft-email-panel");
      return Boolean(panel && !panel.hidden);
    }

    function bindResultInteractions() {
      resultsRoot.querySelectorAll(".opm-rec-card").forEach((card) => {
        card.addEventListener("click", () => {
          const idx = Number(card.dataset.recIndex);
          if (Number.isNaN(idx) || !lastData) return;
          selectedIndex = idx;
          specViewLevel = "top10";
          resultsRoot.innerHTML = renderResults(
            lastData,
            selectedIndex,
            lastQueryText,
            {
              draftPanelOpen: isDraftPanelOpen(),
              specViewLevel,
            }
          );
          bindResultInteractions();
        });
      });

      resultsRoot.querySelector("#opm-spec-expand-btn")?.addEventListener("click", () => {
        specViewLevel = advanceSpecViewLevel(specViewLevel);
        if (!lastData) return;
        resultsRoot.innerHTML = renderResults(
          lastData,
          selectedIndex,
          lastQueryText,
          {
            draftPanelOpen: isDraftPanelOpen(),
            specViewLevel,
          }
        );
        bindResultInteractions();
      });

      const draftBtn = resultsRoot.querySelector("#opm-draft-email-btn");
      const draftPanel = resultsRoot.querySelector("#opm-draft-email-panel");

      draftBtn?.addEventListener("click", () => {
        if (!lastData) return;
        resultsRoot.innerHTML = renderResults(
          lastData,
          selectedIndex,
          lastQueryText,
          { draftPanelOpen: true, specViewLevel }
        );
        bindResultInteractions();
        resultsRoot.querySelector("#opm-draft-email-panel")?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      });
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const queryText = buildQueryText(queryInput.value);

      if (!queryText) {
        setResultsPanelVisible(true);
        showMessage(
          alertEl,
          "error",
          "Please enter a part number or replacement request before getting a recommendation."
        );
        resultsRoot.innerHTML = "";
        setLoading(false);
        return;
      }

      setResultsPanelVisible(true);
      clearMessage(alertEl);
      setLoading(true);
      resultsRoot.innerHTML = "";
      lastQueryText = queryText;

      try {
        const res = await window.OpmApiClient.recommendFromTicket(queryText);

        if (!res.ok) {
          showMessage(
            alertEl,
            "error",
            window.OpmApiClient.formatApiError(res)
          );
          return;
        }

        const body = res.data;

        if (body?.message) {
          showMessage(
            alertEl,
            "warning",
            body.message === "Ticket not related to OPM"
              ? "This request does not appear to be OPM-related. Try including a part number or a clear replacement request."
              : body.message
          );
          return;
        }

        if (!body?.recommendations?.length) {
          showMessage(
            alertEl,
            "warning",
            "No recommendations were returned for this request."
          );
          return;
        }

        lastData = body;
        window.OpmRecentQueries?.add(queryText, { response: body });
        selectedIndex = 0;
        specViewLevel = "top10";
        resultsRoot.innerHTML = renderResults(
          body,
          selectedIndex,
          queryText
        );
        bindResultInteractions();
      } catch (err) {
        console.error(err);
        showMessage(
          alertEl,
          "error",
          err.message === "Failed to fetch"
            ? "Could not reach the GC Match API. Start the local dev server (python opm-dev-server.py) and open http://127.0.0.1:8765/index.html — do not open the HTML file directly. See opm-config.js GCMATCH_USE_SAME_ORIGIN_PROXY."
            : `Network error: ${err.message}`
        );
      } finally {
        setLoading(false);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", initOpmPage);
})();
