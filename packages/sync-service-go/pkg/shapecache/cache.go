// Package shapecache provides components for managing shape cache data,
// including the ShapeCache which manages active shapes and their lifecycle.
//
// Ported from: lib/electric/shape_cache.ex
package shapecache

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/electric-sql/electric/packages/sync-service-go/pkg/offset"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/shape"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/storage"
)

// ShapeState represents the current state of a shape.
type ShapeState int

const (
	// StateCreating indicates the shape is being created (snapshot in progress).
	StateCreating ShapeState = iota
	// StateActive indicates the shape is active and receiving WAL updates.
	StateActive
	// StateDeleted indicates the shape has been marked for deletion.
	StateDeleted
)

// String returns a human-readable representation of the state.
func (s ShapeState) String() string {
	switch s {
	case StateCreating:
		return "creating"
	case StateActive:
		return "active"
	case StateDeleted:
		return "deleted"
	default:
		return "unknown"
	}
}

// ShapeInfo contains metadata about an active shape.
type ShapeInfo struct {
	// Handle is the unique identifier for this shape instance.
	Handle shape.Handle
	// Shape is the shape definition.
	Shape *shape.Shape
	// State is the current state of the shape.
	State ShapeState
	// LatestOffset is the latest offset in the shape's log.
	LatestOffset offset.LogOffset
	// Chunker manages chunk boundaries for this shape.
	Chunker *Chunker

	// snapshotDone is a channel that is closed when the snapshot is complete.
	snapshotDone chan struct{}
	// snapshotOnce ensures snapshotDone is closed only once.
	snapshotOnce sync.Once
}

// newShapeInfo creates a new ShapeInfo with the given parameters.
func newShapeInfo(handle shape.Handle, s *shape.Shape, chunkThreshold int64) *ShapeInfo {
	return &ShapeInfo{
		Handle:       handle,
		Shape:        s,
		State:        StateCreating,
		LatestOffset: offset.InitialOffset,
		Chunker:      NewChunker(chunkThreshold),
		snapshotDone: make(chan struct{}),
	}
}

// markSnapshotComplete marks the snapshot as complete and transitions to active state.
// Only transitions to Active if the current state is Creating (not if already Deleted).
func (si *ShapeInfo) markSnapshotComplete() {
	si.snapshotOnce.Do(func() {
		// Only transition to Active if currently Creating
		// Don't override if already Deleted
		if si.State == StateCreating {
			si.State = StateActive
		}
		close(si.snapshotDone)
	})
}

// Errors
var (
	// ErrShapeNotFound is returned when a shape is not found in the cache.
	ErrShapeNotFound = errors.New("shape not found")
	// ErrShapeDeleted is returned when trying to operate on a deleted shape.
	ErrShapeDeleted = errors.New("shape has been deleted")
	// ErrInvalidState is returned when a state transition is invalid.
	ErrInvalidState = errors.New("invalid state transition")
	// ErrSnapshotTimeout is returned when waiting for snapshot times out.
	ErrSnapshotTimeout = errors.New("timeout waiting for snapshot")
)

// CacheConfig holds configuration options for the Cache.
type CacheConfig struct {
	// ChunkThreshold is the byte threshold for chunk boundaries (default: 10MB).
	ChunkThreshold int64
}

// Cache manages active shapes and their lifecycle.
// It provides thread-safe access to shape metadata and deduplication
// based on shape definition hash.
type Cache struct {
	mu       sync.RWMutex
	shapes   map[string]*ShapeInfo // handle.String() -> ShapeInfo
	storage  storage.Storage
	byHash   map[string]string // shape.Hash() -> handle.String() for dedup
	config   CacheConfig
}

// NewCache creates a new shape cache.
func NewCache(s storage.Storage) *Cache {
	return NewCacheWithConfig(s, CacheConfig{
		ChunkThreshold: DefaultChunkThreshold,
	})
}

