# API DOCUMENTATION: DRYING FACTORY MANAGEMENT SYSTEM (V2)

Base URL: /api/v1  
Format: JSON  
Auth: Bearer JWT (bắt buộc cho tất cả endpoint trừ login)

Tài liệu này bám theo schema trong SQLQueryDDL.sql (phiên bản đã cập nhật).

---

## 1. Tổng quan phân quyền (RBAC)

Hệ thống có 2 vai trò:

- User: vận hành mẻ sấy và theo dõi trong phạm vi được cấp.
- Admin: toàn quyền User + quản trị danh mục, thiết bị, quyền truy cập, report toàn hệ thống.

Phạm vi truy cập dữ liệu dùng bảng user_scope theo một trong 3 mức:

- Factory scope
- Area scope
- Dryer scope

### 1.1. Quy ước phân quyền endpoint

- [ADMIN]: chỉ Admin gọi được.
- [USER]: User hoặc Admin đều gọi được (nhưng bị lọc theo phạm vi user_scope nếu không phải Admin).

---

## 2. Chuẩn request/response

### 2.1. Header chung

- Authorization: Bearer <token>
- Content-Type: application/json

### 2.2. Response thành công

{
"status": "success",
"data": {}
}

### 2.3. Response lỗi chuẩn

{
"status": "error",
"code": "STRING_CODE",
"message": "Details",
"errors": []
}

---

## 3. Authentication & User Profile

### POST /auth/login

Role: Public  
Mô tả: Đăng nhập bằng email/password, trả JWT.

Request:

{
"email": "admin@gmail.com",
"password": "123456"
}

Response 200:

{
"status": "success",
"data": {
"access_token": "<jwt>",
"expires_in": 3600,
"user": {
"app_user_id": 1,
"app_user_name": "System Admin",
"email": "admin@gmail.com",
"is_admin": true
}
}
}

### GET /auth/me

Role: [USER]  
Mô tả: Lấy thông tin user hiện tại + danh sách scope.

### POST /auth/logout

Role: [USER]  
Mô tả: Đăng xuất (blacklist token hoặc xóa refresh token phía server nếu có).

---

## 4. User Management & Scope

### GET /users

Role: [ADMIN]  
Mô tả: Danh sách người dùng, hỗ trợ filter is_admin, is_active, email.

### POST /users

Role: [ADMIN]  
Mô tả: Tạo user mới.

Request:

{
"app_user_name": "Operator A",
"email": "operatorA@gmail.com",
"password": "123456",
"is_admin": false
}

### PATCH /users/{id}

Role: [ADMIN]  
Mô tả: Cập nhật tên, trạng thái active, hoặc đổi role.

### POST /users/{id}/scopes

Role: [ADMIN]  
Mô tả: Gán phạm vi truy cập (factory hoặc area hoặc dryer).

Request:

{
"fac_id": null,
"area_id": 2,
"dry_id": null
}

Lưu ý:

- Chỉ được truyền đúng 1 trong 3 trường fac_id, area_id, dry_id.
- Nếu user là Admin thì scope có thể bỏ qua khi truy vấn.

### GET /users/{id}/scopes

Role: [ADMIN]  
Mô tả: Xem các scope đã cấp cho user.

### DELETE /users/{id}/scopes/{scope_id}

Role: [ADMIN]  
Mô tả: Thu hồi một scope của user.

---

## 5. Factory Structure

### GET /factories

Role: [USER]  
Mô tả: Lấy danh sách nhà máy theo quyền truy cập.

### POST /factories

Role: [ADMIN]  
Mô tả: Tạo nhà máy.

### GET /areas

Role: [USER]  
Query:

- fac_id

Mô tả: Lấy danh sách khu vực theo nhà máy và quyền truy cập.

### POST /areas

Role: [ADMIN]  
Mô tả: Tạo khu vực mới.

Request:

{
"area_name": "Area A",
"fac_id": 1
}

### GET /dryers

Role: [USER]  
Query:

- area_id
- status (Running, Idle, Maintenance)

### GET /dryers/{id}

Role: [USER]  
Mô tả: Chi tiết máy sấy kèm sensor và control device.

Response 200:

{
"status": "success",
"data": {
"dry_id": 1,
"dry_name": "Dryer 01",
"status": "Idle",
"area_id": 2,
"sensors": [
{
"sensor_id": 1,
"sensor_type": "humidity",
"threshold": 2,
"last_value": 65.2,
"updated_at": "2026-04-21T09:00:00"
}
],
"controls": [
{ "control_id": 1, "control_name": "Fan 1", "control_type": "fan", "status": "inactive" },
{ "control_id": 2, "control_name": "Fan 2", "control_type": "fan", "status": "inactive" },
{ "control_id": 3, "control_name": "Lamp 1", "control_type": "lamp", "status": "active" }
]
}
}

### POST /dryers

Role: [ADMIN]  
Mô tả: Tạo máy sấy.

### PATCH /dryers/{id}

