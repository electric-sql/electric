// Package api provides HTTP handlers for the Electric sync service API.
//
// This package implements the core HTTP endpoints for shape management:
// - GET /v1/shape - Retrieve shape data with optional long-polling
// - DELETE /v1/shape - Delete a shape
// - OPTIONS /v1/shape - CORS preflight handling
// - GET /v1/health - Health check
//
// Ported from: lib/electric/plug/serve_shape_plug.ex
package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/electric-sql/electric/packages/sync-service-go/pkg/columns"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/config"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/offset"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/schema"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/shape"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/shapecache"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/storage"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/where"
)

// Common HTTP header names used by the Electric protocol.
const (
	HeaderElectricHandle                = "electric-handle"
	HeaderElectricOffset                = "electric-offset"
	HeaderElectricSchema                = "electric-schema"
	HeaderElectricUpToDate              = "electric-up-to-date"
	HeaderElectricCursor                = "electric-cursor"
	HeaderCacheControl                  = "Cache-Control"
	HeaderETag                          = "ETag"
	HeaderContentType                   = "Content-Type"
	HeaderAccessControlAllowOrigin      = "Access-Control-Allow-Origin"
	HeaderAccessControlAllowMethods     = "Access-Control-Allow-Methods"
	HeaderAccessControlAllowHeaders     = "Access-Control-Allow-Headers"
	HeaderAccessControlExposeHeaders    = "Access-Control-Expose-Headers"
	HeaderAccessControlMaxAge           = "Access-Control-Max-Age"
)

// Query parameter names for the shape API.
const (
	ParamTable   = "table"
	ParamWhere   = "where"
	ParamColumns = "columns"
	ParamReplica = "replica"
	ParamHandle  = "handle"
	ParamOffset  = "offset"
	ParamLive    = "live"
	ParamCursor  = "cursor"
)

// Content types.
const (
	ContentTypeJSON = "application/json"
)

// Error codes returned in JSON error responses.
const (
	ErrorCodeBadRequest    = "bad_request"
	ErrorCodeShapeGone     = "shape_gone"
	ErrorCodeInternalError = "internal_error"
	ErrorCodeNotFound      = "not_found"
)

// APIError represents an error response from the API.
type APIError struct {
	Code    string `json:"error"`
	Message string `json:"message"`
}

// Handler provides HTTP handlers for the Electric API.
type Handler struct {
	cache   *shapecache.Cache
	storage storage.Storage
	config  *config.Config
}

// NewHandler creates a new API handler with the given dependencies.
func NewHandler(cache *shapecache.Cache, storage storage.Storage, cfg *config.Config) *Handler {
	return &Handler{
		cache:   cache,
		storage: storage,
		config:  cfg,
	}
}

// ShapeParams holds the parsed parameters for a shape request.
type ShapeParams struct {
	Table   string
	Schema  string // Extracted from table (schema.table format)
	Where   string
	Columns []string
	Replica string
	Handle  string
	Offset  offset.LogOffset
	Live    bool
	Cursor  string
}

// CacheEntry holds information about a shape returned from the cache.
type CacheEntry struct {
	Handle       string
	TableSchema  *schema.TableSchema
	LatestOffset offset.LogOffset
}

// ServeShape handles GET /v1/shape requests.
// Query params: table (required), where, columns, replica, handle, offset, live
func (h *Handler) ServeShape(w http.ResponseWriter, r *http.Request) error {
	// Only accept GET requests
	if r.Method != http.MethodGet {
		return h.writeError(w, http.StatusMethodNotAllowed, ErrorCodeBadRequest, "method not allowed")
	}

	// Parse and validate query parameters
	params, err := h.parseShapeParams(r)
	if err != nil {
		return h.writeError(w, http.StatusBadRequest, ErrorCodeBadRequest, err.Error())
	}

	// Set CORS headers
	h.setCORSHeaders(w)

	// Get or create the shape from cache
	entry, err := h.getOrCreateShape(r.Context(), params)
	if err != nil {
		if isShapeGoneError(err) {
			return h.writeShapeGoneError(w, params.Handle)
		}
		return h.writeError(w, http.StatusInternalServerError, ErrorCodeInternalError, err.Error())
	}

	// Check if the requested handle matches (if provided)
	if params.Handle != "" && params.Handle != entry.Handle {
		return h.writeShapeGoneError(w, params.Handle)
	}

	// Get log items from storage
	items, latestOffset, err := h.getLogItems(r.Context(), entry.Handle, params.Offset)
	if err != nil {
		if isShapeGoneError(err) {
			return h.writeShapeGoneError(w, entry.Handle)
		}
		return h.writeError(w, http.StatusInternalServerError, ErrorCodeInternalError, err.Error())
	}

	// Handle live mode with long-polling
	upToDate := len(items) == 0 || isUpToDate(items, latestOffset)
	if params.Live && upToDate && len(items) == 0 {
		// Long-poll: wait for new data or timeout
		newItems, newOffset, err := h.longPoll(r.Context(), entry.Handle, params.Offset)
		if err != nil {
			if err == context.Canceled || err == context.DeadlineExceeded {
				// Timeout - return empty response with up-to-date flag
				return h.writeShapeResponse(w, entry, params, items, latestOffset, true, params.Offset.IsBeforeAll())
			}
			return h.writeError(w, http.StatusInternalServerError, ErrorCodeInternalError, err.Error())
		}
		if len(newItems) > 0 {
			items = newItems
			latestOffset = newOffset
			upToDate = false
		}
	}

	// Determine if we should include schema in the response
	includeSchema := params.Offset.IsBeforeAll()

	return h.writeShapeResponse(w, entry, params, items, latestOffset, upToDate, includeSchema)
}

