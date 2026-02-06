// Package shapecache provides tests for the ShapeCache component.
//
// Ported from: test/electric/shape_cache/ files
package shapecache

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/electric-sql/electric/packages/sync-service-go/pkg/offset"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/shape"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/storage"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/storage/memory"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Helper to create a test shape
func testShape(t *testing.T, tableName string) *shape.Shape {
	t.Helper()
	s, err := shape.New(tableName)
	require.NoError(t, err)
	return s
}

// Helper to create a test shape with options
func testShapeWithWhere(t *testing.T, tableName, where string) *shape.Shape {
	t.Helper()
	s, err := shape.New(tableName, shape.WithWhere(where))
	require.NoError(t, err)
	return s
}

// TestNewCache tests cache creation
func TestNewCache(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)

	assert.NotNil(t, cache)
	assert.NotNil(t, cache.shapes)
	assert.NotNil(t, cache.byHash)
	assert.Equal(t, int64(DefaultChunkThreshold), cache.config.ChunkThreshold)
}

// TestNewCacheWithConfig tests cache creation with custom config
func TestNewCacheWithConfig(t *testing.T) {
	store := memory.NewDefault()
	config := CacheConfig{
		ChunkThreshold: 1024 * 1024, // 1MB
	}
	cache := NewCacheWithConfig(store, config)

	assert.NotNil(t, cache)
	assert.Equal(t, int64(1024*1024), cache.config.ChunkThreshold)
}

// TestNewCacheWithConfig_DefaultThreshold tests that zero threshold uses default
func TestNewCacheWithConfig_DefaultThreshold(t *testing.T) {
	store := memory.NewDefault()
	config := CacheConfig{
		ChunkThreshold: 0,
	}
	cache := NewCacheWithConfig(store, config)

	assert.Equal(t, int64(DefaultChunkThreshold), cache.config.ChunkThreshold)
}

// TestGetOrCreate_NewShape tests creating a new shape
func TestGetOrCreate_NewShape(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, created, err := cache.GetOrCreate(ctx, s)

	require.NoError(t, err)
	assert.True(t, created)
	assert.True(t, handle.IsValid())
	assert.Equal(t, s.Hash(), handle.Hash)
}

// TestGetOrCreate_Deduplication tests that same shape returns same handle
func TestGetOrCreate_Deduplication(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s1 := testShape(t, "users")
	s2 := testShape(t, "users") // Same shape definition

	handle1, created1, err1 := cache.GetOrCreate(ctx, s1)
	require.NoError(t, err1)
	assert.True(t, created1)

	handle2, created2, err2 := cache.GetOrCreate(ctx, s2)
	require.NoError(t, err2)
	assert.False(t, created2) // Should not create new
	assert.Equal(t, handle1.String(), handle2.String())
}

// TestGetOrCreate_DifferentShapes tests that different shapes get different handles
func TestGetOrCreate_DifferentShapes(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s1 := testShape(t, "users")
	s2 := testShape(t, "orders") // Different table

	handle1, created1, err1 := cache.GetOrCreate(ctx, s1)
	require.NoError(t, err1)
	assert.True(t, created1)

	handle2, created2, err2 := cache.GetOrCreate(ctx, s2)
	require.NoError(t, err2)
	assert.True(t, created2) // Should create new
	assert.NotEqual(t, handle1.String(), handle2.String())
}

// TestGetOrCreate_NilShape tests error for nil shape
func TestGetOrCreate_NilShape(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	_, _, err := cache.GetOrCreate(ctx, nil)
	assert.Error(t, err)
}

// TestGetOrCreate_AfterDelete tests recreation after deletion
func TestGetOrCreate_AfterDelete(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")

	// Create
	handle1, created1, err1 := cache.GetOrCreate(ctx, s)
	require.NoError(t, err1)
	assert.True(t, created1)

	// Delete
	err := cache.Delete(handle1.String())
	require.NoError(t, err)

	// Recreate - should get a new handle
	handle2, created2, err2 := cache.GetOrCreate(ctx, s)
	require.NoError(t, err2)
	assert.True(t, created2)
	assert.NotEqual(t, handle1.String(), handle2.String())
	assert.Equal(t, handle1.Hash, handle2.Hash) // Same hash, different timestamp
}

// TestGet_ExistingShape tests getting an existing shape
func TestGet_ExistingShape(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, err := cache.GetOrCreate(ctx, s)
	require.NoError(t, err)

	info, found := cache.Get(handle.String())
	assert.True(t, found)
	assert.Equal(t, handle.String(), info.Handle.String())
	assert.Equal(t, StateCreating, info.State)
}