Role: [ADMIN]  
Mô tả: Cập nhật tên, trạng thái bảo trì, khu vực.

---

## 6. Device Management (Sensors & Output Devices)

### POST /dryers/{id}/sensors

Role: [ADMIN]  
Mô tả: Thêm sensor vào máy sấy.

Request:

{
"sensor_type": "temperature",
"threshold": 1.5
}

### PATCH /sensors/{id}

Role: [ADMIN]  
Mô tả: Cập nhật threshold, loại sensor.

### GET /sensors/{id}/latest

Role: [USER]  
Mô tả: Lấy giá trị sensor_latest.

### POST /dryers/{id}/controls

Role: [ADMIN]  
Mô tả: Thêm thiết bị output cho máy sấy. Hỗ trợ nhiều thiết bị cùng loại.

Request:

{
"control_name": "Lamp 2",
"control_type": "lamp",
"status": "inactive"
}

### PATCH /controls/{id}

Role: [ADMIN]  
Mô tả: Cập nhật tên thiết bị hoặc trạng thái active/inactive.

---

## 7. Fruit, Recipe, Phase

### GET /fruits

Role: [USER]  
Mô tả: Danh sách loại trái cây.

### POST /fruits

Role: [ADMIN]  
Mô tả: Tạo loại trái cây.

### GET /recipes

Role: [USER]  
Query:

- fruit_id
- is_active

### GET /recipes/{id}

Role: [USER]  
Mô tả: Chi tiết recipe và phases theo phase_order.

### POST /recipes

Role: [ADMIN]  
Mô tả: Tạo recipe và danh sách phase.

Request:

{
"recipe_name": "Dry Mango Standard",
"recipe_type": "standard",
"fruit_id": 1,
"phases": [
{
"phase_order": 1,
"duration_seconds": 3600,
"humidity": 72,
"temperature": 52
},
{
"phase_order": 2,
"duration_seconds": 5400,
"humidity": 65,
"temperature": 56
}
]
}

### PATCH /recipes/{id}

Role: [ADMIN]  
Mô tả: Cập nhật recipe_name, recipe_type, is_active.

### PUT /recipes/{id}/phases

Role: [ADMIN]  
Mô tả: Ghi đè toàn bộ phases của recipe.

---

## 8. Policy, Condition, Action

Threshold là option có thể bật/tắt ở batch. Khi threshold_enabled = true, engine mới chạy logic policy.

### GET /policies

Role: [USER]  
Query:

- phase_id
- recipe_id
- is_active

### POST /policies

Role: [ADMIN]  
Mô tả: Tạo policy cho phase.

Request:

{
"policy_name": "Humidity Guard P1",
"policy_type": "threshold",
"phase_id": 10,
"is_active": true
}

### POST /policies/{id}/conditions

Role: [ADMIN]  
Mô tả: Thêm điều kiện kích hoạt policy.

Request:

{
"sensor_id": 2,
"value": 75,
"cp_operator": ">="
}

### POST /policies/{id}/actions

Role: [ADMIN]  
Mô tả: Thêm hành động cho policy.

Request:

{
"control_id": 3,
"action_type": "activate"
}

### DELETE /policies/{id}/conditions/{condition_id}

Role: [ADMIN]

### DELETE /policies/{id}/actions/{action_id}

Role: [ADMIN]

---

## 9. Batch Operations

### POST /batches

Role: [USER]  
Mô tả: Tạo batch mới.

Request:

{
"dry_id": 1,
"fruit_id": 1,
"recipe_id": 3,
"operation_mode": "scheduled",
"threshold_enabled": true,
"is_customize": false
}

Quy tắc:

- Máy phải ở trạng thái Idle để tạo batch mới.
- Tại một thời điểm chỉ có 1 batch running trên 1 dryer.
- User chỉ tạo batch trên dryer thuộc scope của mình.

### GET /batches

Role: [USER]  
Query:

- dry_id
- status
- operation_mode
- from
- to

### GET /batches/{id}

Role: [USER]  
Mô tả: Chi tiết batch, recipe, phase hiện tại, trạng thái thiết bị.

### POST /batches/{id}/start

Role: [USER]  
Mô tả: Chuyển status sang running và set start_time.

### POST /batches/{id}/stop

Role: [USER]  
Mô tả: Dừng batch, cập nhật status = cancelled hoặc completed theo lựa chọn.

Request:

{
"final_status": "completed"
}

final_status chỉ nhận completed hoặc cancelled.

### POST /batches/{id}/toggle-threshold

Role: [USER]  
Mô tả: Bật/tắt threshold option trong lúc batch chạy.

Request:

{
"threshold_enabled": false
}

### POST /batches/{id}/controls/{control_id}/commands

Role: [USER]  
Mô tả: Điều khiển thủ công output device khi operation_mode = manual.

Request:

{
"action_type": "activate"
}

---

## 10. Sensor Data Ingestion & Processing

### POST /sensor-data

