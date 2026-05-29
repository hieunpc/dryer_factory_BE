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

## File Mapping - Xử lý Chức Năng Nào

### 📋 Entry Points (Điểm khởi động)
| File | Chức năng |
|------|----------|
| `src/server.js` | Khởi động server, kết nối database, khởi tạo MQTT, lắng nghe port |
| `src/app.js` | Cấu hình Express app, middleware chung (body parser, CORS, logging) |

### ⚙️ Configuration (Cấu hình)
| File | Chức năng |
|------|----------|
| `src/config/env.js` | Đọc biến môi trường từ `.env`, validate cấu hình hệ thống |
| `src/config/db.js` | Kết nối PostgreSQL, query database |
| `src/config/mqtt.js` | Kết nối Adafruit MQTT, publish/subscribe IoT messages |

### 🔐 Middleware (Bảo mật & Xử lý)
| File | Chức năng |
|------|----------|
| `src/middleware/auth.js` | JWT authentication, kiểm tra quyền admin, lấy thông tin user |
| `src/middleware/errorHandler.js` | Catch lỗi toàn cục, trả về response lỗi chuẩn |

### 🛣️ Routes (API Endpoints)
| File | Chức năng |
|------|----------|
| `src/routes/api.js` | **Main router** - tổng hợp tất cả route con, xác định quyền truy cập |
| `src/routes/auth.js` | `POST /auth/login` - Đăng nhập, phát JWT token |
| `src/routes/users.js` | User management: CRUD user, cấp quyền admin, thay đổi mật khẩu |
| `src/routes/structure.js` | Quản lý cấu trúc: Areas, Dryers, Sensors, Controls |
| `src/routes/catalog.js` | Catalog: Fruits, Recipes, Phases (giai đoạn sấy), Policies (chính sách) |
| `src/routes/batches.js` | Batch operations: tạo/sửa/xóa batch, thay đổi status, điều khiển |
| `src/routes/monitoring.js` | Real-time monitoring: lấy sensor data, batch progress, event logs |

### 💼 Services (Business Logic - Logic Kinh Doanh)
| File | Chức năng |
|------|----------|
| `src/services/batchService.js` | Xử lý batch: tính phase hiện tại, thực thi phase actions, quản lý state |
| `src/services/sensorService.js` | Xử lý sensor data: nhập giá trị từ MQTT, lưu lịch sử |
| `src/services/scopeService.js` | RBAC: kiểm tra quyền truy cập dryer, đảm bảo user có quyền |
| `src/services/logService.js` | Ghi log: user actions, batch changes, control commands |

### 🛠️ Utils (Công cụ Hỗ trợ)
| File | Chức năng |
|------|----------|
| `src/utils/asyncHandler.js` | Wrapper cho async function trong route - catch lỗi tự động |
| `src/utils/httpError.js` | Custom class HttpError để tạo lỗi chuẩn API |
| `src/utils/routeHelpers.js` | Helper: parse boolean, validate enum, format response, v.v. |

### 📊 Scripts
| File | Chức năng |
|------|----------|
| `scripts/seed.js` | Seed dữ liệu mẫu: users, areas, dryers, sensors, catalog vào database |

### 📡 Database & Docker
| File | Chức năng |
|------|----------|
| `docker-compose.yml` | Docker config: PostgreSQL, volumes, networking |
| `docker/init.sql` | SQL script khởi tạo schema database |
| `alter_db.sql` / `SQLQueryDDL.sql` | SQL migrations, alterations |

### 📚 Documentation
| File | Chức năng |
|------|----------|
| `DOC-API-Dryer.md` | Chi tiết API endpoints, request/response examples |
| `Describe.md` | Mô tả dự án tổng quát |
| `INTEGRATION_FIXES.md` | Ghi chép các fix, bug, integration issues |

---

## 📍 Luồng Xử Lý Chính

### 1️⃣ Đăng Nhập
```
POST /api/v1/auth/login
  → src/routes/auth.js
  → Hash check, JWT token generation
  → writeLog() để ghi log
```

### 2️⃣ CRUD Dryer (Máy sấy)
```
GET/POST/PUT/DELETE /api/v1/dryers, /api/v1/areas, /api/v1/sensors
  → src/routes/structure.js
  → authenticate + requireAdmin middleware
  → src/services/scopeService.js kiểm tra quyền
  → Query database thông qua src/config/db.js
  → writeLog() để ghi hành động
```

### 3️⃣ Tạo Batch (Lô sấy)
```
POST /api/v1/batches
  → src/routes/batches.js
  → Validate input (dryer, fruit, recipe)
  → src/services/batchService.js: tính toán phase info
  → Insert batch vào database
  → Publish MQTT message nếu control cần
```

### 4️⃣ Real-time Monitoring
```
GET /api/v1/batches/:id
  → src/routes/monitoring.js
  → src/services/batchService.js: tính current phase & elapsed time
  → Lấy sensor data từ database
  → publishControlState() gửi lệnh điều khiển nếu có
```

### 5️⃣ IoT Sensor Data (MQTT)
```
Subscribe MQTT feeds
  → src/config/mqtt.js
  → src/services/sensorService.js: ingestSensorValue()
  → Lưu vào database (sensor_reading table)
```
