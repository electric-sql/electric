#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "antithesis",
#     "requests<3",
# ]
# ///

import requests
from antithesis import assertions

def main():
    try:
        response = requests.get("http://electric:3000/v1/shape", params={"table": "users", "offset": "-1"})
    except Exception as e:
        assertions.unreachable(
            "Request to Electric failed completely",
            {"error": str(e)}
        )
        exit(1)
    
    try:
        response.json()
        assertions.always(
            True,
            "The response from Electric is valid JSON",
            {"response_code": response.status_code}
        )
    except Exception as e:
        assertions.always(
            False,
            "The response from Electric is valid JSON",
            {"body": response.text, "response_code": response.status_code}
        )
        exit(1)
if __name__ == "__main__":
    main()

