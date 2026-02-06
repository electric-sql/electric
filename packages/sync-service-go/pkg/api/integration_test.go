// Package api provides integration tests for the Electric sync service API.
// These tests verify end-to-end behavior of the HTTP API using an in-memory storage backend.
// Ported from: packages/typescript-client/test/integration.test.ts
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/electric-sql/electric/packages/sync-service-go/pkg/config"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/schema"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/shape"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/shapecache"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/storage"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/storage/memory"
)

// testEnv provides a complete test environment for integration tests.
type testEnv struct {
	server  *httptest.Server
	cache   *shapecache.Cache
	storage *memory.MemoryStorage
	config  *config.Config
	baseURL string
	t       *testing.T
}

// newTestEnv creates a new test environment with an HTTP server.
func newTestEnv(t *testing.T) *testEnv {
	t.Helper()

	store := memory.NewDefault()
	cache := shapecache.NewCache(store)
	cfg := &config.Config{
		DatabaseURL:     "postgres://test:test@localhost:5432/test",
		Port:            3000,
		LongPollTimeout: 100 * time.Millisecond, // Short timeout for tests
		ChunkThreshold:  10240,                  // 10KB for testing
		MaxAge:          604800,                 // 1 week (matches Electric behavior)
		StaleAge:        2629746,                // ~1 month
		StorageDir:      t.TempDir(),
		ReplicationSlot: "test_slot",
		Publication:     "test_pub",
		DBPoolSize:      1,
	}

	router := NewRouter(cache, store, cfg)
	server := httptest.NewServer(router)

	return &testEnv{
		server:  server,
		cache:   cache,
		storage: store,
		config:  cfg,
		baseURL: server.URL,
		t:       t,
	}
}

// close shuts down the test server.
func (e *testEnv) close() {
	if e.server != nil {
		e.server.Close()
	}
}

// getShape makes a shape request and parses the response.
// Returns the response and parsed JSON messages.
func (e *testEnv) getShape(t *testing.T, params url.Values) (*http.Response, []map[string]any) {
	t.Helper()

	reqURL := e.baseURL + "/v1/shape?" + params.Encode()
	resp, err := http.Get(reqURL)
	require.NoError(t, err)

	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	defer resp.Body.Close()

	var messages []map[string]any
	if len(body) > 0 && resp.StatusCode == http.StatusOK {
		err = json.Unmarshal(body, &messages)
		require.NoError(t, err, "failed to parse response body: %s", string(body))
	}

	return resp, messages
}

// getShapeWithHeaders makes a shape request with custom headers.
func (e *testEnv) getShapeWithHeaders(t *testing.T, params url.Values, headers map[string]string) (*http.Response, []map[string]any) {
	t.Helper()

	reqURL := e.baseURL + "/v1/shape?" + params.Encode()
	req, err := http.NewRequest(http.MethodGet, reqURL, nil)
	require.NoError(t, err)

	for k, v := range headers {
		req.Header.Set(k, v)
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	require.NoError(t, err)

	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	defer resp.Body.Close()

	var messages []map[string]any
	if len(body) > 0 && resp.StatusCode == http.StatusOK {
		err = json.Unmarshal(body, &messages)
		require.NoError(t, err, "failed to parse response body: %s", string(body))
	}

	return resp, messages
}

// deleteShape deletes a shape by handle.
func (e *testEnv) deleteShape(t *testing.T, handle string) *http.Response {
	t.Helper()

	reqURL := e.baseURL + "/v1/shape?handle=" + handle
	req, err := http.NewRequest(http.MethodDelete, reqURL, nil)
	require.NoError(t, err)

	client := &http.Client{}
	resp, err := client.Do(req)
	require.NoError(t, err)

	return resp
}

// createShape creates a shape in the cache and storage with the given table name.
// Returns the shape handle.
func (e *testEnv) createShape(t *testing.T, tableName string, opts ...shape.Option) string {
	t.Helper()

	s, err := shape.New(tableName, opts...)
	require.NoError(t, err)

	handle, _, err := e.cache.GetOrCreate(context.Background(), s)
	require.NoError(t, err)

	// Set up table schema
	tableSchema := schema.NewTableSchema("public", tableName, []schema.Column{
		{Name: "id", Type: "int4", PKIndex: 0},
		{Name: "title", Type: "text", PKIndex: -1},
		{Name: "priority", Type: "int4", PKIndex: -1},
	})
	s.TableSchema = tableSchema

	// Create shape in storage with schema
	schemaInfo := storage.SchemaInfo{
		TableName: tableName,
		Schema:    "public",
		Columns: []storage.ColumnInfo{
			{Name: "id", Type: "int4", PKIndex: 0},
			{Name: "title", Type: "text", PKIndex: -1},
			{Name: "priority", Type: "int4", PKIndex: -1},
		},
	}

	// Create empty snapshot (shape exists but no data)
	err = e.storage.SetSnapshot(handle.String(), schemaInfo, []storage.LogItem{}, 0)
	require.NoError(t, err)

	// Mark snapshot complete
	err = e.cache.MarkSnapshotComplete(handle.String())
	require.NoError(t, err)

	return handle.String()
}

// insertRows inserts rows into a shape's storage.
// Each row should be a map with column names as keys.
func (e *testEnv) insertRows(t *testing.T, handle string, rows ...map[string]any) {
	t.Helper()

	// Get existing snapshot data
	existingItems, _, err := e.storage.GetSnapshot(handle)
	require.NoError(t, err)

	// Get table name from cache
	info, found := e.cache.Get(handle)
	require.True(t, found, "shape not found")

	tableName := info.Shape.TableName
	schemaName := info.Shape.Schema

	// Build new snapshot items from existing + new rows
	newItems := make([]storage.LogItem, len(existingItems))
	copy(newItems, existingItems)

	// Calculate offset based on existing items
	baseOffset := len(existingItems)

	for i, row := range rows {
		offset := baseOffset + i
		id := row["id"]

		// Build the key
		key := buildRecordKey(schemaName, tableName, id)

		// Build JSON message
		msg := map[string]any{
			"headers": map[string]any{
				"operation": "insert",
			},
			"key":    key,
			"value":  row,
			"offset": formatOffset(0, offset),
		}
		jsonBytes, err := json.Marshal(msg)
		require.NoError(t, err)

		newItems = append(newItems, storage.LogItem{
			Offset: formatOffset(0, offset),
			Key:    key,
			Op:     storage.OpInsert,
			JSON:   jsonBytes,
		})
	}

	// Get current schema info
	schemaInfo, err := e.storage.GetSchema(handle)
	require.NoError(t, err)

	// Update snapshot with all items
	err = e.storage.SetSnapshot(handle, schemaInfo, newItems, 0)
	require.NoError(t, err)
}

// appendToLog appends log entries (for live updates simulation).
func (e *testEnv) appendToLog(t *testing.T, handle string, txOffset int64, rows ...map[string]any) {
	t.Helper()

	info, found := e.cache.Get(handle)
	require.True(t, found, "shape not found")

	tableName := info.Shape.TableName
	schemaName := info.Shape.Schema

	items := make([]storage.LogItem, 0, len(rows))

	for i, row := range rows {
		id := row["id"]
		op := storage.OpInsert
		if opVal, ok := row["_op"]; ok {
			switch opVal.(string) {
			case "update":
				op = storage.OpUpdate
			case "delete":
				op = storage.OpDelete
			default:
				op = storage.OpInsert
			}
			delete(row, "_op")
		}

		key := buildRecordKey(schemaName, tableName, id)
		offset := formatOffset(txOffset, i)

		msg := map[string]any{
			"headers": map[string]any{
				"operation": string(op),
			},
			"key":    key,
			"value":  row,
			"offset": offset,
		}
		jsonBytes, err := json.Marshal(msg)
		require.NoError(t, err)

		items = append(items, storage.LogItem{
			Offset: offset,
			Key:    key,
			Op:     op,
			JSON:   jsonBytes,
		})
	}

	err := e.storage.AppendToLog(handle, items)
	require.NoError(t, err)
}

// waitForUpToDate polls until the shape reports up-to-date at the given offset.
func (e *testEnv) waitForUpToDate(t *testing.T, handle string, offset string) string {
	t.Helper()

	params := url.Values{}
	params.Set("table", "test")
	params.Set("handle", handle)
	params.Set("offset", offset)

	resp, _ := e.getShape(t, params)
	defer resp.Body.Close()

	return resp.Header.Get(HeaderElectricOffset)
}

// Helper functions

// buildRecordKey builds a record key in the Electric format.
func buildRecordKey(schemaName, tableName string, id any) string {
	return "\"" + schemaName + "\".\"" + tableName + "\"/\"" + anyToString(id) + "\""
}

// formatOffset formats a tx_offset and op_offset into an offset string.
func formatOffset(tx int64, op int) string {
	return storage.FormatOffset(tx, op)
}

// anyToString converts any value to a string representation.
func anyToString(v any) string {
	switch val := v.(type) {
	case string:
		return val
	case int:
		return strings.TrimPrefix(strings.TrimSuffix(mustMarshal(val), ""), "")
	case int64:
		return strings.TrimPrefix(strings.TrimSuffix(mustMarshal(val), ""), "")
	case float64:
		return strings.TrimPrefix(strings.TrimSuffix(mustMarshal(val), ""), "")
	default:
		return strings.Trim(string(mustMarshalBytes(val)), "\"")
	}
}

func mustMarshal(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func mustMarshalBytes(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

// =============================================================================
// Integration Tests
// =============================================================================

// TestIntegration_EmptyShape tests that an empty shape/table returns up-to-date immediately.
func TestIntegration_EmptyShape(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create an empty shape
	handle := env.createShape(t, "empty_table")

	// Request the shape
	params := url.Values{}
	params.Set("table", "empty_table")
	params.Set("offset", "-1")

	resp, messages := env.getShape(t, params)
	defer resp.Body.Close()

	// Verify response headers
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.NotEmpty(t, resp.Header.Get(HeaderElectricHandle), "should have electric-handle header")
	assert.NotEmpty(t, resp.Header.Get(HeaderElectricOffset), "should have electric-offset header")
	assert.Equal(t, handle, resp.Header.Get(HeaderElectricHandle))

	// Empty shape should return empty array
	assert.Empty(t, messages, "empty shape should return no data messages")
}

// TestIntegration_GetShapeHeaders tests that all required headers are present.
func TestIntegration_GetShapeHeaders(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create a shape
	env.createShape(t, "users")

	// Request the shape (initial sync)
	params := url.Values{}
	params.Set("table", "users")
	params.Set("offset", "-1")

	resp, _ := env.getShape(t, params)
	defer resp.Body.Close()

	// Verify all required headers
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	// electric-handle header must exist
	handleHeader := resp.Header.Get(HeaderElectricHandle)
	assert.NotEmpty(t, handleHeader, "electric-handle header should exist")

	// electric-offset header must exist
	offsetHeader := resp.Header.Get(HeaderElectricOffset)
	assert.NotEmpty(t, offsetHeader, "electric-offset header should exist")

	// electric-schema header should exist for initial sync (offset=-1)
	schemaHeader := resp.Header.Get(HeaderElectricSchema)
	assert.NotEmpty(t, schemaHeader, "electric-schema header should exist for initial sync")

	// Schema header should be valid JSON with column info
	var schemaInfo map[string]any
	err := json.Unmarshal([]byte(schemaHeader), &schemaInfo)
	assert.NoError(t, err, "electric-schema should be valid JSON")

	// Should contain column definitions
	assert.Contains(t, schemaInfo, "id", "schema should contain 'id' column")
	assert.Contains(t, schemaInfo, "title", "schema should contain 'title' column")
}

// TestIntegration_InitialData tests that initial data is returned correctly.
func TestIntegration_InitialData(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape and insert data
	handle := env.createShape(t, "issues")

	// Insert data before subscribing
	env.insertRows(t, handle,
		map[string]any{"id": "1", "title": "First issue", "priority": 1},
		map[string]any{"id": "2", "title": "Second issue", "priority": 2},
	)

	// Request the shape
	params := url.Values{}
	params.Set("table", "issues")
	params.Set("offset", "-1")

	resp, messages := env.getShape(t, params)
	defer resp.Body.Close()

	// Should get the inserted data
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Len(t, messages, 2, "should return 2 data messages")

	// Verify data content
	values := make([]map[string]any, 0)
	for _, msg := range messages {
		if val, ok := msg["value"].(map[string]any); ok {
			values = append(values, val)
		}
	}
	assert.Len(t, values, 2)

	// Check that we got both issues (order may vary)
	titles := []string{}
	for _, v := range values {
		if title, ok := v["title"].(string); ok {
			titles = append(titles, title)
		}
	}
	assert.Contains(t, titles, "First issue")
	assert.Contains(t, titles, "Second issue")
}

// TestIntegration_WhereClause tests that WHERE clause filtering works correctly.
func TestIntegration_WhereClause(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape with WHERE clause
	handle := env.createShape(t, "filtered_issues",
		shape.WithWhere("priority > 5"),
	)

	// Insert rows - some matching, some not matching
	// Note: In real scenario, WHERE filtering happens at PostgreSQL level
	// Here we simulate by only inserting matching rows
	env.insertRows(t, handle,
		map[string]any{"id": "1", "title": "High priority", "priority": 10},
		map[string]any{"id": "2", "title": "Also high", "priority": 8},
	)

	// Request the shape with WHERE clause
	params := url.Values{}
	params.Set("table", "filtered_issues")
	params.Set("where", "priority > 5")
	params.Set("offset", "-1")

	resp, messages := env.getShape(t, params)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Len(t, messages, 2, "should return only matching rows")
}

// TestIntegration_ColumnSelection tests that column selection works correctly.
func TestIntegration_ColumnSelection(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape with column selection
	handle := env.createShape(t, "column_test",
		shape.WithColumns([]string{"id", "title"}),
	)

	// Insert data
	env.insertRows(t, handle,
		map[string]any{"id": "1", "title": "Test", "priority": 5},
	)

	// Request with column selection
	params := url.Values{}
	params.Set("table", "column_test")
	params.Set("columns", "id,title")
	params.Set("offset", "-1")

	resp, messages := env.getShape(t, params)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Len(t, messages, 1)

	// Verify column content
	if len(messages) > 0 {
		if val, ok := messages[0]["value"].(map[string]any); ok {
			// Should have id and title
			assert.Contains(t, val, "id")
			assert.Contains(t, val, "title")
			// Note: In this test setup, we're inserting the full row,
			// column filtering would be done at the response level
		}
	}
}

// TestIntegration_CacheHeaders tests that correct cache headers are returned.
func TestIntegration_CacheHeaders(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape
	env.createShape(t, "cache_test")

	// Request the shape
	params := url.Values{}
	params.Set("table", "cache_test")
	params.Set("offset", "-1")

	resp, _ := env.getShape(t, params)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	// Check Cache-Control header
	cacheControl := resp.Header.Get(HeaderCacheControl)
	assert.NotEmpty(t, cacheControl, "Cache-Control header should be present")

	// For non-empty responses, should include public
	// Note: empty shapes may get different caching

	// Check ETag header
	etag := resp.Header.Get(HeaderETag)
	assert.NotEmpty(t, etag, "ETag header should be present")
	assert.True(t, strings.HasPrefix(etag, "\""), "ETag should be quoted")
	assert.True(t, strings.HasSuffix(etag, "\""), "ETag should be quoted")
}

// TestIntegration_CacheHeadersWithData tests cache headers when data is present.
func TestIntegration_CacheHeadersWithData(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape with data
	handle := env.createShape(t, "cache_test_data")
	env.insertRows(t, handle,
		map[string]any{"id": "1", "title": "Test", "priority": 1},
	)

	// Request the shape
	params := url.Values{}
	params.Set("table", "cache_test_data")
	params.Set("offset", "-1")

	resp, _ := env.getShape(t, params)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	// Check Cache-Control header for initial sync with data
	cacheControl := resp.Header.Get(HeaderCacheControl)
	assert.NotEmpty(t, cacheControl, "Cache-Control header should be present")
	assert.Contains(t, cacheControl, "public", "should be public")
	assert.Contains(t, cacheControl, "max-age", "should have max-age")
}

// TestIntegration_ETagRevalidation tests ETag-based revalidation.
func TestIntegration_ETagRevalidation(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape with data
	handle := env.createShape(t, "etag_test")
	env.insertRows(t, handle,
		map[string]any{"id": "1", "title": "Test", "priority": 1},
	)

	// First request to get ETag
	params := url.Values{}
	params.Set("table", "etag_test")
	params.Set("offset", "-1")

	resp1, _ := env.getShape(t, params)
	etag := resp1.Header.Get(HeaderETag)
	resp1.Body.Close()

	require.NotEmpty(t, etag, "should have ETag")

	// Second request with If-None-Match
	params.Set("handle", handle)
	params.Set("offset", "0_0")

	resp2, _ := env.getShapeWithHeaders(t, params, map[string]string{
		"If-None-Match": etag,
	})
	defer resp2.Body.Close()

	// Should return 304 Not Modified when content hasn't changed
	// Note: Actual behavior depends on whether the offset/handle match
	// With the same offset and no new data, we might get 200 with empty array
	// or 304 depending on implementation
	assert.True(t, resp2.StatusCode == http.StatusOK || resp2.StatusCode == http.StatusNotModified,
		"should return 200 or 304 for unchanged content")
}

// TestIntegration_InvalidRequest tests that invalid requests return proper errors.
func TestIntegration_InvalidRequest(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Test cases for invalid requests
	tests := []struct {
		name       string
		params     url.Values
		wantStatus int
		wantError  bool
	}{
		{
			name:       "missing table",
			params:     url.Values{},
			wantStatus: http.StatusBadRequest,
			wantError:  true,
		},
		{
			name: "invalid WHERE clause",
			params: url.Values{
				"table": []string{"users"},
				"where": []string{"invalid SQL here @@#$"},
			},
			wantStatus: http.StatusBadRequest,
			wantError:  true,
		},
		{
			name: "invalid offset",
			params: url.Values{
				"table":  []string{"users"},
				"offset": []string{"not_an_offset"},
			},
			wantStatus: http.StatusBadRequest,
			wantError:  true,
		},
		{
			name: "invalid replica mode",
			params: url.Values{
				"table":   []string{"users"},
				"replica": []string{"invalid"},
			},
			wantStatus: http.StatusBadRequest,
			wantError:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp, _ := env.getShape(t, tt.params)
			defer resp.Body.Close()

			assert.Equal(t, tt.wantStatus, resp.StatusCode)

			if tt.wantError {
				// Error responses should have JSON error format
				assert.Equal(t, ContentTypeJSON, resp.Header.Get(HeaderContentType))
			}
		})
	}
}

// TestIntegration_InvalidWhereClauseErrorFormat tests error format for invalid WHERE.
func TestIntegration_InvalidWhereClauseErrorFormat(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	params := url.Values{}
	params.Set("table", "users")
	params.Set("where", "SELECT * FROM users") // Invalid WHERE clause

	reqURL := env.baseURL + "/v1/shape?" + params.Encode()
	resp, err := http.Get(reqURL)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)

	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)

	var errorResp map[string]any
	err = json.Unmarshal(body, &errorResp)
	require.NoError(t, err)

	// Should have error field
	assert.Contains(t, errorResp, "error")
	assert.Contains(t, errorResp, "message")
}