// DeleteShape handles DELETE /v1/shape requests.
// Query params: table (required), handle
func (h *Handler) DeleteShape(w http.ResponseWriter, r *http.Request) error {
	// Only accept DELETE requests
	if r.Method != http.MethodDelete {
		return h.writeError(w, http.StatusMethodNotAllowed, ErrorCodeBadRequest, "method not allowed")
	}

	// Set CORS headers
	h.setCORSHeaders(w)

	// Parse handle from query params or path
	handle := r.URL.Query().Get(ParamHandle)
	if handle == "" {
		// Try to get handle from path parameter (for /v1/shape/{handle} routes)
		handle = r.PathValue("handle")
	}

	// Get table parameter (used with handle to identify specific shape)
	table := r.URL.Query().Get(ParamTable)

	// Validate: must have at least handle or table
	if handle == "" && table == "" {
		return h.writeError(w, http.StatusBadRequest, ErrorCodeBadRequest, "handle or table parameter is required")
	}

	// If we have a handle, delete by handle
	if handle != "" {
		// Verify the shape exists
		if !h.storage.ShapeExists(handle) {
			return h.writeError(w, http.StatusNotFound, ErrorCodeNotFound, "shape not found")
		}

		// Delete from cache first (which also cleans up storage)
		if h.cache != nil {
			if err := h.cache.Remove(handle); err != nil {
				// If cache deletion fails, try direct storage deletion
				if err := h.storage.DeleteShape(handle); err != nil {
					return h.writeError(w, http.StatusInternalServerError, ErrorCodeInternalError, err.Error())
				}
			}
		} else {
			// No cache, delete directly from storage
			if err := h.storage.DeleteShape(handle); err != nil {
				return h.writeError(w, http.StatusInternalServerError, ErrorCodeInternalError, err.Error())
			}
		}
	} else if table != "" {
		// Delete by table name - find all matching shapes
		// Parse the table name to get schema and table
		schemaName, tableName := parseTableName(table)

		if h.cache != nil {
			// Get all shapes and delete those matching the table
			handles := h.cache.List()
			for _, handle := range handles {
				s, err := h.cache.GetShape(handle)
				if err != nil {
					continue
				}
				if s.Schema == schemaName && s.TableName == tableName {
					h.cache.Remove(handle)
				}
			}
		} else {
			return h.writeError(w, http.StatusBadRequest, ErrorCodeBadRequest, "table-based deletion requires cache")
		}
	}

	// Return success with no content
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// OptionsShape handles OPTIONS /v1/shape for CORS preflight requests.
func (h *Handler) OptionsShape(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w)
	w.WriteHeader(http.StatusNoContent)
}

// Health handles GET /v1/health.
func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set(HeaderContentType, ContentTypeJSON)
	w.WriteHeader(http.StatusOK)

	response := map[string]string{
		"status": "ok",
	}
	json.NewEncoder(w).Encode(response)
}

