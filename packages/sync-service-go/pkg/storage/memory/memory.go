// Package memory provides an in-memory implementation of the Storage interface.
// This is a first-class component used for both testing and production scenarios
// where persistence is not required.
//
// Ported from: lib/electric/shape_cache/storage.ex (memory-related patterns)
package memory

import (
	"errors"
	"sync"

	"github.com/electric-sql/electric/packages/sync-service-go/pkg/storage"
)

// Default chunk size threshold in bytes (10MB)
const DefaultChunkThreshold = 10 * 1024 * 1024

var (
	// ErrShapeNotFound is returned when a shape is not found.
	ErrShapeNotFound = errors.New("shape not found")
	// ErrSnapshotNotFound is returned when a snapshot is not found for a shape.
	ErrSnapshotNotFound = errors.New("snapshot not found")
)

// shapeData holds all data for a single shape.
type shapeData struct {
	schema       storage.SchemaInfo
	snapshotXmin int64
	snapshotDone bool
	snapshot     []storage.LogItem   // Snapshot items
	log          []storage.LogItem   // Append-only log entries
	chunkBounds  map[string]string   // startOffset -> endOffset
	pgSnapshot   *storage.PgSnapshot // PostgreSQL snapshot for transaction filtering
}

// Config holds configuration options for MemoryStorage.
type Config struct {
	ChunkThreshold int // Byte threshold for chunk boundaries, 0 means default (10MB)
}

// MemoryStorage implements storage.Storage using in-memory data structures.
// It is thread-safe for concurrent access.
type MemoryStorage struct {
	mu             sync.RWMutex
	shapes         map[string]*shapeData
	chunkThreshold int
}

// New creates a new MemoryStorage instance with the given configuration.
func New(cfg Config) *MemoryStorage {
	threshold := cfg.ChunkThreshold
	if threshold <= 0 {
		threshold = DefaultChunkThreshold
	}

	return &MemoryStorage{
		shapes:         make(map[string]*shapeData),
		chunkThreshold: threshold,
	}
}

// NewDefault creates a new MemoryStorage with default configuration.
func NewDefault() *MemoryStorage {
	return New(Config{})
}

// MakeNewShapeID generates a new unique shape ID.
// Format: {8-char-hex}-{microsecond-timestamp}
func (m *MemoryStorage) MakeNewShapeID() string {
	return storage.GenerateShapeID()
}

// ShapeExists checks if a shape with the given ID exists.
func (m *MemoryStorage) ShapeExists(shapeID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	_, exists := m.shapes[shapeID]
	return exists
}

// ListShapes returns a list of all shape IDs.
func (m *MemoryStorage) ListShapes() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	ids := make([]string, 0, len(m.shapes))
	for id := range m.shapes {
		ids = append(ids, id)
	}
	return ids
}

// DeleteShape removes a shape and all its data.
func (m *MemoryStorage) DeleteShape(shapeID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.shapes[shapeID]; !exists {
		return ErrShapeNotFound
	}

	delete(m.shapes, shapeID)
	return nil
}

// SetSnapshot stores snapshot data for a shape.
// This creates the shape if it doesn't exist.
func (m *MemoryStorage) SetSnapshot(shapeID string, schema storage.SchemaInfo, items []storage.LogItem, snapshotXmin int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Make a copy of items to avoid external mutations
	snapshotCopy := make([]storage.LogItem, len(items))
	copy(snapshotCopy, items)

	m.shapes[shapeID] = &shapeData{
		schema:       schema,
		snapshotXmin: snapshotXmin,
		snapshotDone: true,
		snapshot:     snapshotCopy,
		log:          make([]storage.LogItem, 0),
		chunkBounds:  make(map[string]string),
	}

	return nil
}

// GetSnapshot retrieves snapshot data for a shape.
// Returns the snapshot items and the snapshot xmin value.
func (m *MemoryStorage) GetSnapshot(shapeID string) ([]storage.LogItem, int64, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	shape, exists := m.shapes[shapeID]
	if !exists {
		return nil, 0, ErrShapeNotFound
	}

	if !shape.snapshotDone {
		return nil, 0, ErrSnapshotNotFound
	}

	// Return a copy to prevent external mutations
	result := make([]storage.LogItem, len(shape.snapshot))
	copy(result, shape.snapshot)

	return result, shape.snapshotXmin, nil
}

// SnapshotExists checks if a snapshot exists for the given shape.
func (m *MemoryStorage) SnapshotExists(shapeID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	shape, exists := m.shapes[shapeID]
	if !exists {
		return false
	}

	return shape.snapshotDone
}

// AppendToLog appends items to the log for a shape.
// The shape must exist (via SetSnapshot) before appending to log.
func (m *MemoryStorage) AppendToLog(shapeID string, items []storage.LogItem) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	shape, exists := m.shapes[shapeID]
	if !exists {
		return ErrShapeNotFound
	}

	// Append items to log
	shape.log = append(shape.log, items...)

	return nil
}