// NewCacheWithConfig creates a new shape cache with the given configuration.
func NewCacheWithConfig(s storage.Storage, config CacheConfig) *Cache {
	if config.ChunkThreshold <= 0 {
		config.ChunkThreshold = DefaultChunkThreshold
	}
	return &Cache{
		shapes:  make(map[string]*ShapeInfo),
		storage: s,
		byHash:  make(map[string]string),
		config:  config,
	}
}

// GetOrCreate returns an existing shape or creates a new one.
// Returns (handle, created, error) where created is true if a new shape was made.
//
// Deduplication: if a shape with the same Hash() already exists, the existing
// handle is returned. This allows clients to reconnect to the same shape.
func (c *Cache) GetOrCreate(ctx context.Context, s *shape.Shape) (shape.Handle, bool, error) {
	if s == nil {
		return shape.Handle{}, false, errors.New("shape cannot be nil")
	}

	shapeHash := s.Hash()

	// First, try to find existing shape by hash (read lock)
	c.mu.RLock()
	if handleStr, exists := c.byHash[shapeHash]; exists {
		if info, ok := c.shapes[handleStr]; ok {
			// Verify the shape isn't deleted
			if info.State != StateDeleted {
				c.mu.RUnlock()
				return info.Handle, false, nil
			}
		}
	}
	c.mu.RUnlock()

	// Need to create - acquire write lock
	c.mu.Lock()
	defer c.mu.Unlock()

	// Double-check after acquiring write lock (another goroutine may have created it)
	if handleStr, exists := c.byHash[shapeHash]; exists {
		if info, ok := c.shapes[handleStr]; ok {
			if info.State != StateDeleted {
				return info.Handle, false, nil
			}
			// If deleted, we need to clean up and create new
			delete(c.shapes, handleStr)
			delete(c.byHash, shapeHash)
		}
	}

	// Create new shape
	handle := shape.NewHandle(shapeHash)
	handleStr := handle.String()

	info := newShapeInfo(handle, s, c.config.ChunkThreshold)
	c.shapes[handleStr] = info
	c.byHash[shapeHash] = handleStr

	return handle, true, nil
}

// Get retrieves shape info by handle.
// Returns (info, found) where found is false if the shape doesn't exist.
func (c *Cache) Get(handle string) (*ShapeInfo, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	info, exists := c.shapes[handle]
	if !exists {
		return nil, false
	}

	// Return a shallow copy to prevent external mutation of state
	infoCopy := *info
	return &infoCopy, true
}

// GetByHash retrieves shape info by shape definition hash.
// Returns (info, found) where found is false if no shape with that hash exists.
func (c *Cache) GetByHash(hash string) (*ShapeInfo, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	handleStr, exists := c.byHash[hash]
	if !exists {
		return nil, false
	}

	info, exists := c.shapes[handleStr]
	if !exists {
		return nil, false
	}

	// Return a shallow copy to prevent external mutation of state
	infoCopy := *info
	return &infoCopy, true
}

// Delete marks a shape for deletion.
// This transitions the shape to StateDeleted and removes it from the hash index.
func (c *Cache) Delete(handle string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	info, exists := c.shapes[handle]
	if !exists {
		return ErrShapeNotFound
	}

	if info.State == StateDeleted {
		return nil // Already deleted
	}

	// Mark as deleted
	info.State = StateDeleted

	// Remove from hash index to allow recreation
	if info.Shape != nil {
		delete(c.byHash, info.Shape.Hash())
	}

	// Close snapshot channel if still open
	info.markSnapshotComplete()

	return nil
}

// Remove completely removes a shape from the cache.
// Unlike Delete, this removes all traces of the shape.
func (c *Cache) Remove(handle string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	info, exists := c.shapes[handle]
	if !exists {
		return ErrShapeNotFound
	}

	// Remove from hash index
	if info.Shape != nil {
		delete(c.byHash, info.Shape.Hash())
	}

	// Remove from shapes map
	delete(c.shapes, handle)

	// Close snapshot channel if still open
	info.markSnapshotComplete()

	return nil
}

