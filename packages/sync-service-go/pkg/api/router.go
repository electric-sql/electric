// Package api provides the HTTP router and handlers for the Electric sync service.
// Ported from: lib/electric/plug/router.ex
package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"runtime/debug"
	"strings"
	"sync/atomic"

	"github.com/electric-sql/electric/packages/sync-service-go/pkg/config"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/shapecache"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/storage"
)

// Version is the Electric server version, can be set at build time.
var Version = "dev"

// electricExposedHeaders is the list of headers to expose in CORS responses.
var electricExposedHeaders = []string{
	HeaderElectricCursor,
	HeaderElectricHandle,
	HeaderElectricOffset,
	HeaderElectricSchema,
	HeaderElectricUpToDate,
	"retry-after",
}

// requestIDCounter is a simple counter for generating request IDs.
var requestIDCounter uint64

// generateRequestID generates a unique request ID.
func generateRequestID() string {
	id := atomic.AddUint64(&requestIDCounter, 1)
	return fmt.Sprintf("%d", id)
}

// Router is the main HTTP router for the Electric sync service.
type Router struct {
	mux     *http.ServeMux
	handler *Handler
	config  *config.Config

	// Custom handlers - if nil, use handler's methods
	customServeShape  func(http.ResponseWriter, *http.Request)
	customDeleteShape func(http.ResponseWriter, *http.Request)
	customHealth      func(http.ResponseWriter, *http.Request)
}

// RouterOption is a function that configures a Router.
type RouterOption func(*Router)

// WithCustomServeShape sets a custom handler for GET /v1/shape.
func WithCustomServeShape(fn func(http.ResponseWriter, *http.Request)) RouterOption {
	return func(r *Router) {
		r.customServeShape = fn
	}
}

// WithCustomDeleteShape sets a custom handler for DELETE /v1/shape.
func WithCustomDeleteShape(fn func(http.ResponseWriter, *http.Request)) RouterOption {
	return func(r *Router) {
		r.customDeleteShape = fn
	}
}

// WithCustomHealth sets a custom handler for health endpoints.
func WithCustomHealth(fn func(http.ResponseWriter, *http.Request)) RouterOption {
	return func(r *Router) {
		r.customHealth = fn
	}
}

// NewRouter creates a new HTTP router with the given dependencies.
func NewRouter(cache *shapecache.Cache, storage storage.Storage, cfg *config.Config, opts ...RouterOption) *Router {
	handler := NewHandler(cache, storage, cfg)
	router := &Router{
		mux:     http.NewServeMux(),
		handler: handler,
		config:  cfg,
	}

	// Apply options
	for _, opt := range opts {
		opt(router)
	}

	// Register routes
	router.setupRoutes()

	return router
}

// setupRoutes registers all HTTP routes.
func (r *Router) setupRoutes() {
	// Shape API routes - use custom handlers if set, otherwise use handler's methods
	serveShapeHandler := r.customServeShape
	if serveShapeHandler == nil {
		serveShapeHandler = r.wrapErrorHandler(r.handler.ServeShape)
	}
	r.mux.HandleFunc("GET /v1/shape", r.wrapHandler(serveShapeHandler))

	deleteShapeHandler := r.customDeleteShape
	if deleteShapeHandler == nil {
		deleteShapeHandler = r.wrapErrorHandler(r.handler.DeleteShape)
	}
	r.mux.HandleFunc("DELETE /v1/shape", r.wrapHandler(deleteShapeHandler))
	r.mux.HandleFunc("DELETE /v1/shape/{handle}", r.wrapHandler(deleteShapeHandler))

	r.mux.HandleFunc("OPTIONS /v1/shape", r.wrapHandler(r.handler.OptionsShape))

	// Health check routes - use custom handler if set
	healthHandler := r.customHealth
	if healthHandler == nil {
		healthHandler = r.handler.Health
	}
	r.mux.HandleFunc("GET /v1/health", r.wrapHandler(healthHandler))
	r.mux.HandleFunc("GET /health", r.wrapHandler(healthHandler))

	// Root route - returns 200 empty response
	r.mux.HandleFunc("GET /", r.wrapHandler(r.root))
}

