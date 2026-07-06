/**
 * Parts Match breakdown graph — mirrors colleague Ja component (5-col grid + trace links).
 */
(function (global) {
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatValue(value) {
    if (value == null) return "—";
    if (Array.isArray(value)) {
      if (value.length === 0) return "∅";
      return value.join(", ");
    }
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function formatAttrDisplay(value, maxItems = 3) {
    const full = formatValue(value);
    if (!Array.isArray(value) || value.length <= maxItems) {
      return { display: full, full };
    }
    return {
      display: `${value.slice(0, maxItems).join(", ")} +${value.length - maxItems} more`,
      full,
    };
  }

  function buildAttrMaps(decodePositions, encodePositions) {
    const decodeFor = new Map();
    const encodeFor = new Map();

    if (decodePositions) {
      for (const pos of decodePositions) {
        if (!pos?.attrs_set) continue;
        for (const attr of Object.keys(pos.attrs_set)) {
          decodeFor.set(attr, pos.name);
        }
      }
    }

    if (encodePositions) {
      for (const pos of encodePositions) {
        if (!pos?.chosen_attrs) continue;
        for (const attr of Object.keys(pos.chosen_attrs)) {
          encodeFor.set(attr, pos.name);
        }
      }
    }

    return { decodeFor, encodeFor };
  }

  function sortBreakdown(breakdown, decodeFor, encodeFor) {
    const rank = (item) => {
      if (item.score_is_skip) return 6;
      const mapped = decodeFor.has(item.name) || encodeFor.has(item.name);
      const score = item.score ?? 1;
      const hardFail =
        (item.role === "gate" &&
          (item.gate_status === "fail" || item.gate_status === "missing")) ||
        (item.role === "scored" && score === 0);
      const partial =
        !hardFail && item.role === "scored" && score < 1;
      if (mapped) {
        if (hardFail) return 1;
        if (partial) return 2;
        return 4;
      }
      if (hardFail || partial) return 3;
      return 5;
    };

    const gateOrder = (status) =>
      status === "fail" ? 0 : status === "missing" ? 1 : 2;

    return [...breakdown].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;

      const ga = a.role === "gate" ? 0 : 1;
      const gb = b.role === "gate" ? 0 : 1;
      if (ga !== gb) return ga - gb;

      if (a.role === "gate" && b.role === "gate") {
        const oa = gateOrder(a.gate_status);
        const ob = gateOrder(b.gate_status);
        if (oa !== ob) return oa - ob;
      }

      const sa = a.score ?? 1;
      const sb = b.score ?? 1;
      if (sa === sb) return a.name.localeCompare(b.name);
      return sa - sb;
    });
  }

  function scoreBarClass(score, isGate) {
    if (isGate) return score === 1 ? "opm-match-graph__bar-fill--gate-pass" : "opm-match-graph__bar-fill--gate-fail";
    if (score >= 0.8) return "opm-match-graph__bar-fill--high";
    if (score >= 0.5) return "opm-match-graph__bar-fill--mid";
    return "opm-match-graph__bar-fill--low";
  }

  function scoreCellHtml(item) {
    if (item?.score_is_skip) {
      return `<span class="opm-match-graph__skipped">skipped</span>`;
    }
    if (item?.score == null) {
      return `<span class="opm-match-graph__skipped">—</span>`;
    }

    const pct = Math.round(Number(item.score) * 100);
    const isGate = item.role === "gate";
    const barClass = scoreBarClass(Number(item.score), isGate);

    return `<div class="opm-match-graph__score-metrics">
      <div class="opm-match-graph__bar-track">
        <div class="opm-match-graph__bar-fill ${barClass}" style="width:${pct}%"></div>
      </div>
      <span class="opm-match-graph__score-pct">${pct}%</span>
      <span class="opm-match-graph__score-weight">w${escapeHtml(String(item.weight ?? ""))}</span>
    </div>`;
  }

  function gateBadge(item) {
    if (item.role !== "gate" || !item.gate_status) return "";
    if (item.gate_status === "pass") {
      return `<span class="opm-match-graph__gate opm-match-graph__gate--pass">gate ✓</span>`;
    }
    if (item.gate_status === "missing") {
      return `<span class="opm-match-graph__gate opm-match-graph__gate--missing">gate ?</span>`;
    }
    return `<span class="opm-match-graph__gate opm-match-graph__gate--fail">gate ✗</span>`;
  }

  function chosenCodeLabel(pos) {
    if (pos.chosen_code != null) return String(pos.chosen_code);
    return "?";
  }

  function decodeTokenLabel(pos) {
    const match = pos.all_codes?.find(
      (c) => c.code?.toLowerCase() === pos.token?.toLowerCase()
    );
    return match?.code ?? pos.token ?? "?";
  }

  function snippetForDecode(pos) {
    const match = pos.all_codes?.find(
      (c) => c.code?.toLowerCase() === pos.token?.toLowerCase()
    );
    return match?.source?.snippet || "";
  }

  function snippetForEncode(pos) {
    const match = pos.all_codes?.find((c) => c.code === pos.chosen_code);
    return match?.source?.snippet || "";
  }

  function renderDecodeColumn(positions, obsEntry, matchMode, rowSpan) {
    const rows = (positions || [])
      .map((pos) => {
        const token = decodeTokenLabel(pos);
        const unknown = pos.token === "?" || !pos.token;
        const snippet = snippetForDecode(pos);
        return `<div class="opm-match-graph__pos-row" data-ref="obs-pos-row:${escapeHtml(pos.name)}">
          <span class="opm-match-graph__pos-name">${escapeHtml(pos.name)}</span>
          ${snippet ? `<span class="opm-match-graph__pos-snippet">${escapeHtml(snippet)}</span>` : ""}
          <span class="opm-match-graph__pos-code${unknown ? " opm-match-graph__pos-code--unknown" : ""}" data-ref="obs-pos-token:${escapeHtml(pos.name)}">${escapeHtml(token)}</span>
        </div>`;
      })
      .join("");

    const emptyNote =
      !positions?.length && matchMode === "series"
        ? `<div class="opm-match-graph__series-note">series match — no obs SKU</div>`
        : "";

    const entryRow = obsEntry
      ? `<div class="opm-match-graph__entry-row">
          <span class="opm-match-graph__pos-name">entry</span>
          <span class="opm-match-graph__entry-code" data-ref="obs-entry">${escapeHtml(obsEntry)}</span>
        </div>`
      : "";

    return `<div class="opm-match-graph__sku-col opm-match-graph__sku-col--obs" style="grid-column:1;grid-row:2 / span ${rowSpan}">
      ${emptyNote}
      ${rows}
      ${entryRow}
    </div>`;
  }

  function renderEncodeColumn(positions, candEntry, rowSpan) {
    const rows = (positions || [])
      .map((pos) => {
        const code = chosenCodeLabel(pos);
        const unknown = pos.chosen_code == null;
        const snippet = snippetForEncode(pos);
        return `<div class="opm-match-graph__pos-row opm-match-graph__pos-row--cand" data-ref="cand-pos-row:${escapeHtml(pos.name)}">
          <span class="opm-match-graph__pos-code${unknown ? " opm-match-graph__pos-code--unknown" : ""}" data-ref="cand-pos-token:${escapeHtml(pos.name)}">${escapeHtml(code)}</span>
          ${snippet ? `<span class="opm-match-graph__pos-snippet">${escapeHtml(snippet)}</span>` : ""}
          <span class="opm-match-graph__pos-name opm-match-graph__pos-name--right">${escapeHtml(pos.name)}</span>
        </div>`;
      })
      .join("");

    const entryRow = candEntry
      ? `<div class="opm-match-graph__entry-row opm-match-graph__entry-row--cand">
          <span class="opm-match-graph__entry-code" data-ref="cand-entry">${escapeHtml(candEntry)}</span>
          <span class="opm-match-graph__pos-name opm-match-graph__pos-name--right">entry</span>
        </div>`
      : "";

    return `<div class="opm-match-graph__sku-col opm-match-graph__sku-col--cand" style="grid-column:5;grid-row:2 / span ${rowSpan}">
      ${rows}
      ${entryRow}
    </div>`;
  }

  function renderGraph({
    breakdown = [],
    decodePositions = [],
    encodePositions = [],
    obsEntry = "",
    candEntry = "",
    matchMode = "sku",
  } = {}) {
    if (!breakdown.length) {
      return '<p class="opm-rec__muted">No specification comparison available.</p>';
    }

    const { decodeFor, encodeFor } = buildAttrMaps(
      decodePositions,
      encodePositions
    );
    const sorted = sortBreakdown(breakdown, decodeFor, encodeFor);
    const rowSpan = Math.max(sorted.length, 1);

    const attrRows = sorted
      .map((item) => {
        const obsVal = formatAttrDisplay(item.obs?.value);
        const candVal = formatAttrDisplay(item.cand?.value);
        const obsUnmapped = !decodeFor.has(item.name);
        const candUnmapped = !encodeFor.has(item.name);

        return `<div class="opm-match-graph__attr-cell opm-match-graph__attr-cell--obs" style="grid-column:2" data-ref="obs-attr:${escapeHtml(item.name)}" title="${escapeHtml(obsVal.full)}">
            <div class="opm-match-graph__attr-value">${escapeHtml(obsVal.display)}${
              item.obs?.unit
                ? `<span class="opm-match-graph__attr-unit">${escapeHtml(item.obs.unit)}</span>`
                : ""
            }</div>
            ${obsUnmapped ? `<div class="opm-match-graph__attr-entry-hint">entry</div>` : ""}
          </div>
          <div class="opm-match-graph__score-cell" style="grid-column:3" data-ref="score:${escapeHtml(item.name)}">
            <div class="opm-match-graph__score-name">${escapeHtml(item.name)}${gateBadge(item)}</div>
            ${scoreCellHtml(item)}
          </div>
          <div class="opm-match-graph__attr-cell opm-match-graph__attr-cell--cand" style="grid-column:4" data-ref="cand-attr:${escapeHtml(item.name)}" title="${escapeHtml(candVal.full)}">
            <div class="opm-match-graph__attr-value">${escapeHtml(candVal.display)}${
              item.cand?.unit
                ? `<span class="opm-match-graph__attr-unit">${escapeHtml(item.cand.unit)}</span>`
                : ""
            }</div>
            ${candUnmapped ? `<div class="opm-match-graph__attr-entry-hint">entry</div>` : ""}
          </div>`;
      })
      .join("");

    const mapAttrs = `data-decode-map="${escapeHtml(JSON.stringify(Object.fromEntries(decodeFor)))}" data-encode-map="${escapeHtml(JSON.stringify(Object.fromEntries(encodeFor)))}"`;

    return `<div class="opm-match-graph">
      <div class="opm-match-graph__grid" data-opm-graph-root ${mapAttrs}>
        <svg class="opm-match-graph__svg" aria-hidden="true"></svg>
        <div class="opm-match-graph__hdr">Observed SKU</div>
        <div class="opm-match-graph__hdr">Obs attributes</div>
        <div class="opm-match-graph__hdr">Score</div>
        <div class="opm-match-graph__hdr">Cand attributes</div>
        <div class="opm-match-graph__hdr opm-match-graph__hdr--right">Candidate SKU</div>
        ${renderDecodeColumn(decodePositions, obsEntry, matchMode, rowSpan)}
        ${renderEncodeColumn(encodePositions, candEntry, rowSpan)}
        ${attrRows}
      </div>
    </div>`;
  }

  function rightMid(el, frame) {
    const r = el.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    return {
      x: r.right - f.left,
      y: r.top + r.height / 2 - f.top,
    };
  }

  function leftMid(el, frame) {
    const r = el.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    return {
      x: r.left - f.left,
      y: r.top + r.height / 2 - f.top,
    };
  }

  function bezierPath(x1, y1, x2, y2) {
    const i = Math.max(20, Math.abs(x2 - x1) * 0.5);
    return `M ${x1},${y1} C ${x1 + i},${y1} ${x2 - i},${y2} ${x2},${y2}`;
  }

  function resolveRef(grid, kind, name) {
    const token = grid.querySelector(`[data-ref="${kind}-token:${CSS.escape(name)}"]`);
    if (token) return token;
    const row = grid.querySelector(`[data-ref="${kind}-row:${CSS.escape(name)}"]`);
    if (row) return row;
    return grid.querySelector(`[data-ref="${kind}-entry"]`);
  }

  function paintLinks(grid) {
    const svg = grid.querySelector(".opm-match-graph__svg");
    if (!svg) return;

    let decodeMap = {};
    let encodeMap = {};
    try {
      decodeMap = JSON.parse(grid.getAttribute("data-decode-map") || "{}");
      encodeMap = JSON.parse(grid.getAttribute("data-encode-map") || "{}");
    } catch {
      decodeMap = {};
      encodeMap = {};
    }

    const breakdownNames = [
      ...grid.querySelectorAll('[data-ref^="obs-attr:"]'),
    ].map((el) => el.getAttribute("data-ref").slice("obs-attr:".length));

    const obsEntry = grid.querySelector('[data-ref="obs-entry"]');
    const candEntry = grid.querySelector('[data-ref="cand-entry"]');

    const frameRect = grid.getBoundingClientRect();
    svg.setAttribute("width", String(Math.ceil(frameRect.width)));
    svg.setAttribute("height", String(Math.ceil(frameRect.height)));
    svg.innerHTML = "";

    const paths = [];

    for (const attrName of breakdownNames) {
      const obsAttr = grid.querySelector(
        `[data-ref="obs-attr:${CSS.escape(attrName)}"]`
      );
      const candAttr = grid.querySelector(
        `[data-ref="cand-attr:${CSS.escape(attrName)}"]`
      );

      const obsPosName = decodeMap[attrName];
      const candPosName = encodeMap[attrName];

      const obsSource =
        (obsPosName && resolveRef(grid, "obs-pos", obsPosName)) || obsEntry;
      if (obsAttr && obsSource) {
        const p1 = rightMid(obsSource, grid);
        const p2 = leftMid(obsAttr, grid);
        paths.push({
          side: "obs",
          attr: attrName,
          d: bezierPath(p1.x, p1.y, p2.x, p2.y),
        });
      }

      const candTarget =
        (candPosName && resolveRef(grid, "cand-pos", candPosName)) || candEntry;
      if (candAttr && candTarget) {
        const p1 = rightMid(candAttr, grid);
        const p2 = leftMid(candTarget, grid);
        paths.push({
          side: "cand",
          attr: attrName,
          d: bezierPath(p1.x, p1.y, p2.x, p2.y),
        });
      }
    }

    for (const path of paths) {
      const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
      el.setAttribute("d", path.d);
      el.setAttribute("class", `opm-match-graph__link opm-match-graph__link--${path.side}`);
      el.setAttribute("data-attr", path.attr);
      svg.appendChild(el);
    }
  }

  function wireGraphLinks(root) {
    const grid = root?.querySelector?.("[data-opm-graph-root]");
    if (!grid) return;

    const repaint = () => paintLinks(grid);

    if (grid._opmGraphResizeObserver) {
      grid._opmGraphResizeObserver.disconnect();
    }

    repaint();

    const ro = new ResizeObserver(repaint);
    ro.observe(grid);
    grid._opmGraphResizeObserver = ro;

    if (grid._opmGraphResizeHandler) {
      window.removeEventListener("resize", grid._opmGraphResizeHandler);
    }
    grid._opmGraphResizeHandler = repaint;
    window.addEventListener("resize", repaint);
  }

  global.OpmPartsMatchGraph = {
    buildAttrMaps,
    renderGraph,
    sortBreakdown,
    wireGraphLinks,
  };
})(window);