// UpdateOffset updates the latest offset for a shape.
func (c *Cache) UpdateOffset(handle string, off offset.LogOffset) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	info, exists := c.shapes[handle]
	if !exists {
		return ErrShapeNotFound
	}

	if info.State == StateDeleted {
		return ErrShapeDeleted
	}

	// Only update if the new offset is greater than the current
	if off.After(info.LatestOffset) {
		info.LatestOffset = off
	}

	return nil
}

// List returns all active (non-deleted) shape handles.
func (c *Cache) List() []string {
	c.mu.RLock()
	defer c.mu.RUnlock()

	handles := make([]string, 0, len(c.shapes))
	for handle, info := range c.shapes {
		if info.State != StateDeleted {
			handles = append(handles, handle)
		}
	}
	return handles
}

// Count returns the number of active (non-deleted) shapes.
func (c *Cache) Count() int {
	c.mu.RLock()
	defer c.mu.RUnlock()

	count := 0
	for _, info := range c.shapes {
		if info.State != StateDeleted {
			count++
		}
	}
	return count
}

// AwaitSnapshot waits for a shape's snapshot to complete.
// Returns immediately if the snapshot is already complete.
// Returns error if the context is canceled or the shape is not found.
func (c *Cache) AwaitSnapshot(ctx context.Context, handle string) error {
	c.mu.RLock()
	info, exists := c.shapes[handle]
	if !exists {
		c.mu.RUnlock()
		return ErrShapeNotFound
	}

	// Check if already complete
	if info.State == StateActive || info.State == StateDeleted {
		c.mu.RUnlock()
		return nil
	}

	// Get the channel to wait on
	snapshotDone := info.snapshotDone
	c.mu.RUnlock()

	// Wait for snapshot completion or context cancellation
	select {
	case <-snapshotDone:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// SetState updates the state of a shape.
// Validates state transitions and returns error for invalid transitions.
func (c *Cache) SetState(handle string, state ShapeState) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	info, exists := c.shapes[handle]
	if !exists {
		return ErrShapeNotFound
	}

	// Validate state transition
	if !isValidStateTransition(info.State, state) {
		return fmt.Errorf("%w: cannot transition from %s to %s", ErrInvalidState, info.State, state)
	}

	oldState := info.State
	info.State = state

	// If transitioning to active, mark snapshot as complete
	if oldState == StateCreating && state == StateActive {
		info.markSnapshotComplete()
	}

	return nil
}

// isValidStateTransition checks if a state transition is valid.
func isValidStateTransition(from, to ShapeState) bool {
	switch from {
	case StateCreating:
		// Can transition to Active or Deleted
		return to == StateActive || to == StateDeleted
	case StateActive:
		// Can only transition to Deleted
		return to == StateDeleted
	case StateDeleted:
		// Cannot transition from Deleted
		return false
	default:
		return false
	}
}

// GetLog retrieves log items for a shape from the given offset.
// Returns items where item.Offset > since, up to the specified limit.
// If limit is 0 or negative, all matching items are returned.
func (c *Cache) GetLog(handle string, since offset.LogOffset, limit int) ([]shape.LogItem, error) {
	c.mu.RLock()
	info, exists := c.shapes[handle]
	if !exists {
		c.mu.RUnlock()
		return nil, ErrShapeNotFound
	}

	if info.State == StateDeleted {
		c.mu.RUnlock()
		return nil, ErrShapeDeleted
	}
	c.mu.RUnlock()

	// Use storage to get the log
	// Convert offset to string format for storage interface
	sinceStr := since.String()

	storageItems, err := c.storage.GetLogSince(handle, sinceStr, limit)
	if err != nil {
		// If shape not found in storage, return empty (may be newly created)
		if errors.Is(err, errors.New("shape not found")) {
			return []shape.LogItem{}, nil
		}
		return nil, fmt.Errorf("failed to get log from storage: %w", err)
	}

	// Convert storage.LogItem to shape.LogItem
	items := make([]shape.LogItem, 0, len(storageItems))
	for _, si := range storageItems {
		off, err := offset.Parse(si.Offset)
		if err != nil {
			continue // Skip invalid offsets
		}
		items = append(items, shape.LogItem{
			Offset: off,
			// Note: The JSON is already pre-serialized in storage
		})
	}

	return items, nil
}

// GetChunkEnd returns the end offset for a chunk.
// Returns (endOffset, found) where found is true if the chunk boundary exists.
func (c *Cache) GetChunkEnd(handle string, start offset.LogOffset) (offset.LogOffset, bool) {
	c.mu.RLock()
	info, exists := c.shapes[handle]
	if !exists {
		c.mu.RUnlock()
		return offset.LogOffset{}, false
	}

	// First check the in-memory chunker
	if info.Chunker != nil {
		endOffset, found := info.Chunker.GetChunkEnd(start)
		if found {
			c.mu.RUnlock()
			return endOffset, true
		}
	}
	c.mu.RUnlock()

	// Fall back to storage
	endStr, found := c.storage.GetChunkEnd(handle, start.String())
	if !found {
		return offset.LogOffset{}, false
	}

	endOffset, err := offset.Parse(endStr)
	if err != nil {
		return offset.LogOffset{}, false
	}

	return endOffset, true
}

// AddToChunker adds an item to the shape's chunker.
// Returns true if the item completed a chunk.
func (c *Cache) AddToChunker(handle string, off offset.LogOffset, sizeBytes int64) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	info, exists := c.shapes[handle]
	if !exists {
		return false, ErrShapeNotFound
	}

	if info.State == StateDeleted {
		return false, ErrShapeDeleted
	}

	if info.Chunker == nil {
		info.Chunker = NewChunker(c.config.ChunkThreshold)
	}

	completed := info.Chunker.Add(off, sizeBytes)
	return completed, nil
}

