/**
 * Search History — table shows last OPM searches from localStorage.
 * Search filters the history list by substring match on Requested part number (no API).
 */
(function () {
  const HISTORY_EMPTY_MSG =
    "No OPM search history yet. Results from the OPM page will appear here.";
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

  function renderRows(body, rows) {
    if (!rows.length) {
      renderEmpty(body, FILTER_EMPTY_MSG);
      return;
    }

    body.innerHTML = rows
      .map(
        (row) => `
      <div class="opm-draft-row">
        <div class="opm-draft-row__cell opm-draft-row__cell--requested">
          <strong>${escapeHtml(row.requested)}</strong>
        </div>
        <div class="opm-draft-row__cell opm-draft-row__cell--recommended">
          ${escapeHtml(row.recommended)}
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

  function renderRecentQueries(searchInput, onFilter) {
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
        onFilter?.(entry.partNumber);
      });
    });
  }

  function init() {
    const body = document.querySelector(".opm-results-body");
    const searchInput = document.getElementById("draft-part-number");
    const form = searchInput?.closest("form");
    const prevBtn = document.querySelector(".opm-pagination button:first-child");
    const nextBtn = document.querySelector(".opm-pagination button:last-child");
    const pageInfo = document.querySelector(".opm-pagination__info");
    const pagination = document.querySelector(".opm-pagination");

    if (!body || !window.OpmRecentQueries) return;

    const perPage = 10;

    function getHistoryRows() {
      return window.OpmRecentQueries.getRecentHistoryRows();
    }

    let allRows = [];
    let page = 1;

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

    function refreshFromStore() {
      showFullHistory();
      renderRecentQueries(searchInput, (partNumber) => applyHistoryFilter(partNumber));
    }

    refreshFromStore();

    window.addEventListener("pageshow", (e) => {
      if (e.persisted) refreshFromStore();
    });

    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      applyHistoryFilter(searchInput?.value || "");
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
