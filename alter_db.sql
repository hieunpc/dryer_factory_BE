-- Connect to the database
-- Run this script against the DryerDB database

-- Add 'light' to sensor_type check
ALTER TABLE sensor_device DROP CONSTRAINT ck_sensor_type;
ALTER TABLE sensor_device ADD CONSTRAINT ck_sensor_type CHECK (sensor_type IN ('humidity', 'temperature', 'door_state', 'light'));

-- Add 'dehumidifier' to control_type check
-- Note: Removed dehumidifier as per user feedback, fan handles both temperature and humidity

-- Make humidity, temperature and light nullable in phase (for scheduled mode without temp/humidity/light)
ALTER TABLE phase ALTER COLUMN humidity DROP NOT NULL;
ALTER TABLE phase ALTER COLUMN temperature DROP NOT NULL;
ALTER TABLE phase ADD COLUMN IF NOT EXISTS light FLOAT NULL;

-- Add table for phase actions (to define device actions in each phase for scheduled mode)
CREATE TABLE phase_actions (
    action_id SERIAL PRIMARY KEY,
    phase_id INT NOT NULL,
    control_id INT NOT NULL,
    action_type VARCHAR(50) NOT NULL
        CONSTRAINT ck_phase_action_type
        CHECK (action_type IN ('activate', 'deactivate')),
    start_offset_seconds INT NOT NULL DEFAULT 0,  -- offset from phase start in seconds
    duration_seconds INT NULL,  -- duration to keep action, if null then until phase end
    CONSTRAINT fk_phase_actions_phase
        FOREIGN KEY (phase_id)
        REFERENCES phase(phase_id),
    CONSTRAINT fk_phase_actions_control
        FOREIGN KEY (control_id)
        REFERENCES control_device(control_id)
);