// GetLogSince returns all log items with offset greater than the given offset.
// This implements exclusive start (items where item.Offset > offset).
func (m *MemoryStorage) GetLogSince(shapeID string, offset string) ([]storage.LogItem, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	shape, exists := m.shapes[shapeID]
	if !exists {
		return nil, ErrShapeNotFound
	}

	result := make([]storage.LogItem, 0)

	// If offset is "-1" (BeforeAll), include snapshot items first
	if storage.IsBeforeAll(offset) {
		result = append(result, shape.snapshot...)
		// Then include all log items
		result = append(result, shape.log...)
		return result, nil
	}

	// Find items where offset > given offset
	for _, item := range shape.log {
		if storage.CompareOffsets(item.Offset, offset) > 0 {
			result = append(result, item)
		}
	}

	return result, nil
}

// GetLogChunk returns log items for a specific chunk starting at chunkOffset.
// Returns the items, the next chunk offset (or "" if no more chunks), and any error.
func (m *MemoryStorage) GetLogChunk(shapeID string, chunkOffset string) ([]storage.LogItem, string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	shape, exists := m.shapes[shapeID]
	if !exists {
		return nil, "", ErrShapeNotFound
	}

	// Get chunk end if it exists
	chunkEnd, hasChunkEnd := shape.chunkBounds[chunkOffset]

	// If this is the BeforeAll offset, return snapshot
	if storage.IsBeforeAll(chunkOffset) {
		items := make([]storage.LogItem, len(shape.snapshot))
		copy(items, shape.snapshot)

		// Determine next chunk offset
		var nextOffset string
		if len(shape.log) > 0 {
			// Next chunk starts after snapshot, at offset "0_0" or first log item
			nextOffset = "0_0"
		}
		return items, nextOffset, nil
	}

	// Collect items from chunkOffset (exclusive) to chunkEnd (inclusive) or to the end
	result := make([]storage.LogItem, 0)
	for _, item := range shape.log {
		// Items where offset > chunkOffset
		if storage.CompareOffsets(item.Offset, chunkOffset) > 0 {
			result = append(result, item)
			// Stop if we've reached the chunk end
			if hasChunkEnd && storage.CompareOffsets(item.Offset, chunkEnd) >= 0 {
				break
			}
		}
	}

	// Determine next chunk offset
	var nextOffset string
	if hasChunkEnd && len(result) > 0 {
		nextOffset = chunkEnd
	}

	return result, nextOffset, nil
}

// GetChunkEnd returns the end offset for a chunk starting at the given offset.
// Returns the end offset and true if a chunk boundary exists, or "" and false otherwise.
func (m *MemoryStorage) GetChunkEnd(shapeID string, offset string) (string, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	shape, exists := m.shapes[shapeID]
	if !exists {
		return "", false
	}

	endOffset, found := shape.chunkBounds[offset]
	return endOffset, found
}

// SetChunkEnd sets the end offset for a chunk starting at startOffset.
func (m *MemoryStorage) SetChunkEnd(shapeID string, startOffset string, endOffset string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	shape, exists := m.shapes[shapeID]
	if !exists {
		return ErrShapeNotFound
	}

	shape.chunkBounds[startOffset] = endOffset
	return nil
}

// GetLatestOffset returns the latest offset in the log for a shape.
// If the shape has no log entries, returns "0_0" (First).
// If the shape doesn't exist, returns an error.
func (m *MemoryStorage) GetLatestOffset(shapeID string) (string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	shape, exists := m.shapes[shapeID]
	if !exists {
		return "", ErrShapeNotFound
	}

	// If no log entries, return "0_0" (the First/initial offset)
	if len(shape.log) == 0 {
		return "0_0", nil
	}

	// Return the offset of the last log item
	return shape.log[len(shape.log)-1].Offset, nil
}

// GetSchema returns the schema info for a shape.
func (m *MemoryStorage) GetSchema(shapeID string) (storage.SchemaInfo, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	shape, exists := m.shapes[shapeID]
	if !exists {
		return storage.SchemaInfo{}, ErrShapeNotFound
	}

	return shape.schema, nil
}

// SetPgSnapshot stores the PostgreSQL snapshot for transaction filtering.
func (m *MemoryStorage) SetPgSnapshot(shapeID string, snapshot *storage.PgSnapshot) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	shape, exists := m.shapes[shapeID]
	if !exists {
		return ErrShapeNotFound
	}

	shape.pgSnapshot = snapshot
	return nil
}

// GetPgSnapshot retrieves the PostgreSQL snapshot for a shape.
func (m *MemoryStorage) GetPgSnapshot(shapeID string) (*storage.PgSnapshot, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	shape, exists := m.shapes[shapeID]
	if !exists {
		return nil, ErrShapeNotFound
	}

	return shape.pgSnapshot, nil
}

// Cleanup removes all data from the storage.
func (m *MemoryStorage) Cleanup() {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.shapes = make(map[string]*shapeData)
}

// GetLogLength returns the number of log entries for a shape.
func (m *MemoryStorage) GetLogLength(shapeID string) (int, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	shape, exists := m.shapes[shapeID]
	if !exists {
		return 0, ErrShapeNotFound
	}

	return len(shape.log), nil
}

// GetSnapshotLength returns the number of snapshot items for a shape.
func (m *MemoryStorage) GetSnapshotLength(shapeID string) (int, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	shape, exists := m.shapes[shapeID]
	if !exists {
		return 0, ErrShapeNotFound
	}

	return len(shape.snapshot), nil
}

// Ensure MemoryStorage implements storage.Storage
var _ storage.Storage = (*MemoryStorage)(nil)