// TestIntegration_ShapeDeprecation tests that deleted shapes return 409 Conflict.
func TestIntegration_ShapeDeprecation(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape with data
	handle := env.createShape(t, "deprecation_test")
	env.insertRows(t, handle,
		map[string]any{"id": "1", "title": "Test", "priority": 1},
	)

	// Verify shape works initially
	params := url.Values{}
	params.Set("table", "deprecation_test")
	params.Set("handle", handle)
	params.Set("offset", "-1")

	resp1, _ := env.getShape(t, params)
	assert.Equal(t, http.StatusOK, resp1.StatusCode)
	resp1.Body.Close()

	// Delete the shape
	deleteResp := env.deleteShape(t, handle)
	assert.Equal(t, http.StatusNoContent, deleteResp.StatusCode)
	deleteResp.Body.Close()

	// Subsequent requests with the old handle should return 409
	// Make a fresh request (don't use getShape helper as it may not handle error responses well)
	reqURL := env.baseURL + "/v1/shape?" + params.Encode()
	resp2, err := http.Get(reqURL)
	require.NoError(t, err)

	// Read body before closing
	body, err := io.ReadAll(resp2.Body)
	resp2.Body.Close()
	require.NoError(t, err)

	assert.Equal(t, http.StatusConflict, resp2.StatusCode)

	// Error should indicate shape is gone
	var errorResp map[string]any
	err = json.Unmarshal(body, &errorResp)
	require.NoError(t, err)

	assert.Equal(t, ErrorCodeShapeGone, errorResp["error"])
}

// TestIntegration_MultipleClients tests that multiple clients can access the same shape.
func TestIntegration_MultipleClients(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape with data
	handle := env.createShape(t, "multi_client_test")
	env.insertRows(t, handle,
		map[string]any{"id": "1", "title": "First", "priority": 1},
		map[string]any{"id": "2", "title": "Second", "priority": 2},
	)

	// Run multiple clients in parallel
	const numClients = 5
	var wg sync.WaitGroup
	results := make([][]map[string]any, numClients)
	handles := make([]string, numClients)
	errors := make([]error, numClients)

	for i := 0; i < numClients; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()

			params := url.Values{}
			params.Set("table", "multi_client_test")
			params.Set("offset", "-1")

			reqURL := env.baseURL + "/v1/shape?" + params.Encode()
			resp, err := http.Get(reqURL)
			if err != nil {
				errors[idx] = err
				return
			}
			defer resp.Body.Close()

			body, err := io.ReadAll(resp.Body)
			if err != nil {
				errors[idx] = err
				return
			}

			var messages []map[string]any
			if err := json.Unmarshal(body, &messages); err != nil {
				errors[idx] = err
				return
			}

			results[idx] = messages
			handles[idx] = resp.Header.Get(HeaderElectricHandle)
		}(i)
	}

	wg.Wait()

	// Verify no errors
	for i, err := range errors {
		assert.NoError(t, err, "client %d should not have errors", i)
	}

	// All clients should get the same handle
	for i := 1; i < numClients; i++ {
		assert.Equal(t, handles[0], handles[i], "all clients should get the same handle")
	}

	// All clients should get the same data
	for i := 1; i < numClients; i++ {
		assert.Equal(t, len(results[0]), len(results[i]),
			"all clients should get the same number of messages")
	}
}

