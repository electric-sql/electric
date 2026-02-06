// Package shapecache provides components for managing shape cache data,
// including chunking shape logs for HTTP responses and CDN caching.
//
// Ported from: lib/electric/shape_cache/log_chunker.ex
package shapecache

import (
	"sync"

	"github.com/electric-sql/electric/packages/sync-service-go/pkg/offset"
)

// DefaultChunkThreshold is the default size threshold in bytes (10MB).
// This ensures chunks are accepted by CDN caches.
// See: https://github.com/electric-sql/electric/issues/1581
const DefaultChunkThreshold = 10 * 1024 * 1024

// ChunkBoundary represents a completed chunk with start and end offsets.
type ChunkBoundary struct {
	Start offset.LogOffset
	End   offset.LogOffset
}

// Chunker tracks chunk boundaries in a shape log.
// It divides the log into bounded chunks for HTTP responses and CDN caching.
//
// Chunking rules:
// 1. A chunk is complete when cumulative size exceeds threshold
// 2. Chunk boundary is at the last item BEFORE exceeding threshold
// 3. New chunk starts at the next item after the boundary
// 4. Empty chunks are not allowed
// 5. First item always starts a new chunk
//
// Thread-safety: Chunker is safe for concurrent use.
type Chunker struct {
	mu sync.RWMutex

	threshold       int64            // bytes threshold for chunk completion
	currentSize     int64            // current chunk size in bytes
	chunkStart      offset.LogOffset // start of current chunk
	lastOffset      offset.LogOffset // offset of the last added item
	chunkBoundaries []ChunkBoundary  // completed chunk boundaries
	hasItems        bool             // whether any items have been added
}

// NewChunker creates a new chunker with the given threshold.
// If threshold is <= 0, DefaultChunkThreshold is used.
func NewChunker(threshold int64) *Chunker {
	if threshold <= 0 {
		threshold = DefaultChunkThreshold
	}
	return &Chunker{
		threshold:       threshold,
		chunkBoundaries: make([]ChunkBoundary, 0),
	}
}

// Add adds an item to the current chunk.
// Returns true if adding this item completed a chunk.
//
// When adding an item would cause the cumulative size to reach or exceed
// the threshold, the current chunk is completed (boundary at the previous item)
// and a new chunk starts with the current item.
func (c *Chunker) Add(off offset.LogOffset, sizeBytes int64) bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	// First item always starts a new chunk
	if !c.hasItems {
		c.chunkStart = off
		c.currentSize = sizeBytes
		c.lastOffset = off
		c.hasItems = true
		return false
	}

	// Check if adding this item would exceed threshold
	if c.currentSize+sizeBytes >= c.threshold {
		// Complete current chunk - ends at the last added item
		c.chunkBoundaries = append(c.chunkBoundaries, ChunkBoundary{
			Start: c.chunkStart,
			End:   c.lastOffset,
		})

		// Start new chunk with this item
		c.chunkStart = off
		c.currentSize = sizeBytes
		c.lastOffset = off
		return true
	}

	// Add to current chunk
	c.currentSize += sizeBytes
	c.lastOffset = off
	return false
}

// CurrentChunkStart returns the start offset of the current (incomplete) chunk.
// Returns a zero LogOffset if no items have been added.
func (c *Chunker) CurrentChunkStart() offset.LogOffset {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.chunkStart
}

// GetChunkEnd returns the end offset for a chunk starting at the given offset.
// Returns (endOffset, true) if the chunk is complete.
// Returns (zero, false) if the chunk is incomplete or not found.
func (c *Chunker) GetChunkEnd(start offset.LogOffset) (offset.LogOffset, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	for _, boundary := range c.chunkBoundaries {
		if boundary.Start.Equal(start) {
			return boundary.End, true
		}
	}
	return offset.LogOffset{}, false
}

// IsChunkComplete checks if the chunk starting at the given offset is complete.
func (c *Chunker) IsChunkComplete(start offset.LogOffset) bool {
	_, complete := c.GetChunkEnd(start)
	return complete
}

// Reset resets the chunker state, clearing all boundaries and current chunk data.
func (c *Chunker) Reset() {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.currentSize = 0
	c.chunkStart = offset.LogOffset{}
	c.lastOffset = offset.LogOffset{}
	c.chunkBoundaries = make([]ChunkBoundary, 0)
	c.hasItems = false
}

// CurrentChunkSize returns the current size in bytes of the incomplete chunk.
func (c *Chunker) CurrentChunkSize() int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.currentSize
}

// Threshold returns the configured chunk threshold in bytes.
func (c *Chunker) Threshold() int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.threshold
}

// CompletedChunks returns a copy of all completed chunk boundaries.
func (c *Chunker) CompletedChunks() []ChunkBoundary {
	c.mu.RLock()
	defer c.mu.RUnlock()

	result := make([]ChunkBoundary, len(c.chunkBoundaries))
	copy(result, c.chunkBoundaries)
	return result
}

// LastOffset returns the offset of the last item added to the chunker.
// Returns a zero LogOffset if no items have been added.
func (c *Chunker) LastOffset() offset.LogOffset {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.lastOffset
}

// HasItems returns true if any items have been added to the chunker.
func (c *Chunker) HasItems() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.hasItems
}
