import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { pool, testConnection } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// 5 bảng geometry từ pgAdmin (UNION)
const LAYER_TABLES = (process.env.GEOMETRY_LAYERS || "road,garbadge,bounds,instruction-generated,building")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
// Quote identifier an toàn cho PostgreSQL (hỗ trợ tên có gạch ngang như "instruction-generated")
function quoteTable(name) {
  const n = name.replace(/\s+/g, "_");
  return /^[a-z0-9_]+$/.test(n) ? `public.${n}` : `public."${n}"`;
}
app.use(cors());
app.use(express.json());

const WEB_DIR = path.resolve(__dirname, "..", "web");

function toInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

async function fetchLatestPoints({ sinceId = 0, limit = 500 }) {
  const q = `
    select id, lat, lng, label, created_at
    from public.tracking_points
    where id > $1
    order by id asc
    limit $2
  `;
  const { rows } = await pool.query(q, [sinceId, limit]);
  return rows;
}

app.get("/api/points", async (req, res) => {
  try {
    const sinceId = toInt(req.query.sinceId, 0);
    const limit = toInt(req.query.limit, toInt(process.env.POINTS_LIMIT, 500));
    const rows = await fetchLatestPoints({ sinceId, limit });
    res.json({ ok: true, rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});

// Server-Sent Events stream: pushes new points in near realtime.
app.get("/api/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let closed = false;
  req.on("close", () => {
    closed = true;
  });

  let sinceId = toInt(req.query.sinceId, 0);
  const limit = toInt(req.query.limit, toInt(process.env.POINTS_LIMIT, 500));

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send("hello", { ok: true, sinceId });

  const intervalMs = 1500;
  const timer = setInterval(async () => {
    if (closed) return;
    try {
      const rows = await fetchLatestPoints({ sinceId, limit });
      if (rows.length > 0) {
        sinceId = rows[rows.length - 1].id;
        send("points", { ok: true, rows, sinceId });
      } else {
        send("ping", { ok: true, ts: Date.now() });
      }
    } catch (err) {
      send("error", { ok: false, error: String(err?.message ?? err) });
    }
  }, intervalMs);

  req.on("close", () => clearInterval(timer));
});

// Kiểm tra cấu hình geometry (debug)
app.get("/api/geometry/status", (req, res) => {
  res.json({ ok: true, layers: LAYER_TABLES });
});

// API trả về geometry từ 5 bảng (UNION) - nhiều layout trên 1 bản đồ
app.get("/api/geometry", async (req, res) => {
  if (LAYER_TABLES.length === 0) {
    return res.status(400).json({
      ok: false,
      error: "Chưa cấu hình GEOMETRY_LAYERS trong .env"
    });
  }
  try {
    const limit = toInt(req.query.limit, 500);
    const unions = LAYER_TABLES.map(
      (layer) =>
        `(SELECT '${layer}' AS layer, gid, ST_AsGeoJSON(ST_Transform(geom, 4326))::json AS geojson ` +
        `FROM ${quoteTable(layer)} WHERE geom IS NOT NULL LIMIT ${limit})`
    ).join("\n UNION ALL \n");
    const q = `SELECT * FROM (${unions}) t LIMIT ${limit * LAYER_TABLES.length}`;
    const { rows } = await pool.query(q);
    const features = rows.map((r, i) => ({
      type: "Feature",
      id: i + 1,
      properties: { layer: r.layer, gid: r.gid },
      geometry: typeof r.geojson === "string" ? JSON.parse(r.geojson) : r.geojson
    }));
    res.json({ ok: true, type: "FeatureCollection", features });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: String(err?.message ?? err),
      hint: "Kiểm tra GEOMETRY_LAYERS và các bảng: road, garbadge, bounds, instruction-generated, building."
    });
  }
});

app.use(express.static(WEB_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(WEB_DIR, "index.html"));
});

const port = toInt(process.env.PORT, 5173);
app.listen(port, async () => {
  console.log(`Server running: http://localhost:${port}`);
  try {
    await testConnection();
    console.log("Database: kết nối thành công.");
  } catch (err) {
    console.error("Database: lỗi kết nối:", err?.message ?? err);
    console.error("Kiểm tra .env: DATABASE_URL đúng user/password/database?");
    console.error("Nếu pgAdmin dùng database 'postgres', đổi DBNAME trong DATABASE_URL thành postgres.");
  }
});

