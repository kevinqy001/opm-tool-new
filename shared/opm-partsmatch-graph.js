/**
 * Parts Match breakdown — flow graph (table ↔ graph toggle).
 */
(function (global) {
  const ROW_HEIGHT = 56;

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
    if (p === 0) return { fill: "#ef4444", track: "#fee2e2" };
    if (p === 100) return { fill: "#22c55e", track: "#dcfce7" };
    const hue = Math.round((p / 100) * 120);
    return {
      fill: `hsl(${hue}, 72%, 42%)`,
      track: `hsl(${hue}, 65%, 92%)`,
    };
  }

  function truncate(str, max = 36) {
    const s = String(str);
    if (s.length <= max) return s;
    return `${s.slice(0, max - 1)}…`;
  }

  function formatWeight(weight) {
    if (weight == null || weight === "") return "";
    const n = Number(weight);
    if (Number.isNaN(n)) return "";
    const label = Number.isInteger(n) ? String(n) : String(n);
    return `w${label}`;
  }

  function scoreCellHtml(item) {
    if (item?.score_is_skip) {
      return `<span class="opm-match-graph__skip">skipped</span>`;
    }
    if (item?.score == null) {
      return `<span class="opm-match-graph__skip">—</span>`;
    }
    const pct = Math.round(Number(item.score) * 100);
    const colors = matchBarColor(pct);
    const weight = formatWeight(item.weight);
    return `<div class="opm-match-graph__score">
      <div class="opm-match-graph__score-bar" style="background:${colors.track}">
        <div class="opm-match-graph__score-fill" style="width:${pct}%;background:${colors.fill}"></div>
      </div>
      <span class="opm-match-graph__score-pct">${pct}%</span>
      ${weight ? `<span class="opm-match-graph__score-weight">${escapeHtml(weight)}</span>` : ""}
    </div>`;
  }

  function renderGraph(items, { reqLabel, recLabel }) {
    if (!items.length) {
      return '<p class="opm-rec__muted">No specification comparison available.</p>';
    }

    const rows = items
      .map((item, index) => {
        const attrLabel = humanizeAttrName(item.name);
        const obsDisplay = formatAttrValue(item.obs);
        const candDisplay = formatAttrValue(item.cand);
        const gateNote =
          item.role === "gate" && item.gate_status
            ? ` (${item.gate_status})`
            : "";

        return `<div class="opm-match-graph__row" data-row="${index}">
          <div class="opm-match-graph__cell opm-match-graph__cell--obs" title="${escapeHtml(obsDisplay)}">
            <span class="opm-match-graph__pill">${escapeHtml(truncate(obsDisplay))}</span>
          </div>
          <div class="opm-match-graph__cell opm-match-graph__cell--obs-attr" title="${escapeHtml(attrLabel)}">
            <span class="opm-match-graph__attr">${escapeHtml(truncate(attrLabel, 28))}${escapeHtml(gateNote)}</span>
          </div>
          <div class="opm-match-graph__cell opm-match-graph__cell--score">
            ${scoreCellHtml(item)}
          </div>
          <div class="opm-match-graph__cell opm-match-graph__cell--cand-attr" title="${escapeHtml(attrLabel)}">
            <span class="opm-match-graph__attr">${escapeHtml(truncate(attrLabel, 28))}</span>
          </div>
          <div class="opm-match-graph__cell opm-match-graph__cell--cand" title="${escapeHtml(candDisplay)}">
            <span class="opm-match-graph__pill opm-match-graph__pill--cand">${escapeHtml(truncate(candDisplay))}</span>
          </div>
        </div>`;
      })
      .join("");

    const height = items.length * ROW_HEIGHT + 8;

    return `<div class="opm-match-graph" style="--opm-graph-rows:${items.length}">
      <div class="opm-match-graph__labels" aria-hidden="true">
        <span>Observed SKU</span>
        <span>Obs attributes</span>
        <span>Score</span>
        <span>Cand attributes</span>
        <span>Candidate SKU</span>
      </div>
      <div class="opm-match-graph__frame">
        <svg class="opm-match-graph__svg" width="100%" height="${height}" aria-hidden="true"></svg>
        <div class="opm-match-graph__body">${rows}</div>
      </div>
      <p class="opm-rec__muted opm-rec-spec-footnote">
        Flow view for <strong>${escapeHtml(reqLabel)}</strong> → <strong>${escapeHtml(recLabel)}</strong>.
        Match % and weights (w) come from the Parts Match algorithm.
      </p>
    </div>`;
  }

  function centerOf(el, frame) {
    const r = el.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    return {
      x: r.left + r.width / 2 - f.left,
      y: r.top + r.height / 2 - f.top,
    };
  }

  function linkPath(points) {
    if (points.length < 2) return "";
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const curr = points[i];
      const cx = (prev.x + curr.x) / 2;
      d += ` C ${cx} ${prev.y}, ${cx} ${curr.y}, ${curr.x} ${curr.y}`;
    }
    return d;
  }

  function wireGraphLinks(root) {
    const graph = root?.querySelector?.(".opm-match-graph");
    if (!graph) return;

    const frame = graph.querySelector(".opm-match-graph__frame");
    const svg = graph.querySelector(".opm-match-graph__svg");
    if (!frame || !svg) return;

    const frameRect = frame.getBoundingClientRect();
    svg.setAttribute("height", String(Math.ceil(frameRect.height)));
    svg.innerHTML = "";

    graph.querySelectorAll(".opm-match-graph__row").forEach((row) => {
      const cells = [
        row.querySelector(".opm-match-graph__cell--obs"),
        row.querySelector(".opm-match-graph__cell--obs-attr"),
        row.querySelector(".opm-match-graph__cell--score"),
        row.querySelector(".opm-match-graph__cell--cand-attr"),
        row.querySelector(".opm-match-graph__cell--cand"),
      ].filter(Boolean);

      if (cells.length < 2) return;

      const points = cells.map((cell) => centerOf(cell, frame));
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", linkPath(points));
      path.setAttribute("class", "opm-match-graph__link");
      svg.appendChild(path);
    });
  }

  global.OpmPartsMatchGraph = {
    ROW_HEIGHT,
    renderGraph,
    wireGraphLinks,
  };
})(window);