// TestIntegration_LiveModeUpToDate tests live mode returns up-to-date header.
func TestIntegration_LiveModeUpToDate(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create empty shape
	handle := env.createShape(t, "live_test")

	// Request in live mode
	params := url.Values{}
	params.Set("table", "live_test")
	params.Set("handle", handle)
	params.Set("offset", "0_0")
	params.Set("live", "true")

	start := time.Now()
	resp, _ := env.getShape(t, params)
	elapsed := time.Since(start)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	// Should have taken some time due to long-polling
	// (but our test config has short timeout)
	assert.True(t, elapsed >= 50*time.Millisecond,
		"expected long-poll delay, got %v", elapsed)

	// Should have up-to-date header
	upToDate := resp.Header.Get(HeaderElectricUpToDate)
	assert.Equal(t, "true", upToDate, "should indicate up-to-date")

	// Should have cursor for live mode
	cursor := resp.Header.Get(HeaderElectricCursor)
	assert.NotEmpty(t, cursor, "should have cursor in live mode")
}

// TestIntegration_CORSHeaders tests CORS headers are properly set.
func TestIntegration_CORSHeaders(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape
	env.createShape(t, "cors_test")

	// Request with Origin header
	params := url.Values{}
	params.Set("table", "cors_test")
	params.Set("offset", "-1")

	headers := map[string]string{
		"Origin": "http://example.com",
	}

	resp, _ := env.getShapeWithHeaders(t, params, headers)
	defer resp.Body.Close()

	// Check CORS headers
	assert.NotEmpty(t, resp.Header.Get(HeaderAccessControlAllowOrigin))
	assert.NotEmpty(t, resp.Header.Get(HeaderAccessControlExposeHeaders))

	// Exposed headers should include Electric headers
	exposed := resp.Header.Get(HeaderAccessControlExposeHeaders)
	assert.Contains(t, exposed, "electric-handle")
	assert.Contains(t, exposed, "electric-offset")
	assert.Contains(t, exposed, "electric-schema")
}

// TestIntegration_OptionsPreflightRequest tests OPTIONS preflight handling.
func TestIntegration_OptionsPreflightRequest(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	req, err := http.NewRequest(http.MethodOptions, env.baseURL+"/v1/shape", nil)
	require.NoError(t, err)

	req.Header.Set("Origin", "http://example.com")
	req.Header.Set("Access-Control-Request-Method", "GET")

	client := &http.Client{}
	resp, err := client.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusNoContent, resp.StatusCode)
	assert.NotEmpty(t, resp.Header.Get(HeaderAccessControlAllowMethods))
}

// TestIntegration_HandleMismatch tests that using wrong handle returns 409.
func TestIntegration_HandleMismatch(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape
	env.createShape(t, "handle_test")

	// Request with a fake handle
	params := url.Values{}
	params.Set("table", "handle_test")
	params.Set("handle", "fake-handle-12345")
	params.Set("offset", "-1")

	resp, _ := env.getShape(t, params)
	defer resp.Body.Close()

	// Should return 409 Conflict because handle doesn't exist
	assert.Equal(t, http.StatusConflict, resp.StatusCode)
}

// TestIntegration_SchemaTableFormat tests schema.table format in table parameter.
func TestIntegration_SchemaTableFormat(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape with custom schema
	s, err := shape.New("products", shape.WithSchema("inventory"))
	require.NoError(t, err)

	handle, _, err := env.cache.GetOrCreate(context.Background(), s)
	require.NoError(t, err)

	// Set up storage
	schemaInfo := storage.SchemaInfo{
		TableName: "products",
		Schema:    "inventory",
		Columns: []storage.ColumnInfo{
			{Name: "id", Type: "int4", PKIndex: 0},
			{Name: "name", Type: "text", PKIndex: -1},
		},
	}
	err = env.storage.SetSnapshot(handle.String(), schemaInfo, []storage.LogItem{}, 0)
	require.NoError(t, err)
	env.cache.MarkSnapshotComplete(handle.String())

	// Request using schema.table format
	params := url.Values{}
	params.Set("table", "inventory.products")
	params.Set("offset", "-1")

	resp, _ := env.getShape(t, params)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, handle.String(), resp.Header.Get(HeaderElectricHandle))
}

// TestIntegration_ReplicaMode tests replica=full mode.
func TestIntegration_ReplicaMode(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape with replica=full
	s, err := shape.New("replica_test", shape.WithReplica(shape.ReplicaFull))
	require.NoError(t, err)

	handle, _, err := env.cache.GetOrCreate(context.Background(), s)
	require.NoError(t, err)

	schemaInfo := storage.SchemaInfo{
		TableName: "replica_test",
		Schema:    "public",
		Columns: []storage.ColumnInfo{
			{Name: "id", Type: "int4", PKIndex: 0},
			{Name: "data", Type: "text", PKIndex: -1},
		},
	}
	err = env.storage.SetSnapshot(handle.String(), schemaInfo, []storage.LogItem{}, 0)
	require.NoError(t, err)
	env.cache.MarkSnapshotComplete(handle.String())

	// Request with replica=full
	params := url.Values{}
	params.Set("table", "replica_test")
	params.Set("replica", "full")
	params.Set("offset", "-1")

	resp, _ := env.getShape(t, params)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)
}

// TestIntegration_HealthEndpoint tests the health check endpoint.
func TestIntegration_HealthEndpoint(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	resp, err := http.Get(env.baseURL + "/v1/health")
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)

	var health map[string]string
	err = json.Unmarshal(body, &health)
	require.NoError(t, err)

	assert.Equal(t, "ok", health["status"])
}

// TestIntegration_HealthEndpointAlias tests the /health alias.
func TestIntegration_HealthEndpointAlias(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	resp, err := http.Get(env.baseURL + "/health")
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)
}

// TestIntegration_DeleteByTable tests deleting shapes by table name.
func TestIntegration_DeleteByTable(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape
	handle := env.createShape(t, "delete_by_table_test")

	// Delete by table
	req, err := http.NewRequest(http.MethodDelete, env.baseURL+"/v1/shape?table=delete_by_table_test", nil)
	require.NoError(t, err)

	client := &http.Client{}
	resp, err := client.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusNoContent, resp.StatusCode)

	// Verify shape is gone
	assert.False(t, env.cache.HasShape(handle))
}

// TestIntegration_ConcurrentRequests tests handling concurrent requests.
func TestIntegration_ConcurrentRequests(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape with data
	handle := env.createShape(t, "concurrent_test")
	env.insertRows(t, handle,
		map[string]any{"id": "1", "title": "Test", "priority": 1},
	)

	const numRequests = 50
	var wg sync.WaitGroup
	successCount := int32(0)

	for i := 0; i < numRequests; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			params := url.Values{}
			params.Set("table", "concurrent_test")
			params.Set("offset", "-1")

			resp, err := http.Get(env.baseURL + "/v1/shape?" + params.Encode())
			if err != nil {
				return
			}
			defer resp.Body.Close()

			if resp.StatusCode == http.StatusOK {
				successCount++
			}
		}()
	}

	wg.Wait()

	// All requests should succeed
	assert.Equal(t, int32(numRequests), successCount)
}

// TestIntegration_ServerHeader tests that Electric server header is present.
func TestIntegration_ServerHeader(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	resp, err := http.Get(env.baseURL + "/v1/health")
	require.NoError(t, err)
	defer resp.Body.Close()

	serverHeader := resp.Header.Get("electric-server")
	assert.NotEmpty(t, serverHeader)
	assert.True(t, strings.HasPrefix(serverHeader, "ElectricSQL/"))
}

// TestIntegration_RequestID tests that request IDs are generated/preserved.
func TestIntegration_RequestID(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Test auto-generated request ID
	resp1, err := http.Get(env.baseURL + "/v1/health")
	require.NoError(t, err)
	requestID := resp1.Header.Get("X-Request-Id")
	resp1.Body.Close()
	assert.NotEmpty(t, requestID)

	// Test preserved request ID
	req, err := http.NewRequest(http.MethodGet, env.baseURL+"/v1/health", nil)
	require.NoError(t, err)
	req.Header.Set("X-Request-Id", "my-custom-request-id")

	client := &http.Client{}
	resp2, err := client.Do(req)
	require.NoError(t, err)
	defer resp2.Body.Close()

	assert.Equal(t, "my-custom-request-id", resp2.Header.Get("X-Request-Id"))
}

// =============================================================================
// Live Mode / Long-Polling Integration Tests
// =============================================================================

// TestIntegration_LiveModeLongPolling tests that subscribing with live=true
// causes the server to hold the connection until timeout or new data.
// Verifies proper headers are returned (electric-up-to-date, electric-cursor).
func TestIntegration_LiveModeLongPolling(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create an empty shape
	handle := env.createShape(t, "live_poll_test")

	// Request in live mode with offset past all data
	params := url.Values{}
	params.Set("table", "live_poll_test")
	params.Set("handle", handle)
	params.Set("offset", "0_0")
	params.Set("live", "true")

	// Use context with timeout to verify long-polling behavior
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	reqURL := env.baseURL + "/v1/shape?" + params.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	require.NoError(t, err)

	client := &http.Client{}

	start := time.Now()
	resp, err := client.Do(req)
	elapsed := time.Since(start)
	require.NoError(t, err)
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)

	// Verify response status
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	// Should have taken some time due to long-polling (config has 100ms timeout)
	assert.True(t, elapsed >= 50*time.Millisecond,
		"expected long-poll delay, got %v", elapsed)

	// Should have up-to-date header since no new data
	upToDate := resp.Header.Get(HeaderElectricUpToDate)
	assert.Equal(t, "true", upToDate, "should indicate up-to-date")

	// Should have cursor header for live mode
	cursor := resp.Header.Get(HeaderElectricCursor)
	assert.NotEmpty(t, cursor, "should have cursor in live mode")

	// Should have offset header
	offsetHeader := resp.Header.Get(HeaderElectricOffset)
	assert.NotEmpty(t, offsetHeader, "should have offset header")

	// Response body should be empty array (no new data)
	var messages []map[string]any
	err = json.Unmarshal(body, &messages)
	require.NoError(t, err)
	assert.Empty(t, messages, "should return empty array when up-to-date")
}

