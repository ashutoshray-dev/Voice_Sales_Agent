import os
os.chdir('E:/agentic_coding/Voice_sales_agent')
from dotenv import load_dotenv
load_dotenv()
import requests

url = os.getenv('SUPABASE_URL')
service_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

# Try to use the SQL editor API
headers = {
    'apikey': service_key,
    'Authorization': f'Bearer {service_key}',
    'Content-Type': 'application/json'
}

# Try to execute SQL via pg endpoint
sql = "INSERT INTO storage.policies (name, bucket_id, definition, operation) VALUES ('anon_upload', 'recordings', 'true', 'INSERT');"
data = {'query': sql}

try:
    response = requests.post(f'{url}/rest/v1/', headers=headers, json=data)
    print('Response:', response.status_code, response.text)
except Exception as e:
    print(f'Error: {e}')