// parseShapeParams parses and validates query parameters for a shape request.
func (h *Handler) parseShapeParams(r *http.Request) (*ShapeParams, error) {
	q := r.URL.Query()

	// Table is required
	table := q.Get(ParamTable)
	if table == "" {
		return nil, fmt.Errorf("table parameter is required")
	}

	// Parse schema.table format
	schemaName, tableName := parseTableName(table)
	if tableName == "" {
		return nil, fmt.Errorf("invalid table name: %s", table)
	}

	// Parse columns if provided
	var cols []string
	if colsParam := q.Get(ParamColumns); colsParam != "" {
		var err error
		cols, err = columns.ParseColumns(colsParam)
		if err != nil {
			return nil, fmt.Errorf("invalid columns parameter: %w", err)
		}
	}

	// Validate WHERE clause if provided
	whereParam := q.Get(ParamWhere)
	if whereParam != "" {
		_, err := where.Parse(whereParam)
		if err != nil {
			return nil, fmt.Errorf("invalid where parameter: %w", err)
		}
	}

	// Parse replica mode
	replica := q.Get(ParamReplica)
	if replica != "" && replica != "default" && replica != "full" {
		return nil, fmt.Errorf("invalid replica parameter: must be 'default' or 'full'")
	}

	// Parse offset
	var off offset.LogOffset
	offsetParam := q.Get(ParamOffset)
	if offsetParam == "" {
		off = offset.BeforeAll
	} else {
		var err error
		off, err = offset.Parse(offsetParam)
		if err != nil {
			return nil, fmt.Errorf("invalid offset parameter: %w", err)
		}
	}

	// Parse live mode
	liveParam := q.Get(ParamLive)
	live := liveParam == "true" || liveParam == "1"

	return &ShapeParams{
		Table:   tableName,
		Schema:  schemaName,
		Where:   whereParam,
		Columns: cols,
		Replica: replica,
		Handle:  q.Get(ParamHandle),
		Offset:  off,
		Live:    live,
		Cursor:  q.Get(ParamCursor),
	}, nil
}

// getOrCreateShape retrieves or creates a shape based on the request parameters.
func (h *Handler) getOrCreateShape(ctx context.Context, params *ShapeParams) (*CacheEntry, error) {
	if h.cache == nil {
		return nil, fmt.Errorf("cache not initialized")
	}

	// If client provided a handle, try to look it up
	if params.Handle != "" {
		info, found := h.cache.Get(params.Handle)
		if !found {
			return nil, fmt.Errorf("shape not found")
		}
		if info.State == shapecache.StateDeleted {
			return nil, fmt.Errorf("shape gone")
		}

		return &CacheEntry{
			Handle:       info.Handle.String(),
			TableSchema:  info.Shape.TableSchema,
			LatestOffset: info.LatestOffset,
		}, nil
	}

	// No handle provided - build shape and get or create
	opts := []shape.Option{
		shape.WithSchema(params.Schema),
	}

	if params.Where != "" {
		opts = append(opts, shape.WithWhere(params.Where))
	}

	if len(params.Columns) > 0 {
		opts = append(opts, shape.WithColumns(params.Columns))
	}

	if params.Replica != "" {
		replicaMode, err := shape.ValidateReplicaMode(params.Replica)
		if err != nil {
			return nil, err
		}
		opts = append(opts, shape.WithReplica(replicaMode))
	}

	s, err := shape.New(params.Table, opts...)
	if err != nil {
		return nil, fmt.Errorf("invalid shape definition: %w", err)
	}

	// Get or create shape in cache
	handle, _, err := h.cache.GetOrCreate(ctx, s)
	if err != nil {
		return nil, fmt.Errorf("failed to get or create shape: %w", err)
	}

	// Get the shape info to return
	info, found := h.cache.Get(handle.String())
	if !found {
		return nil, fmt.Errorf("shape not found after creation")
	}

	return &CacheEntry{
		Handle:       handle.String(),
		TableSchema:  info.Shape.TableSchema,
		LatestOffset: info.LatestOffset,
	}, nil
}

// getLogItems retrieves log items from storage starting after the given offset.
func (h *Handler) getLogItems(ctx context.Context, handle string, off offset.LogOffset) ([]storage.LogItem, offset.LogOffset, error) {
	// Get items from storage
	items, err := h.storage.GetLogSince(handle, off.String(), 0)
	if err != nil {
		return nil, offset.BeforeAll, err
	}

	// Get the latest offset
	latestOffsetStr, err := h.storage.GetLatestOffset(handle)
	if err != nil {
		return nil, offset.BeforeAll, err
	}

	latestOffset, err := offset.Parse(latestOffsetStr)
	if err != nil {
		latestOffset = offset.InitialOffset
	}

	return items, latestOffset, nil
}

// longPoll waits for new data or timeout.
func (h *Handler) longPoll(ctx context.Context, handle string, off offset.LogOffset) ([]storage.LogItem, offset.LogOffset, error) {
	// Create a timeout context
	timeout := h.config.LongPollTimeout
	if timeout <= 0 {
		timeout = 20 * time.Second
	}

	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	// Poll interval for checking new data
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil, off, ctx.Err()
		case <-ticker.C:
			// Check for new items
			items, latestOffset, err := h.getLogItems(ctx, handle, off)
			if err != nil {
				return nil, off, err
			}
			if len(items) > 0 {
				return items, latestOffset, nil
			}
		}
	}
}