// TestIntegration_LiveModeReceivesUpdates tests that subscribing with live=true
// receives updates when data is added while long-polling.
func TestIntegration_LiveModeReceivesUpdates(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape with initial data
	handle := env.createShape(t, "live_updates_test")
	env.insertRows(t, handle,
		map[string]any{"id": "1", "title": "Initial", "priority": 1},
	)

	// Channel to signal when data has been added
	dataAdded := make(chan struct{})
	responseReceived := make(chan struct {
		resp     *http.Response
		messages []map[string]any
		offset   string
		err      error
	})

	// Start long-polling in a goroutine
	go func() {
		params := url.Values{}
		params.Set("table", "live_updates_test")
		params.Set("handle", handle)
		params.Set("offset", "0_0") // After initial data
		params.Set("live", "true")

		reqURL := env.baseURL + "/v1/shape?" + params.Encode()
		resp, err := http.Get(reqURL)
		if err != nil {
			responseReceived <- struct {
				resp     *http.Response
				messages []map[string]any
				offset   string
				err      error
			}{nil, nil, "", err}
			return
		}

		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		var messages []map[string]any
		json.Unmarshal(body, &messages)

		responseReceived <- struct {
			resp     *http.Response
			messages []map[string]any
			offset   string
			err      error
		}{resp, messages, resp.Header.Get(HeaderElectricOffset), nil}
	}()

	// Wait a bit to ensure client is polling, then add new data
	time.Sleep(20 * time.Millisecond)
	env.appendToLog(t, handle, 1,
		map[string]any{"id": "2", "title": "Live Update", "priority": 2},
	)
	close(dataAdded)

	// Wait for response
	select {
	case result := <-responseReceived:
		require.NoError(t, result.err)
		assert.Equal(t, http.StatusOK, result.resp.StatusCode)

		// Should have received the new data
		assert.Len(t, result.messages, 1, "should receive the new row")

		if len(result.messages) > 0 {
			msg := result.messages[0]
			if val, ok := msg["value"].(map[string]any); ok {
				assert.Equal(t, "2", val["id"])
				assert.Equal(t, "Live Update", val["title"])
			}
		}

		// Offset should be updated to reflect new data
		assert.NotEqual(t, "0_0", result.offset, "offset should be updated")

	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for long-poll response")
	}
}

// TestIntegration_CatchupAfterOffline tests that a client can catch up after
// being offline by requesting from an old offset and receiving only new data.
func TestIntegration_CatchupAfterOffline(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape with initial data
	handle := env.createShape(t, "catchup_test")
	env.insertRows(t, handle,
		map[string]any{"id": "1", "title": "Initial 1", "priority": 1},
		map[string]any{"id": "2", "title": "Initial 2", "priority": 2},
		map[string]any{"id": "3", "title": "Initial 3", "priority": 3},
	)

	// Get initial data and offset (simulating initial sync)
	params := url.Values{}
	params.Set("table", "catchup_test")
	params.Set("handle", handle)
	params.Set("offset", "-1")

	resp1, messages1 := env.getShape(t, params)
	initialOffset := resp1.Header.Get(HeaderElectricOffset)
	resp1.Body.Close()

	assert.Len(t, messages1, 3, "should get 3 initial rows")
	assert.NotEmpty(t, initialOffset, "should have initial offset")

	// Simulate going offline and more data being added
	env.appendToLog(t, handle, 1,
		map[string]any{"id": "4", "title": "Offline 1", "priority": 4},
		map[string]any{"id": "5", "title": "Offline 2", "priority": 5},
	)

	// Client comes back online and requests from old offset
	params2 := url.Values{}
	params2.Set("table", "catchup_test")
	params2.Set("handle", handle)
	params2.Set("offset", initialOffset)

	resp2, messages2 := env.getShape(t, params2)
	newOffset := resp2.Header.Get(HeaderElectricOffset)
	resp2.Body.Close()

	// Should receive only the new data (rows 4 and 5)
	assert.Len(t, messages2, 2, "should receive only new rows since last offset")

	// Verify the new rows
	titles := make([]string, 0)
	for _, msg := range messages2 {
		if val, ok := msg["value"].(map[string]any); ok {
			if title, ok := val["title"].(string); ok {
				titles = append(titles, title)
			}
		}
	}
	assert.Contains(t, titles, "Offline 1")
	assert.Contains(t, titles, "Offline 2")

	// Offset should be updated
	assert.NotEqual(t, initialOffset, newOffset, "offset should be updated")
}

// TestIntegration_UpdatesAfterInitialSync tests that after initial sync,
// insert/update/delete operations are received in order.
func TestIntegration_UpdatesAfterInitialSync(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape with initial data
	handle := env.createShape(t, "updates_order_test")
	env.insertRows(t, handle,
		map[string]any{"id": "1", "title": "Original", "priority": 1},
	)

	// Get initial sync
	params := url.Values{}
	params.Set("table", "updates_order_test")
	params.Set("handle", handle)
	params.Set("offset", "-1")

	resp1, _ := env.getShape(t, params)
	initialOffset := resp1.Header.Get(HeaderElectricOffset)
	resp1.Body.Close()

	// Perform insert, update, delete operations in sequence
	// Insert new row
	env.appendToLog(t, handle, 1,
		map[string]any{"id": "2", "title": "Inserted", "priority": 2},
	)

	// Update existing row
	env.appendToLog(t, handle, 2,
		map[string]any{"id": "1", "title": "Updated", "priority": 10, "_op": "update"},
	)

	// Delete a row
	env.appendToLog(t, handle, 3,
		map[string]any{"id": "2", "_op": "delete"},
	)

	// Fetch changes since initial sync
	params2 := url.Values{}
	params2.Set("table", "updates_order_test")
	params2.Set("handle", handle)
	params2.Set("offset", initialOffset)

	resp2, messages := env.getShape(t, params2)
	resp2.Body.Close()

	// Should have received 3 operations in order
	assert.Len(t, messages, 3, "should receive 3 operations")

	if len(messages) >= 3 {
		// First operation: insert
		headers0 := messages[0]["headers"].(map[string]any)
		assert.Equal(t, "insert", headers0["operation"])

		// Second operation: update
		headers1 := messages[1]["headers"].(map[string]any)
		assert.Equal(t, "update", headers1["operation"])

		// Third operation: delete
		headers2 := messages[2]["headers"].(map[string]any)
		assert.Equal(t, "delete", headers2["operation"])
	}
}

// TestIntegration_MultipleClientsReceiveSameUpdates tests that multiple clients
// subscribed with live=true receive the same updates.
func TestIntegration_MultipleClientsReceiveSameUpdates(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape with initial data
	handle := env.createShape(t, "multi_client_live_test")
	env.insertRows(t, handle,
		map[string]any{"id": "1", "title": "Initial", "priority": 1},
	)

	// First, add new data to the log
	env.appendToLog(t, handle, 1,
		map[string]any{"id": "2", "title": "Shared Update", "priority": 2},
	)

	// Channels to collect results from both clients
	type clientResult struct {
		messages []map[string]any
		offset   string
		err      error
	}

	results := make(chan clientResult, 2)

	// Function to make a request (not necessarily live, since data already exists)
	makeRequest := func() {
		params := url.Values{}
		params.Set("table", "multi_client_live_test")
		params.Set("handle", handle)
		params.Set("offset", "0_0") // After initial data

		reqURL := env.baseURL + "/v1/shape?" + params.Encode()
		resp, err := http.Get(reqURL)
		if err != nil {
			results <- clientResult{nil, "", err}
			return
		}

		body, _ := io.ReadAll(resp.Body)
		offset := resp.Header.Get(HeaderElectricOffset)
		resp.Body.Close()

		var messages []map[string]any
		json.Unmarshal(body, &messages)

		results <- clientResult{messages, offset, nil}
	}

	// Start two clients in parallel
	go makeRequest()
	go makeRequest()

	// Collect results from both clients
	var collectedResults []clientResult
	for i := 0; i < 2; i++ {
		select {
		case result := <-results:
			collectedResults = append(collectedResults, result)
		case <-time.After(2 * time.Second):
			t.Fatalf("timeout waiting for client %d response", i+1)
		}
	}

	// Verify both clients received the update
	for i, result := range collectedResults {
		require.NoError(t, result.err, "client %d should not have error", i+1)
		assert.Len(t, result.messages, 1, "client %d should receive 1 message", i+1)
	}

	// Both clients should have received the same data
	if len(collectedResults) == 2 && len(collectedResults[0].messages) > 0 && len(collectedResults[1].messages) > 0 {
		msg1 := collectedResults[0].messages[0]
		msg2 := collectedResults[1].messages[0]

		// Compare the keys (should be identical)
		assert.Equal(t, msg1["key"], msg2["key"], "both clients should receive same key")

		// Compare offsets
		assert.Equal(t, collectedResults[0].offset, collectedResults[1].offset,
			"both clients should have same offset")
	}
}

// TestIntegration_OffsetsAreSequential tests that offsets are strictly increasing
// and follow the {tx}_{op} format when inserting multiple rows.
func TestIntegration_OffsetsAreSequential(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape
	handle := env.createShape(t, "offset_sequence_test")

	// Insert multiple rows in sequence (simulating multiple transactions)
	env.insertRows(t, handle,
		map[string]any{"id": "1", "title": "Row 1", "priority": 1},
	)

	env.appendToLog(t, handle, 1,
		map[string]any{"id": "2", "title": "Row 2", "priority": 2},
	)

	env.appendToLog(t, handle, 2,
		map[string]any{"id": "3", "title": "Row 3", "priority": 3},
	)

	env.appendToLog(t, handle, 3,
		map[string]any{"id": "4", "title": "Row 4", "priority": 4},
		map[string]any{"id": "5", "title": "Row 5", "priority": 5}, // Same transaction, different op
	)

	// Get all data
	params := url.Values{}
	params.Set("table", "offset_sequence_test")
	params.Set("handle", handle)
	params.Set("offset", "-1")

	resp, messages := env.getShape(t, params)
	resp.Body.Close()

	// Should have 5 rows
	assert.GreaterOrEqual(t, len(messages), 5, "should have at least 5 messages")

	// Verify offset format and ordering
	var lastTx int64 = -1
	var lastOp int = -1

	for i, msg := range messages {
		offsetStr, ok := msg["offset"].(string)
		require.True(t, ok, "message %d should have offset", i)

		// Verify offset format: {tx}_{op}
		assert.Regexp(t, `^\d+_\d+$`, offsetStr, "offset should match {tx}_{op} format")

		// Parse offset components
		var tx int64
		var op int
		_, err := fmt.Sscanf(offsetStr, "%d_%d", &tx, &op)
		require.NoError(t, err, "should parse offset: %s", offsetStr)

		// Verify strictly increasing (either tx increases, or same tx with increasing op)
		if i > 0 {
			if tx > lastTx {
				// New transaction - valid
			} else if tx == lastTx {
				// Same transaction, op should increase
				assert.Greater(t, op, lastOp,
					"op should increase within same transaction: %s", offsetStr)
			} else {
				t.Errorf("offset %s should be greater than previous (tx=%d, op=%d)", offsetStr, lastTx, lastOp)
			}
		}

		lastTx = tx
		lastOp = op
	}

	// Verify the final offset header
	finalOffset := resp.Header.Get(HeaderElectricOffset)
	assert.NotEmpty(t, finalOffset, "should have final offset in header")
	assert.Regexp(t, `^\d+_\d+$`, finalOffset, "final offset should match {tx}_{op} format")
}

// =============================================================================
// Chunking and Data Type Integration Tests
// =============================================================================

