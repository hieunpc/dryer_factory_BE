-- PostgreSQL DDL for Dryer system (converted from SQL Server)

CREATE TABLE Area (
    area_id SERIAL PRIMARY KEY,
    area_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE Dryer (
    dry_id SERIAL PRIMARY KEY,
    dry_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('Running', 'Idle', 'Maintenance')),
    area_id INT NOT NULL REFERENCES Area(area_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sensor_device (
    sensor_id SERIAL PRIMARY KEY,
    sensor_type VARCHAR(50) NOT NULL CHECK (sensor_type IN ('humidity', 'temperature', 'door_state')),
    threshold DOUBLE PRECISION,
    dry_id INT NOT NULL REFERENCES Dryer(dry_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sensor_latest (
    sensor_id INT PRIMARY KEY REFERENCES sensor_device(sensor_id) ON DELETE CASCADE,
    last_value DOUBLE PRECISION NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE control_device (
    control_id SERIAL PRIMARY KEY,
    control_name VARCHAR(255),
    control_type VARCHAR(50) NOT NULL CHECK (control_type IN ('fan', 'lamp')),
    status VARCHAR(50) NOT NULL CHECK (status IN ('active', 'inactive')),
    dry_id INT NOT NULL REFERENCES Dryer(dry_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE fruit (
    fruit_id SERIAL PRIMARY KEY,
    fruit_name VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE recipe (
    recipe_id SERIAL PRIMARY KEY,
    recipe_name VARCHAR(255) NOT NULL,
    recipe_type VARCHAR(100) NOT NULL,
    fruit_id INT NOT NULL REFERENCES fruit(fruit_id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE phase (
    phase_id SERIAL PRIMARY KEY,
    phase_order INT NOT NULL,
    recipe_id INT NOT NULL REFERENCES recipe(recipe_id),
    duration_seconds INT NOT NULL,
    humidity DOUBLE PRECISION NOT NULL,
    temperature DOUBLE PRECISION NOT NULL,
    UNIQUE (recipe_id, phase_order)
);

CREATE TABLE policy (
    policy_id SERIAL PRIMARY KEY,
    policy_type VARCHAR(100) NOT NULL,
    policy_name VARCHAR(255) NOT NULL,
    phase_id INT NOT NULL REFERENCES phase(phase_id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE policy_condition (
    condition_id SERIAL PRIMARY KEY,
    policy_id INT NOT NULL REFERENCES policy(policy_id),
    sensor_id INT NOT NULL REFERENCES sensor_device(sensor_id),
    value DOUBLE PRECISION NOT NULL,
    cp_operator VARCHAR(10) NOT NULL CHECK (cp_operator IN ('>', '<', '>=', '<=', '='))
);

CREATE TABLE policy_action (
    action_id SERIAL PRIMARY KEY,
    policy_id INT NOT NULL REFERENCES policy(policy_id),
    control_id INT NOT NULL REFERENCES control_device(control_id),
    action_type VARCHAR(50) NOT NULL CHECK (action_type IN ('activate', 'deactivate'))
);

CREATE TABLE app_user (
    app_user_id SERIAL PRIMARY KEY,
    app_user_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_scope (
    scope_id SERIAL PRIMARY KEY,
    app_user_id INT NOT NULL REFERENCES app_user(app_user_id),
    area_id INT REFERENCES Area(area_id),
    dry_id INT REFERENCES Dryer(dry_id),
    CHECK (
        (CASE WHEN area_id IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN dry_id IS NULL THEN 0 ELSE 1 END) = 1
    )
);

CREATE TABLE batch (
    batch_id SERIAL PRIMARY KEY,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    operation_mode VARCHAR(20) NOT NULL CHECK (operation_mode IN ('manual', 'scheduled')),
    threshold_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    is_customize BOOLEAN NOT NULL DEFAULT FALSE,
    dry_id INT NOT NULL REFERENCES Dryer(dry_id),
    fruit_id INT NOT NULL REFERENCES fruit(fruit_id),
    recipe_id INT NOT NULL REFERENCES recipe(recipe_id),
    app_user_id INT NOT NULL REFERENCES app_user(app_user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE log (
    log_id SERIAL PRIMARY KEY,
    log_style VARCHAR(60) NOT NULL CHECK (log_style IN (
        'parameter_change', 'sensor_trigger', 'batch_start', 'batch_running',
        'batch_end', 'device_action', 'audit_login', 'audit_permission_change', 'audit_config_change'
    )),
    message VARCHAR(1000) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    batch_id INT REFERENCES batch(batch_id),
    sensor_id INT REFERENCES sensor_device(sensor_id),
    control_id INT REFERENCES control_device(control_id),
    app_user_id INT REFERENCES app_user(app_user_id),
    value DOUBLE PRECISION
);

CREATE TABLE report_export (
    export_id SERIAL PRIMARY KEY,
    app_user_id INT NOT NULL REFERENCES app_user(app_user_id),
    report_type VARCHAR(100) NOT NULL,
    file_format VARCHAR(20) NOT NULL CHECK (file_format IN ('pdf', 'xlsx')),
    filter_json TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