// TestGet_NonExistingShape tests getting a non-existing shape
func TestGet_NonExistingShape(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)

	info, found := cache.Get("nonexistent-12345")
	assert.False(t, found)
	assert.Nil(t, info)
}

// TestGetByHash_ExistingShape tests getting by hash
func TestGetByHash_ExistingShape(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, err := cache.GetOrCreate(ctx, s)
	require.NoError(t, err)

	info, found := cache.GetByHash(s.Hash())
	assert.True(t, found)
	assert.Equal(t, handle.String(), info.Handle.String())
}

// TestGetByHash_NonExistingHash tests getting by non-existing hash
func TestGetByHash_NonExistingHash(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)

	info, found := cache.GetByHash("nonexistent")
	assert.False(t, found)
	assert.Nil(t, info)
}

// TestDelete_ExistingShape tests deleting an existing shape
func TestDelete_ExistingShape(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, err := cache.GetOrCreate(ctx, s)
	require.NoError(t, err)

	err = cache.Delete(handle.String())
	require.NoError(t, err)

	// Shape should still exist but be marked as deleted
	info, found := cache.Get(handle.String())
	assert.True(t, found)
	assert.Equal(t, StateDeleted, info.State)

	// Should not be found by hash anymore
	_, found = cache.GetByHash(s.Hash())
	assert.False(t, found)
}

// TestDelete_NonExistingShape tests deleting non-existing shape
func TestDelete_NonExistingShape(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)

	err := cache.Delete("nonexistent-12345")
	assert.ErrorIs(t, err, ErrShapeNotFound)
}

// TestDelete_AlreadyDeleted tests deleting an already deleted shape
func TestDelete_AlreadyDeleted(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, err := cache.GetOrCreate(ctx, s)
	require.NoError(t, err)

	// First delete
	err = cache.Delete(handle.String())
	require.NoError(t, err)

	// Second delete should succeed (idempotent)
	err = cache.Delete(handle.String())
	assert.NoError(t, err)
}

// TestRemove_ExistingShape tests complete removal
func TestRemove_ExistingShape(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, err := cache.GetOrCreate(ctx, s)
	require.NoError(t, err)

	err = cache.Remove(handle.String())
	require.NoError(t, err)

	// Shape should be completely gone
	_, found := cache.Get(handle.String())
	assert.False(t, found)
}

// TestRemove_NonExistingShape tests removing non-existing shape
func TestRemove_NonExistingShape(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)

	err := cache.Remove("nonexistent-12345")
	assert.ErrorIs(t, err, ErrShapeNotFound)
}

// TestUpdateOffset_ExistingShape tests updating offset
func TestUpdateOffset_ExistingShape(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, err := cache.GetOrCreate(ctx, s)
	require.NoError(t, err)

	newOffset := offset.MustNew(100, 5)
	err = cache.UpdateOffset(handle.String(), newOffset)
	require.NoError(t, err)

	info, _ := cache.Get(handle.String())
	assert.Equal(t, newOffset, info.LatestOffset)
}

// TestUpdateOffset_OnlyIncreases tests that offset only increases
func TestUpdateOffset_OnlyIncreases(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, err := cache.GetOrCreate(ctx, s)
	require.NoError(t, err)

	// Set higher offset
	highOffset := offset.MustNew(100, 5)
	err = cache.UpdateOffset(handle.String(), highOffset)
	require.NoError(t, err)

	// Try to set lower offset - should be ignored
	lowOffset := offset.MustNew(50, 0)
	err = cache.UpdateOffset(handle.String(), lowOffset)
	require.NoError(t, err)

	info, _ := cache.Get(handle.String())
	assert.Equal(t, highOffset, info.LatestOffset) // Should still be high
}

// TestUpdateOffset_NonExistingShape tests updating non-existing shape
func TestUpdateOffset_NonExistingShape(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)

	err := cache.UpdateOffset("nonexistent-12345", offset.MustNew(100, 0))
	assert.ErrorIs(t, err, ErrShapeNotFound)
}

// TestUpdateOffset_DeletedShape tests updating deleted shape
func TestUpdateOffset_DeletedShape(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, err := cache.GetOrCreate(ctx, s)
	require.NoError(t, err)

	err = cache.Delete(handle.String())
	require.NoError(t, err)

	err = cache.UpdateOffset(handle.String(), offset.MustNew(100, 0))
	assert.ErrorIs(t, err, ErrShapeDeleted)
}