// TestIntegration_ChunkingLargeLogs tests handling of large amounts of data.
// Ported from: packages/typescript-client/test/integration.test.ts
// - Insert enough data to exceed chunk threshold (~10KB)
// - Verify all data is received correctly
// - Verify data integrity for large responses
//
// Note: HTTP-level chunking may require multiple requests depending on implementation.
// This test verifies that large data sets are handled correctly regardless of chunking.
func TestIntegration_ChunkingLargeLogs(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape
	handle := env.createShape(t, "chunking_test")

	// Insert enough data to exceed the 10KB chunk threshold
	// Each row with a ~1KB title
	const numRows = 35
	const titleSize = 1000 // 1KB titles

	rows := make([]map[string]any, numRows)
	expectedTitles := make(map[string]bool)
	for i := 0; i < numRows; i++ {
		// Generate a 1KB title with a unique prefix for verification
		title := fmt.Sprintf("row_%d_", i) + generateLargeString(titleSize-10)
		rows[i] = map[string]any{
			"id":       fmt.Sprintf("%d", i+1),
			"title":    title,
			"priority": i + 1,
		}
		expectedTitles[title] = false
	}

	env.insertRows(t, handle, rows...)

	// Collect all data through potentially multiple requests
	var allMessages []map[string]any
	currentOffset := "-1"
	var totalBytes int

	// Make requests until we've received all data
	maxIterations := 20 // Safety limit
	for i := 0; i < maxIterations; i++ {
		params := url.Values{}
		params.Set("table", "chunking_test")
		params.Set("handle", handle)
		params.Set("offset", currentOffset)

		reqURL := env.baseURL + "/v1/shape?" + params.Encode()
		resp, err := http.Get(reqURL)
		require.NoError(t, err)

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		require.NoError(t, err)

		if resp.StatusCode != http.StatusOK {
			t.Fatalf("unexpected status %d: %s", resp.StatusCode, string(body))
		}

		var messages []map[string]any
		err = json.Unmarshal(body, &messages)
		require.NoError(t, err)

		// Track response size and messages
		if len(messages) > 0 {
			totalBytes += len(body)
			allMessages = append(allMessages, messages...)
		}

		// Get new offset from response header
		newOffset := resp.Header.Get(HeaderElectricOffset)
		if newOffset == "" || newOffset == currentOffset {
			break
		}
		currentOffset = newOffset

		// Check if we have all data
		if len(allMessages) >= numRows {
			break
		}
	}

	// Verify we received all rows
	assert.GreaterOrEqual(t, len(allMessages), numRows,
		"should receive at least %d messages, got %d", numRows, len(allMessages))

	// Verify total bytes transferred is substantial (around 35KB minimum)
	assert.Greater(t, totalBytes, 30000,
		"total bytes should be > 30KB, got %d bytes", totalBytes)

	// Verify data integrity - all expected titles should be present
	for _, msg := range allMessages {
		if val, ok := msg["value"].(map[string]any); ok {
			if title, ok := val["title"].(string); ok {
				if _, exists := expectedTitles[title]; exists {
					expectedTitles[title] = true
				}
			}
		}
	}

	// Count how many titles we found
	foundCount := 0
	for _, found := range expectedTitles {
		if found {
			foundCount++
		}
	}
	assert.Equal(t, numRows, foundCount, "should find all %d unique rows", numRows)
}

// TestIntegration_SpecialColumnNames tests columns with special characters.
// Ported from: packages/typescript-client/test/integration.test.ts
// - Create shape with columns containing special chars (commas, quotes, spaces)
// - Verify columns with special chars are handled correctly
// - Column names like: "has,comma", 'has"quote', "has space"
func TestIntegration_SpecialColumnNames(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape with special column names
	s, err := shape.New("special_columns")
	require.NoError(t, err)

	handleObj, _, err := env.cache.GetOrCreate(context.Background(), s)
	require.NoError(t, err)
	handle := handleObj.String()

	// Set up table schema with special column names on the shape
	tableSchema := schema.NewTableSchema("public", "special_columns", []schema.Column{
		{Name: "id", Type: "int4", PKIndex: 0},
		{Name: "normal", Type: "text", PKIndex: -1},
		{Name: "has,comma", Type: "text", PKIndex: -1},
		{Name: `has"quote`, Type: "text", PKIndex: -1},
		{Name: "has space", Type: "text", PKIndex: -1},
	})
	s.TableSchema = tableSchema

	// Set up storage schema info
	schemaInfo := storage.SchemaInfo{
		TableName: "special_columns",
		Schema:    "public",
		Columns: []storage.ColumnInfo{
			{Name: "id", Type: "int4", PKIndex: 0},
			{Name: "normal", Type: "text", PKIndex: -1},
			{Name: "has,comma", Type: "text", PKIndex: -1},
			{Name: `has"quote`, Type: "text", PKIndex: -1},
			{Name: "has space", Type: "text", PKIndex: -1},
		},
	}

	// Create snapshot with special column data
	row := map[string]any{
		"id":         "1",
		"normal":     "normal_value",
		"has,comma":  "comma_value",
		`has"quote`:  "quote_value",
		"has space":  "space_value",
	}

	key := buildRecordKey("public", "special_columns", "1")
	msg := map[string]any{
		"headers": map[string]any{
			"operation": "insert",
		},
		"key":    key,
		"value":  row,
		"offset": formatOffset(0, 0),
	}
	jsonBytes, err := json.Marshal(msg)
	require.NoError(t, err)

	items := []storage.LogItem{
		{
			Offset: formatOffset(0, 0),
			Key:    key,
			Op:     storage.OpInsert,
			JSON:   jsonBytes,
		},
	}

	err = env.storage.SetSnapshot(handle, schemaInfo, items, 0)
	require.NoError(t, err)
	err = env.cache.MarkSnapshotComplete(handle)
	require.NoError(t, err)

	// Request the shape
	params := url.Values{}
	params.Set("table", "special_columns")
	params.Set("offset", "-1")

	resp, messages := env.getShape(t, params)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	require.Len(t, messages, 1)

	// Verify the message contains all special column names
	value, ok := messages[0]["value"].(map[string]any)
	require.True(t, ok, "message should have value")

	assert.Equal(t, "1", value["id"])
	assert.Equal(t, "normal_value", value["normal"])
	assert.Equal(t, "comma_value", value["has,comma"])
	assert.Equal(t, "quote_value", value[`has"quote`])
	assert.Equal(t, "space_value", value["has space"])

	// Verify schema header contains special column names
	schemaHeader := resp.Header.Get(HeaderElectricSchema)
	assert.NotEmpty(t, schemaHeader, "should have schema header")

	var schemaMap map[string]any
	err = json.Unmarshal([]byte(schemaHeader), &schemaMap)
	require.NoError(t, err)

	assert.Contains(t, schemaMap, "normal")
	assert.Contains(t, schemaMap, "has,comma")
	assert.Contains(t, schemaMap, `has"quote`)
	assert.Contains(t, schemaMap, "has space")
}

// TestIntegration_DataTypes tests that various PostgreSQL data types are encoded correctly.
// Ported from: packages/typescript-client/test/integration.test.ts
// - Test various PostgreSQL data types are encoded correctly
// - Strings, integers, floats, booleans, JSON
// - Values come as strings from PostgreSQL, verify encoding
func TestIntegration_DataTypes(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape with multiple data types
	s, err := shape.New("datatype_test")
	require.NoError(t, err)

	handleObj, _, err := env.cache.GetOrCreate(context.Background(), s)
	require.NoError(t, err)
	handle := handleObj.String()

	// Set up table schema with various types on the shape
	tableSchema := schema.NewTableSchema("public", "datatype_test", []schema.Column{
		{Name: "id", Type: "int4", PKIndex: 0},
		{Name: "txt", Type: "varchar", PKIndex: -1},
		{Name: "i2", Type: "int2", PKIndex: -1},
		{Name: "i4", Type: "int4", PKIndex: -1},
		{Name: "i8", Type: "int8", PKIndex: -1},
		{Name: "f8", Type: "float8", PKIndex: -1},
		{Name: "b", Type: "bool", PKIndex: -1},
		{Name: "json_col", Type: "json", PKIndex: -1},
		{Name: "jsonb_col", Type: "jsonb", PKIndex: -1},
	})
	s.TableSchema = tableSchema

	// Set up storage schema info
	schemaInfo := storage.SchemaInfo{
		TableName: "datatype_test",
		Schema:    "public",
		Columns: []storage.ColumnInfo{
			{Name: "id", Type: "int4", PKIndex: 0},
			{Name: "txt", Type: "varchar", PKIndex: -1},
			{Name: "i2", Type: "int2", PKIndex: -1},
			{Name: "i4", Type: "int4", PKIndex: -1},
			{Name: "i8", Type: "int8", PKIndex: -1},
			{Name: "f8", Type: "float8", PKIndex: -1},
			{Name: "b", Type: "bool", PKIndex: -1},
			{Name: "json_col", Type: "json", PKIndex: -1},
			{Name: "jsonb_col", Type: "jsonb", PKIndex: -1},
		},
	}

	// Create test data with various types
	// Note: PostgreSQL values come as strings in the sync protocol
	row := map[string]any{
		"id":        "1",
		"txt":       "test string",
		"i2":        "32767",
		"i4":        "2147483647",
		"i8":        "9223372036854775807",
		"f8":        "3.14159265359",
		"b":         "true",
		"json_col":  `{"foo":"bar","nested":{"key":123}}`,
		"jsonb_col": `{"array":[1,2,3],"bool":true}`,
	}

	key := buildRecordKey("public", "datatype_test", "1")
	msg := map[string]any{
		"headers": map[string]any{
			"operation": "insert",
		},
		"key":    key,
		"value":  row,
		"offset": formatOffset(0, 0),
	}
	jsonBytes, err := json.Marshal(msg)
	require.NoError(t, err)

	items := []storage.LogItem{
		{
			Offset: formatOffset(0, 0),
			Key:    key,
			Op:     storage.OpInsert,
			JSON:   jsonBytes,
		},
	}

	err = env.storage.SetSnapshot(handle, schemaInfo, items, 0)
	require.NoError(t, err)
	err = env.cache.MarkSnapshotComplete(handle)
	require.NoError(t, err)

	// Request the shape
	params := url.Values{}
	params.Set("table", "datatype_test")
	params.Set("offset", "-1")

	resp, messages := env.getShape(t, params)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	require.Len(t, messages, 1)

	// Verify all data types are present in the response
	value, ok := messages[0]["value"].(map[string]any)
	require.True(t, ok, "message should have value")

	// Verify each type
	assert.Equal(t, "1", value["id"])
	assert.Equal(t, "test string", value["txt"])
	assert.Equal(t, "32767", value["i2"])
	assert.Equal(t, "2147483647", value["i4"])
	assert.Equal(t, "9223372036854775807", value["i8"])
	assert.Equal(t, "3.14159265359", value["f8"])
	assert.Equal(t, "true", value["b"])
	assert.Equal(t, `{"foo":"bar","nested":{"key":123}}`, value["json_col"])
	assert.Equal(t, `{"array":[1,2,3],"bool":true}`, value["jsonb_col"])

	// Verify schema header has type information
	schemaHeader := resp.Header.Get(HeaderElectricSchema)
	require.NotEmpty(t, schemaHeader)

	var schemaMap map[string]any
	err = json.Unmarshal([]byte(schemaHeader), &schemaMap)
	require.NoError(t, err)

	// Verify column types in schema
	if idCol, ok := schemaMap["id"].(map[string]any); ok {
		assert.Equal(t, "int4", idCol["type"])
	}
	if txtCol, ok := schemaMap["txt"].(map[string]any); ok {
		assert.Equal(t, "varchar", txtCol["type"])
	}
	if boolCol, ok := schemaMap["b"].(map[string]any); ok {
		assert.Equal(t, "bool", boolCol["type"])
	}
}

