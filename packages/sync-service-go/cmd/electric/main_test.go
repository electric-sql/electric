package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/electric-sql/electric/packages/sync-service-go/pkg/api"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/config"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/shapecache"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/storage/memory"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHealthCheck(t *testing.T) {
	// Create test dependencies
	store := memory.NewDefault()
	cache := shapecache.NewCache(store)
	cfg := &config.Config{
		Port:            3000,
		LongPollTimeout: 20 * time.Second,
		ChunkThreshold:  10 * 1024 * 1024,
		MaxAge:          604800,
		StaleAge:        300,
		StorageDir:      "./test_data",
		ReplicationSlot: "test_slot",
		Publication:     "test_pub",
		DBPoolSize:      5,
		DatabaseURL:     "postgres://test:test@localhost/test",
	}

	// Create router
	router := api.NewRouter(cache, store, cfg)

	// Test /health endpoint
	t.Run("GET /health returns ok", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))

		var response map[string]string
		err := json.NewDecoder(rec.Body).Decode(&response)
		require.NoError(t, err)
		assert.Equal(t, "ok", response["status"])
	})

	// Test /v1/health endpoint
	t.Run("GET /v1/health returns ok", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))

		var response map[string]string
		err := json.NewDecoder(rec.Body).Decode(&response)
		require.NoError(t, err)
		assert.Equal(t, "ok", response["status"])
	})
}

func TestServerConfiguration(t *testing.T) {
	// Test that the server can be configured correctly
	store := memory.NewDefault()
	cache := shapecache.NewCache(store)
	cfg := &config.Config{
		Port:            3000,
		LongPollTimeout: 20 * time.Second,
		ChunkThreshold:  10 * 1024 * 1024,
		MaxAge:          604800,
		StaleAge:        300,
		StorageDir:      "./test_data",
		ReplicationSlot: "test_slot",
		Publication:     "test_pub",
		DBPoolSize:      5,
		DatabaseURL:     "postgres://test:test@localhost/test",
	}

	router := api.NewRouter(cache, store, cfg)

	// Create an httptest server to test the full HTTP stack
	server := httptest.NewServer(router)
	defer server.Close()

	// Make a real HTTP request to the test server
	resp, err := http.Get(server.URL + "/health")
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var response map[string]string
	err = json.NewDecoder(resp.Body).Decode(&response)
	require.NoError(t, err)
	assert.Equal(t, "ok", response["status"])
}

func TestRouterEndpoints(t *testing.T) {
	store := memory.NewDefault()
	cache := shapecache.NewCache(store)
	cfg := &config.Config{
		Port:            3000,
		LongPollTimeout: 20 * time.Second,
		ChunkThreshold:  10 * 1024 * 1024,
		MaxAge:          604800,
		StaleAge:        300,
		StorageDir:      "./test_data",
		ReplicationSlot: "test_slot",
		Publication:     "test_pub",
		DBPoolSize:      5,
		DatabaseURL:     "postgres://test:test@localhost/test",
	}

	router := api.NewRouter(cache, store, cfg)

	// Test that shape endpoints exist and return appropriate responses
	t.Run("GET /v1/shape returns response", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/shape?table=test", nil)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		// Returns 409 (Conflict) because the shape cache can't properly initialize without DB
		// This is expected behavior - the handler is working but the cache returns "shape gone"
		assert.Equal(t, http.StatusConflict, rec.Code)
	})

	t.Run("DELETE /v1/shape/{handle} returns response", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodDelete, "/v1/shape/test-handle-123", nil)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		// Returns 404 (Not Found) because the shape doesn't exist
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})

	t.Run("GET /v1/shape without table returns bad request", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/shape", nil)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		// Returns 400 (Bad Request) because table parameter is required
		assert.Equal(t, http.StatusBadRequest, rec.Code)
	})

	t.Run("OPTIONS /v1/shape returns CORS headers", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodOptions, "/v1/shape", nil)
		req.Header.Set("Origin", "http://example.com")
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusNoContent, rec.Code)
		assert.NotEmpty(t, rec.Header().Get("Access-Control-Allow-Origin"))
		assert.Contains(t, rec.Header().Get("Access-Control-Allow-Methods"), "DELETE")
	})
}