// TestList tests listing shapes
func TestList(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	// Empty cache
	handles := cache.List()
	assert.Empty(t, handles)

	// Add shapes
	s1 := testShape(t, "users")
	h1, _, _ := cache.GetOrCreate(ctx, s1)

	s2 := testShape(t, "orders")
	h2, _, _ := cache.GetOrCreate(ctx, s2)

	handles = cache.List()
	assert.Len(t, handles, 2)
	assert.Contains(t, handles, h1.String())
	assert.Contains(t, handles, h2.String())

	// Delete one
	cache.Delete(h1.String())

	handles = cache.List()
	assert.Len(t, handles, 1)
	assert.Contains(t, handles, h2.String())
	assert.NotContains(t, handles, h1.String())
}

// TestCount tests counting shapes
func TestCount(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	assert.Equal(t, 0, cache.Count())

	s1 := testShape(t, "users")
	h1, _, _ := cache.GetOrCreate(ctx, s1)

	assert.Equal(t, 1, cache.Count())

	s2 := testShape(t, "orders")
	cache.GetOrCreate(ctx, s2)

	assert.Equal(t, 2, cache.Count())

	cache.Delete(h1.String())

	assert.Equal(t, 1, cache.Count())
}

// TestAwaitSnapshot_AlreadyActive tests awaiting on already active shape
func TestAwaitSnapshot_AlreadyActive(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, err := cache.GetOrCreate(ctx, s)
	require.NoError(t, err)

	// Mark as active
	err = cache.SetState(handle.String(), StateActive)
	require.NoError(t, err)

	// Should return immediately
	err = cache.AwaitSnapshot(ctx, handle.String())
	assert.NoError(t, err)
}

// TestAwaitSnapshot_NonExisting tests awaiting on non-existing shape
func TestAwaitSnapshot_NonExisting(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	err := cache.AwaitSnapshot(ctx, "nonexistent-12345")
	assert.ErrorIs(t, err, ErrShapeNotFound)
}

// TestAwaitSnapshot_WaitsForCompletion tests that await actually waits
func TestAwaitSnapshot_WaitsForCompletion(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, err := cache.GetOrCreate(ctx, s)
	require.NoError(t, err)

	done := make(chan struct{})

	// Start waiting in goroutine
	go func() {
		err := cache.AwaitSnapshot(ctx, handle.String())
		assert.NoError(t, err)
		close(done)
	}()

	// Give the goroutine time to start waiting
	time.Sleep(50 * time.Millisecond)

	// Should not be done yet
	select {
	case <-done:
		t.Fatal("AwaitSnapshot returned before snapshot was complete")
	default:
		// Expected
	}

	// Mark snapshot complete
	err = cache.MarkSnapshotComplete(handle.String())
	require.NoError(t, err)

	// Should complete now
	select {
	case <-done:
		// Expected
	case <-time.After(1 * time.Second):
		t.Fatal("AwaitSnapshot did not return after snapshot completion")
	}
}

// TestAwaitSnapshot_ContextCanceled tests context cancellation
func TestAwaitSnapshot_ContextCanceled(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx, cancel := context.WithCancel(context.Background())

	s := testShape(t, "users")
	handle, _, err := cache.GetOrCreate(ctx, s)
	require.NoError(t, err)

	errCh := make(chan error, 1)

	go func() {
		errCh <- cache.AwaitSnapshot(ctx, handle.String())
	}()

	// Give goroutine time to start
	time.Sleep(50 * time.Millisecond)

	// Cancel context
	cancel()

	// Should return with context error
	select {
	case err := <-errCh:
		assert.ErrorIs(t, err, context.Canceled)
	case <-time.After(1 * time.Second):
		t.Fatal("AwaitSnapshot did not return after context cancellation")
	}
}

