# Realtime Map (PostgreSQL)

Web xem dữ liệu “gần thời gian thực” từ PostgreSQL trên bản đồ (Leaflet/OpenStreetMap).

## Yêu cầu

- Node.js 18+ (khuyến nghị 20+)
- PostgreSQL (local hoặc remote)

## Cài & chạy

1) Cài dependencies:

```bash
npm install
```

2) Tạo file cấu hình môi trường:

- Copy `.env.example` → `.env`
- Sửa `DATABASE_URL` cho đúng Postgres của bạn

3) Tạo bảng + dữ liệu mẫu (chạy trong Postgres):

- Chạy `db/schema.sql`
- (Tuỳ chọn) Chạy `db/seed.sql`

4) Chạy server:

```bash
npm run dev
```

Mở web tại `http://localhost:5173`

## Realtime demo nhanh

Trong một cửa sổ SQL khác, chạy:

- `db/simulate_realtime.sql`

Trang web sẽ tự cập nhật marker mới qua SSE endpoint `/api/stream`.

## API

- `GET /api/points?sinceId=0&limit=500`
- `GET /api/stream?sinceId=0` (Server-Sent Events)