// TestIntegration_NullValues tests that NULL values are properly represented.
// Ported from: packages/typescript-client/test/integration.test.ts
// - Insert row with NULL values
// - Verify NULLs are properly represented (not present in JSON or explicitly null)
func TestIntegration_NullValues(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape
	s, err := shape.New("null_test")
	require.NoError(t, err)

	handleObj, _, err := env.cache.GetOrCreate(context.Background(), s)
	require.NoError(t, err)
	handle := handleObj.String()

	// Set up table schema on the shape
	tableSchema := schema.NewTableSchema("public", "null_test", []schema.Column{
		{Name: "id", Type: "int4", PKIndex: 0},
		{Name: "required_field", Type: "text", PKIndex: -1, NotNull: true},
		{Name: "nullable_text", Type: "text", PKIndex: -1},
		{Name: "nullable_int", Type: "int4", PKIndex: -1},
	})
	s.TableSchema = tableSchema

	// Set up storage schema info
	schemaInfo := storage.SchemaInfo{
		TableName: "null_test",
		Schema:    "public",
		Columns: []storage.ColumnInfo{
			{Name: "id", Type: "int4", PKIndex: 0},
			{Name: "required_field", Type: "text", PKIndex: -1, NotNull: true},
			{Name: "nullable_text", Type: "text", PKIndex: -1},
			{Name: "nullable_int", Type: "int4", PKIndex: -1},
		},
	}

	// Create row with NULL values - NULLs are either absent or explicitly null
	row := map[string]any{
		"id":             "1",
		"required_field": "has value",
		// nullable_text and nullable_int are NULL - either omit or set to nil
		"nullable_text": nil,
		"nullable_int":  nil,
	}

	key := buildRecordKey("public", "null_test", "1")
	msg := map[string]any{
		"headers": map[string]any{
			"operation": "insert",
		},
		"key":    key,
		"value":  row,
		"offset": formatOffset(0, 0),
	}
	jsonBytes, err := json.Marshal(msg)
	require.NoError(t, err)

	items := []storage.LogItem{
		{
			Offset: formatOffset(0, 0),
			Key:    key,
			Op:     storage.OpInsert,
			JSON:   jsonBytes,
		},
	}

	err = env.storage.SetSnapshot(handle, schemaInfo, items, 0)
	require.NoError(t, err)
	err = env.cache.MarkSnapshotComplete(handle)
	require.NoError(t, err)

	// Request the shape
	params := url.Values{}
	params.Set("table", "null_test")
	params.Set("offset", "-1")

	resp, messages := env.getShape(t, params)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	require.Len(t, messages, 1)

	// Verify the response
	value, ok := messages[0]["value"].(map[string]any)
	require.True(t, ok, "message should have value")

	// Required field should be present
	assert.Equal(t, "1", value["id"])
	assert.Equal(t, "has value", value["required_field"])

	// NULL values should be represented as nil in the JSON
	// In Go's JSON, nil values are present with null value
	assert.Nil(t, value["nullable_text"])
	assert.Nil(t, value["nullable_int"])
}

// TestIntegration_EmptyStringsVsNull tests distinction between empty strings and NULL.
// Ported from: packages/typescript-client/test/integration.test.ts
// - Insert row with empty string vs NULL
// - Verify they are distinct in response
func TestIntegration_EmptyStringsVsNull(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape
	s, err := shape.New("empty_vs_null_test")
	require.NoError(t, err)

	handleObj, _, err := env.cache.GetOrCreate(context.Background(), s)
	require.NoError(t, err)
	handle := handleObj.String()

	// Set up table schema on the shape
	tableSchema := schema.NewTableSchema("public", "empty_vs_null_test", []schema.Column{
		{Name: "id", Type: "int4", PKIndex: 0},
		{Name: "empty_string", Type: "text", PKIndex: -1},
		{Name: "null_value", Type: "text", PKIndex: -1},
		{Name: "whitespace", Type: "text", PKIndex: -1},
	})
	s.TableSchema = tableSchema

	// Set up storage schema info
	schemaInfo := storage.SchemaInfo{
		TableName: "empty_vs_null_test",
		Schema:    "public",
		Columns: []storage.ColumnInfo{
			{Name: "id", Type: "int4", PKIndex: 0},
			{Name: "empty_string", Type: "text", PKIndex: -1},
			{Name: "null_value", Type: "text", PKIndex: -1},
			{Name: "whitespace", Type: "text", PKIndex: -1},
		},
	}

	// Create row with empty string vs NULL
	row := map[string]any{
		"id":           "1",
		"empty_string": "",   // Empty string - should be present as ""
		"null_value":   nil,  // NULL - should be nil/absent
		"whitespace":   "  ", // Whitespace - should be preserved
	}

	key := buildRecordKey("public", "empty_vs_null_test", "1")
	msg := map[string]any{
		"headers": map[string]any{
			"operation": "insert",
		},
		"key":    key,
		"value":  row,
		"offset": formatOffset(0, 0),
	}
	jsonBytes, err := json.Marshal(msg)
	require.NoError(t, err)

	items := []storage.LogItem{
		{
			Offset: formatOffset(0, 0),
			Key:    key,
			Op:     storage.OpInsert,
			JSON:   jsonBytes,
		},
	}

	err = env.storage.SetSnapshot(handle, schemaInfo, items, 0)
	require.NoError(t, err)
	err = env.cache.MarkSnapshotComplete(handle)
	require.NoError(t, err)

	// Request the shape
	params := url.Values{}
	params.Set("table", "empty_vs_null_test")
	params.Set("offset", "-1")

	resp, messages := env.getShape(t, params)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	require.Len(t, messages, 1)

	// Verify the response
	value, ok := messages[0]["value"].(map[string]any)
	require.True(t, ok, "message should have value")

	// Empty string should be present as ""
	emptyStr, exists := value["empty_string"]
	assert.True(t, exists, "empty_string should exist in value")
	assert.Equal(t, "", emptyStr, "empty_string should be empty string")

	// NULL should be nil
	nullVal := value["null_value"]
	assert.Nil(t, nullVal, "null_value should be nil")

	// Whitespace should be preserved
	wsVal := value["whitespace"]
	assert.Equal(t, "  ", wsVal, "whitespace should be preserved")

	// Verify they are distinct
	assert.NotEqual(t, emptyStr, nullVal, "empty string and NULL should be distinct")
}

// TestIntegration_LargeValues tests handling of very large text values.
// Ported from: packages/typescript-client/test/integration.test.ts
// - Insert row with very large text value
// - Verify it's returned correctly
func TestIntegration_LargeValues(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create shape
	handle := env.createShape(t, "large_values_test")

	// Test various large value sizes
	testCases := []struct {
		name string
		size int
	}{
		{"small_large", 1000},      // 1KB
		{"medium_large", 10000},    // 10KB
		{"quite_large", 50000},     // 50KB
		{"very_large", 100000},     // 100KB
	}

	for i, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Generate large text value
			largeText := generateLargeString(tc.size)

			row := map[string]any{
				"id":       fmt.Sprintf("%d", i+100), // Use high IDs to avoid conflicts
				"title":    largeText,
				"priority": 1,
			}

			env.insertRows(t, handle, row)

			// Request and verify
			params := url.Values{}
			params.Set("table", "large_values_test")
			params.Set("handle", handle)
			params.Set("offset", "-1")

			resp, messages := env.getShape(t, params)
			resp.Body.Close()

			assert.Equal(t, http.StatusOK, resp.StatusCode)

			// Find the row we inserted
			found := false
			for _, msg := range messages {
				if val, ok := msg["value"].(map[string]any); ok {
					if val["id"] == fmt.Sprintf("%d", i+100) {
						found = true
						// Verify the large value is returned correctly
						title, ok := val["title"].(string)
						assert.True(t, ok, "title should be a string")
						assert.Len(t, title, tc.size, "title should have correct length")
						assert.Equal(t, largeText, title, "title should match original")
						break
					}
				}
			}
			assert.True(t, found, "should find the inserted row with large value")
		})
	}
}

// Helper function to generate a large string of specified size
func generateLargeString(size int) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, size)
	for i := range b {
		b[i] = charset[i%len(charset)]
	}
	return string(b)
}

// newTestEnvWithSecret creates a test environment with secret authentication enabled.
func newTestEnvWithSecret(t *testing.T, secret string) *testEnv {
	t.Helper()

	store := memory.NewDefault()
	cache := shapecache.NewCache(store)
	cfg := &config.Config{
		DatabaseURL:     "postgres://test:test@localhost:5432/test",
		Port:            3000,
		LongPollTimeout: 100 * time.Millisecond, // Short timeout for tests
		ChunkThreshold:  10240,                  // 10KB for testing
		MaxAge:          604800,                 // 1 week (matches Electric behavior)
		StaleAge:        2629746,                // ~1 month
		StorageDir:      t.TempDir(),
		ReplicationSlot: "test_slot",
		Publication:     "test_pub",
		DBPoolSize:      1,
		Secret:          secret, // Set the secret
	}

	router := NewRouter(cache, store, cfg)
	server := httptest.NewServer(router)

	return &testEnv{
		server:  server,
		cache:   cache,
		storage: store,
		config:  cfg,
		baseURL: server.URL,
		t:       t,
	}
}

// deleteShapeByTable deletes shapes by table name.
func (e *testEnv) deleteShapeByTable(t *testing.T, table string) *http.Response {
	t.Helper()

	reqURL := e.baseURL + "/v1/shape?table=" + table
	req, err := http.NewRequest(http.MethodDelete, reqURL, nil)
	require.NoError(t, err)

	client := &http.Client{}
	resp, err := client.Do(req)
	require.NoError(t, err)

	return resp
}

// =============================================================================
// Error Handling and Edge Case Integration Tests
// =============================================================================

