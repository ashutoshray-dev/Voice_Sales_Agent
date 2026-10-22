import os
os.chdir('E:/agentic_coding/Voice_sales_agent')
from dotenv import load_dotenv
load_dotenv()
from supabase import create_client

url = os.getenv('SUPABASE_URL')
service_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
supabase = create_client(url, service_key)

# Use the supabase client to run raw SQL
# The supabase python client has a way to execute SQL
try:
    # Try using the from_ method on the rest client
    result = supabase.postgrest.session.execute(
        "POST",
        "/",
        json={"query": "INSERT INTO storage.policies (name, bucket_id, definition, operation) VALUES ('anon_upload', 'recordings', 'true', 'INSERT');"}
    )
    print('Policy result:', result)
except Exception as e:
    print(f'Error: {e}')
    import traceback
    traceback.print_exc()