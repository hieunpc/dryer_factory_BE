CREATE DATABASE FactoryDB;
GO

USE FactoryDB;
GO

CREATE TABLE Factory (
    fac_id INT IDENTITY(1,1) PRIMARY KEY,
    fac_name NVARCHAR(255) NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE()
);

CREATE TABLE Area (
    area_id INT IDENTITY(1,1) PRIMARY KEY,
    area_name NVARCHAR(255) NOT NULL,
    fac_id INT NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_Area_Factory
        FOREIGN KEY (fac_id)
        REFERENCES Factory(fac_id)
);

CREATE TABLE Dryer (
    dry_id INT IDENTITY(1,1) PRIMARY KEY,
    dry_name NVARCHAR(255) NOT NULL,
    status NVARCHAR(50) NOT NULL
        CONSTRAINT CK_Dryer_Status
        CHECK (status IN ('Running', 'Idle', 'Maintenance')),
    area_id INT NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_Dryer_Area
        FOREIGN KEY (area_id)
        REFERENCES Area(area_id)
);

CREATE TABLE sensor_device (
    sensor_id INT IDENTITY(1,1) PRIMARY KEY,
    sensor_type NVARCHAR(50) NOT NULL
        CONSTRAINT CK_sensor_type
        CHECK (sensor_type IN ('humidity', 'temperature', 'door_state')),
    threshold FLOAT NULL,
    dry_id INT NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_sensor_dryer
        FOREIGN KEY (dry_id)
        REFERENCES Dryer(dry_id)
);

CREATE TABLE sensor_latest (
    sensor_id INT PRIMARY KEY,
    last_value FLOAT NOT NULL,
    updated_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_latest_sensor
        FOREIGN KEY (sensor_id)
        REFERENCES sensor_device(sensor_id)
        ON DELETE CASCADE
);

CREATE TABLE control_device (
    control_id INT IDENTITY(1,1) PRIMARY KEY,
    control_name NVARCHAR(255) NULL,
    control_type NVARCHAR(50) NOT NULL
        CONSTRAINT CK_control_type
        CHECK (control_type IN ('fan', 'lamp')),
    status NVARCHAR(50) NOT NULL
        CONSTRAINT CK_control_status
        CHECK (status IN ('active', 'inactive')),
    dry_id INT NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_control_dryer
        FOREIGN KEY (dry_id)
        REFERENCES Dryer(dry_id)
);

CREATE TABLE fruit (
    fruit_id INT IDENTITY(1,1) PRIMARY KEY,
    fruit_name NVARCHAR(255) NOT NULL,
    CONSTRAINT UQ_fruit_name UNIQUE (fruit_name)
);

CREATE TABLE recipe (
    recipe_id INT IDENTITY(1,1) PRIMARY KEY,
    recipe_name NVARCHAR(255) NOT NULL,
    recipe_type NVARCHAR(100) NOT NULL,
    fruit_id INT NOT NULL,
    is_active BIT NOT NULL DEFAULT 1,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_recipe_fruit
        FOREIGN KEY (fruit_id)
        REFERENCES fruit(fruit_id)
);

CREATE TABLE phase (
    phase_id INT IDENTITY(1,1) PRIMARY KEY,
    phase_order INT NOT NULL,
    recipe_id INT NOT NULL,
    duration_seconds INT NOT NULL,
    humidity FLOAT NOT NULL,
    temperature FLOAT NOT NULL,
    CONSTRAINT UQ_phase_recipe_order UNIQUE (recipe_id, phase_order),
    CONSTRAINT FK_phase_recipe
        FOREIGN KEY (recipe_id)
        REFERENCES recipe(recipe_id)
);

CREATE TABLE policy (
    policy_id INT IDENTITY(1,1) PRIMARY KEY,
    policy_type NVARCHAR(100) NOT NULL,
    policy_name NVARCHAR(255) NOT NULL,
    phase_id INT NOT NULL,
    is_active BIT NOT NULL DEFAULT 1,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_Policy_Phase
        FOREIGN KEY (phase_id)
        REFERENCES phase(phase_id)
);

CREATE TABLE policy_condition (
    condition_id INT IDENTITY(1,1) PRIMARY KEY,
    policy_id INT NOT NULL,
    sensor_id INT NOT NULL,
    value FLOAT NOT NULL,
    cp_operator NVARCHAR(10) NOT NULL
        CONSTRAINT CK_condition_operator
        CHECK (cp_operator IN ('>', '<', '>=', '<=', '=')),
    CONSTRAINT FK_condition_policy
        FOREIGN KEY (policy_id)
        REFERENCES policy(policy_id),
    CONSTRAINT FK_condition_sensor
        FOREIGN KEY (sensor_id)
        REFERENCES sensor_device(sensor_id)
);

