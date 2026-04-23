# Huong Dan Test Backend Cho Frontend

Tai lieu nay giup team frontend nho gon luong test va map man hinh voi API.

## 1. Chuan bi moi truong

- Backend dang chay: http://localhost:3000
- PostgreSQL Docker dang chay: 127.0.0.1:55432
- Da seed du lieu mau: admin@gmail.com / 123456, operator@gmail.com / 123456

Cac buoc setup nhanh:

1. docker compose up -d
2. npm install
3. npm run seed
4. npm start

## 2. Import Postman

- File collection: postman collection (.json)
- Sau khi import, chay request login truoc de luu token vao bien token.

Thu tu chay khuyen nghi:

1. 00 - Health
2. 01 - Auth
3. 02 - Structure
4. 03 - Device
5. 05 - Batch & Threshold
6. 06 - Monitoring & Dashboard

## 3. Mapping man hinh frontend -> API

### 3.1. Dang nhap

- POST /api/v1/auth/login
- GET /api/v1/auth/me

Dung cho:

- Login form
- Header profile
- Kiem tra role user/admin

### 3.2. Cay cau truc (Area/Dryer)

- GET /api/v1/areas
- GET /api/v1/dryers?area_id=
- GET /api/v1/dryers/:id

Dung cho:

- Sidebar structure
- Trang chi tiet may say

### 3.3. Thiet bi va cam bien

- PATCH /api/v1/sensors/:id
- GET /api/v1/sensors/:id/latest
- PATCH /api/v1/controls/:id

Dung cho:

- Form cau hinh nguong sensor
- UI bat/tat trang thai control

### 3.4. Cong thuc va policy

- GET /api/v1/fruits
- GET /api/v1/recipes
- GET /api/v1/recipes/:id
- GET /api/v1/policies
- POST /api/v1/policies/:id/conditions
- POST /api/v1/policies/:id/actions

Dung cho:

- Recipe editor
- Policy threshold builder

### 3.5. Van hanh me say

- POST /api/v1/batches
- POST /api/v1/batches/:id/start
- POST /api/v1/batches/:id/stop
- POST /api/v1/batches/:id/toggle-threshold
- POST /api/v1/batches/:id/controls/:controlId/commands
- POST /api/v1/sensor-data

Dung cho:

- Man hinh run batch
- Toggle threshold option
- Dieu khien manual

### 3.6. Giam sat, dashboard, report

- GET /api/v1/logs
- GET /api/v1/logs/audit (admin)
- GET /api/v1/dashboard/overview
- GET /api/v1/dashboard/charts/temperature-humidity
- GET /api/v1/dashboard/charts/device-utilization
- GET /api/v1/reports/operations
- GET /api/v1/reports/quality
- GET /api/v1/reports/incidents
- GET /api/v1/reports/performance (admin)
- POST /api/v1/reports/export

Dung cho:

- Monitoring page
- Dashboard charts
- Report page

## 4. Use case test quan trong cho frontend

### UC-01: Login va load cay nha may

1. Login admin
2. Goi auth/me
3. Goi factories -> areas -> dryers
4. Mo dryer/:id de hien sensor + controls

Ket qua mong doi:

- Co token hop le
- Danh sach structure hien thi day du
- Dryer detail co sensors va controls

### UC-02: Chinh nguong sensor va doc latest

1. PATCH /sensors/:id voi threshold moi
2. GET /sensors/:id/latest

Ket qua mong doi:

- API tra success
- latest tra ve gia tri va thoi gian cap nhat

### UC-03: Tao batch scheduled + threshold

1. POST /batches voi operation_mode=scheduled, threshold_enabled=true
2. POST /batches/:id/start
3. POST /sensor-data voi gia tri humidity vuot nguong
4. GET /logs?batch_id=

Ket qua mong doi:

- Co log sensor_trigger
- Co log device_action neu policy du dieu kien

### UC-04: Manual control trong batch manual

1. Tao batch voi operation_mode=manual
2. Start batch
3. POST /batches/:id/controls/:controlId/commands action_type=activate/deactivate

Ket qua mong doi:

- Trang thai control thay doi
- Co log device_action voi chuoi Manual action

### UC-05: Dashboard va report

1. GET /dashboard/overview
2. GET /dashboard/charts/temperature-humidity
3. GET /reports/operations
4. POST /reports/export

Ket qua mong doi:

- Dashboard tra KPI
- Chart tra chuoi du lieu
- Export tra ve export_id va download_url

## 5. Luu y cho frontend

- Tat ca endpoint (tru login) can Authorization: Bearer token.
- 401: token loi/het han.
- 403: role hoac scope khong du quyen.
- 409: xung dot trang thai (vi du dryer dang co batch running).
- 422: vi pham rule nghiep vu (vi du manual command khi batch khong o manual mode).

## 6. Payload mau hay dung

Login:

{
"email": "admin@gmail.com",
"password": "123456"
}

Tao batch:

{
"dry_id": 1,
"fruit_id": 1,
"recipe_id": 1,
"operation_mode": "scheduled",
"threshold_enabled": true,
"is_customize": false
}

Push sensor:

{
"sensor_id": 2,
"value": 120
}

## 7. Goi y tich hop frontend

- Tao API client voi interceptor tu dong gan token.
- Khi gap 401 thi logout va dieu huong ve login.
- Dung polling 3-5s cho dryer detail va logs neu chua co websocket.
- Tach model cho control, sensor, batch, log de tai su dung giua cac man hinh.