// GetLatestOffset returns the latest offset for a shape.
func (c *Cache) GetLatestOffset(handle string) (offset.LogOffset, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	info, exists := c.shapes[handle]
	if !exists {
		return offset.LogOffset{}, ErrShapeNotFound
	}

	return info.LatestOffset, nil
}

// GetState returns the current state of a shape.
func (c *Cache) GetState(handle string) (ShapeState, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	info, exists := c.shapes[handle]
	if !exists {
		return 0, ErrShapeNotFound
	}

	return info.State, nil
}

// MarkSnapshotComplete marks a shape's snapshot as complete and transitions to active state.
func (c *Cache) MarkSnapshotComplete(handle string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	info, exists := c.shapes[handle]
	if !exists {
		return ErrShapeNotFound
	}

	if info.State != StateCreating {
		return nil // Already active or deleted
	}

	info.markSnapshotComplete()
	return nil
}

// HasShape checks if a shape with the given handle exists and is not deleted.
func (c *Cache) HasShape(handle string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()

	info, exists := c.shapes[handle]
	if !exists {
		return false
	}

	return info.State != StateDeleted
}

// GetShape returns the shape definition for a given handle.
func (c *Cache) GetShape(handle string) (*shape.Shape, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	info, exists := c.shapes[handle]
	if !exists {
		return nil, ErrShapeNotFound
	}

	return info.Shape, nil
}

// ValidateHandle checks if the given handle matches the expected shape.
// Returns nil if valid, or an error describing the mismatch.
func (c *Cache) ValidateHandle(handle string, s *shape.Shape) error {
	c.mu.RLock()
	defer c.mu.RUnlock()

	info, exists := c.shapes[handle]
	if !exists {
		return ErrShapeNotFound
	}

	if info.State == StateDeleted {
		return ErrShapeDeleted
	}

	// Check if the shape hash matches
	if info.Shape != nil && s != nil {
		if info.Shape.Hash() != s.Hash() {
			return errors.New("shape definition does not match handle")
		}
	}

	return nil
}

// Cleanup removes all shapes from the cache.
func (c *Cache) Cleanup() {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Close all snapshot channels
	for _, info := range c.shapes {
		info.markSnapshotComplete()
	}

	c.shapes = make(map[string]*ShapeInfo)
	c.byHash = make(map[string]string)
}
