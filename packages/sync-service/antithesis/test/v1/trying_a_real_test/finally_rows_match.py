#!/usr/bin/env -S PYTHONUNBUFFERED=1 uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "antithesis",
#     "psycopg2-binary",
#     "requests<3",
# ]
# ///

import psycopg2, requests, json
from time import sleep
 
from antithesis import (
    assertions,
)

# Configuration
db_name = "electric"
db_user = "postgres"
db_password = "password"
db_host = "postgres"  # change to hostname when added to docker-compose
db_port = "5432"  # Default PostgreSQL port

# Electric API configuration
ELECTRIC_URL = "http://electric:3000"

def materialize_table(table: str, where: str = None) -> list:
    """
    Materialize a table from Electric API by walking the shape until completion.
    
    Args:
        table: The table name to materialize
        where: Optional where clause to filter rows
        
    Returns:
        A list of all rows as dictionaries
    """
    # Initial parameters
    offset = "-1"
    handle = None
    materialized_data = {}
    
    # Continue fetching until we're up-to-date
    up_to_date = False
    while not up_to_date:
        # Build request URL and parameters
        params = {
            "table": table,
            "offset": offset,
            "replica": "full"
        }
        
        if handle:
            params["handle"] = handle
            
        if where:
            params["where"] = where
            
        # Make the request
        response = requests.get(f"{ELECTRIC_URL}/v1/shape", params=params)
        
        # Handle errors
        if response.status_code >= 400:
            raise Exception(f"Error fetching shape: {response.status_code}: {response.text}")
            
        # Process the response if we have data
        if response.status_code == 200:
            # Update handle and offset for next request
            handle = response.headers["electric-handle"]
            offset = response.headers["electric-offset"]
            
            # Check if we're up-to-date
            up_to_date = "electric-up-to-date" in response.headers
            
            # Process messages
            messages = response.json()
            for message in messages:
                # Skip control messages
                if "control" in message.get("headers", {}):
                    continue
                    
                # Process data operations
                if "operation" in message.get("headers", {}):
                    operation = message["headers"]["operation"]
                    key = message["key"]
                    
                    if operation == "insert" or operation == "update":
                        materialized_data[key] = message["value"]
                    elif operation == "delete":
                        if key in materialized_data:
                            del materialized_data[key]
    
    # Convert the dictionary to a list
    return list(materialized_data.values())

def main(): 
    conn = psycopg2.connect(
        dbname=db_name,
        user=db_user,
        password=db_password,
        host=db_host,
        port=db_port
    )

    with conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name, email FROM public.users ORDER BY id")
            rows = cur.fetchall()

    conn.close()

    print(f"Found {len(rows)} rows in the database")

    # Sleep for a few seconds to ensure that the rows are available in Electric.
    sleep(5)

    # Then iterate a shape in Electric to get all rows
    # and assert that the rows match
    electric_rows = materialize_table("users")
    electric_rows.sort(key=lambda x: x["id"])
    print(f"Got {len(electric_rows)} rows from Electric")
    
    # Convert database rows to same format as Electric rows for comparison
    db_dicts = []
    for row in rows:
        db_dicts.append({
            "id": str(row[0]),  # Convert to string as Electric returns strings
            "name": row[1],
            "email": row[2]
        })
    
    # Assert that rows match (content, not necessarily order)
    db_set = {json.dumps(item, sort_keys=True) for item in db_dicts}
    electric_set = {json.dumps(item, sort_keys=True) for item in electric_rows}
    
    assertions.always(
        db_set == electric_set,
        f"Reading the shape at the end of the test, DB rows and Electric rows match",
        {
            "db_set": len(db_set),
            "electric_set": len(electric_set)
        }
    )
    print("Test complete")

if __name__ == "__main__":
    main()
    

