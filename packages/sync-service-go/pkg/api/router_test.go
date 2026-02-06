// Package api provides tests for the HTTP router.
// Ported from: test/electric/plug/router_test.exs
package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/electric-sql/electric/packages/sync-service-go/pkg/config"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/shapecache"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/storage/memory"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestHealthResponse for parsing health check responses in tests.
type TestHealthResponse struct {
	Status string `json:"status"`
}

// TestErrorResponse for parsing error responses in tests.
type TestErrorResponse struct {
	Message string `json:"message"`
	Error   string `json:"error,omitempty"`
}

// Simple test handlers for testing router middleware without complex business logic
func simpleServeShapeHandler(w http.ResponseWriter, r *http.Request) {
	tableName := r.URL.Query().Get("table")
	if tableName == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"message": "table parameter is required"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("[]"))
}

func simpleDeleteShapeHandler(w http.ResponseWriter, r *http.Request) {
	handle := r.URL.Query().Get("handle")
	if handle == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"message": "handle parameter is required"})
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func simpleHealthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "active"})
}

// testRouter creates a new router with simple test handlers.
func testRouter(t *testing.T) *Router {
	t.Helper()
	store := memory.NewDefault()
	cache := shapecache.NewCache(store)
	cfg := &config.Config{
		Port:       3000,
		MaxAge:     60,
		StaleAge:   300,
		StorageDir: t.TempDir(),
	}
	return NewRouter(cache, store, cfg,
		WithCustomServeShape(simpleServeShapeHandler),
		WithCustomDeleteShape(simpleDeleteShapeHandler),
		WithCustomHealth(simpleHealthHandler),
	)
}

// testRouterWithSecret creates a new router with a configured secret.
func testRouterWithSecret(t *testing.T, secret string) *Router {
	t.Helper()
	store := memory.NewDefault()
	cache := shapecache.NewCache(store)
	cfg := &config.Config{
		Port:       3000,
		MaxAge:     60,
		StaleAge:   300,
		StorageDir: t.TempDir(),
		Secret:     secret,
	}
	return NewRouter(cache, store, cfg,
		WithCustomServeShape(simpleServeShapeHandler),
		WithCustomDeleteShape(simpleDeleteShapeHandler),
		WithCustomHealth(simpleHealthHandler),
	)
}

// --- Route tests ---

