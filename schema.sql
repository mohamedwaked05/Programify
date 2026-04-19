-- ============================================================
-- Gym Program Builder — PostgreSQL Schema
-- Run once: psql -U postgres -d gym_program -f schema.sql
-- ============================================================

-- Programs (top-level container)
CREATE TABLE IF NOT EXISTS programs (
    id         SERIAL       PRIMARY KEY,
    name       VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Days (always exactly 7 per program, order_index 1–7)
CREATE TABLE IF NOT EXISTS days (
    id          SERIAL       PRIMARY KEY,
    program_id  INTEGER      NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL DEFAULT '',
    order_index SMALLINT     NOT NULL CHECK (order_index BETWEEN 1 AND 7),
    UNIQUE (program_id, order_index)
);

CREATE INDEX IF NOT EXISTS idx_days_program ON days(program_id);

-- Exercises (many per day, ordered by order_index)
CREATE TABLE IF NOT EXISTS exercises (
    id          SERIAL       PRIMARY KEY,
    day_id      INTEGER      NOT NULL REFERENCES days(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL DEFAULT '',
    sets        SMALLINT     NOT NULL DEFAULT 3  CHECK (sets BETWEEN 1 AND 6),
    reps        SMALLINT     NOT NULL DEFAULT 10 CHECK (reps BETWEEN 1 AND 25),
    rir         SMALLINT     NOT NULL DEFAULT 2  CHECK (rir  BETWEEN 0 AND 5),
    note        TEXT         NOT NULL DEFAULT '',
    order_index SMALLINT     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_exercises_day ON exercises(day_id);

-- Auto-update updated_at on programs row change
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS programs_updated_at ON programs;
CREATE TRIGGER programs_updated_at
    BEFORE UPDATE ON programs
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