CREATE TABLE policy_action (
    action_id INT IDENTITY(1,1) PRIMARY KEY,
    policy_id INT NOT NULL,
    control_id INT NOT NULL,
    action_type NVARCHAR(50) NOT NULL
        CONSTRAINT CK_action_type
        CHECK (action_type IN ('activate', 'deactivate')),
    CONSTRAINT FK_action_policy
        FOREIGN KEY (policy_id)
        REFERENCES policy(policy_id),
    CONSTRAINT FK_action_control
        FOREIGN KEY (control_id)
        REFERENCES control_device(control_id)
);

CREATE TABLE app_user (
    app_user_id INT IDENTITY(1,1) PRIMARY KEY,
    app_user_name NVARCHAR(255) NOT NULL,
    email NVARCHAR(255) NOT NULL,
    password_hash NVARCHAR(255) NOT NULL,
    is_admin BIT NOT NULL DEFAULT 0,
    is_active BIT NOT NULL DEFAULT 1,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT UQ_user_email UNIQUE (email)
);

CREATE TABLE user_scope (
    scope_id INT IDENTITY(1,1) PRIMARY KEY,
    app_user_id INT NOT NULL,
    fac_id INT NULL,
    area_id INT NULL,
    dry_id INT NULL,
    CONSTRAINT FK_scope_user
        FOREIGN KEY (app_user_id)
        REFERENCES app_user(app_user_id),
    CONSTRAINT FK_scope_factory
        FOREIGN KEY (fac_id)
        REFERENCES Factory(fac_id),
    CONSTRAINT FK_scope_area
        FOREIGN KEY (area_id)
        REFERENCES Area(area_id),
    CONSTRAINT FK_scope_dryer
        FOREIGN KEY (dry_id)
        REFERENCES Dryer(dry_id),
    CONSTRAINT CK_scope_target
        CHECK (
            (CASE WHEN fac_id IS NULL THEN 0 ELSE 1 END)
            + (CASE WHEN area_id IS NULL THEN 0 ELSE 1 END)
            + (CASE WHEN dry_id IS NULL THEN 0 ELSE 1 END) = 1
        )
);

CREATE TABLE batch (
    batch_id INT IDENTITY(1,1) PRIMARY KEY,
    start_time DATETIME2 NULL,
    end_time DATETIME2 NULL,
    status NVARCHAR(50) NOT NULL
        CONSTRAINT CK_batch_status
        CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    operation_mode NVARCHAR(20) NOT NULL
        CONSTRAINT CK_batch_operation_mode
        CHECK (operation_mode IN ('manual', 'scheduled')),
    threshold_enabled BIT NOT NULL DEFAULT 0,
    is_customize BIT NOT NULL DEFAULT 0,
    dry_id INT NOT NULL,
    fruit_id INT NOT NULL,
    recipe_id INT NOT NULL,
    app_user_id INT NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_batch_dryer
        FOREIGN KEY (dry_id)
        REFERENCES Dryer(dry_id),
    CONSTRAINT FK_batch_fruit
        FOREIGN KEY (fruit_id)
        REFERENCES fruit(fruit_id),
    CONSTRAINT FK_batch_recipe
        FOREIGN KEY (recipe_id)
        REFERENCES recipe(recipe_id),
    CONSTRAINT FK_batch_user
        FOREIGN KEY (app_user_id)
        REFERENCES app_user(app_user_id)
);

CREATE TABLE log (
    log_id INT IDENTITY(1,1) PRIMARY KEY,
    log_style NVARCHAR(60) NOT NULL
        CONSTRAINT CK_log_style
        CHECK (log_style IN (
            'parameter_change',
            'sensor_trigger',
            'batch_start',
            'batch_running',
            'batch_end',
            'device_action',
            'audit_login',
            'audit_permission_change',
            'audit_config_change'
        )),
    message NVARCHAR(1000) NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    batch_id INT NULL,
    sensor_id INT NULL,
    control_id INT NULL,
    app_user_id INT NULL,
    value FLOAT NULL,
    CONSTRAINT FK_log_batch
        FOREIGN KEY (batch_id)
        REFERENCES batch(batch_id),
    CONSTRAINT FK_log_sensor
        FOREIGN KEY (sensor_id)
        REFERENCES sensor_device(sensor_id),
    CONSTRAINT FK_log_control
        FOREIGN KEY (control_id)
        REFERENCES control_device(control_id),
    CONSTRAINT FK_log_user
        FOREIGN KEY (app_user_id)
        REFERENCES app_user(app_user_id)
);

CREATE TABLE report_export (
    export_id INT IDENTITY(1,1) PRIMARY KEY,
    app_user_id INT NOT NULL,
    report_type NVARCHAR(100) NOT NULL,
    file_format NVARCHAR(20) NOT NULL
        CONSTRAINT CK_report_format
        CHECK (file_format IN ('pdf', 'xlsx')),
    filter_json NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_report_export_user
        FOREIGN KEY (app_user_id)
        REFERENCES app_user(app_user_id)
);
GO