// writeShapeResponse writes a successful shape response with all required headers.
func (h *Handler) writeShapeResponse(w http.ResponseWriter, entry *CacheEntry, params *ShapeParams, items []storage.LogItem, latestOffset offset.LogOffset, upToDate bool, includeSchema bool) error {
	// Set content type
	w.Header().Set(HeaderContentType, ContentTypeJSON)

	// Set Electric headers
	w.Header().Set(HeaderElectricHandle, entry.Handle)
	w.Header().Set(HeaderElectricOffset, latestOffset.String())

	// Set schema header for initial requests
	if includeSchema && entry.TableSchema != nil {
		schemaHeader := entry.TableSchema.SchemaHeader()
		w.Header().Set(HeaderElectricSchema, schemaHeader)
	}

	// Set up-to-date header
	if upToDate {
		w.Header().Set(HeaderElectricUpToDate, "true")
	}

	// Set cursor for live mode
	if params.Live && upToDate {
		cursor := generateCursor(entry.Handle, latestOffset)
		w.Header().Set(HeaderElectricCursor, cursor)
	}

	// Set cache control headers
	h.setCacheHeaders(w, params, upToDate, len(items) > 0)

	// Set ETag
	etag := generateETag(entry.Handle, latestOffset, len(items))
	w.Header().Set(HeaderETag, etag)

	// Write response body
	w.WriteHeader(http.StatusOK)

	// Build response array from log items
	var response []json.RawMessage
	for _, item := range items {
		if len(item.JSON) > 0 {
			response = append(response, json.RawMessage(item.JSON))
		}
	}

	// Always return an array (even if empty)
	if response == nil {
		response = []json.RawMessage{}
	}

	return json.NewEncoder(w).Encode(response)
}

// writeError writes an error response.
func (h *Handler) writeError(w http.ResponseWriter, statusCode int, errorCode, message string) error {
	w.Header().Set(HeaderContentType, ContentTypeJSON)
	w.WriteHeader(statusCode)

	return json.NewEncoder(w).Encode(APIError{
		Code:    errorCode,
		Message: message,
	})
}

// writeShapeGoneError writes a 409 Conflict response indicating the shape is gone.
func (h *Handler) writeShapeGoneError(w http.ResponseWriter, handle string) error {
	w.Header().Set(HeaderContentType, ContentTypeJSON)
	// Clear any previously set Electric headers
	w.Header().Del(HeaderElectricHandle)
	w.Header().Del(HeaderElectricOffset)
	w.Header().Del(HeaderElectricSchema)

	// Set no-cache headers for this error
	w.Header().Set(HeaderCacheControl, "no-cache, no-store, must-revalidate")

	w.WriteHeader(http.StatusConflict)

	return json.NewEncoder(w).Encode(APIError{
		Code:    ErrorCodeShapeGone,
		Message: fmt.Sprintf("Shape %s no longer exists. Client must refetch with a new handle.", handle),
	})
}

// setCORSHeaders sets CORS headers for cross-origin requests.
func (h *Handler) setCORSHeaders(w http.ResponseWriter) {
	w.Header().Set(HeaderAccessControlAllowOrigin, "*")
	w.Header().Set(HeaderAccessControlAllowMethods, "GET, DELETE, OPTIONS")
	w.Header().Set(HeaderAccessControlAllowHeaders, "Content-Type, Accept, If-None-Match")
	w.Header().Set(HeaderAccessControlExposeHeaders, strings.Join([]string{
		HeaderElectricHandle,
		HeaderElectricOffset,
		HeaderElectricSchema,
		HeaderElectricUpToDate,
		HeaderElectricCursor,
		HeaderETag,
		HeaderCacheControl,
	}, ", "))
	w.Header().Set(HeaderAccessControlMaxAge, "86400")
}

