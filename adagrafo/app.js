/* ADA Grafos — grafo de menções positivas/negativas entre candidatos */
(() => {
  "use strict";

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $("graph-canvas");
  const ctx = canvas.getContext("2d");
  const tooltip = $("tooltip");
  const fileInput = $("file-input");

  // ---------- Estado ----------
  const S = {
    nodes: [],
    nodeById: new Map(),
    mentions: [],
    pairLinks: [],
    edges: [],
    categories: [],
    activeCats: new Set(),
    showPos: true,
    showNeg: true,
    maxCount: 1,
    transform: d3.zoomIdentity,
    hoverEdge: null,
    hoverNode: null,
    focusNode: null,
    pinned: false,
    sim: null,
    width: 0,
    height: 0,
    dpr: 1,
  };

  const COLORS = {
    pos: { h: 152, s0: 35, s1: 80, l0: 32, l1: 58 },
    neg: { h: 350, s0: 40, s1: 92, l0: 38, l1: 64 },
  };

  // ---------- Utilidades ----------
  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const shortName = (name) => {
    const p = name.trim().split(/\s+/);
    return p.length <= 2 ? p.join(" ") : `${p[0]} ${p[p.length - 1]}`;
  };

  function detectDelimiter(text) {
    const eol = text.search(/\r|\n/);
    const line = text.slice(0, eol === -1 ? 5000 : eol);
    const count = (ch) => line.split(ch).length - 1;
    const c = { ",": count(","), ";": count(";"), "\t": count("\t") };
    return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
  }

  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const d = detectDelimiter(text);
    const rows = [];
    let row = [], field = "", q = false;
    const push = () => {
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    };
    for (let i = 0, n = text.length; i < n; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else q = false;
        } else field += c;
      } else if (c === '"') q = true;
      else if (c === d) { row.push(field); field = ""; }
      else if (c === "\r" || c === "\n") push();
      else field += c;
    }
    if (field !== "" || row.length) push();
    return rows;
  }

  // ---------- Mapeamento de colunas ----------
  const COLS = {
    authorId: ["codigo ac do autor", "id do autor", "codigo do autor"],
    authorName: ["nome do autor", "autor"],
    targetId: ["codigo ac do avaliado", "id do avaliado", "codigo do avaliado"],
    targetName: ["nome do avaliado", "avaliado"],
    type: ["tipo de mencao", "tipo"],
    attr: ["atributo", "categoria"],
    choice: ["escolha"],
    comment: ["comentario", "comentario original"],
    question: ["pergunta original", "pergunta"],
  };

  function mapColumns(header) {
    const h = header.map(norm);
    const idx = {};
    for (const [key, names] of Object.entries(COLS)) {
      idx[key] = -1;
      for (const n of names) {
        const i = h.indexOf(n);
        if (i !== -1) { idx[key] = i; break; }
      }
    }
    return idx;
  }

  // ---------- Construção do grafo ----------
  function buildData(text) {
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error("O arquivo está vazio ou não possui linhas de dados.");
    const idx = mapColumns(rows[0]);
    const missing = [];
    if (idx.authorName < 0 && idx.authorId < 0) missing.push("Nome do autor");
    if (idx.targetName < 0 && idx.targetId < 0) missing.push("Nome do avaliado");
    if (idx.type < 0) missing.push("Tipo de menção");
    if (missing.length) throw new Error(`Colunas obrigatórias não encontradas: ${missing.join(", ")}.`);

    const get = (r, k) => (idx[k] >= 0 ? (r[idx[k]] ?? "").trim() : "");
    const nodeById = new Map();
    const mentions = [];
    const ensureNode = (id, name) => {
      let n = nodeById.get(id);
      if (!n) {
        n = { id, name: name || id, recvPos: 0, recvNeg: 0, givePos: 0, giveNeg: 0 };
        n.short = shortName(n.name);
        nodeById.set(id, n);
      }
      return n;
    };

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const aName = get(r, "authorName"), tName = get(r, "targetName");
      const aId = get(r, "authorId") || aName, tId = get(r, "targetId") || tName;
      if (!aId || !tId || aId === tId) continue;
      const t = norm(get(r, "type"));
      const type = t.startsWith("posit") ? "pos" : t.startsWith("negat") ? "neg" : null;
      if (!type) continue;
      const a = ensureNode(aId, aName), b = ensureNode(tId, tName);
      if (type === "pos") { a.givePos++; b.recvPos++; } else { a.giveNeg++; b.recvNeg++; }
      mentions.push({
        src: aId, tgt: tId, type,
        attr: get(r, "attr") || "Sem categoria",
        choice: get(r, "choice"),
        comment: get(r, "comment"),
        question: get(r, "question"),
      });
    }
    if (!mentions.length) throw new Error("Nenhuma menção Positiva/Negativa válida foi encontrada.");

    const nodes = [...nodeById.values()];
    nodes.forEach((n) => {
      n.r = 7 + Math.sqrt(n.recvPos + n.recvNeg) * 1.7;
    });

    // Links não direcionais para o layout (independem dos filtros)
    const pairMap = new Map();
    for (const m of mentions) {
      const k = m.src < m.tgt ? `${m.src}\u0000${m.tgt}` : `${m.tgt}\u0000${m.src}`;
      const p = pairMap.get(k);
      if (p) p.w++;
      else pairMap.set(k, { source: m.src, target: m.tgt, w: 1 });
    }

    const categories = [...new Set(mentions.map((m) => m.attr))];
    return { nodes, nodeById, mentions, pairLinks: [...pairMap.values()], categories };
  }

  function aggregateEdges() {
    const map = new Map();
    for (const m of S.mentions) {
      if (!S.activeCats.has(m.attr)) continue;
      if (m.type === "pos" && !S.showPos) continue;
      if (m.type === "neg" && !S.showNeg) continue;
      const k = `${m.src}\u0000${m.tgt}\u0000${m.type}`;
      let e = map.get(k);
      if (!e) {
        e = { source: S.nodeById.get(m.src), target: S.nodeById.get(m.tgt), type: m.type, items: [] };
        map.set(k, e);
      }
      e.items.push(m);
    }
    const edges = [...map.values()];

    // Agrupar por par para calcular curvaturas (ida e volta separadas)
    const pairs = new Map();
    for (const e of edges) {
      const a = e.source.id < e.target.id ? e.source : e.target;
      e.canonA = a;
      e.canonB = a === e.source ? e.target : e.source;
      const k = `${e.canonA.id}\u0000${e.canonB.id}`;
      (pairs.get(k) || pairs.set(k, []).get(k)).push(e);
    }
    for (const list of pairs.values()) {
      const fwd = list.filter((e) => e.source === e.canonA).sort((x, y) => (x.type < y.type ? 1 : -1));
      const bwd = list.filter((e) => e.source !== e.canonA).sort((x, y) => (x.type < y.type ? 1 : -1));
      if (fwd.length && bwd.length) {
        fwd.forEach((e, j) => (e.curve = j + 1));
        bwd.forEach((e, j) => (e.curve = -(j + 1)));
      } else {
        const one = fwd.length ? fwd : bwd;
        if (one.length === 1) one[0].curve = 0;
        else one.forEach((e, j) => (e.curve = j === 0 ? 1 : -1));
      }
    }

    const observedMax = edges.reduce((m, e) => Math.max(m, e.items.length), 1);
    S.maxCount = observedMax;
    edges.forEach((e) => (e.t = S.maxCount > 1 ? (e.items.length - 1) / (S.maxCount - 1) : 1));
    edges.sort((a, b) => a.items.length - b.items.length);
    S.edges = edges;

    // Lado oposto (para mostrar no tooltip)
    const byKey = new Map(edges.map((e) => [`${e.source.id}\u0000${e.target.id}\u0000${e.type}`, e]));
    edges.forEach((e) => {
      e.reverse = ["pos", "neg"].map((t) => byKey.get(`${e.target.id}\u0000${e.source.id}\u0000${t}`)).filter(Boolean);
    });

    renderLegend();
    renderStats();
    requestRender();
  }

  // ---------- Cores ----------
  function edgeColor(type, t, alphaMul = 1) {
    const c = COLORS[type];
    const s = c.s0 + (c.s1 - c.s0) * t;
    const l = c.l0 + (c.l1 - c.l0) * t;
    const a = (0.35 + 0.65 * t) * alphaMul;
    return `hsla(${c.h}, ${s}%, ${l}%, ${a})`;
  }

  // ---------- Geometria das arestas ----------
  function edgeGeom(e) {
    const s = e.source, t = e.target;
    const a = e.canonA, b = e.canonB;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = -dy / dist, ny = dx / dist;
    const off = e.curve * Math.min(Math.max(dist * 0.14, 10), 42);
    const cx = (s.x + t.x) / 2 + nx * off * 2;
    const cy = (s.y + t.y) / 2 + ny * off * 2;

    let ux = cx - s.x, uy = cy - s.y, ul = Math.hypot(ux, uy) || 1;
    const sx = s.x + (ux / ul) * (s.r + 1), sy = s.y + (uy / ul) * (s.r + 1);
    let vx = t.x - cx, vy = t.y - cy, vl = Math.hypot(vx, vy) || 1;
    const ex = t.x - (vx / vl) * (t.r + 2), ey = t.y - (vy / vl) * (t.r + 2);
    return { sx, sy, cx, cy, ex, ey, ang: Math.atan2(ey - cy, ex - cx) };
  }

  function distToEdge(e, px, py) {
    const g = edgeGeom(e);
    let best = Infinity, lx = g.sx, ly = g.sy;
    const N = 16;
    for (let i = 1; i <= N; i++) {
      const t = i / N, mt = 1 - t;
      const x = mt * mt * g.sx + 2 * mt * t * g.cx + t * t * g.ex;
      const y = mt * mt * g.sy + 2 * mt * t * g.cy + t * t * g.ey;
      best = Math.min(best, segDist(px, py, lx, ly, x, y));
      lx = x; ly = y;
    }
    return best;
  }

  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  // ---------- Renderização ----------
  let raf = 0;
  function requestRender() {
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); });
  }

  function resize() {
    S.dpr = window.devicePixelRatio || 1;
    S.width = window.innerWidth;
    S.height = window.innerHeight;
    canvas.width = S.width * S.dpr;
    canvas.height = S.height * S.dpr;
    requestRender();
  }

  function isActiveEdge(e, focus) {
    if (S.hoverEdge) return e === S.hoverEdge;
    if (focus) return e.source === focus || e.target === focus;
    return true;
  }

  function draw() {
    const { width, height, dpr, transform: T } = S;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!S.nodes.length) return;
    ctx.setTransform(dpr * T.k, 0, 0, dpr * T.k, dpr * T.x, dpr * T.y);

    const focus = S.focusNode || (S.hoverEdge ? null : S.hoverNode);
    const dimming = !!(focus || S.hoverEdge);
    const neighbors = new Set();
    if (focus) {
      neighbors.add(focus);
      S.edges.forEach((e) => {
        if (e.source === focus) neighbors.add(e.target);
        if (e.target === focus) neighbors.add(e.source);
      });
    }
    if (S.hoverEdge) { neighbors.add(S.hoverEdge.source); neighbors.add(S.hoverEdge.target); }

    // Arestas: inativas primeiro, depois ativas
    const passes = dimming ? [false, true] : [true];
    for (const activePass of passes) {
      for (const e of S.edges) {
        const active = isActiveEdge(e, focus);
        if (dimming && active !== activePass) continue;
        drawEdge(e, dimming && !active ? 0.07 : 1, e === S.hoverEdge);
      }
    }

    // Nós
    const showLabels = T.k > 0.55;
    for (const n of S.nodes) {
      const faded = dimming && !neighbors.has(n);
      drawNode(n, faded, n === S.hoverNode || n === S.focusNode);
    }
    // Rótulos
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const fs = 11 / Math.min(T.k, 1.6);
    for (const n of S.nodes) {
      const faded = dimming && !neighbors.has(n);
      const highlighted = neighbors.has(n);
      if (!showLabels && !highlighted) continue;
      ctx.font = `${highlighted ? 600 : 500} ${fs}px Inter, sans-serif`;
      ctx.lineWidth = 3 / T.k;
      ctx.strokeStyle = "rgba(11,14,23,0.85)";
      const y = n.y + n.r + 3 / T.k;
      ctx.strokeText(n.short, n.x, y);
      ctx.fillStyle = faded ? "rgba(200,205,225,0.15)" : highlighted ? "#ffffff" : "rgba(220,224,240,0.85)";
      ctx.fillText(n.short, n.x, y);
    }
  }

  function drawEdge(e, alphaMul, hovered) {
    const g = edgeGeom(e);
    const t = e.t;
    const w = (0.9 + 2.2 * t) * (hovered ? 1.6 : 1);
    const color = edgeColor(e.type, hovered ? 1 : t, alphaMul);
    const head = 5 + w * 1.6;

    // Linha termina na base da seta
    const bx = g.ex - Math.cos(g.ang) * head * 0.8;
    const by = g.ey - Math.sin(g.ang) * head * 0.8;

    if (hovered) {
      ctx.save();
      ctx.shadowColor = e.type === "pos" ? "rgba(52,211,153,0.8)" : "rgba(251,113,133,0.8)";
      ctx.shadowBlur = 14;
    }
    ctx.beginPath();
    ctx.moveTo(g.sx, g.sy);
    ctx.quadraticCurveTo(g.cx, g.cy, bx, by);
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = "butt";
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(g.ex, g.ey);
    ctx.lineTo(g.ex - head * Math.cos(g.ang - 0.42), g.ey - head * Math.sin(g.ang - 0.42));
    ctx.lineTo(g.ex - head * Math.cos(g.ang + 0.42), g.ey - head * Math.sin(g.ang + 0.42));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    if (hovered) ctx.restore();
  }

  function drawNode(n, faded, highlighted) {
    ctx.save();
    ctx.globalAlpha = faded ? 0.18 : 1;
    if (highlighted) {
      ctx.shadowColor = "rgba(139,140,248,0.9)";
      ctx.shadowBlur = 22;
    }
    const g = ctx.createRadialGradient(n.x - n.r * 0.35, n.y - n.r * 0.4, n.r * 0.1, n.x, n.y, n.r);
    g.addColorStop(0, highlighted ? "#e4e5ff" : "#c9cbff");
    g.addColorStop(0.45, highlighted ? "#8f92ff" : "#7376e6");
    g.addColorStop(1, highlighted ? "#3d3fb0" : "#2d2f86");
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = highlighted ? 2 / S.transform.k : 1 / S.transform.k;
    ctx.strokeStyle = highlighted ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.18)";
    ctx.stroke();
    ctx.restore();
  }

  // ---------- Hit testing ----------
  function worldPoint(ev) {
    const rect = canvas.getBoundingClientRect();
    return S.transform.invert([ev.clientX - rect.left, ev.clientY - rect.top]);
  }

  function findNode(x, y) {
    for (let i = S.nodes.length - 1; i >= 0; i--) {
      const n = S.nodes[i];
      if (Math.hypot(n.x - x, n.y - y) <= n.r + 2 / S.transform.k) return n;
    }
    return null;
  }

  function findEdge(x, y) {
    const tol = 6 / S.transform.k;
    const focus = S.focusNode;
    let best = null, bestD = tol;
    for (let i = S.edges.length - 1; i >= 0; i--) {
      const e = S.edges[i];
      if (focus && e.source !== focus && e.target !== focus) continue;
      const d = distToEdge(e, x, y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  // ---------- Tooltip ----------
  function mentionList(items, type) {
    return `<ul class="tt-list">${items
      .map(
        (m) => `<li class="${type}">
          <div class="tt-meta"><span class="tt-attr">${esc(m.attr)}</span>${m.choice ? `<span class="tt-choice">· ${esc(m.choice)}</span>` : ""}</div>
          ${m.comment ? `<p class="tt-comment">“${esc(m.comment)}”</p>` : `<p class="tt-comment empty">Sem comentário</p>`}
        </li>`
      )
      .join("")}</ul>`;
  }

  function edgeSection(e) {
    const label = e.type === "pos" ? "Positiva" : "Negativa";
    const n = e.items.length;
    return `<div class="tt-section">
      <div class="tt-route">${esc(e.source.name)}<span class="arrow ${e.type}">→</span>${esc(e.target.name)}</div>
      <span class="badge ${e.type}">${label} · ${n} ${n === 1 ? "menção" : "menções"}</span>
      ${mentionList(e.items, e.type)}
    </div>`;
  }

  function edgeTooltipHTML(e) {
    let html = edgeSection(e);
    if (S.pinned && e.reverse.length) html += e.reverse.map(edgeSection).join("");
    else if (e.reverse.length) html += `<div class="tt-hint">↔ Existe avaliação no sentido oposto · clique para fixar e ver tudo</div>`;
    else html += `<div class="tt-hint">Clique para fixar este painel</div>`;
    return html;
  }

  function nodeTooltipHTML(n) {
    return `<div class="tt-node-name">${esc(n.name)}</div>
      <div class="muted" style="font-size:11.5px">${esc(n.id !== n.name ? n.id : "")}</div>
      <div class="tt-grid">
        <span></span><span class="h">Recebidas</span><span class="h">Dadas</span>
        <span style="color:var(--pos)">● Positivas</span><b>${n.recvPos}</b><b>${n.givePos}</b>
        <span style="color:var(--neg)">● Negativas</span><b>${n.recvNeg}</b><b>${n.giveNeg}</b>
      </div>
      <div class="tt-hint">${S.focusNode === n ? "Clique para sair do foco" : "Clique para focar nas relações"}</div>`;
  }

  let lastMouse = { x: 0, y: 0 };
  function showTooltip(html, cx, cy) {
    tooltip.innerHTML = (S.pinned ? `<button class="tt-close" id="tt-close" title="Fechar">×</button>` : "") + html;
    tooltip.classList.add("show");
    tooltip.setAttribute("aria-hidden", "false");
    positionTooltip(cx, cy);
    if (S.pinned) $("tt-close").onclick = unpin;
  }
  function positionTooltip(cx, cy) {
    const pad = 16;
    const w = tooltip.offsetWidth, h = tooltip.offsetHeight;
    let x = cx + pad, y = cy + pad;
    if (x + w > S.width - 8) x = cx - w - pad;
    if (y + h > S.height - 8) y = Math.max(8, S.height - h - 8);
    tooltip.style.transform = "";
    tooltip.style.left = `${Math.max(8, x)}px`;
    tooltip.style.top = `${Math.max(8, y)}px`;
  }
  function hideTooltip() {
    tooltip.classList.remove("show", "pinned");
    tooltip.setAttribute("aria-hidden", "true");
  }
  function unpin() {
    S.pinned = false;
    S.hoverEdge = null;
    hideTooltip();
    requestRender();
  }

  // ---------- Interações ----------
  function onMove(ev) {
    if (S.pinned || !S.nodes.length) return;
    lastMouse = { x: ev.clientX, y: ev.clientY };
    const [x, y] = worldPoint(ev);
    const n = findNode(x, y);
    const e = n ? null : findEdge(x, y);
    const changed = n !== S.hoverNode || e !== S.hoverEdge;
    S.hoverNode = n;
    S.hoverEdge = e;
    canvas.classList.toggle("pointer", !!(n || e));
    if (e) showTooltip(edgeTooltipHTML(e), ev.clientX, ev.clientY);
    else if (n) showTooltip(nodeTooltipHTML(n), ev.clientX, ev.clientY);
    else hideTooltip();
    if (changed) requestRender();
  }

  function onClick(ev) {
    if (!S.nodes.length) return;
    const [x, y] = worldPoint(ev);
    const n = findNode(x, y);
    if (n) {
      if (S.pinned) unpin();
      S.focusNode = S.focusNode === n ? null : n;
      S.hoverNode = n;
      showTooltip(nodeTooltipHTML(n), ev.clientX, ev.clientY);
      requestRender();
      return;
    }
    const e = findEdge(x, y);
    if (e) {
      S.pinned = true;
      S.hoverEdge = e;
      S.hoverNode = null;
      showTooltip(edgeTooltipHTML(e), ev.clientX, ev.clientY);
      tooltip.classList.add("pinned");
      requestRender();
      return;
    }
    if (S.pinned) unpin();
    else if (S.focusNode) { S.focusNode = null; requestRender(); }
  }

  // ---------- Zoom / drag ----------
  const zoom = d3
    .zoom()
    .scaleExtent([0.08, 6])
    .on("zoom", (ev) => {
      S.transform = ev.transform;
      if (S.pinned) unpin();
      requestRender();
    });

  const drag = d3
    .drag()
    .container(canvas)
    .subject((ev) => {
      const [x, y] = S.transform.invert([ev.x, ev.y]);
      const n = findNode(x, y);
      return n ? { node: n, x: S.transform.applyX(n.x), y: S.transform.applyY(n.y) } : null;
    })
    .on("start", (ev) => {
      if (!ev.active) S.sim.alphaTarget(0.25).restart();
      const n = ev.subject.node;
      n.fx = n.x; n.fy = n.y;
      hideTooltip();
    })
    .on("drag", (ev) => {
      const n = ev.subject.node;
      const [x, y] = S.transform.invert([ev.x, ev.y]);
      n.fx = x; n.fy = y;
    })
    .on("end", (ev) => {
      if (!ev.active) S.sim.alphaTarget(0);
      const n = ev.subject.node;
      n.fx = null; n.fy = null;
    });

  d3.select(canvas).call(drag).call(zoom).on("dblclick.zoom", null);
  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("mouseleave", () => {
    if (S.pinned) return;
    S.hoverEdge = S.hoverNode = null;
    hideTooltip();
    requestRender();
  });

  function fitView(duration = 600) {
    if (!S.nodes.length) return;
    const xs = S.nodes.map((n) => n.x), ys = S.nodes.map((n) => n.y);
    const x0 = Math.min(...xs) - 40, x1 = Math.max(...xs) + 40;
    const y0 = Math.min(...ys) - 40, y1 = Math.max(...ys) + 40;
    const panelW = $("panel").classList.contains("hidden") ? 0 : 330;
    const W = S.width - panelW, H = S.height;
    const k = Math.min(W / (x1 - x0), H / (y1 - y0), 2.5) * 0.95;
    const t = d3.zoomIdentity
      .translate(panelW + W / 2, H / 2)
      .scale(k)
      .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    d3.select(canvas).transition().duration(duration).call(zoom.transform, t);
  }

  function focusOn(n) {
    S.focusNode = n;
    const k = Math.max(S.transform.k, 1.2);
    const panelW = 330;
    const t = d3.zoomIdentity
      .translate(panelW + (S.width - panelW) / 2, S.height / 2)
      .scale(k)
      .translate(-n.x, -n.y);
    d3.select(canvas).transition().duration(700).call(zoom.transform, t);
    requestRender();
  }

  // ---------- Painel ----------
  function renderStats() {
    const pos = S.edges.filter((e) => e.type === "pos");
    const neg = S.edges.filter((e) => e.type === "neg");
    const sum = (arr) => arr.reduce((s, e) => s + e.items.length, 0);
    $("stats").innerHTML = `
      <div class="stat"><b>${S.nodes.length}</b><span>Candidatos</span></div>
      <div class="stat"><b>${S.edges.length}</b><span>Setas visíveis</span></div>
      <div class="stat pos"><b>${sum(pos)}</b><span>Menções positivas</span></div>
      <div class="stat neg"><b>${sum(neg)}</b><span>Menções negativas</span></div>`;
  }

  function renderLegend() {
    const steps = [];
    for (let i = 1; i <= S.maxCount; i++) steps.push(S.maxCount > 1 ? (i - 1) / (S.maxCount - 1) : 1);
    const bar = (type) => steps.map((t) => `<i style="background:${edgeColor(type, t)}"></i>`).join("");
    $("legend").innerHTML = `
      <div class="legend-row"><span class="lbl">Positiva</span><span class="bar">${bar("pos")}</span></div>
      <div class="legend-row"><span class="lbl">Negativa</span><span class="bar">${bar("neg")}</span></div>
      <div class="legend-scale"><span>1</span><span>${S.maxCount}</span></div>`;
  }

  function renderChips() {
    const wrap = $("cat-chips");
    wrap.innerHTML = "";
    S.categories.forEach((c, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.id = `cat-chip-${i}`;
      b.className = "chip-btn" + (S.activeCats.has(c) ? " active" : "");
      b.textContent = c;
      b.onclick = () => {
        if (S.activeCats.has(c)) S.activeCats.delete(c);
        else S.activeCats.add(c);
        b.classList.toggle("active");
        resetHover();
        aggregateEdges();
      };
      wrap.appendChild(b);
    });
  }

  function resetHover() {
    S.hoverEdge = null;
    S.hoverNode = null;
    S.pinned = false;
    hideTooltip();
  }

  $("toggle-pos").onclick = (ev) => {
    S.showPos = !S.showPos;
    ev.currentTarget.classList.toggle("active", S.showPos);
    resetHover();
    aggregateEdges();
  };
  $("toggle-neg").onclick = (ev) => {
    S.showNeg = !S.showNeg;
    ev.currentTarget.classList.toggle("active", S.showNeg);
    resetHover();
    aggregateEdges();
  };

  $("search-input").addEventListener("change", (ev) => {
    const q = norm(ev.target.value);
    if (!q) { S.focusNode = null; requestRender(); return; }
    const n = S.nodes.find((x) => norm(x.name) === q) || S.nodes.find((x) => norm(x.name).includes(q));
    if (n) focusOn(n);
  });

  $("zoom-in").onclick = () => d3.select(canvas).transition().duration(250).call(zoom.scaleBy, 1.4);
  $("zoom-out").onclick = () => d3.select(canvas).transition().duration(250).call(zoom.scaleBy, 1 / 1.4);
  $("zoom-fit").onclick = () => fitView();
  $("export-png").onclick = () => {
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const o = out.getContext("2d");
    o.fillStyle = "#0b0e17";
    o.fillRect(0, 0, out.width, out.height);
    o.drawImage(canvas, 0, 0);
    const a = document.createElement("a");
    a.download = "grafo-mencoes.png";
    a.href = out.toDataURL("image/png");
    a.click();
  };

  // ---------- Carregamento ----------
  function loadText(text, fileName) {
    let data;
    try {
      data = buildData(text);
    } catch (err) {
      $("dz-error").textContent = err.message;
      if (S.nodes.length) alert(err.message);
      return;
    }
    $("dz-error").textContent = "";
    if (S.sim) S.sim.stop();
    resetHover();
    S.focusNode = null;

    Object.assign(S, data);
    S.activeCats = new Set(S.categories);
    S.showPos = S.showNeg = true;
    $("toggle-pos").classList.add("active");
    $("toggle-neg").classList.add("active");
    $("file-name").textContent = fileName;
    $("search-input").value = "";
    $("names-list").innerHTML = S.nodes
      .map((n) => n.name)
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .map((n) => `<option value="${esc(n)}"></option>`)
      .join("");

    $("dropzone").classList.add("hidden");
    $("panel").classList.remove("hidden");
    $("controls").classList.remove("hidden");

    renderChips();
    aggregateEdges();

    const maxW = d3.max(S.pairLinks, (l) => l.w) || 1;
    S.sim = d3
      .forceSimulation(S.nodes)
      .force("link", d3.forceLink(S.pairLinks).id((d) => d.id).distance(110).strength((l) => 0.08 + 0.25 * (l.w / maxW)))
      .force("charge", d3.forceManyBody().strength(-320).distanceMax(900))
      .force("collide", d3.forceCollide().radius((d) => d.r + 16))
      .force("x", d3.forceX().strength(0.04))
      .force("y", d3.forceY().strength(0.04))
      .stop();
    S.sim.tick(220);
    S.sim.alpha(0.08).on("tick", requestRender).restart();
    resize();
    fitView(0);
  }

  function readFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let text = reader.result;
      // Fallback para arquivos em Latin-1/Windows-1252 (Excel)
      if (text.includes("\uFFFD")) {
        const r2 = new FileReader();
        r2.onload = () => loadText(r2.result, file.name);
        r2.readAsText(file, "windows-1252");
        return;
      }
      loadText(text, file.name);
    };
    reader.readAsText(file, "utf-8");
  }

  fileInput.addEventListener("change", () => {
    readFile(fileInput.files[0]);
    fileInput.value = "";
  });

  // Drag & drop em qualquer lugar da tela
  let dragDepth = 0;
  const overlay = $("drag-overlay");
  window.addEventListener("dragenter", (e) => { e.preventDefault(); dragDepth++; overlay.classList.add("show"); });
  window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; overlay.classList.remove("show"); } });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    overlay.classList.remove("show");
    readFile(e.dataTransfer.files[0]);
  });

  window.addEventListener("resize", resize);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { unpin(); S.focusNode = null; requestRender(); }
  });
  resize();

  // Carregamento opcional via URL (?csv=arquivo.csv) quando servido por HTTP
  const qs = new URLSearchParams(location.search).get("csv");
  if (qs) fetch(qs).then((r) => r.text()).then((t) => loadText(t, qs)).catch(() => {});
})();