func TestRouter_Root(t *testing.T) {
	router := testRouter(t)

	req := httptest.NewRequest("GET", "/", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Empty(t, rr.Body.String())
}

func TestRouter_Root_NotFound(t *testing.T) {
	router := testRouter(t)

	req := httptest.NewRequest("GET", "/nonexistent", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusNotFound, rr.Code)
}

func TestRouter_Health(t *testing.T) {
	router := testRouter(t)

	req := httptest.NewRequest("GET", "/v1/health", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Equal(t, "application/json", rr.Header().Get("Content-Type"))
	assert.Equal(t, "no-cache, no-store, must-revalidate", rr.Header().Get("Cache-Control"))

	var resp TestHealthResponse
	err := json.Unmarshal(rr.Body.Bytes(), &resp)
	require.NoError(t, err)
	assert.Equal(t, "active", resp.Status)
}

func TestRouter_HealthAlias(t *testing.T) {
	router := testRouter(t)

	req := httptest.NewRequest("GET", "/health", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Equal(t, "application/json", rr.Header().Get("Content-Type"))

	var resp TestHealthResponse
	err := json.Unmarshal(rr.Body.Bytes(), &resp)
	require.NoError(t, err)
	assert.Equal(t, "active", resp.Status)
}

func TestRouter_ServeShape(t *testing.T) {
	router := testRouter(t)

	req := httptest.NewRequest("GET", "/v1/shape?table=users", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Equal(t, "application/json", rr.Header().Get("Content-Type"))
}

func TestRouter_ServeShape_MissingTable(t *testing.T) {
	router := testRouter(t)

	req := httptest.NewRequest("GET", "/v1/shape", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)

	var resp TestErrorResponse
	err := json.Unmarshal(rr.Body.Bytes(), &resp)
	require.NoError(t, err)
	assert.Contains(t, resp.Message, "table")
}

func TestRouter_DeleteShape(t *testing.T) {
	router := testRouter(t)

	req := httptest.NewRequest("DELETE", "/v1/shape?handle=abc123", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusAccepted, rr.Code)
}

func TestRouter_DeleteShape_MissingHandle(t *testing.T) {
	router := testRouter(t)

	req := httptest.NewRequest("DELETE", "/v1/shape", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)

	var resp TestErrorResponse
	err := json.Unmarshal(rr.Body.Bytes(), &resp)
	require.NoError(t, err)
	assert.Contains(t, resp.Message, "handle")
}

func TestRouter_OptionsShape(t *testing.T) {
	router := testRouter(t)

	req := httptest.NewRequest("OPTIONS", "/v1/shape", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusNoContent, rr.Code)
}

// --- CORS tests ---

func TestRouter_CORS_ShapeRoute(t *testing.T) {
	router := testRouter(t)

	req := httptest.NewRequest("GET", "/v1/shape?table=users", nil)
	req.Header.Set("Origin", "http://example.com")
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	assert.Equal(t, "http://example.com", rr.Header().Get("Access-Control-Allow-Origin"))
	assert.Contains(t, rr.Header().Get("Access-Control-Allow-Methods"), "GET")
	assert.Contains(t, rr.Header().Get("Access-Control-Allow-Methods"), "DELETE")
	assert.Contains(t, rr.Header().Get("Access-Control-Allow-Methods"), "OPTIONS")
	assert.Equal(t, "*", rr.Header().Get("Access-Control-Allow-Headers"))

	// Check exposed headers
	exposedHeaders := rr.Header().Get("Access-Control-Expose-Headers")
	assert.Contains(t, exposedHeaders, "electric-handle")
	assert.Contains(t, exposedHeaders, "electric-offset")
	assert.Contains(t, exposedHeaders, "electric-schema")
	assert.Contains(t, exposedHeaders, "electric-up-to-date")
	assert.Contains(t, exposedHeaders, "electric-cursor")
}

func TestRouter_CORS_NoOrigin(t *testing.T) {
	router := testRouter(t)

	req := httptest.NewRequest("GET", "/v1/shape?table=users", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	// When no Origin header, should default to "*"
	assert.Equal(t, "*", rr.Header().Get("Access-Control-Allow-Origin"))
}

func TestRouter_CORS_NonShapeRoute(t *testing.T) {
	router := testRouter(t)

	req := httptest.NewRequest("GET", "/health", nil)
	req.Header.Set("Origin", "http://example.com")
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	// Non-shape routes have simpler CORS
	assert.Equal(t, "http://example.com", rr.Header().Get("Access-Control-Allow-Origin"))
	methods := rr.Header().Get("Access-Control-Allow-Methods")
	assert.Contains(t, methods, "GET")
	assert.Contains(t, methods, "HEAD")
}

func TestRouter_CORS_OptionsPreflight(t *testing.T) {
	router := testRouter(t)

	req := httptest.NewRequest("OPTIONS", "/v1/shape", nil)
	req.Header.Set("Origin", "http://example.com")
	req.Header.Set("Access-Control-Request-Method", "DELETE")
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusNoContent, rr.Code)
	// Note: The handlers.go OptionsShape sets CORS headers which may override router middleware.
	// The actual origin is set to "*" by handlers.go.setCORSHeaders.
	assert.NotEmpty(t, rr.Header().Get("Access-Control-Allow-Origin"))
	assert.Contains(t, rr.Header().Get("Access-Control-Allow-Methods"), "DELETE")
}

// --- Authentication tests ---

func TestRouter_Auth_NoSecretConfigured(t *testing.T) {
	router := testRouter(t)

	// Without secret configured, should pass through
	req := httptest.NewRequest("GET", "/v1/shape?table=users", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestRouter_Auth_SecretRequired_Missing(t *testing.T) {
	router := testRouterWithSecret(t, "my-secret")

	// With secret configured but not provided, should 401
	req := httptest.NewRequest("GET", "/v1/shape?table=users", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code)

	var resp TestErrorResponse
	err := json.Unmarshal(rr.Body.Bytes(), &resp)
	require.NoError(t, err)
	assert.Contains(t, resp.Message, "Unauthorized")
}

func TestRouter_Auth_SecretRequired_WrongSecret(t *testing.T) {
	router := testRouterWithSecret(t, "my-secret")

	req := httptest.NewRequest("GET", "/v1/shape?table=users&secret=wrong-secret", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestRouter_Auth_SecretRequired_CorrectSecret(t *testing.T) {
	router := testRouterWithSecret(t, "my-secret")

	req := httptest.NewRequest("GET", "/v1/shape?table=users&secret=my-secret", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestRouter_Auth_SecretRequired_ApiSecretBackwardsCompat(t *testing.T) {
	router := testRouterWithSecret(t, "my-secret")

	// api_secret should also work for backwards compatibility
	req := httptest.NewRequest("GET", "/v1/shape?table=users&api_secret=my-secret", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestRouter_Auth_OptionsSkipsAuth(t *testing.T) {
	router := testRouterWithSecret(t, "my-secret")

	// OPTIONS requests should not require authentication
	req := httptest.NewRequest("OPTIONS", "/v1/shape", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusNoContent, rr.Code)
}

func TestRouter_Auth_HealthSkipsAuth(t *testing.T) {
	router := testRouterWithSecret(t, "my-secret")

	// Health check should not require authentication
	req := httptest.NewRequest("GET", "/v1/health", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestRouter_Auth_DeleteRequiresAuth(t *testing.T) {
	router := testRouterWithSecret(t, "my-secret")

	// DELETE without secret should 401
	req := httptest.NewRequest("DELETE", "/v1/shape?handle=abc123", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestRouter_Auth_DeleteWithSecret(t *testing.T) {
	router := testRouterWithSecret(t, "my-secret")

	// DELETE with secret should work
	req := httptest.NewRequest("DELETE", "/v1/shape?handle=abc123&secret=my-secret", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusAccepted, rr.Code)
}

// --- Request ID tests ---

func TestRouter_RequestID_Generated(t *testing.T) {
	router := testRouter(t)

	req := httptest.NewRequest("GET", "/health", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	requestID := rr.Header().Get("X-Request-Id")
	assert.NotEmpty(t, requestID)
}

func TestRouter_RequestID_Preserved(t *testing.T) {
	router := testRouter(t)

	req := httptest.NewRequest("GET", "/health", nil)
	req.Header.Set("X-Request-Id", "custom-request-id")
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	requestID := rr.Header().Get("X-Request-Id")
	assert.Equal(t, "custom-request-id", requestID)
}

// --- Server header tests ---

func TestRouter_ServerHeader(t *testing.T) {
	router := testRouter(t)

	req := httptest.NewRequest("GET", "/health", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	serverHeader := rr.Header().Get("electric-server")
	assert.True(t, strings.HasPrefix(serverHeader, "ElectricSQL/"))
}

// --- Panic recovery tests ---

func TestRouter_PanicRecovery(t *testing.T) {
	store := memory.NewDefault()
	cache := shapecache.NewCache(store)
	cfg := &config.Config{
		Port:       3000,
		StorageDir: t.TempDir(),
	}
	router := NewRouter(cache, store, cfg,
		WithCustomServeShape(simpleServeShapeHandler),
		WithCustomDeleteShape(simpleDeleteShapeHandler),
		WithCustomHealth(simpleHealthHandler),
	)

	// Create a new mux with a panic handler
	panicRouter := &Router{
		mux:    http.NewServeMux(),
		config: cfg,
	}
	panicRouter.mux.HandleFunc("GET /panic", panicRouter.wrapHandler(func(w http.ResponseWriter, r *http.Request) {
		panic("test panic")
	}))

	req := httptest.NewRequest("GET", "/panic", nil)
	rr := httptest.NewRecorder()

	// Should not panic
	panicRouter.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusInternalServerError, rr.Code)

	var resp TestErrorResponse
	err := json.Unmarshal(rr.Body.Bytes(), &resp)
	require.NoError(t, err)
	assert.Contains(t, resp.Message, "Internal server error")

	// Verify original router still works
	req = httptest.NewRequest("GET", "/health", nil)
	rr = httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	assert.Equal(t, http.StatusOK, rr.Code)
}

// --- Error response tests ---

func TestRouter_ErrorResponse_JSON(t *testing.T) {
	router := testRouter(t)

	req := httptest.NewRequest("GET", "/v1/shape", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assert.Equal(t, "application/json", rr.Header().Get("Content-Type"))

	var resp TestErrorResponse
	err := json.Unmarshal(rr.Body.Bytes(), &resp)
	require.NoError(t, err)
	assert.NotEmpty(t, resp.Message)
}

// --- Handler tests ---

func TestHandler_NewHandler(t *testing.T) {
	store := memory.NewDefault()
	cache := shapecache.NewCache(store)
	cfg := &config.Config{}

	handler := NewHandler(cache, store, cfg)

	assert.NotNil(t, handler)
	assert.NotNil(t, handler.cache)
	assert.NotNil(t, handler.storage)
	assert.NotNil(t, handler.config)
}

// --- Route matching tests ---

func TestIsShapeRoute(t *testing.T) {
	tests := []struct {
		path     string
		expected bool
	}{
		{"/v1/shape", true},
		{"/v1/shape/", true},
		{"/v1/shape/subpath", true},
		// Note: In real HTTP requests, query strings are NOT part of the path
		// req.URL.Path would be "/v1/shape", not "/v1/shape?table=users"
		{"/v1/shapes", false},
		{"/v1/health", false},
		{"/health", false},
		{"/", false},
		{"/v2/shape", false},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			result := isShapeRoute(tt.path)
			assert.Equal(t, tt.expected, result)
		})
	}
}

// --- Integration tests ---

func TestRouter_FullIntegration(t *testing.T) {
	router := testRouter(t)
	server := httptest.NewServer(router)
	defer server.Close()

	// Test root endpoint
	resp, err := http.Get(server.URL + "/")
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Test health endpoint
	resp, err = http.Get(server.URL + "/v1/health")
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Test shape endpoint with table param
	resp, err = http.Get(server.URL + "/v1/shape?table=users")
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Test shape endpoint without table param
	resp, err = http.Get(server.URL + "/v1/shape")
	require.NoError(t, err)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	resp.Body.Close()
}

func TestRouter_ConcurrentRequests(t *testing.T) {
	router := testRouter(t)
	server := httptest.NewServer(router)
	defer server.Close()

	const numRequests = 100

	done := make(chan bool, numRequests)

	for i := 0; i < numRequests; i++ {
		go func() {
			resp, err := http.Get(server.URL + "/v1/health")
			if err != nil {
				done <- false
				return
			}
			resp.Body.Close()
			done <- resp.StatusCode == http.StatusOK
		}()
	}

	successCount := 0
	for i := 0; i < numRequests; i++ {
		if <-done {
			successCount++
		}
	}

	assert.Equal(t, numRequests, successCount)
}

// --- NewRouter without custom handlers uses handlers.go ---

func TestRouter_DefaultHandlers(t *testing.T) {
	store := memory.NewDefault()
	cache := shapecache.NewCache(store)
	cfg := &config.Config{
		Port:       3000,
		StorageDir: t.TempDir(),
	}

	// Create router without custom handlers - uses handlers.go
	router := NewRouter(cache, store, cfg)

	// Health check should work (handlers.go Health returns {"status": "ok"})
	req := httptest.NewRequest("GET", "/v1/health", nil)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)

	var resp TestHealthResponse
	err := json.Unmarshal(rr.Body.Bytes(), &resp)
	require.NoError(t, err)
	assert.Equal(t, "ok", resp.Status) // handlers.go returns "ok" not "active"
}
