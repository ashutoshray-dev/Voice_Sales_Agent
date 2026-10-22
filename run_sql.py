import os
os.chdir('E:/agentic_coding/Voice_sales_agent')
from dotenv import load_dotenv
load_dotenv()
from supabase import create_client
import requests

url = os.getenv('SUPABASE_URL')
service_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

# Try direct SQL execution via REST API
headers = {
    'apikey': service_key,
    'Authorization': f'Bearer {service_key}',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
}

# Try to run SQL
sql = "INSERT INTO storage.policies (name, bucket_id, definition, operation) VALUES ('anon_upload', 'recordings', 'true', 'INSERT');"
data = {'query': sql}

try:
    response = requests.post(f'{url}/rest/v1/rpc/exec_sql', headers=headers, json=data)
    print('Response:', response.status_code, response.text)
except Exception as e:
    print(f'Error: {e}')