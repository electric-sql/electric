#!/bin/bash

if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <shape-url>"
    echo "Example: $0 'http://localhost:3000/v1/shape?table=todos'"
    exit 1
fi

# Extract base URL (everything before the query string)
BASE_URL=$(echo "$1" | sed -E 's/\?.*//')
# Extract and clean query parameters
QUERY_STRING=$(echo "$1" | sed -n 's/.*\?\(.*\)/\1/p')

# Build cleaned query string, removing electric-specific params but keeping others
if [ -n "$QUERY_STRING" ]; then
    # Split query string into individual parameters
    CLEANED_PARAMS=""
    IFS='&' read -ra PARAMS <<< "$QUERY_STRING"
    for param in "${PARAMS[@]}"; do
        KEY=$(echo "$param" | cut -d'=' -f1)
        # Skip electric-specific params
        case "$KEY" in
            "offset"|"handle"|"live") continue ;;
            *) 
                if [ -z "$CLEANED_PARAMS" ]; then
                    CLEANED_PARAMS="$param"
                else
                    CLEANED_PARAMS="${CLEANED_PARAMS}&${param}"
                fi
                ;;
        esac
    done
    
    # Add question mark if we have params
    if [ -n "$CLEANED_PARAMS" ]; then
        BASE_URL="${BASE_URL}?${CLEANED_PARAMS}&"
    else
        BASE_URL="${BASE_URL}?"
    fi
else
    BASE_URL="${BASE_URL}?"
fi

# Directory to store individual JSON files
OFFSET_DIR="./json_files"

# Initialize variables
LATEST_OFFSET="-1"
SHAPE_HANDLE=""
IS_LIVE_MODE=false

# Create the output directory if it doesn't exist
mkdir -p "$OFFSET_DIR"

# Function to extract header value from curl response
get_header_value() {
    local headers="$1"
    local header_name="$2"
    echo "$headers" | grep -i "^$header_name:" | cut -d':' -f2- | tr -d ' \r'
}

# Function to download and process JSON data
process_json() {
    local url="$1"
    local tmp_headers="headers.tmp"
    local tmp_body="body.tmp"
    local response_file="response.tmp"
    local state_file="state.tmp"

    echo "Downloading shape log from URL: ${url}"

    # Clear any existing tmp files and create new ones
    rm -f "$tmp_headers" "$tmp_body" "$response_file" "$state_file" xx*
    
    # Download the entire response first
    curl -i -s "$url" > "$response_file"

    # Split at the double newline - everything before the JSON array
    sed -n '/^\[/,$p' "$response_file" > "$tmp_body"
    grep -B 1000 "^\[" "$response_file" | grep -v "^\[" > "$tmp_headers"

    # Display prettified JSON if file is not empty
    if [ -s "$tmp_body" ]; then
        jq '.' < "$tmp_body"
    fi

    # Extract important headers
    local headers=$(cat "$tmp_headers")
    local new_handle=$(get_header_value "$headers" "electric-handle")
    local new_offset=$(get_header_value "$headers" "electric-offset")

    # Always update handle from header if present
    if [ -n "$new_handle" ]; then
        SHAPE_HANDLE="$new_handle"
    fi

    # Update offset from header
    if [ -n "$new_offset" ]; then
        LATEST_OFFSET="$new_offset"
    fi

    # Check if headers were received
    if [ ! -f "$tmp_headers" ]; then
        echo >&2 "Failed to download response."
        return 1
    fi

    # Process last 5 items in the JSON array for control messages
    jq -c 'if length > 5 then .[-5:] else . end | .[]' "$tmp_body" | while IFS= read -r item; do
        # Parse the JSON message
        if echo "$item" | jq -e '.headers.control' >/dev/null 2>&1; then
            echo "Found control message" >&2
            # Handle control messages
            local control=$(echo "$item" | jq -r '.headers.control')
            echo "Control value: $control" >&2
            case "$control" in
                "up-to-date")
                    echo "true" > "$state_file"
                    echo >&2 "Shape is up to date, switching to live mode"
                    ;;
                "must-refetch")
                    echo >&2 "Server requested refetch"
                    LATEST_OFFSET="-1"
                    IS_LIVE_MODE=false
                    SHAPE_HANDLE=""
                    ;;
            esac
        fi
    done

    # Read the state file and update IS_LIVE_MODE
    if [ -f "$state_file" ] && [ "$(cat "$state_file")" = "true" ]; then
        IS_LIVE_MODE=true
    fi

    # Cleanup
    rm -f "$tmp_headers" "$tmp_body" "$response_file" "$state_file" xx*

    return 0
}

# Main loop to poll for updates
while true; do
    # Construct URL with appropriate parameters
    url="${BASE_URL}offset=$LATEST_OFFSET"
    if [ -n "$SHAPE_HANDLE" ]; then
        url="${url}&handle=$SHAPE_HANDLE"
    fi
    if [ "$IS_LIVE_MODE" = true ]; then
        url="${url}&live=true"
    fi

    if ! process_json "$url"; then
        echo >&2 "Error processing response, retrying in 5 seconds..."
        sleep 5
        continue
    fi

    # Add small delay between requests
    sleep 1
done
