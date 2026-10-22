-- AI Voice Sales Bot — Supabase Schema
-- Run this in Supabase SQL Editor

-- Calls table
CREATE TABLE IF NOT EXISTS calls (
  id UUID PRIMARY KEY,
  device_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_sec INTEGER,
  status TEXT NOT NULL DEFAULT 'In Progress',
  summary JSONB,
  transcript JSONB DEFAULT '[]'::jsonb,
  recording_path TEXT,
  error TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_calls_device_id ON calls(device_id);
CREATE INDEX IF NOT EXISTS idx_calls_started_at ON calls(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);

-- Enable Row Level Security (optional - for production)
-- ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Users can only see their own calls" ON calls
--   FOR SELECT USING (device_id = current_setting('app.current_device_id', true));

-- Storage bucket for recordings (create via Supabase Dashboard -> Storage)
-- Name: recordings, Public: false
-- Run this in Storage section or via SQL:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('recordings', 'recordings', false);