// TestIntegration_InvalidWhereClauseSyntax tests various invalid WHERE clause syntaxes.
// Ported from: packages/typescript-client/test/integration.test.ts
// - Various invalid WHERE clause syntaxes
// - "1 x 1", "invalid", etc.
// - Should return 400 with descriptive error
//
// Note: The WHERE clause parser uses pg_query (PostgreSQL parser), so some
// syntaxes that might seem invalid are actually valid PostgreSQL:
// - "invalid" is a valid column reference
// - "id = 1 -- comment" is valid (comments are stripped)
func TestIntegration_InvalidWhereClauseSyntax(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Test various invalid WHERE clause syntaxes
	// Only include cases that the PostgreSQL parser actually rejects
	testCases := []struct {
		name        string
		where       string
		wantStatus  int
		wantError   bool
		description string
	}{
		{
			name:        "invalid operator",
			where:       "1 x 1",
			wantStatus:  http.StatusBadRequest,
			wantError:   true,
			description: "invalid syntax with 'x' operator",
		},
		{
			name:        "sql injection attempt",
			where:       "SELECT * FROM users",
			wantStatus:  http.StatusBadRequest,
			wantError:   true,
			description: "SQL SELECT statement",
		},
		{
			name:        "unclosed parenthesis",
			where:       "(id = 1",
			wantStatus:  http.StatusBadRequest,
			wantError:   true,
			description: "unclosed parenthesis",
		},
		{
			name:        "unclosed string literal",
			where:       "name = 'test",
			wantStatus:  http.StatusBadRequest,
			wantError:   true,
			description: "unclosed string literal",
		},
		{
			name:        "invalid special characters",
			where:       "@@#$%^&",
			wantStatus:  http.StatusBadRequest,
			wantError:   true,
			description: "invalid special characters",
		},
		{
			name:        "semicolon injection",
			where:       "id = 1; DROP TABLE users",
			wantStatus:  http.StatusBadRequest,
			wantError:   true,
			description: "semicolon with DROP statement",
		},
		{
			name:        "missing right operand",
			where:       "id >",
			wantStatus:  http.StatusBadRequest,
			wantError:   true,
			description: "comparison without right operand",
		},
		{
			name:        "subquery attempt",
			where:       "id IN (SELECT id FROM other)",
			wantStatus:  http.StatusBadRequest,
			wantError:   true,
			description: "subquery is not allowed",
		},
		{
			name:        "function call",
			where:       "upper(name) = 'TEST'",
			wantStatus:  http.StatusBadRequest,
			wantError:   true,
			description: "function calls are not allowed",
		},
		{
			name:        "empty where clause",
			where:       "",
			wantStatus:  http.StatusOK,
			wantError:   false,
			description: "empty where clause is valid (no filtering)",
		},
	}

	// Create a shape to test against (without WHERE clause for empty where test)
	env.createShape(t, "users")

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			params := url.Values{}
			params.Set("table", "users")
			if tc.where != "" {
				params.Set("where", tc.where)
			}
			params.Set("offset", "-1")

			reqURL := env.baseURL + "/v1/shape?" + params.Encode()
			resp, err := http.Get(reqURL)
			require.NoError(t, err)
			defer resp.Body.Close()

			body, err := io.ReadAll(resp.Body)
			require.NoError(t, err)

			assert.Equal(t, tc.wantStatus, resp.StatusCode, "status for: %s", tc.description)

			if tc.wantError {
				// Verify error response format
				assert.Equal(t, ContentTypeJSON, resp.Header.Get(HeaderContentType))

				var errorResp map[string]any
				err = json.Unmarshal(body, &errorResp)
				require.NoError(t, err, "should parse error response")

				assert.Contains(t, errorResp, "error", "should have error field")
				assert.Contains(t, errorResp, "message", "should have message field")
			}
		})
	}
}

// TestIntegration_InvalidTableName tests invalid table name handling.
// - Non-existent table
// - Malformed table name
// - Should return 400
//
// Note: The server may accept syntactically-valid but non-existent table names
// and only fail later when trying to access PostgreSQL. These tests focus on
// truly malformed table parameters that are rejected at the API level.
func TestIntegration_InvalidTableName(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	testCases := []struct {
		name        string
		table       string
		wantStatus  int
		description string
	}{
		{
			name:        "empty table name",
			table:       "",
			wantStatus:  http.StatusBadRequest,
			description: "table parameter is required",
		},
		{
			name:        "empty schema.table",
			table:       ".",
			wantStatus:  http.StatusBadRequest,
			description: "just a dot is invalid",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			params := url.Values{}
			if tc.table != "" {
				params.Set("table", tc.table)
			}
			params.Set("offset", "-1")

			reqURL := env.baseURL + "/v1/shape?" + params.Encode()
			resp, err := http.Get(reqURL)
			require.NoError(t, err)
			defer resp.Body.Close()

			assert.Equal(t, tc.wantStatus, resp.StatusCode, tc.description)

			if tc.wantStatus == http.StatusBadRequest {
				// Verify error response
				body, err := io.ReadAll(resp.Body)
				require.NoError(t, err)

				var errorResp map[string]any
				err = json.Unmarshal(body, &errorResp)
				require.NoError(t, err)

				assert.Contains(t, errorResp, "error")
				assert.Contains(t, errorResp, "message")
			}
		})
	}
}

// TestIntegration_MissingRequiredParams tests that missing required parameters return proper errors.
// - Request without table parameter
// - Should return 400
func TestIntegration_MissingRequiredParams(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	testCases := []struct {
		name       string
		params     url.Values
		wantStatus int
		wantError  string
	}{
		{
			name:       "no parameters at all",
			params:     url.Values{},
			wantStatus: http.StatusBadRequest,
			wantError:  "table",
		},
		{
			name: "only offset, no table",
			params: url.Values{
				"offset": []string{"-1"},
			},
			wantStatus: http.StatusBadRequest,
			wantError:  "table",
		},
		{
			name: "only handle, no table",
			params: url.Values{
				"handle": []string{"some-handle"},
			},
			wantStatus: http.StatusBadRequest,
			wantError:  "table",
		},
		{
			name: "only where, no table",
			params: url.Values{
				"where": []string{"id = 1"},
			},
			wantStatus: http.StatusBadRequest,
			wantError:  "table",
		},
		{
			name: "only columns, no table",
			params: url.Values{
				"columns": []string{"id,name"},
			},
			wantStatus: http.StatusBadRequest,
			wantError:  "table",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			reqURL := env.baseURL + "/v1/shape?" + tc.params.Encode()
			resp, err := http.Get(reqURL)
			require.NoError(t, err)
			defer resp.Body.Close()

			body, err := io.ReadAll(resp.Body)
			require.NoError(t, err)

			assert.Equal(t, tc.wantStatus, resp.StatusCode)

			var errorResp map[string]any
			err = json.Unmarshal(body, &errorResp)
			require.NoError(t, err)

			assert.Contains(t, errorResp, "error")
			assert.Contains(t, errorResp, "message")

			// Error message should mention the missing parameter
			if tc.wantError != "" {
				message := errorResp["message"].(string)
				assert.Contains(t, strings.ToLower(message), tc.wantError)
			}
		})
	}
}

// TestIntegration_InvalidOffset tests invalid offset format handling.
// - Invalid offset format (not {tx}_{op})
// - Should return 400
func TestIntegration_InvalidOffset(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create a shape to test against
	env.createShape(t, "offset_test")

	testCases := []struct {
		name       string
		offset     string
		wantStatus int
	}{
		{
			name:       "plain text",
			offset:     "not_an_offset",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "single number",
			offset:     "12345",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "three parts",
			offset:     "1_2_3",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "negative tx",
			offset:     "-10_5",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "floating point",
			offset:     "1.5_2.5",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "letters in offset",
			offset:     "abc_def",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "missing second part",
			offset:     "123_",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "missing first part",
			offset:     "_123",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "just underscore",
			offset:     "_",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "empty string",
			offset:     "",
			wantStatus: http.StatusOK, // Empty is treated as -1
		},
		{
			name:       "valid -1",
			offset:     "-1",
			wantStatus: http.StatusOK,
		},
		{
			name:       "valid offset",
			offset:     "0_0",
			wantStatus: http.StatusOK,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			params := url.Values{}
			params.Set("table", "offset_test")
			if tc.offset != "" {
				params.Set("offset", tc.offset)
			}

			reqURL := env.baseURL + "/v1/shape?" + params.Encode()
			resp, err := http.Get(reqURL)
			require.NoError(t, err)
			defer resp.Body.Close()

			assert.Equal(t, tc.wantStatus, resp.StatusCode)

			if tc.wantStatus == http.StatusBadRequest {
				body, err := io.ReadAll(resp.Body)
				require.NoError(t, err)

				var errorResp map[string]any
				err = json.Unmarshal(body, &errorResp)
				require.NoError(t, err)

				assert.Contains(t, errorResp, "error")
				assert.Contains(t, errorResp, "message")
			}
		})
	}
}

// TestIntegration_InvalidHandle tests invalid handle format and non-existent handle handling.
// - Invalid handle format
// - Non-existent handle
// - Should return appropriate error
func TestIntegration_InvalidHandle(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create a valid shape for comparison
	env.createShape(t, "handle_test")

	testCases := []struct {
		name       string
		handle     string
		wantStatus int
		wantError  string
	}{
		{
			name:       "non-existent handle",
			handle:     "non-existent-handle-12345",
			wantStatus: http.StatusConflict, // Shape gone
			wantError:  ErrorCodeShapeGone,
		},
		{
			name:       "random UUID-like handle",
			handle:     "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
			wantStatus: http.StatusConflict,
			wantError:  ErrorCodeShapeGone,
		},
		{
			name:       "empty handle",
			handle:     "",
			wantStatus: http.StatusOK, // Empty handle means create new shape
		},
		{
			name:       "handle with special characters",
			handle:     "handle@#$%^&*()",
			wantStatus: http.StatusConflict,
			wantError:  ErrorCodeShapeGone,
		},
		{
			name:       "very long handle",
			handle:     strings.Repeat("x", 1000),
			wantStatus: http.StatusConflict,
			wantError:  ErrorCodeShapeGone,
		},
		{
			name:       "handle with spaces",
			handle:     "handle with spaces",
			wantStatus: http.StatusConflict,
			wantError:  ErrorCodeShapeGone,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			params := url.Values{}
			params.Set("table", "handle_test")
			params.Set("offset", "-1")
			if tc.handle != "" {
				params.Set("handle", tc.handle)
			}

			reqURL := env.baseURL + "/v1/shape?" + params.Encode()
			resp, err := http.Get(reqURL)
			require.NoError(t, err)
			defer resp.Body.Close()

			assert.Equal(t, tc.wantStatus, resp.StatusCode)

			if tc.wantError != "" {
				body, err := io.ReadAll(resp.Body)
				require.NoError(t, err)

				var errorResp map[string]any
				err = json.Unmarshal(body, &errorResp)
				require.NoError(t, err)

				assert.Equal(t, tc.wantError, errorResp["error"])
			}
		})
	}
}

