# Dryer Backend (Node.js)

## Run

1. Copy `.env.example` to `.env` and fill values.
2. Start PostgreSQL Docker:

```bash
docker compose up -d
```

3. Install dependencies:

```bash
npm install
```

4. Seed sample data:

```bash
npm run seed
```

5. Start in development:

```bash
npm run dev
```

6. Start in production mode:

```bash
npm start
```

## API Base

- `http://localhost:3000/api/v1`

## Notes

- JWT authentication is required for all endpoints except `POST /auth/login`.
- MQTT is optional and controlled by `MQTT_ENABLED`.
- Lamp feed supports aliases: `AIO_FEED_LAMP` or `AIO_FEED_LED` or `AIO_FEED_LIGHT`.
- Adafruit MQTT temp/hum ingestion can be mapped to DB sensor ids via:
    - `AIO_SENSOR_ID_TEMP`
    - `AIO_SENSOR_ID_HUM`

## Project Code Structure

Tổng cộng có 20 file code chính trong dự án (không tính tài liệu và các file cấu hình không phải mã nguồn):

- `src/app.js` – cấu hình Express, middleware và đường dẫn API chung.
- `src/server.js` – khởi động server, kết nối DB và MQTT.

Thư mục `src`:
- `src/config/` (3 file): cấu hình database, môi trường và MQTT.
- `src/middleware/` (2 file): xử lý xác thực JWT và bắt lỗi chung.
- `src/routes/` (6 file): định nghĩa các endpoint API chính.
- `src/services/` (3 file): logic nghiệp vụ cho log, scope và sensor.
- `src/utils/` (3 file): helper dùng lại trong toàn bộ app.

Ngoài ra:
- `scripts/seed.js` – chạy seed dữ liệu mẫu vào database.

### Mục đích chính của từng phần

- `src/config/` – chứa cấu hình môi trường và kết nối.
- `src/middleware/` – chứa middleware bảo mật và xử lý lỗi.
- `src/routes/` – chứa các route API cho máy sấy, người dùng, cấu trúc, catalog, batch và monitoring.
- `src/services/` – tách logic xử lý dữ liệu ra khỏi route.
- `src/utils/` – hỗ trợ xử lý bất đồng bộ, lỗi HTTP và helper đường dẫn route.
