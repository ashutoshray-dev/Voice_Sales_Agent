import os
os.chdir('E:/agentic_coding/Voice_sales_agent')
from dotenv import load_dotenv
load_dotenv()
import requests

url = os.getenv('SUPABASE_URL')
service_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

headers = {
    'apikey': service_key,
    'Authorization': f'Bearer {service_key}',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
}

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

data = {'query': sql}

# Try the pg_query endpoint
try:
    response = requests.post(f'{url}/rest/v1/rpc/pg_query', headers=headers, json=data)
    print('pg_query Response:', response.status_code, response.text)
except Exception as e:
    print(f'Error: {e}')

# Try the query endpoint
try:
    response = requests.post(f'{url}/rest/v1/rpc/query', headers=headers, json=data)
    print('query Response:', response.status_code, response.text)
except Exception as e:
    print(f'Error: {e}')