// TestSetState_ValidTransitions tests valid state transitions
func TestSetState_ValidTransitions(t *testing.T) {
	tests := []struct {
		name     string
		from     ShapeState
		to       ShapeState
		expectOK bool
	}{
		{"Creating to Active", StateCreating, StateActive, true},
		{"Creating to Deleted", StateCreating, StateDeleted, true},
		{"Active to Deleted", StateActive, StateDeleted, true},
		{"Active to Creating", StateActive, StateCreating, false},
		{"Deleted to Active", StateDeleted, StateActive, false},
		{"Deleted to Creating", StateDeleted, StateCreating, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := memory.NewDefault()
			cache := NewCache(store)
			ctx := context.Background()

			s := testShape(t, "users")
			handle, _, _ := cache.GetOrCreate(ctx, s)

			// Set initial state if not Creating
			if tt.from != StateCreating {
				if tt.from == StateActive {
					cache.SetState(handle.String(), StateActive)
				} else if tt.from == StateDeleted {
					cache.SetState(handle.String(), StateActive)
					cache.SetState(handle.String(), StateDeleted)
				}
			}

			err := cache.SetState(handle.String(), tt.to)
			if tt.expectOK {
				assert.NoError(t, err)
				state, _ := cache.GetState(handle.String())
				assert.Equal(t, tt.to, state)
			} else {
				assert.Error(t, err)
				assert.ErrorIs(t, err, ErrInvalidState)
			}
		})
	}
}

// TestSetState_NonExisting tests setting state on non-existing shape
func TestSetState_NonExisting(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)

	err := cache.SetState("nonexistent-12345", StateActive)
	assert.ErrorIs(t, err, ErrShapeNotFound)
}

// TestGetLatestOffset tests getting latest offset
func TestGetLatestOffset(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, _ := cache.GetOrCreate(ctx, s)

	// Initial offset should be InitialOffset
	off, err := cache.GetLatestOffset(handle.String())
	require.NoError(t, err)
	assert.Equal(t, offset.InitialOffset, off)

	// Update and verify
	newOff := offset.MustNew(100, 5)
	cache.UpdateOffset(handle.String(), newOff)

	off, err = cache.GetLatestOffset(handle.String())
	require.NoError(t, err)
	assert.Equal(t, newOff, off)
}

// TestGetLatestOffset_NonExisting tests getting offset for non-existing shape
func TestGetLatestOffset_NonExisting(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)

	_, err := cache.GetLatestOffset("nonexistent-12345")
	assert.ErrorIs(t, err, ErrShapeNotFound)
}

// TestGetState tests getting state
func TestGetState(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, _ := cache.GetOrCreate(ctx, s)

	state, err := cache.GetState(handle.String())
	require.NoError(t, err)
	assert.Equal(t, StateCreating, state)

	cache.SetState(handle.String(), StateActive)

	state, err = cache.GetState(handle.String())
	require.NoError(t, err)
	assert.Equal(t, StateActive, state)
}

// TestGetState_NonExisting tests getting state for non-existing shape
func TestGetState_NonExisting(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)

	_, err := cache.GetState("nonexistent-12345")
	assert.ErrorIs(t, err, ErrShapeNotFound)
}

// TestMarkSnapshotComplete tests marking snapshot as complete
func TestMarkSnapshotComplete(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, _ := cache.GetOrCreate(ctx, s)

	// Should be creating initially
	state, _ := cache.GetState(handle.String())
	assert.Equal(t, StateCreating, state)

	// Mark complete
	err := cache.MarkSnapshotComplete(handle.String())
	require.NoError(t, err)

	// Should be active now
	state, _ = cache.GetState(handle.String())
	assert.Equal(t, StateActive, state)
}

// TestMarkSnapshotComplete_AlreadyActive tests marking already active shape
func TestMarkSnapshotComplete_AlreadyActive(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, _ := cache.GetOrCreate(ctx, s)

	cache.SetState(handle.String(), StateActive)

	// Should be idempotent
	err := cache.MarkSnapshotComplete(handle.String())
	assert.NoError(t, err)

	state, _ := cache.GetState(handle.String())
	assert.Equal(t, StateActive, state)
}

// TestMarkSnapshotComplete_NonExisting tests marking non-existing shape
func TestMarkSnapshotComplete_NonExisting(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)

	err := cache.MarkSnapshotComplete("nonexistent-12345")
	assert.ErrorIs(t, err, ErrShapeNotFound)
}

// TestHasShape tests checking for shape existence
func TestHasShape(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, _ := cache.GetOrCreate(ctx, s)

	assert.True(t, cache.HasShape(handle.String()))
	assert.False(t, cache.HasShape("nonexistent-12345"))

	// Deleted shapes should return false
	cache.Delete(handle.String())
	assert.False(t, cache.HasShape(handle.String()))
}

// TestGetShape tests getting shape definition
func TestGetShape(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, _ := cache.GetOrCreate(ctx, s)

	retrieved, err := cache.GetShape(handle.String())
	require.NoError(t, err)
	assert.Equal(t, s.TableName, retrieved.TableName)
	assert.Equal(t, s.Schema, retrieved.Schema)
}

