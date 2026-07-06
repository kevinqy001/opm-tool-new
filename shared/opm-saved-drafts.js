/**
 * Search History — re-runs Parts Match on Search; table shows one row per search run.
 */
(function () {
  const HISTORY_EMPTY_MSG =
    "No OPM search history yet. Search a part number or use results from the OPM page.";
  const FILTER_EMPTY_MSG =
    "No search history entries match your filter. Try a different part number.";

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderEmpty(body, message) {
    body.innerHTML = `<p class="opm-saved__empty">${escapeHtml(message)}</p>`;
  }

  function renderRecommendedHtml(recommendations) {
    const store = window.OpmRecentQueries;
    if (!Array.isArray(recommendations) || !recommendations.length) {
      return "—";
    }

    const scoreToPercent = store?.scoreToPercent;
    const formatScoreLabel = store?.formatScoreLabel;
    const matchScoreColor = store?.matchScoreColor;

    return `<div class="opm-history-rec-list">${recommendations
      .map((item) => {
        const part = escapeHtml(item.partNumber || "—");
        const pct = scoreToPercent?.(item.score);
        const label = formatScoreLabel?.(item.score);
        const color = pct != null ? matchScoreColor?.(pct) : null;

        const scoreBadge =
          label && color
            ? `<span class="opm-history-rec__score" style="background-color:${escapeHtml(color)}" aria-label="Match score ${escapeHtml(label)}">${escapeHtml(label)}</span>`
            : "";

        return `<div class="opm-history-rec">${part}${scoreBadge}</div>`;
      })
      .join("")}</div>`;
  }

  function renderRows(body, rows) {
    if (!rows.length) {
      renderEmpty(body, FILTER_EMPTY_MSG);
      return;
    }

    body.innerHTML = rows
      .map(
        (row) => `
      <div class="opm-draft-row">
        <div class="opm-draft-row__cell opm-draft-row__cell--date">
          ${escapeHtml(row.searchedAt || "—")}
        </div>
        <div class="opm-draft-row__cell opm-draft-row__cell--requested">
          <strong>${escapeHtml(row.requested)}</strong>
        </div>
        <div class="opm-draft-row__cell opm-draft-row__cell--recommended">
          ${renderRecommendedHtml(row.recommendations)}
        </div>
      </div>`
      )
      .join("");
  }

  /** Case-insensitive substring match on requested part number. */
  function filterHistoryRows(rows, query) {
    const q = String(query ?? "").trim();
    if (!q) return rows;
    const needle = q.toLowerCase();
    return rows.filter((row) =>
      String(row.requested ?? "")
        .toLowerCase()
        .includes(needle)
    );
  }

  function renderRecentQueries(searchInput) {
    const wrap = document.getElementById("opm-recent-queries");
    const listEl = document.getElementById("opm-recent-queries-list");
    const store = window.OpmRecentQueries;
    if (!wrap || !listEl || !store) return;

    const items = store.getPartNumberList();
    if (!items.length) {
      wrap.hidden = true;
      listEl.innerHTML = "";
      return;
    }

    wrap.hidden = false;
    listEl.innerHTML = items
      .map(
        ({ partNumber }, index) =>
          `<button
          type="button"
          class="opm-recent-queries__badge"
          role="listitem"
          data-index="${index}"
          title="${escapeHtml(partNumber)}"
        >${escapeHtml(partNumber)}</button>`
      )
      .join("");

    listEl.querySelectorAll(".opm-recent-queries__badge").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-index"));
        const entry = items[idx];
        if (!entry?.partNumber || !searchInput) return;
        searchInput.value = entry.partNumber;
        searchInput.focus();
      });
    });
  }

  function init() {
    const body = document.querySelector(".opm-results-body");
    const searchInput = document.getElementById("draft-part-number");
    const form = searchInput?.closest("form");
    const submitBtn = form?.querySelector('button[type="submit"]');
    const prevBtn = document.querySelector(".opm-pagination button:first-child");
    const nextBtn = document.querySelector(".opm-pagination button:last-child");
    const pageInfo = document.querySelector(".opm-pagination__info");
    const pagination = document.querySelector(".opm-pagination");

    if (!body || !window.OpmRecentQueries) return;

    const perPage = 10;
    let allRows = [];
    let page = 1;
    let searchInFlight = false;

    function getHistoryRows() {
      return window.OpmRecentQueries.getRecentHistoryRows();
    }

    function updatePagination() {
      const total = Math.max(1, Math.ceil(allRows.length / perPage) || 1);
      if (page > total) page = total;

      if (pagination) {
        pagination.hidden = allRows.length <= perPage;
      }
      if (pageInfo) pageInfo.textContent = `${page} / ${total}`;
      if (prevBtn) prevBtn.disabled = page <= 1 || !allRows.length;
      if (nextBtn) nextBtn.disabled = page >= total || !allRows.length;
    }

    function renderPage() {
      const start = (page - 1) * perPage;
      const slice = allRows.slice(start, start + perPage);
      renderRows(body, slice);
      updatePagination();
    }

    function showFullHistory() {
      allRows = getHistoryRows().slice();
      page = 1;
      if (!allRows.length) {
        renderEmpty(body, HISTORY_EMPTY_MSG);
        updatePagination();
        return;
      }
      renderPage();
    }

    function applyHistoryFilter(query) {
      const trimmed = String(query ?? searchInput?.value ?? "").trim();
      if (!trimmed) {
        showFullHistory();
        return;
      }

      const historyRows = getHistoryRows();
      if (!historyRows.length) {
        renderEmpty(body, HISTORY_EMPTY_MSG);
        allRows = [];
        page = 1;
        updatePagination();
        return;
      }

      allRows = filterHistoryRows(historyRows, trimmed);
      page = 1;
      renderPage();
    }

    function setSearchBusy(busy) {
      searchInFlight = busy;
      if (submitBtn) {
        submitBtn.disabled = busy;
        submitBtn.textContent = busy ? "Searching…" : "Search";
      }
    }

    async function runMatchAndRecord(partNumber) {
      const sku = String(partNumber ?? "").trim();
      if (!sku) {
        showFullHistory();
        return;
      }

      const client = window.OpmPartsMatchClient;
      if (!client?.matchPart) {
        applyHistoryFilter(sku);
        return;
      }

      if (searchInFlight) return;

      setSearchBusy(true);
      const notice = document.getElementById("saved-drafts-alert");
      if (notice) notice.hidden = true;
      try {
        const res = await client.matchPart(sku);
        if (!res.ok) {
          showFullHistory();
          const msg = client.formatApiError(res);
          const notice = document.getElementById("saved-drafts-alert");
          if (notice) {
            notice.textContent = msg;
            notice.hidden = false;
          }
          return;
        }

        window.OpmRecentQueries.add(sku, { response: res.data });
        renderRecentQueries(searchInput);
        showFullHistory();
      } catch (err) {
        showFullHistory();
        const msg =
          err?.message || "Could not reach Parts Match. Please try again.";
        const notice = document.getElementById("saved-drafts-alert");
        if (notice) {
          notice.textContent = msg;
          notice.hidden = false;
        } else {
          console.warn("[OPM Search History]", msg);
        }
      } finally {
        setSearchBusy(false);
      }
    }

    function refreshFromStore() {
      showFullHistory();
      renderRecentQueries(searchInput);
    }

    refreshFromStore();

    window.addEventListener("pageshow", (e) => {
      if (e.persisted) refreshFromStore();
    });

    window.addEventListener("storage", (e) => {
      if (e.key === window.OpmRecentQueries?.STORAGE_KEY) {
        refreshFromStore();
      }
    });

    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      runMatchAndRecord(searchInput?.value || "");
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