// wrapErrorHandler converts a handler that returns an error into a standard http.HandlerFunc.
// Any error returned is already written to the response by the handler.
func (r *Router) wrapErrorHandler(fn func(http.ResponseWriter, *http.Request) error) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		if err := fn(w, req); err != nil {
			// Error already written to response by the handler
			// Could add logging here if desired
			log.Printf("Handler error: %v", err)
		}
	}
}

// wrapHandler wraps a handler function with middleware.
func (r *Router) wrapHandler(fn func(http.ResponseWriter, *http.Request)) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		// Apply middleware in order
		r.withRequestID(
			r.withServerHeader(
				r.withCORS(
					r.withAuthentication(
						r.withPanicRecovery(fn),
					),
				),
			),
		)(w, req)
	}
}

// withRequestID adds a request ID to the request context.
func (r *Router) withRequestID(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		requestID := req.Header.Get("X-Request-Id")
		if requestID == "" {
			requestID = generateRequestID()
		}
		w.Header().Set("X-Request-Id", requestID)
		next(w, req)
	}
}

// withServerHeader adds the Electric server header.
func (r *Router) withServerHeader(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("electric-server", fmt.Sprintf("ElectricSQL/%s", Version))
		next(w, req)
	}
}

// withCORS adds CORS headers to the response.
func (r *Router) withCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		// Only add CORS headers for /v1/shape routes
		if isShapeRoute(req.URL.Path) {
			// Get allowed origin from request or use "*"
			origin := req.Header.Get("Origin")
			if origin == "" {
				origin = "*"
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, HEAD, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "*")
			w.Header().Set("Access-Control-Expose-Headers", strings.Join(electricExposedHeaders, ","))
		} else {
			// For non-shape routes, use simpler CORS headers
			origin := req.Header.Get("Origin")
			if origin == "" {
				origin = "*"
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD")
		}
		next(w, req)
	}
}

// withAuthentication checks for API secret if configured.
func (r *Router) withAuthentication(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		// Skip authentication for OPTIONS requests
		if req.Method == "OPTIONS" {
			next(w, req)
			return
		}

		// Skip authentication for non-shape routes or if no secret is configured
		if !isShapeRoute(req.URL.Path) || r.config == nil || r.config.Secret == "" {
			next(w, req)
			return
		}

		// Check for secret in query params
		secret := req.URL.Query().Get("secret")
		// Also check api_secret for backwards compatibility
		if secret == "" {
			secret = req.URL.Query().Get("api_secret")
		}

		if secret != r.config.Secret {
			writeRouterErrorJSON(w, http.StatusUnauthorized, "Unauthorized - Invalid API secret")
			return
		}

		next(w, req)
	}
}

// withPanicRecovery recovers from panics and returns a 500 error.
func (r *Router) withPanicRecovery(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				log.Printf("Panic recovered: %v\n%s", err, debug.Stack())
				writeRouterErrorJSON(w, http.StatusInternalServerError, "Internal server error")
			}
		}()
		next(w, req)
	}
}

// ServeHTTP implements http.Handler interface.
func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	r.mux.ServeHTTP(w, req)
}

// root handles GET / requests, returning 200 with an empty body.
func (r *Router) root(w http.ResponseWriter, req *http.Request) {
	// Return 200 with empty body for exact root path
	if req.URL.Path != "/" {
		writeRouterErrorJSON(w, http.StatusNotFound, "Not found")
		return
	}
	w.WriteHeader(http.StatusOK)
}

// isShapeRoute checks if the path is a shape API route.
// Matches /v1/shape exactly or /v1/shape/ with additional path segments.
// Note: Query strings are not part of URL.Path in Go's net/http, so we don't check for them.
func isShapeRoute(path string) bool {
	if path == "/v1/shape" {
		return true
	}
	// Match /v1/shape/ (with trailing slash) or /v1/shape/{subpath}
	return strings.HasPrefix(path, "/v1/shape/")
}

// RouterErrorResponse represents a JSON error response from the router.
type RouterErrorResponse struct {
	Message string `json:"message"`
}

// writeRouterErrorJSON writes a JSON error response.
func writeRouterErrorJSON(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	resp := RouterErrorResponse{Message: message}
	_ = json.NewEncoder(w).Encode(resp)
}

// RouterHealthResponse represents the health check response.
type RouterHealthResponse struct {
	Status string `json:"status"`
}
