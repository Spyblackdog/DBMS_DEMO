const connPill = document.getElementById("connPill");
const sinceIdEl = document.getElementById("sinceId");
const logEl = document.getElementById("log");

const lastIdEl = document.getElementById("lastId");
const lastLabelEl = document.getElementById("lastLabel");
const lastLatEl = document.getElementById("lastLat");
const lastLngEl = document.getElementById("lastLng");
const lastTimeEl = document.getElementById("lastTime");
const followEl = document.getElementById("follow");

function setPill(state, text) {
  connPill.classList.remove("ok", "bad");
  if (state) connPill.classList.add(state);
  connPill.textContent = text;
}

function log(line) {
  const now = new Date().toISOString().replace("T", " ").replace("Z", "Z");
  logEl.textContent = `[${now}] ${line}\n` + logEl.textContent;
}

// Map
const startCenter = [10.7769, 106.7009]; // HCMC default
const map = L.map("map", { zoomControl: true }).setView(startCenter, 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

const markers = new Map(); // id -> marker
const layerGroups = {}; // layerName -> L.LayerGroup
const LAYER_LABELS = { road: "Đường", garbadge: "Bãi rác", bounds: "Ranh giới", "instruction-generated": "Hướng dẫn", building: "Công trình" };
const LAYER_STYLES = {
  road: { color: "#78716c", weight: 3, fillColor: "transparent", fillOpacity: 0 },
  garbadge: { color: "#2563eb", weight: 2, fillColor: "#3b82f6", fillOpacity: 0.5 },
  bounds: { color: "#22c55e", weight: 2, fillColor: "#22c55e", fillOpacity: 0.2 },
  "instruction-generated": { color: "#f97316", weight: 2, fillColor: "#fb923c", fillOpacity: 0.4 },
  building: { color: "#64748b", weight: 1, fillColor: "#94a3b8", fillOpacity: 0.5 }
};
let lastId = 0;

function upsertPoint(p) {
  const id = Number(p.id);
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  const label = p.label ?? "";
  const createdAt = p.created_at ?? null;

  const popup = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; font-size: 13px;">
      <div style="font-weight: 700; margin-bottom: 6px;">${escapeHtml(label || "tracking_point")}</div>
      <div><b>ID</b>: ${id}</div>
      <div><b>Lat</b>: ${lat}</div>
      <div><b>Lng</b>: ${lng}</div>
      <div><b>Time</b>: ${escapeHtml(String(createdAt ?? ""))}</div>
    </div>
  `;

  if (markers.has(id)) {
    const m = markers.get(id);
    m.setLatLng([lat, lng]);
    m.setPopupContent(popup);
  } else {
    const m = L.marker([lat, lng]).addTo(map);
    m.bindPopup(popup);
    markers.set(id, m);
  }

  lastId = Math.max(lastId, id);
  sinceIdEl.textContent = String(lastId);

  lastIdEl.textContent = String(id);
  lastLabelEl.textContent = label || "-";
  lastLatEl.textContent = Number.isFinite(lat) ? lat.toFixed(6) : "-";
  lastLngEl.textContent = Number.isFinite(lng) ? lng.toFixed(6) : "-";
  lastTimeEl.textContent = createdAt ? String(createdAt) : "-";

  if (followEl.checked) {
    map.panTo([lat, lng], { animate: true, duration: 0.5 });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return c;
    }
  });
}

function renderLayerToggles() {
  const el = document.getElementById("layerToggles");
  if (!el) return;
  el.innerHTML = "";
  for (const [key, group] of Object.entries(layerGroups)) {
    const label = LAYER_LABELS[key] ?? key;
    const chk = document.createElement("label");
    chk.className = "chk";
    chk.innerHTML = `<input type="checkbox" data-layer="${escapeHtml(key)}" checked /> ${escapeHtml(label)}`;
    chk.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) map.addLayer(group);
      else map.removeLayer(group);
    });
    el.appendChild(chk);
  }
}

function connectStream() {
  setPill("", "Đang kết nối…");
  const url = `/api/stream?sinceId=${encodeURIComponent(String(lastId))}`;
  const es = new EventSource(url);

  es.addEventListener("hello", (ev) => {
    setPill("ok", "Đã kết nối (SSE)");
    try {
      const msg = JSON.parse(ev.data);
      log(`hello sinceId=${msg.sinceId}`);
    } catch {
      log("hello");
    }
  });

  es.addEventListener("points", (ev) => {
    const msg = JSON.parse(ev.data);
    const rows = msg.rows ?? [];
    if (rows.length > 0) {
      for (const p of rows) upsertPoint(p);
      log(`+${rows.length} point(s), lastId=${msg.sinceId}`);
    }
  });

  es.addEventListener("ping", () => {
    // ignore
  });

  es.onerror = () => {
    setPill("bad", "Mất kết nối – tự reconnect…");
    es.close();
    setTimeout(connectStream, 1200);
  };
}

async function loadGeometryLayers() {
  try {
    const r = await fetch("/api/geometry?limit=500");
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      const text = await r.text();
      const preview = text.slice(0, 80).replace(/\s+/g, " ");
      log(`geometry: API trả về HTML thay vì JSON (${r.status}). Kiểm tra: chạy qua http://localhost:5173, restart server.`);
      return;
    }
    const j = await r.json();
    if (!j.ok) {
      log(`geometry: ${j.error ?? "lỗi"}${j.hint ? " " + j.hint : ""}`);
      return;
    }
    const features = j.features ?? [];
    Object.values(layerGroups).forEach((g) => map.removeLayer(g));
    Object.keys(layerGroups).forEach((k) => delete layerGroups[k]);
    const layerCount = {};
    for (const f of features) {
      if (!f.geometry) continue;
      const layerName = f.properties?.layer ?? "other";
      layerCount[layerName] = (layerCount[layerName] || 0) + 1;
      if (!layerGroups[layerName]) layerGroups[layerName] = L.layerGroup().addTo(map);
      const style = LAYER_STYLES[layerName] ?? { color: "#6b7280", weight: 2, fillColor: "#9ca3af", fillOpacity: 0.4 };
      const geojsonLayer = L.geoJSON(
        { type: "Feature", geometry: f.geometry, properties: f.properties ?? {} },
        {
          style,
          onEachFeature: (feat, lyr) => {
            const name = LAYER_LABELS[feat.properties?.layer] ?? feat.properties?.layer ?? "layer";
            lyr.bindPopup(`<b>${escapeHtml(String(name))}</b> (gid: ${feat.properties?.gid ?? "-"})`);
          }
        }
      );
      geojsonLayer.eachLayer((l) => layerGroups[layerName].addLayer(l));
    }
    const total = features.length;
    if (total > 0) {
      const parts = Object.entries(layerCount).map(([k, v]) => `${LAYER_LABELS[k] ?? k}: ${v}`).join(", ");
      log(`geometry: đã tải ${total} đối tượng (${parts})`);
    }
    renderLayerToggles();
  } catch (e) {
    log(`geometry error: ${String(e?.message ?? e)}`);
  }
}

// Initial fetch (so map isn't empty if SSE starts late)
async function initialLoad() {
  await loadGeometryLayers();
  try {
    const r = await fetch(`/api/points?sinceId=0&limit=200`);
    const j = await r.json();
    const rows = j.rows ?? [];
    if (rows.length > 0) {
      rows.forEach(upsertPoint);
      const last = rows[rows.length - 1];
      map.setView([Number(last.lat), Number(last.lng)], 14);
      log(`initial loaded ${rows.length} point(s)`);
    } else {
      log("initial: no points (tracking_points empty?)");
    }
  } catch (e) {
    log(`initial error: ${String(e?.message ?? e)}`);
  }
}

await initialLoad();
connectStream();