// setCacheHeaders sets appropriate cache control headers based on the request and response state.
func (h *Handler) setCacheHeaders(w http.ResponseWriter, params *ShapeParams, upToDate bool, hasItems bool) {
	if upToDate && !hasItems {
		// No new data in live mode - short cache or no-store
		w.Header().Set(HeaderCacheControl, "no-store")
		return
	}

	if params.Offset.IsBeforeAll() && hasItems {
		// Initial sync response - can be cached for a while
		maxAge := h.config.MaxAge
		if maxAge <= 0 {
			maxAge = 60 // Default 1 minute for initial sync
		}
		w.Header().Set(HeaderCacheControl, fmt.Sprintf("public, max-age=%d", maxAge))
		return
	}

	if hasItems {
		// Has items - cache based on config
		maxAge := h.config.MaxAge
		staleAge := h.config.StaleAge
		if maxAge > 0 {
			cacheControl := fmt.Sprintf("public, max-age=%d", maxAge)
			if staleAge > 0 {
				cacheControl += fmt.Sprintf(", stale-while-revalidate=%d", staleAge)
			}
			w.Header().Set(HeaderCacheControl, cacheControl)
		} else {
			w.Header().Set(HeaderCacheControl, "no-store")
		}
		return
	}

	// Default: short cache
	w.Header().Set(HeaderCacheControl, "public, max-age=5")
}

// Helper functions

// parseTableName parses a table name in the format "schema.table" or just "table".
// Returns (schema, table) where schema defaults to "public" if not specified.
func parseTableName(table string) (schemaName, tableName string) {
	// Handle quoted identifiers
	if strings.Contains(table, ".") {
		// Split by dot, handling quoted identifiers
		parts := splitTableName(table)
		if len(parts) == 2 {
			return parts[0], parts[1]
		}
	}
	return "public", table
}

// splitTableName splits a table name by dot, handling quoted identifiers.
func splitTableName(table string) []string {
	// Simple case: no quotes
	if !strings.Contains(table, `"`) {
		return strings.SplitN(table, ".", 2)
	}

	// Handle quoted identifiers
	var parts []string
	var current strings.Builder
	inQuote := false

	for i := 0; i < len(table); i++ {
		c := table[i]
		if c == '"' {
			if inQuote && i+1 < len(table) && table[i+1] == '"' {
				// Escaped quote
				current.WriteByte('"')
				i++
			} else {
				inQuote = !inQuote
			}
		} else if c == '.' && !inQuote {
			parts = append(parts, current.String())
			current.Reset()
		} else {
			current.WriteByte(c)
		}
	}
	parts = append(parts, current.String())

	return parts
}

// isShapeGoneError checks if an error indicates the shape is gone.
func isShapeGoneError(err error) bool {
	if err == nil {
		return false
	}
	errStr := err.Error()
	return strings.Contains(errStr, "shape gone") ||
		strings.Contains(errStr, "not found") ||
		strings.Contains(errStr, "shape not found")
}

// isUpToDate checks if the items represent being up-to-date.
func isUpToDate(items []storage.LogItem, latestOffset offset.LogOffset) bool {
	if len(items) == 0 {
		return true
	}
	// Check if the last item's offset matches the latest offset
	lastItem := items[len(items)-1]
	lastOffset, err := offset.Parse(lastItem.Offset)
	if err != nil {
		return false
	}
	return lastOffset.Equal(latestOffset)
}

// generateCursor generates a cursor string for live mode.
func generateCursor(handle string, off offset.LogOffset) string {
	data := fmt.Sprintf("%s:%s:%d", handle, off.String(), time.Now().UnixNano())
	hash := sha256.Sum256([]byte(data))
	return hex.EncodeToString(hash[:8])
}

// generateETag generates an ETag for caching.
func generateETag(handle string, off offset.LogOffset, itemCount int) string {
	data := fmt.Sprintf("%s:%s:%d", handle, off.String(), itemCount)
	hash := sha256.Sum256([]byte(data))
	return fmt.Sprintf(`"%s"`, hex.EncodeToString(hash[:8]))
}

// HTTPHandler wraps a function that returns an error into an http.HandlerFunc.
// If the handler returns an error, it's logged but not written (the handler should write the error).
type HTTPHandler func(w http.ResponseWriter, r *http.Request) error

// Wrap converts an HTTPHandler to http.HandlerFunc.
func (fn HTTPHandler) Wrap() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := fn(w, r); err != nil {
			// Error already written to response by the handler
			// Could add logging here if desired
		}
	}
}

// RegisterRoutes registers all API routes on the given ServeMux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	// Shape endpoints
	mux.HandleFunc("GET /v1/shape", HTTPHandler(h.ServeShape).Wrap())
	mux.HandleFunc("DELETE /v1/shape", HTTPHandler(h.DeleteShape).Wrap())
	mux.HandleFunc("DELETE /v1/shape/{handle}", HTTPHandler(h.DeleteShape).Wrap())
	mux.HandleFunc("OPTIONS /v1/shape", h.OptionsShape)

	// Health endpoints
	mux.HandleFunc("GET /health", h.Health)
	mux.HandleFunc("GET /v1/health", h.Health)
}