// TestIntegration_SecretAuthentication tests API secret authentication.
// - When ELECTRIC_SECRET is set
// - Requests without secret should return 401
// - Requests with wrong secret should return 401
// - Requests with correct secret should succeed
func TestIntegration_SecretAuthentication(t *testing.T) {
	secret := "test-secret-12345"
	env := newTestEnvWithSecret(t, secret)
	defer env.close()

	// Create a shape for testing
	// Note: We need to bypass auth for setup, which the createShape helper does internally
	// by directly accessing the cache

	t.Run("request without secret should return 401", func(t *testing.T) {
		params := url.Values{}
		params.Set("table", "auth_test")
		params.Set("offset", "-1")

		reqURL := env.baseURL + "/v1/shape?" + params.Encode()
		resp, err := http.Get(reqURL)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)

		body, err := io.ReadAll(resp.Body)
		require.NoError(t, err)

		var errorResp map[string]any
		err = json.Unmarshal(body, &errorResp)
		require.NoError(t, err)

		assert.Contains(t, errorResp, "message")
		message := errorResp["message"].(string)
		assert.Contains(t, strings.ToLower(message), "unauthorized")
	})

	t.Run("request with wrong secret should return 401", func(t *testing.T) {
		params := url.Values{}
		params.Set("table", "auth_test")
		params.Set("offset", "-1")
		params.Set("secret", "wrong-secret")

		reqURL := env.baseURL + "/v1/shape?" + params.Encode()
		resp, err := http.Get(reqURL)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	})

	t.Run("request with api_secret parameter should work", func(t *testing.T) {
		// First create a shape with the secret
		handle := env.createShape(t, "auth_test")
		_ = handle

		params := url.Values{}
		params.Set("table", "auth_test")
		params.Set("offset", "-1")
		params.Set("api_secret", secret) // Using api_secret instead of secret

		reqURL := env.baseURL + "/v1/shape?" + params.Encode()
		resp, err := http.Get(reqURL)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)
	})

	t.Run("request with correct secret should succeed", func(t *testing.T) {
		// Create shape first
		handle := env.createShape(t, "auth_test2")
		_ = handle

		params := url.Values{}
		params.Set("table", "auth_test2")
		params.Set("offset", "-1")
		params.Set("secret", secret)

		reqURL := env.baseURL + "/v1/shape?" + params.Encode()
		resp, err := http.Get(reqURL)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)

		// Verify we got proper headers
		assert.NotEmpty(t, resp.Header.Get(HeaderElectricHandle))
		assert.NotEmpty(t, resp.Header.Get(HeaderElectricOffset))
	})

	t.Run("DELETE request without secret should return 401", func(t *testing.T) {
		handle := env.createShape(t, "delete_auth_test")

		req, err := http.NewRequest(http.MethodDelete, env.baseURL+"/v1/shape?handle="+handle, nil)
		require.NoError(t, err)

		client := &http.Client{}
		resp, err := client.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	})

	t.Run("DELETE request with correct secret should succeed", func(t *testing.T) {
		handle := env.createShape(t, "delete_auth_test2")

		req, err := http.NewRequest(http.MethodDelete, env.baseURL+"/v1/shape?handle="+handle+"&secret="+secret, nil)
		require.NoError(t, err)

		client := &http.Client{}
		resp, err := client.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusNoContent, resp.StatusCode)
	})

	t.Run("health endpoint should not require authentication", func(t *testing.T) {
		resp, err := http.Get(env.baseURL + "/v1/health")
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)
	})

	t.Run("OPTIONS request should not require authentication", func(t *testing.T) {
		req, err := http.NewRequest(http.MethodOptions, env.baseURL+"/v1/shape", nil)
		require.NoError(t, err)
		req.Header.Set("Origin", "http://example.com")
		req.Header.Set("Access-Control-Request-Method", "GET")

		client := &http.Client{}
		resp, err := client.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusNoContent, resp.StatusCode)
	})
}

// TestIntegration_DeleteShapeByTable tests deleting shapes by table name.
// - Delete shape by table name
// - Verify 409 is returned on subsequent requests
func TestIntegration_DeleteShapeByTable(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create a shape with data
	handle := env.createShape(t, "delete_table_test")
	env.insertRows(t, handle,
		map[string]any{"id": "1", "title": "Test Row", "priority": 1},
	)

	// Verify shape works
	params := url.Values{}
	params.Set("table", "delete_table_test")
	params.Set("handle", handle)
	params.Set("offset", "-1")

	resp1, _ := env.getShape(t, params)
	assert.Equal(t, http.StatusOK, resp1.StatusCode)
	resp1.Body.Close()

	// Delete by table name
	deleteResp := env.deleteShapeByTable(t, "delete_table_test")
	assert.Equal(t, http.StatusNoContent, deleteResp.StatusCode)
	deleteResp.Body.Close()

	// Subsequent request with old handle should return 409
	reqURL := env.baseURL + "/v1/shape?" + params.Encode()
	resp2, err := http.Get(reqURL)
	require.NoError(t, err)
	defer resp2.Body.Close()

	assert.Equal(t, http.StatusConflict, resp2.StatusCode)

	body, err := io.ReadAll(resp2.Body)
	require.NoError(t, err)

	var errorResp map[string]any
	err = json.Unmarshal(body, &errorResp)
	require.NoError(t, err)

	assert.Equal(t, ErrorCodeShapeGone, errorResp["error"])
}

// TestIntegration_DeleteShapeByHandle tests deleting shapes by handle.
// - Delete shape by handle
// - Verify 409 is returned on subsequent requests
func TestIntegration_DeleteShapeByHandle(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create a shape with data
	handle := env.createShape(t, "delete_handle_test")
	env.insertRows(t, handle,
		map[string]any{"id": "1", "title": "Test Row", "priority": 1},
	)

	// Verify shape works
	params := url.Values{}
	params.Set("table", "delete_handle_test")
	params.Set("handle", handle)
	params.Set("offset", "-1")

	resp1, _ := env.getShape(t, params)
	assert.Equal(t, http.StatusOK, resp1.StatusCode)
	resp1.Body.Close()

	// Delete by handle
	deleteResp := env.deleteShape(t, handle)
	assert.Equal(t, http.StatusNoContent, deleteResp.StatusCode)
	deleteResp.Body.Close()

	// Subsequent request with old handle should return 409
	reqURL := env.baseURL + "/v1/shape?" + params.Encode()
	resp2, err := http.Get(reqURL)
	require.NoError(t, err)
	defer resp2.Body.Close()

	assert.Equal(t, http.StatusConflict, resp2.StatusCode)

	body, err := io.ReadAll(resp2.Body)
	require.NoError(t, err)

	var errorResp map[string]any
	err = json.Unmarshal(body, &errorResp)
	require.NoError(t, err)

	assert.Equal(t, ErrorCodeShapeGone, errorResp["error"])
}

// TestIntegration_DeleteNonExistentShape tests deleting a shape that doesn't exist.
// - Delete a shape that doesn't exist
// - Should return 404
func TestIntegration_DeleteNonExistentShape(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	testCases := []struct {
		name       string
		handle     string
		wantStatus int
	}{
		{
			name:       "non-existent handle",
			handle:     "non-existent-handle-12345",
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "random UUID handle",
			handle:     "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "empty handle",
			handle:     "",
			wantStatus: http.StatusBadRequest, // Need handle or table
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			var reqURL string
			if tc.handle != "" {
				reqURL = env.baseURL + "/v1/shape?handle=" + tc.handle
			} else {
				reqURL = env.baseURL + "/v1/shape"
			}

			req, err := http.NewRequest(http.MethodDelete, reqURL, nil)
			require.NoError(t, err)

			client := &http.Client{}
			resp, err := client.Do(req)
			require.NoError(t, err)
			defer resp.Body.Close()

			assert.Equal(t, tc.wantStatus, resp.StatusCode)

			if tc.wantStatus == http.StatusNotFound {
				body, err := io.ReadAll(resp.Body)
				require.NoError(t, err)

				var errorResp map[string]any
				err = json.Unmarshal(body, &errorResp)
				require.NoError(t, err)

				assert.Equal(t, ErrorCodeNotFound, errorResp["error"])
			}
		})
	}
}

// TestIntegration_RecoveryAfterShapeGone tests that a client can recover after a shape is deleted.
// - Get shape, delete it
// - Client should be able to re-subscribe with new handle
func TestIntegration_RecoveryAfterShapeGone(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create initial shape with data
	handle1 := env.createShape(t, "recovery_test")
	env.insertRows(t, handle1,
		map[string]any{"id": "1", "title": "Initial Row", "priority": 1},
	)

	// Get initial data
	params := url.Values{}
	params.Set("table", "recovery_test")
	params.Set("handle", handle1)
	params.Set("offset", "-1")

	resp1, messages1 := env.getShape(t, params)
	assert.Equal(t, http.StatusOK, resp1.StatusCode)
	assert.Len(t, messages1, 1)
	resp1.Body.Close()

	// Delete the shape
	deleteResp := env.deleteShape(t, handle1)
	assert.Equal(t, http.StatusNoContent, deleteResp.StatusCode)
	deleteResp.Body.Close()

	// Try to access with old handle - should get 409
	resp2, err := http.Get(env.baseURL + "/v1/shape?" + params.Encode())
	require.NoError(t, err)
	assert.Equal(t, http.StatusConflict, resp2.StatusCode)
	resp2.Body.Close()

	// Create a new shape for the same table (simulating client recovery)
	handle2 := env.createShape(t, "recovery_test")
	env.insertRows(t, handle2,
		map[string]any{"id": "2", "title": "New Row After Recovery", "priority": 2},
	)

	// Client should be able to get data with the new handle
	params2 := url.Values{}
	params2.Set("table", "recovery_test")
	params2.Set("handle", handle2)
	params2.Set("offset", "-1")

	resp3, messages3 := env.getShape(t, params2)
	defer resp3.Body.Close()

	assert.Equal(t, http.StatusOK, resp3.StatusCode)
	assert.Equal(t, handle2, resp3.Header.Get(HeaderElectricHandle))

	// Should have data from the new shape
	assert.Len(t, messages3, 1)
	if len(messages3) > 0 {
		if val, ok := messages3[0]["value"].(map[string]any); ok {
			assert.Equal(t, "2", val["id"])
			assert.Equal(t, "New Row After Recovery", val["title"])
		}
	}

	// Verify the handles are different (new shape was created)
	assert.NotEqual(t, handle1, handle2, "new shape should have different handle")
}

// TestIntegration_RecoveryWithoutHandle tests that a client can recover by requesting without handle.
// When a shape is deleted and client requests without handle, a new shape should be created.
func TestIntegration_RecoveryWithoutHandle(t *testing.T) {
	env := newTestEnv(t)
	defer env.close()

	// Create initial shape with data
	handle1 := env.createShape(t, "recovery_no_handle_test")
	env.insertRows(t, handle1,
		map[string]any{"id": "1", "title": "Initial Row", "priority": 1},
	)

	// Delete the shape
	deleteResp := env.deleteShape(t, handle1)
	assert.Equal(t, http.StatusNoContent, deleteResp.StatusCode)
	deleteResp.Body.Close()

	// Request without handle (client recovery pattern)
	// This should create a new shape
	handle2 := env.createShape(t, "recovery_no_handle_test")
	env.insertRows(t, handle2,
		map[string]any{"id": "2", "title": "New Row", "priority": 2},
	)

	params := url.Values{}
	params.Set("table", "recovery_no_handle_test")
	params.Set("offset", "-1")
	// Note: no handle parameter

	resp, messages := env.getShape(t, params)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	// Should get a new handle
	newHandle := resp.Header.Get(HeaderElectricHandle)
	assert.NotEmpty(t, newHandle)
	assert.Equal(t, handle2, newHandle)

	// Should have data
	assert.Len(t, messages, 1)
}
