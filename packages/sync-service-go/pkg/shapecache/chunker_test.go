package shapecache

import (
	"sync"
	"testing"

	"github.com/electric-sql/electric/packages/sync-service-go/pkg/offset"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Ported from: lib/electric/shape_cache/log_chunker.ex tests

func TestNewChunker(t *testing.T) {
	t.Run("creates chunker with specified threshold", func(t *testing.T) {
		c := NewChunker(1000)
		assert.Equal(t, int64(1000), c.Threshold())
	})

	t.Run("uses default threshold when zero", func(t *testing.T) {
		c := NewChunker(0)
		assert.Equal(t, int64(DefaultChunkThreshold), c.Threshold())
	})

	t.Run("uses default threshold when negative", func(t *testing.T) {
		c := NewChunker(-100)
		assert.Equal(t, int64(DefaultChunkThreshold), c.Threshold())
	})

	t.Run("starts with empty state", func(t *testing.T) {
		c := NewChunker(100)
		assert.False(t, c.HasItems())
		assert.Equal(t, int64(0), c.CurrentChunkSize())
		assert.Equal(t, 0, len(c.CompletedChunks()))
	})
}

func TestDefaultChunkThreshold(t *testing.T) {
	t.Run("default threshold is 10MB", func(t *testing.T) {
		assert.Equal(t, int64(10*1024*1024), int64(DefaultChunkThreshold))
	})
}

func TestChunkerAdd(t *testing.T) {
	t.Run("first item starts a new chunk", func(t *testing.T) {
		c := NewChunker(100)
		off := offset.MustNew(1, 0)

		completed := c.Add(off, 50)

		assert.False(t, completed)
		assert.True(t, c.HasItems())
		assert.Equal(t, off, c.CurrentChunkStart())
		assert.Equal(t, int64(50), c.CurrentChunkSize())
	})

	t.Run("adding item below threshold does not complete chunk", func(t *testing.T) {
		c := NewChunker(100)
		off1 := offset.MustNew(1, 0)
		off2 := offset.MustNew(2, 0)

		c.Add(off1, 30)
		completed := c.Add(off2, 30)

		assert.False(t, completed)
		assert.Equal(t, int64(60), c.CurrentChunkSize())
		assert.Equal(t, 0, len(c.CompletedChunks()))
	})

	t.Run("adding item that reaches threshold completes chunk", func(t *testing.T) {
		c := NewChunker(100)
		off1 := offset.MustNew(1, 0)
		off2 := offset.MustNew(2, 0)

		c.Add(off1, 50)
		completed := c.Add(off2, 50) // 50 + 50 = 100 >= threshold

		assert.True(t, completed)
		assert.Equal(t, 1, len(c.CompletedChunks()))

		chunks := c.CompletedChunks()
		assert.Equal(t, off1, chunks[0].Start)
		assert.Equal(t, off1, chunks[0].End)
	})

	t.Run("adding item that exceeds threshold completes chunk", func(t *testing.T) {
		c := NewChunker(100)
		off1 := offset.MustNew(1, 0)
		off2 := offset.MustNew(2, 0)

		c.Add(off1, 50)
		completed := c.Add(off2, 60) // 50 + 60 = 110 >= threshold

		assert.True(t, completed)
		chunks := c.CompletedChunks()
		require.Equal(t, 1, len(chunks))
		assert.Equal(t, off1, chunks[0].Start)
		assert.Equal(t, off1, chunks[0].End)
	})

	t.Run("new chunk starts at item that caused completion", func(t *testing.T) {
		c := NewChunker(100)
		off1 := offset.MustNew(1, 0)
		off2 := offset.MustNew(2, 0)

		c.Add(off1, 50)
		c.Add(off2, 60)

		assert.Equal(t, off2, c.CurrentChunkStart())
		assert.Equal(t, int64(60), c.CurrentChunkSize())
	})

	t.Run("multiple chunks can be created", func(t *testing.T) {
		c := NewChunker(100)
		off1 := offset.MustNew(1, 0)
		off2 := offset.MustNew(2, 0)
		off3 := offset.MustNew(3, 0)
		off4 := offset.MustNew(4, 0)

		c.Add(off1, 50)
		c.Add(off2, 60) // completes chunk 1: [off1]
		c.Add(off3, 50) // completes chunk 2: [off2]
		c.Add(off4, 30) // in progress

		chunks := c.CompletedChunks()
		require.Equal(t, 2, len(chunks))

		assert.Equal(t, off1, chunks[0].Start)
		assert.Equal(t, off1, chunks[0].End)

		assert.Equal(t, off2, chunks[1].Start)
		assert.Equal(t, off2, chunks[1].End)

		assert.Equal(t, off3, c.CurrentChunkStart())
		assert.Equal(t, int64(80), c.CurrentChunkSize()) // 50 + 30
	})

	t.Run("chunk with multiple items before completion", func(t *testing.T) {
		c := NewChunker(100)
		off1 := offset.MustNew(1, 0)
		off2 := offset.MustNew(2, 0)
		off3 := offset.MustNew(3, 0)
		off4 := offset.MustNew(4, 0)

		c.Add(off1, 20)
		c.Add(off2, 30)
		c.Add(off3, 40)
		completed := c.Add(off4, 50) // 20+30+40+50 = 140 >= 100

		assert.True(t, completed)
		chunks := c.CompletedChunks()
		require.Equal(t, 1, len(chunks))
		assert.Equal(t, off1, chunks[0].Start)
		assert.Equal(t, off3, chunks[0].End) // Last item before exceeding
	})

	t.Run("single large item creates its own chunk on next add", func(t *testing.T) {
		c := NewChunker(100)
		off1 := offset.MustNew(1, 0)
		off2 := offset.MustNew(2, 0)

		c.Add(off1, 200) // Larger than threshold but first item
		assert.False(t, c.HasItems() == false)
		assert.Equal(t, int64(200), c.CurrentChunkSize())
		assert.Equal(t, 0, len(c.CompletedChunks()))

		// Next item completes the chunk containing the large item
		completed := c.Add(off2, 10)
		assert.True(t, completed)

		chunks := c.CompletedChunks()
		require.Equal(t, 1, len(chunks))
		assert.Equal(t, off1, chunks[0].Start)
		assert.Equal(t, off1, chunks[0].End)
	})

	t.Run("zero-size items do not affect chunk size", func(t *testing.T) {
		c := NewChunker(100)
		off1 := offset.MustNew(1, 0)
		off2 := offset.MustNew(2, 0)

		c.Add(off1, 50)
		completed := c.Add(off2, 0)

		assert.False(t, completed)
		assert.Equal(t, int64(50), c.CurrentChunkSize())
	})
}

func TestChunkerCurrentChunkStart(t *testing.T) {
	t.Run("returns zero offset when no items added", func(t *testing.T) {
		c := NewChunker(100)
		assert.Equal(t, offset.LogOffset{}, c.CurrentChunkStart())
	})

	t.Run("returns start of current chunk", func(t *testing.T) {
		c := NewChunker(100)
		off1 := offset.MustNew(1, 0)
		off2 := offset.MustNew(2, 0)

		c.Add(off1, 50)
		c.Add(off2, 60) // Completes chunk, starts new at off2

		assert.Equal(t, off2, c.CurrentChunkStart())
	})
}

func TestChunkerGetChunkEnd(t *testing.T) {
	t.Run("returns false for incomplete chunk", func(t *testing.T) {
		c := NewChunker(100)
		off1 := offset.MustNew(1, 0)

		c.Add(off1, 50)

		_, found := c.GetChunkEnd(off1)
		assert.False(t, found)
	})

	t.Run("returns end offset for complete chunk", func(t *testing.T) {
		c := NewChunker(100)
		off1 := offset.MustNew(1, 0)
		off2 := offset.MustNew(2, 0)
		off3 := offset.MustNew(3, 0)

		c.Add(off1, 20)
		c.Add(off2, 30)
		c.Add(off3, 60) // Completes chunk at off2

		endOffset, found := c.GetChunkEnd(off1)
		assert.True(t, found)
		assert.Equal(t, off2, endOffset)
	})

	t.Run("returns false for unknown start offset", func(t *testing.T) {
		c := NewChunker(100)
		off1 := offset.MustNew(1, 0)
		off2 := offset.MustNew(2, 0)
		unknownOff := offset.MustNew(99, 0)

		c.Add(off1, 50)
		c.Add(off2, 60)

		_, found := c.GetChunkEnd(unknownOff)
		assert.False(t, found)
	})

	t.Run("finds correct chunk among multiple", func(t *testing.T) {
		c := NewChunker(100)
		off1 := offset.MustNew(1, 0)
		off2 := offset.MustNew(2, 0)
		off3 := offset.MustNew(3, 0)
		off4 := offset.MustNew(4, 0)

		c.Add(off1, 50)
		c.Add(off2, 60) // Completes chunk 1
		c.Add(off3, 50)
		c.Add(off4, 60) // Completes chunk 2

		// Check chunk 1
		end1, found1 := c.GetChunkEnd(off1)
		assert.True(t, found1)
		assert.Equal(t, off1, end1)

		// Check chunk 2
		end2, found2 := c.GetChunkEnd(off2)
		assert.True(t, found2)
		assert.Equal(t, off2, end2)
	})
}

func TestChunkerIsChunkComplete(t *testing.T) {
	t.Run("returns false for incomplete chunk", func(t *testing.T) {
		c := NewChunker(100)
		off1 := offset.MustNew(1, 0)

		c.Add(off1, 50)

		assert.False(t, c.IsChunkComplete(off1))
	})

	t.Run("returns true for complete chunk", func(t *testing.T) {
		c := NewChunker(100)
		off1 := offset.MustNew(1, 0)
		off2 := offset.MustNew(2, 0)

		c.Add(off1, 50)
		c.Add(off2, 60)

		assert.True(t, c.IsChunkComplete(off1))
	})
}

func TestChunkerReset(t *testing.T) {
	t.Run("clears all state", func(t *testing.T) {
		c := NewChunker(100)
		off1 := offset.MustNew(1, 0)
		off2 := offset.MustNew(2, 0)

		c.Add(off1, 50)
		c.Add(off2, 60)

		c.Reset()

		assert.False(t, c.HasItems())
		assert.Equal(t, int64(0), c.CurrentChunkSize())
		assert.Equal(t, offset.LogOffset{}, c.CurrentChunkStart())
		assert.Equal(t, 0, len(c.CompletedChunks()))
	})

	t.Run("allows adding items after reset", func(t *testing.T) {
		c := NewChunker(100)
		off1 := offset.MustNew(1, 0)
		off2 := offset.MustNew(2, 0)
		off3 := offset.MustNew(3, 0)

		c.Add(off1, 50)
		c.Add(off2, 60)
		c.Reset()

		completed := c.Add(off3, 30)

		assert.False(t, completed)
		assert.True(t, c.HasItems())
		assert.Equal(t, off3, c.CurrentChunkStart())
		assert.Equal(t, int64(30), c.CurrentChunkSize())
	})
}

func TestChunkerLastOffset(t *testing.T) {
	t.Run("returns zero offset when no items", func(t *testing.T) {
		c := NewChunker(100)
		assert.Equal(t, offset.LogOffset{}, c.LastOffset())
	})

	t.Run("returns last added offset", func(t *testing.T) {
		c := NewChunker(100)
		off1 := offset.MustNew(1, 0)
		off2 := offset.MustNew(2, 0)
		off3 := offset.MustNew(3, 0)

		c.Add(off1, 20)
		c.Add(off2, 30)
		c.Add(off3, 40)

		assert.Equal(t, off3, c.LastOffset())
	})

	t.Run("returns last offset even after chunk completion", func(t *testing.T) {
		c := NewChunker(100)
		off1 := offset.MustNew(1, 0)
		off2 := offset.MustNew(2, 0)

		c.Add(off1, 50)
		c.Add(off2, 60)

		assert.Equal(t, off2, c.LastOffset())
	})
}

func TestChunkerCompletedChunks(t *testing.T) {
	t.Run("returns copy of chunks", func(t *testing.T) {
		c := NewChunker(100)
		off1 := offset.MustNew(1, 0)
		off2 := offset.MustNew(2, 0)

		c.Add(off1, 50)
		c.Add(off2, 60)

		chunks1 := c.CompletedChunks()
		chunks2 := c.CompletedChunks()

		// Modifying one should not affect the other
		chunks1[0].Start = offset.MustNew(999, 0)
		assert.NotEqual(t, chunks1[0].Start, chunks2[0].Start)
	})
}

func TestChunkerThreadSafety(t *testing.T) {
	t.Run("concurrent adds are safe", func(t *testing.T) {
		c := NewChunker(1000)
		var wg sync.WaitGroup
		numGoroutines := 100
		itemsPerGoroutine := 100

		wg.Add(numGoroutines)
		for g := 0; g < numGoroutines; g++ {
			go func(goroutineID int) {
				defer wg.Done()
				for i := 0; i < itemsPerGoroutine; i++ {
					off := offset.MustNew(int64(goroutineID*1000+i), 0)
					c.Add(off, 10)
				}
			}(g)
		}

		wg.Wait()

		// Verify total items were processed (by checking we have items)
		assert.True(t, c.HasItems())
	})

	t.Run("concurrent reads during writes are safe", func(t *testing.T) {
		c := NewChunker(100)
		var wg sync.WaitGroup

		// Start readers
		wg.Add(10)
		for i := 0; i < 10; i++ {
			go func() {
				defer wg.Done()
				for j := 0; j < 100; j++ {
					_ = c.CurrentChunkStart()
					_ = c.CurrentChunkSize()
					_ = c.CompletedChunks()
					_ = c.HasItems()
					_ = c.LastOffset()
				}
			}()
		}

		// Start writers
		wg.Add(10)
		for i := 0; i < 10; i++ {
			go func(id int) {
				defer wg.Done()
				for j := 0; j < 100; j++ {
					off := offset.MustNew(int64(id*100+j), 0)
					c.Add(off, 10)
				}
			}(i)
		}

		wg.Wait()
	})
}

func TestChunkerEdgeCases(t *testing.T) {
	t.Run("exact threshold completion", func(t *testing.T) {
		c := NewChunker(100)
		off1 := offset.MustNew(1, 0)
		off2 := offset.MustNew(2, 0)

		c.Add(off1, 50)
		completed := c.Add(off2, 50) // Exactly 100

		assert.True(t, completed)
	})

	t.Run("handles BeforeAll offset", func(t *testing.T) {
		c := NewChunker(100)

		completed := c.Add(offset.BeforeAll, 50)

		assert.False(t, completed)
		assert.Equal(t, offset.BeforeAll, c.CurrentChunkStart())
	})

	t.Run("handles InitialOffset", func(t *testing.T) {
		c := NewChunker(100)

		completed := c.Add(offset.InitialOffset, 50)

		assert.False(t, completed)
		assert.Equal(t, offset.InitialOffset, c.CurrentChunkStart())
	})

	t.Run("very large threshold", func(t *testing.T) {
		c := NewChunker(1 << 40) // 1TB
		off1 := offset.MustNew(1, 0)
		off2 := offset.MustNew(2, 0)

		c.Add(off1, 1<<30) // 1GB
		completed := c.Add(off2, 1<<30)

		assert.False(t, completed) // Still below threshold
		assert.Equal(t, int64(1<<31), c.CurrentChunkSize())
	})

	t.Run("many small items", func(t *testing.T) {
		c := NewChunker(100)
		numCompleted := 0

		for i := 0; i < 1000; i++ {
			off := offset.MustNew(int64(i), 0)
			if c.Add(off, 1) {
				numCompleted++
			}
		}

		// With threshold 100 and size 1 each, we should complete roughly 10 chunks
		// (1000 items / 100 threshold = ~10 chunks)
		assert.True(t, numCompleted >= 9 && numCompleted <= 11)
	})

	t.Run("alternating large and small items", func(t *testing.T) {
		c := NewChunker(100)
		off1 := offset.MustNew(1, 0)
		off2 := offset.MustNew(2, 0)
		off3 := offset.MustNew(3, 0)
		off4 := offset.MustNew(4, 0)

		c.Add(off1, 10)  // small, size = 10
		c.Add(off2, 95)  // 10+95 = 105 >= 100, completes chunk 1 at off1
		c.Add(off3, 5)   // 95+5 = 100 >= 100, completes chunk 2 at off2
		c.Add(off4, 100) // 5+100 = 105 >= 100, completes chunk 3 at off3

		chunks := c.CompletedChunks()
		assert.Equal(t, 3, len(chunks))
		assert.Equal(t, off1, chunks[0].Start)
		assert.Equal(t, off1, chunks[0].End)
		assert.Equal(t, off2, chunks[1].Start)
		assert.Equal(t, off2, chunks[1].End)
		assert.Equal(t, off3, chunks[2].Start)
		assert.Equal(t, off3, chunks[2].End)
	})

	t.Run("items with same offset", func(t *testing.T) {
		c := NewChunker(100)
		off := offset.MustNew(1, 0)

		c.Add(off, 30)
		c.Add(off, 30)
		completed := c.Add(off, 50)

		assert.True(t, completed)
		chunks := c.CompletedChunks()
		require.Equal(t, 1, len(chunks))
		// All items have the same offset, so start and end are the same
		assert.Equal(t, off, chunks[0].Start)
		assert.Equal(t, off, chunks[0].End)
	})
}

func TestChunkerExampleFromSpec(t *testing.T) {
	// Example from the specification:
	// - Threshold: 100 bytes
	// - Items: [50 bytes @ 0_0, 60 bytes @ 1_0, 30 bytes @ 2_0]
	// - Chunk 1: 0_0 to 0_0 (50 bytes, then 60 would exceed)
	// - Chunk 2 starts at 1_0
	// - Current: 1_0 with items 1_0 (60) and potentially 2_0 (30)

	t.Run("spec example", func(t *testing.T) {
		c := NewChunker(100)
		off0 := offset.MustNew(0, 0)
		off1 := offset.MustNew(1, 0)
		off2 := offset.MustNew(2, 0)

		c.Add(off0, 50)  // chunk starts, size = 50
		c.Add(off1, 60)  // 50 + 60 = 110 >= 100, completes chunk 1
		c.Add(off2, 30)  // new chunk, 60 + 30 = 90 < 100, no completion

		chunks := c.CompletedChunks()
		require.Equal(t, 1, len(chunks))

		// Chunk 1: 0_0 to 0_0
		assert.Equal(t, off0, chunks[0].Start)
		assert.Equal(t, off0, chunks[0].End)

		// Current chunk starts at 1_0
		assert.Equal(t, off1, c.CurrentChunkStart())
		// Current chunk contains 60 + 30 = 90 bytes
		assert.Equal(t, int64(90), c.CurrentChunkSize())
	})
}

// Benchmark tests
func BenchmarkChunkerAdd(b *testing.B) {
	c := NewChunker(10 * 1024 * 1024) // 10MB chunks

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		off := offset.MustNew(int64(i), 0)
		c.Add(off, 1024) // 1KB items
	}
}

func BenchmarkChunkerGetChunkEnd(b *testing.B) {
	c := NewChunker(1000)

	// Create many completed chunks
	for i := 0; i < 1000; i++ {
		off := offset.MustNew(int64(i), 0)
		c.Add(off, 100) // Each item completes a chunk after first
	}

	startOff := offset.MustNew(500, 0)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		c.GetChunkEnd(startOff)
	}
}