Role: Internal IoT hoặc [ADMIN] qua API key riêng  
Mô tả: Nhận dữ liệu sensor theo thời gian thực.

Request:

{
"sensor_id": 1,
"value": 72.5
}

Luồng xử lý:

- Bước 1: Threshold filtering theo sensor_device.threshold. Nếu |new - last| đạt ngưỡng thì cập nhật sensor_latest và ghi log parameter_change.
- Bước 2: Nếu có batch running và threshold_enabled = true, đánh giá policy_condition của phase hiện tại.
- Bước 3: Nếu điều kiện đúng, tạo log sensor_trigger, thực thi policy_action (đóng/mở control_device), ghi log device_action.

Ghi chú:

- Không lưu toàn bộ time-series raw vào DB chính để tránh phình dữ liệu.
- updated_at dùng thời gian server SQL (GETDATE()).

---

## 11. Monitoring & Logs

### GET /logs

Role: [USER]  
Query:

- batch_id
- dry_id
- log_style
- from
- to

log_style hỗ trợ:

- parameter_change
- sensor_trigger
- batch_start
- batch_running
- batch_end
- device_action
- audit_login
- audit_permission_change
- audit_config_change

### GET /logs/audit

Role: [ADMIN]  
Mô tả: Truy xuất riêng audit log về đăng nhập, phân quyền, cấu hình.

---

## 12. Dashboard & Reports (Bắt buộc trực quan)

Các endpoint dưới đây phục vụ UI dashboard trực quan cho Admin/User.

### GET /dashboard/overview

Role: [USER]  
Query:

- fac_id
- area_id
- dry_id
- from
- to

Trả về:

- running_dryers
- idle_dryers
- maintenance_dryers
- running_batches
- completed_batches
- failed_batches
- threshold_alert_rate

### GET /dashboard/charts/temperature-humidity

Role: [USER]  
Query:

- batch_id hoặc dry_id
- from
- to
- interval (1m, 5m, 15m, 1h)

Trả về dữ liệu chuỗi thời gian cho line chart.

### GET /dashboard/charts/device-utilization

Role: [USER]  
Mô tả: Dữ liệu thời lượng bật/tắt theo từng control_device (fan/lamp).

### GET /reports/operations

Role: [USER]  
Mô tả: Báo cáo vận hành theo ca/ngày/tuần/tháng.

### GET /reports/quality

Role: [USER]  
Mô tả: Báo cáo chất lượng mẻ, độ ổn định nhiệt/ẩm, số lần can thiệp manual.

### GET /reports/incidents

Role: [USER]  
Mô tả: Báo cáo cảnh báo threshold, lỗi thiết bị, downtime.

### GET /reports/performance

Role: [ADMIN]  
Mô tả: Báo cáo hiệu suất toàn nhà máy, so sánh area/dryer.

### POST /reports/export

Role: [USER] (cần quyền export, mặc định Admin có quyền)  
Mô tả: Xuất file PDF/XLSX và lưu lịch sử export vào report_export.

Request:

{
"report_type": "operations",
"file_format": "xlsx",
"filters": {
"from": "2026-04-01T00:00:00",
"to": "2026-04-21T23:59:59",
"area_id": 2
}
}

Response 202:

{
"status": "success",
"data": {
"export_id": 15,
"download_url": "/api/v1/reports/export/15/download"
}
}

### GET /reports/export/{export_id}/download

Role: [USER]  
Mô tả: Tải file export nếu thuộc quyền truy cập của người gọi.

---

## 13. Validation Rules chính

- cp_operator chỉ nhận: >, <, >=, <=, =
- action_type chỉ nhận: activate, deactivate
- operation_mode chỉ nhận: manual, scheduled
- batch status chỉ nhận: pending, running, completed, failed, cancelled
- dryer status chỉ nhận: Running, Idle, Maintenance

---

## 14. Error Handling

| HTTP Code | Code Name               | Mô tả                                                  |
| :-------- | :---------------------- | :----------------------------------------------------- |
| 400       | VALIDATION_ERROR        | Dữ liệu không hợp lệ hoặc sai enum                     |
| 401       | UNAUTHORIZED            | Token sai hoặc hết hạn                                 |
| 403       | FORBIDDEN               | Không đủ quyền role/scope                              |
| 404       | NOT_FOUND               | Không tìm thấy tài nguyên                              |
| 409       | CONFLICT                | Xung đột trạng thái (ví dụ dryer đang chạy batch khác) |
| 422       | BUSINESS_RULE_VIOLATION | Vi phạm rule nghiệp vụ                                 |
| 500       | SERVER_ERROR            | Lỗi hệ thống backend hoặc DB                           |

---

## 15. Mapping nhanh API với bảng dữ liệu

- auth/users/scopes: app_user, user_scope
- factory structure: Factory, Area, Dryer
- devices: sensor_device, sensor_latest, control_device
- fruits/recipes/phases: fruit, recipe, phase
- policies: policy, policy_condition, policy_action
- batches: batch
- logs/audit: log
- report export history: report_export
