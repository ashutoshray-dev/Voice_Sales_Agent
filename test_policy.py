import os
os.chdir('E:/agentic_coding/Voice_sales_agent')
from dotenv import load_dotenv
load_dotenv()
from supabase import create_client

url = os.getenv('SUPABASE_URL')
service_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
supabase = create_client(url, service_key)

# Try to execute raw SQL using postgrest
try:
    # Use the rpc function to run SQL - try different approaches
    sql = "INSERT INTO storage.policies (name, bucket_id, definition, operation) VALUES ('anon_upload', 'recordings', 'true', 'INSERT');"
    result = supabase.postgrest.rpc('pgrst_read_only', {'query': sql}).execute()
    print('Policy result:', result)
except Exception as e:
    print(f'Error creating policy: {e}')