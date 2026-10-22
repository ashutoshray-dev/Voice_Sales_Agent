import os
os.chdir('E:/agentic_coding/Voice_sales_agent')
from dotenv import load_dotenv
load_dotenv()
import requests

url = os.getenv('SUPABASE_URL')
service_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

# Get project ref
project_ref = url.split('//')[1].split('.')[0]
print(f'Project ref: {project_ref}')

# Try management API
management_url = f'https://api.supabase.com/v1/projects/{project_ref}/database/query'
headers = {
    'Authorization': f'Bearer {service_key}',
    'Content-Type': 'application/json'
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

try:
    response = requests.post(management_url, headers=headers, json=data)
    print('Response:', response.status_code, response.text)
except Exception as e:
    print(f'Error: {e}')