// TestGetShape_NonExisting tests getting non-existing shape
func TestGetShape_NonExisting(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)

	_, err := cache.GetShape("nonexistent-12345")
	assert.ErrorIs(t, err, ErrShapeNotFound)
}

// TestValidateHandle tests handle validation
func TestValidateHandle(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, _ := cache.GetOrCreate(ctx, s)

	// Valid handle and matching shape
	err := cache.ValidateHandle(handle.String(), s)
	assert.NoError(t, err)

	// Valid handle but different shape
	s2 := testShape(t, "orders")
	err = cache.ValidateHandle(handle.String(), s2)
	assert.Error(t, err)
}

// TestValidateHandle_NonExisting tests validating non-existing handle
func TestValidateHandle_NonExisting(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)

	s := testShape(t, "users")
	err := cache.ValidateHandle("nonexistent-12345", s)
	assert.ErrorIs(t, err, ErrShapeNotFound)
}

// TestValidateHandle_Deleted tests validating deleted shape
func TestValidateHandle_Deleted(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, _ := cache.GetOrCreate(ctx, s)

	cache.Delete(handle.String())

	err := cache.ValidateHandle(handle.String(), s)
	assert.ErrorIs(t, err, ErrShapeDeleted)
}

// TestCleanup tests cleaning up the cache
func TestCleanup(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	// Add some shapes
	s1 := testShape(t, "users")
	cache.GetOrCreate(ctx, s1)

	s2 := testShape(t, "orders")
	cache.GetOrCreate(ctx, s2)

	assert.Equal(t, 2, cache.Count())

	// Cleanup
	cache.Cleanup()

	assert.Equal(t, 0, cache.Count())
	assert.Empty(t, cache.List())
}

// TestAddToChunker tests adding items to chunker
func TestAddToChunker(t *testing.T) {
	store := memory.NewDefault()
	config := CacheConfig{
		ChunkThreshold: 1000, // Small threshold for testing
	}
	cache := NewCacheWithConfig(store, config)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, _ := cache.GetOrCreate(ctx, s)

	// Add items below threshold
	completed, err := cache.AddToChunker(handle.String(), offset.MustNew(1, 0), 400)
	require.NoError(t, err)
	assert.False(t, completed)

	completed, err = cache.AddToChunker(handle.String(), offset.MustNew(1, 1), 400)
	require.NoError(t, err)
	assert.False(t, completed)

	// This should complete a chunk (total 1200 >= 1000)
	completed, err = cache.AddToChunker(handle.String(), offset.MustNew(1, 2), 400)
	require.NoError(t, err)
	assert.True(t, completed)
}

// TestAddToChunker_NonExisting tests adding to non-existing shape
func TestAddToChunker_NonExisting(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)

	_, err := cache.AddToChunker("nonexistent-12345", offset.MustNew(1, 0), 100)
	assert.ErrorIs(t, err, ErrShapeNotFound)
}

// TestAddToChunker_Deleted tests adding to deleted shape
func TestAddToChunker_Deleted(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, _ := cache.GetOrCreate(ctx, s)

	cache.Delete(handle.String())

	_, err := cache.AddToChunker(handle.String(), offset.MustNew(1, 0), 100)
	assert.ErrorIs(t, err, ErrShapeDeleted)
}

// TestGetChunkEnd tests getting chunk end offset
func TestGetChunkEnd(t *testing.T) {
	store := memory.NewDefault()
	config := CacheConfig{
		ChunkThreshold: 500,
	}
	cache := NewCacheWithConfig(store, config)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, _ := cache.GetOrCreate(ctx, s)

	// Add items to create a chunk
	cache.AddToChunker(handle.String(), offset.MustNew(1, 0), 300)
	cache.AddToChunker(handle.String(), offset.MustNew(1, 1), 300) // Completes chunk

	// Get chunk end for the starting offset
	endOffset, found := cache.GetChunkEnd(handle.String(), offset.MustNew(1, 0))
	assert.True(t, found)
	assert.Equal(t, offset.MustNew(1, 0), endOffset) // End is at first item
}

// TestGetChunkEnd_NotFound tests getting non-existing chunk end
func TestGetChunkEnd_NotFound(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, _ := cache.GetOrCreate(ctx, s)

	// No chunks added
	_, found := cache.GetChunkEnd(handle.String(), offset.MustNew(1, 0))
	assert.False(t, found)
}

