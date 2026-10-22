import os
os.chdir('E:/agentic_coding/Voice_sales_agent')
from dotenv import load_dotenv
load_dotenv()
from supabase import create_client

url = os.getenv('SUPABASE_URL')
service_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
supabase = create_client(url, service_key)

# Create the calls table
sql = """
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

CREATE INDEX IF NOT EXISTS idx_calls_device_id ON calls(device_id);
CREATE INDEX IF NOT EXISTS idx_calls_started_at ON calls(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
"""

# Try to execute using rpc
try:
    result = supabase.rpc('exec_sql', {'query': sql}).execute()
    print('Result:', result)
except Exception as e:
    print(f'Error: {e}')