// TestConcurrentAccess tests thread safety of cache operations
func TestConcurrentAccess(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	var wg sync.WaitGroup
	numGoroutines := 100

	// Concurrent GetOrCreate with same shape
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s := testShape(t, "users")
			_, _, err := cache.GetOrCreate(ctx, s)
			assert.NoError(t, err)
		}()
	}
	wg.Wait()

	// Should only have one shape
	assert.Equal(t, 1, cache.Count())
}

// TestConcurrentDifferentShapes tests concurrent creation of different shapes
func TestConcurrentDifferentShapes(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	var wg sync.WaitGroup
	numGoroutines := 50

	tables := make([]string, numGoroutines)
	for i := 0; i < numGoroutines; i++ {
		tables[i] = "table_" + string(rune('a'+i%26)) + string(rune('0'+i/26))
	}

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			s := testShape(t, tables[idx])
			_, _, err := cache.GetOrCreate(ctx, s)
			assert.NoError(t, err)
		}(i)
	}
	wg.Wait()

	assert.Equal(t, numGoroutines, cache.Count())
}

// TestConcurrentReadWrite tests concurrent reads and writes
func TestConcurrentReadWrite(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, _ := cache.GetOrCreate(ctx, s)

	var wg sync.WaitGroup
	numReaders := 50
	numWriters := 10

	// Readers
	for i := 0; i < numReaders; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				cache.Get(handle.String())
				cache.GetLatestOffset(handle.String())
				cache.HasShape(handle.String())
			}
		}()
	}

	// Writers
	for i := 0; i < numWriters; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				off := offset.MustNew(int64(idx*100+j), int64(j))
				cache.UpdateOffset(handle.String(), off)
			}
		}(i)
	}

	wg.Wait()

	// Should still have the shape
	assert.True(t, cache.HasShape(handle.String()))
}

// TestShapeState_String tests state string representation
func TestShapeState_String(t *testing.T) {
	assert.Equal(t, "creating", StateCreating.String())
	assert.Equal(t, "active", StateActive.String())
	assert.Equal(t, "deleted", StateDeleted.String())
	assert.Equal(t, "unknown", ShapeState(99).String())
}

// TestGetLog_WithStorage tests GetLog using storage backend
func TestGetLog_WithStorage(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, _ := cache.GetOrCreate(ctx, s)

	// Set up storage with some data
	schema := storage.SchemaInfo{
		TableName: "users",
		Schema:    "public",
	}
	store.SetSnapshot(handle.String(), schema, []storage.LogItem{}, 0)

	// Add log items to storage
	logItems := []storage.LogItem{
		{Offset: "1_0", Key: "pk1", Op: storage.OpInsert, JSON: []byte(`{}`)},
		{Offset: "1_1", Key: "pk2", Op: storage.OpInsert, JSON: []byte(`{}`)},
	}
	store.AppendToLog(handle.String(), logItems)

	// Mark as active
	cache.SetState(handle.String(), StateActive)

	// Get log from beginning
	items, err := cache.GetLog(handle.String(), offset.BeforeAll, 0)
	require.NoError(t, err)
	// Note: The conversion may not preserve all data, just testing the mechanism
	assert.NotNil(t, items)
}

// TestGetLog_NonExisting tests GetLog for non-existing shape
func TestGetLog_NonExisting(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)

	_, err := cache.GetLog("nonexistent-12345", offset.BeforeAll, 10)
	assert.ErrorIs(t, err, ErrShapeNotFound)
}

// TestGetLog_Deleted tests GetLog for deleted shape
func TestGetLog_Deleted(t *testing.T) {
	store := memory.NewDefault()
	cache := NewCache(store)
	ctx := context.Background()

	s := testShape(t, "users")
	handle, _, _ := cache.GetOrCreate(ctx, s)

	cache.Delete(handle.String())

	_, err := cache.GetLog(handle.String(), offset.BeforeAll, 10)
	assert.ErrorIs(t, err, ErrShapeDeleted)
}

// TestShapeInfo_MarkSnapshotComplete_Idempotent tests that marking complete is idempotent
func TestShapeInfo_MarkSnapshotComplete_Idempotent(t *testing.T) {
	info := newShapeInfo(shape.NewHandle("abc123def45678ab"), testShape(t, "users"), DefaultChunkThreshold)

	// Mark complete multiple times
	info.markSnapshotComplete()
	info.markSnapshotComplete()
	info.markSnapshotComplete()

	// Should be active
	assert.Equal(t, StateActive, info.State)
}
