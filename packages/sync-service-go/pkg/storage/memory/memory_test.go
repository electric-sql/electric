package memory

import (
	"strings"
	"sync"
	"testing"

	"github.com/electric-sql/electric/packages/sync-service-go/pkg/storage"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Ported from: test/electric/shape_cache/storage_test.exs (memory-related tests)

func TestNewMemoryStorage(t *testing.T) {
	t.Run("creates storage with default config", func(t *testing.T) {
		ms := NewDefault()
		assert.NotNil(t, ms)
		assert.Equal(t, DefaultChunkThreshold, ms.chunkThreshold)
	})

	t.Run("creates storage with custom config", func(t *testing.T) {
		cfg := Config{ChunkThreshold: 1024}
		ms := New(cfg)
		assert.NotNil(t, ms)
		assert.Equal(t, 1024, ms.chunkThreshold)
	})

	t.Run("uses default threshold when config value is zero", func(t *testing.T) {
		cfg := Config{ChunkThreshold: 0}
		ms := New(cfg)
		assert.Equal(t, DefaultChunkThreshold, ms.chunkThreshold)
	})

	t.Run("uses default threshold when config value is negative", func(t *testing.T) {
		cfg := Config{ChunkThreshold: -100}
		ms := New(cfg)
		assert.Equal(t, DefaultChunkThreshold, ms.chunkThreshold)
	})
}

func TestMakeNewShapeID(t *testing.T) {
	ms := NewDefault()

	t.Run("generates unique IDs", func(t *testing.T) {
		id1 := ms.MakeNewShapeID()
		id2 := ms.MakeNewShapeID()

		assert.NotEmpty(t, id1)
		assert.NotEmpty(t, id2)
		assert.NotEqual(t, id1, id2)
	})

	t.Run("generates IDs with correct format", func(t *testing.T) {
		id := ms.MakeNewShapeID()

		// Format: {8-char-hex}-{timestamp}
		parts := strings.Split(id, "-")
		assert.Equal(t, 2, len(parts))
		assert.Equal(t, 8, len(parts[0])) // 8 hex characters
	})

	t.Run("generates many unique IDs concurrently", func(t *testing.T) {
		const numGoroutines = 100
		ids := make(chan string, numGoroutines)

		var wg sync.WaitGroup
		for i := 0; i < numGoroutines; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				ids <- ms.MakeNewShapeID()
			}()
		}
		wg.Wait()
		close(ids)

		// Collect IDs and check uniqueness
		seen := make(map[string]bool)
		for id := range ids {
			assert.False(t, seen[id], "duplicate ID generated: %s", id)
			seen[id] = true
		}
		assert.Equal(t, numGoroutines, len(seen))
	})
}

func TestShapeLifecycle(t *testing.T) {
	ms := NewDefault()

	t.Run("shape does not exist initially", func(t *testing.T) {
		assert.False(t, ms.ShapeExists("nonexistent"))
	})

	t.Run("ListShapes returns empty initially", func(t *testing.T) {
		shapes := ms.ListShapes()
		assert.Empty(t, shapes)
	})

	t.Run("shape exists after SetSnapshot", func(t *testing.T) {
		shapeID := "shape-1"
		schema := storage.SchemaInfo{
			TableName: "users",
			Schema:    "public",
		}

		err := ms.SetSnapshot(shapeID, schema, []storage.LogItem{}, 100)
		require.NoError(t, err)

		assert.True(t, ms.ShapeExists(shapeID))
	})

	t.Run("ListShapes returns shape after creation", func(t *testing.T) {
		shapes := ms.ListShapes()
		assert.Contains(t, shapes, "shape-1")
	})

	t.Run("DeleteShape removes shape", func(t *testing.T) {
		err := ms.DeleteShape("shape-1")
		require.NoError(t, err)

		assert.False(t, ms.ShapeExists("shape-1"))
	})

	t.Run("DeleteShape returns error for nonexistent shape", func(t *testing.T) {
		err := ms.DeleteShape("nonexistent")
		assert.Equal(t, ErrShapeNotFound, err)
	})
}

func TestSnapshot(t *testing.T) {
	t.Run("SetSnapshot and GetSnapshot roundtrip", func(t *testing.T) {
		ms := NewDefault()
		shapeID := "shape-1"
		schema := storage.SchemaInfo{
			TableName: "users",
			Schema:    "public",
			Columns: []storage.ColumnInfo{
				{Name: "id", Type: "int4", PKIndex: 0, NotNull: true},
				{Name: "name", Type: "text"},
			},
		}
		items := []storage.LogItem{
			{Offset: "0_0", Key: `"public"."users"/"1"`, Op: storage.OpInsert, JSON: []byte(`{"id":1,"name":"Alice"}`)},
			{Offset: "0_1", Key: `"public"."users"/"2"`, Op: storage.OpInsert, JSON: []byte(`{"id":2,"name":"Bob"}`)},
		}

		err := ms.SetSnapshot(shapeID, schema, items, 12345)
		require.NoError(t, err)

		retrievedItems, xmin, err := ms.GetSnapshot(shapeID)
		require.NoError(t, err)
		assert.Equal(t, int64(12345), xmin)
		assert.Equal(t, len(items), len(retrievedItems))
		assert.Equal(t, items[0].Key, retrievedItems[0].Key)
		assert.Equal(t, items[1].Key, retrievedItems[1].Key)
	})

	t.Run("GetSnapshot returns error for nonexistent shape", func(t *testing.T) {
		ms := NewDefault()
		_, _, err := ms.GetSnapshot("nonexistent")
		assert.Equal(t, ErrShapeNotFound, err)
	})

	t.Run("SnapshotExists returns true after SetSnapshot", func(t *testing.T) {
		ms := NewDefault()
		shapeID := "shape-1"

		assert.False(t, ms.SnapshotExists(shapeID))

		err := ms.SetSnapshot(shapeID, storage.SchemaInfo{}, []storage.LogItem{}, 0)
		require.NoError(t, err)

		assert.True(t, ms.SnapshotExists(shapeID))
	})

	t.Run("SnapshotExists returns false for nonexistent shape", func(t *testing.T) {
		ms := NewDefault()
		assert.False(t, ms.SnapshotExists("nonexistent"))
	})

	t.Run("SetSnapshot with empty items", func(t *testing.T) {
		ms := NewDefault()
		shapeID := "empty-shape"

		err := ms.SetSnapshot(shapeID, storage.SchemaInfo{}, []storage.LogItem{}, 0)
		require.NoError(t, err)

		items, _, err := ms.GetSnapshot(shapeID)
		require.NoError(t, err)
		assert.Empty(t, items)
	})

	t.Run("retrieved snapshot is a copy (not affected by external mutations)", func(t *testing.T) {
		ms := NewDefault()
		shapeID := "shape-1"
		items := []storage.LogItem{
			{Offset: "0_0", Key: "key1", Op: storage.OpInsert, JSON: []byte(`{}`)},
		}

		err := ms.SetSnapshot(shapeID, storage.SchemaInfo{}, items, 0)
		require.NoError(t, err)

		// Mutate original slice
		items[0].Key = "mutated"

		// Retrieve and verify it's not affected
		retrieved, _, _ := ms.GetSnapshot(shapeID)
		assert.Equal(t, "key1", retrieved[0].Key)
	})
}

func TestAppendToLog(t *testing.T) {
	t.Run("appends items to existing shape", func(t *testing.T) {
		ms := NewDefault()
		shapeID := "shape-1"

		err := ms.SetSnapshot(shapeID, storage.SchemaInfo{}, []storage.LogItem{}, 0)
		require.NoError(t, err)

		items := []storage.LogItem{
			{Offset: "100_0", Key: "key1", Op: storage.OpInsert, JSON: []byte(`{}`)},
			{Offset: "100_1", Key: "key2", Op: storage.OpUpdate, JSON: []byte(`{}`)},
		}

		err = ms.AppendToLog(shapeID, items)
		require.NoError(t, err)

		length, err := ms.GetLogLength(shapeID)
		require.NoError(t, err)
		assert.Equal(t, 2, length)
	})

	t.Run("returns error for nonexistent shape", func(t *testing.T) {
		ms := NewDefault()
		err := ms.AppendToLog("nonexistent", []storage.LogItem{})
		assert.Equal(t, ErrShapeNotFound, err)
	})

	t.Run("multiple appends accumulate", func(t *testing.T) {
		ms := NewDefault()
		shapeID := "shape-1"

		err := ms.SetSnapshot(shapeID, storage.SchemaInfo{}, []storage.LogItem{}, 0)
		require.NoError(t, err)

		for i := 0; i < 5; i++ {
			items := []storage.LogItem{
				{Offset: storage.FormatOffset(int64(100+i), 0), Key: "key", Op: storage.OpInsert, JSON: []byte(`{}`)},
			}
			err = ms.AppendToLog(shapeID, items)
			require.NoError(t, err)
		}

		length, _ := ms.GetLogLength(shapeID)
		assert.Equal(t, 5, length)
	})
}

func TestGetLogSince(t *testing.T) {
	ms := NewDefault()
	shapeID := "shape-1"

	// Setup: snapshot with 2 items, log with 3 items
	snapshotItems := []storage.LogItem{
		{Offset: "0_0", Key: "snap1", Op: storage.OpInsert, JSON: []byte(`{"snapshot":1}`)},
		{Offset: "0_1", Key: "snap2", Op: storage.OpInsert, JSON: []byte(`{"snapshot":2}`)},
	}
	logItems := []storage.LogItem{
		{Offset: "100_0", Key: "log1", Op: storage.OpInsert, JSON: []byte(`{"log":1}`)},
		{Offset: "100_1", Key: "log2", Op: storage.OpUpdate, JSON: []byte(`{"log":2}`)},
		{Offset: "200_0", Key: "log3", Op: storage.OpDelete, JSON: []byte(`{"log":3}`)},
	}

	err := ms.SetSnapshot(shapeID, storage.SchemaInfo{}, snapshotItems, 0)
	require.NoError(t, err)
	err = ms.AppendToLog(shapeID, logItems)
	require.NoError(t, err)

	t.Run("offset -1 returns snapshot and all log items", func(t *testing.T) {
		items, err := ms.GetLogSince(shapeID, "-1")
		require.NoError(t, err)
		assert.Equal(t, 5, len(items)) // 2 snapshot + 3 log
		assert.Equal(t, "snap1", items[0].Key)
		assert.Equal(t, "snap2", items[1].Key)
		assert.Equal(t, "log1", items[2].Key)
	})

	t.Run("offset 0_0 returns items after first snapshot item", func(t *testing.T) {
		items, err := ms.GetLogSince(shapeID, "0_0")
		require.NoError(t, err)
		// Only log items with offset > "0_0"
		assert.Equal(t, 3, len(items))
		assert.Equal(t, "log1", items[0].Key)
	})

	t.Run("offset 100_0 returns items after that offset", func(t *testing.T) {
		items, err := ms.GetLogSince(shapeID, "100_0")
		require.NoError(t, err)
		assert.Equal(t, 2, len(items))
		assert.Equal(t, "log2", items[0].Key)
		assert.Equal(t, "log3", items[1].Key)
	})

	t.Run("offset at end returns empty", func(t *testing.T) {
		items, err := ms.GetLogSince(shapeID, "200_0")
		require.NoError(t, err)
		assert.Empty(t, items)
	})

	t.Run("returns error for nonexistent shape", func(t *testing.T) {
		_, err := ms.GetLogSince("nonexistent", "-1")
		assert.Equal(t, ErrShapeNotFound, err)
	})
}

func TestGetLogChunk(t *testing.T) {
	ms := NewDefault()
	shapeID := "shape-1"

	snapshotItems := []storage.LogItem{
		{Offset: "0_0", Key: "snap1", Op: storage.OpInsert, JSON: []byte(`{}`)},
	}
	logItems := []storage.LogItem{
		{Offset: "100_0", Key: "log1", Op: storage.OpInsert, JSON: []byte(`{}`)},
		{Offset: "100_1", Key: "log2", Op: storage.OpInsert, JSON: []byte(`{}`)},
		{Offset: "200_0", Key: "log3", Op: storage.OpInsert, JSON: []byte(`{}`)},
	}

	err := ms.SetSnapshot(shapeID, storage.SchemaInfo{}, snapshotItems, 0)
	require.NoError(t, err)
	err = ms.AppendToLog(shapeID, logItems)
	require.NoError(t, err)

	// Set chunk boundary: 0_0 to 100_1
	err = ms.SetChunkEnd(shapeID, "0_0", "100_1")
	require.NoError(t, err)

	t.Run("chunk -1 returns snapshot", func(t *testing.T) {
		items, nextOffset, err := ms.GetLogChunk(shapeID, "-1")
		require.NoError(t, err)
		assert.Equal(t, 1, len(items))
		assert.Equal(t, "snap1", items[0].Key)
		assert.Equal(t, "0_0", nextOffset)
	})

	t.Run("chunk with boundary returns items up to boundary", func(t *testing.T) {
		items, nextOffset, err := ms.GetLogChunk(shapeID, "0_0")
		require.NoError(t, err)
		assert.Equal(t, 2, len(items)) // 100_0 and 100_1
		assert.Equal(t, "log1", items[0].Key)
		assert.Equal(t, "log2", items[1].Key)
		assert.Equal(t, "100_1", nextOffset)
	})

	t.Run("returns error for nonexistent shape", func(t *testing.T) {
		_, _, err := ms.GetLogChunk("nonexistent", "-1")
		assert.Equal(t, ErrShapeNotFound, err)
	})
}

func TestChunkBoundaries(t *testing.T) {
	ms := NewDefault()
	shapeID := "shape-1"

	err := ms.SetSnapshot(shapeID, storage.SchemaInfo{}, []storage.LogItem{}, 0)
	require.NoError(t, err)

	t.Run("GetChunkEnd returns false when no boundary exists", func(t *testing.T) {
		end, exists := ms.GetChunkEnd(shapeID, "0_0")
		assert.False(t, exists)
		assert.Empty(t, end)
	})

	t.Run("SetChunkEnd and GetChunkEnd roundtrip", func(t *testing.T) {
		err := ms.SetChunkEnd(shapeID, "0_0", "100_5")
		require.NoError(t, err)

		end, exists := ms.GetChunkEnd(shapeID, "0_0")
		assert.True(t, exists)
		assert.Equal(t, "100_5", end)
	})

	t.Run("multiple chunk boundaries", func(t *testing.T) {
		err := ms.SetChunkEnd(shapeID, "100_5", "200_0")
		require.NoError(t, err)

		err = ms.SetChunkEnd(shapeID, "200_0", "300_10")
		require.NoError(t, err)

		end1, _ := ms.GetChunkEnd(shapeID, "0_0")
		end2, _ := ms.GetChunkEnd(shapeID, "100_5")
		end3, _ := ms.GetChunkEnd(shapeID, "200_0")

		assert.Equal(t, "100_5", end1)
		assert.Equal(t, "200_0", end2)
		assert.Equal(t, "300_10", end3)
	})

	t.Run("SetChunkEnd returns error for nonexistent shape", func(t *testing.T) {
		err := ms.SetChunkEnd("nonexistent", "0_0", "1_0")
		assert.Equal(t, ErrShapeNotFound, err)
	})

	t.Run("GetChunkEnd returns false for nonexistent shape", func(t *testing.T) {
		_, exists := ms.GetChunkEnd("nonexistent", "0_0")
		assert.False(t, exists)
	})
}

func TestGetLatestOffset(t *testing.T) {
	t.Run("returns 0_0 for shape with no log entries", func(t *testing.T) {
		ms := NewDefault()
		shapeID := "shape-1"

		err := ms.SetSnapshot(shapeID, storage.SchemaInfo{}, []storage.LogItem{}, 0)
		require.NoError(t, err)

		offset, err := ms.GetLatestOffset(shapeID)
		require.NoError(t, err)
		assert.Equal(t, "0_0", offset)
	})

	t.Run("returns last log offset", func(t *testing.T) {
		ms := NewDefault()
		shapeID := "shape-1"

		err := ms.SetSnapshot(shapeID, storage.SchemaInfo{}, []storage.LogItem{}, 0)
		require.NoError(t, err)

		logItems := []storage.LogItem{
			{Offset: "100_0", Key: "key1", Op: storage.OpInsert, JSON: []byte(`{}`)},
			{Offset: "100_1", Key: "key2", Op: storage.OpInsert, JSON: []byte(`{}`)},
			{Offset: "200_5", Key: "key3", Op: storage.OpInsert, JSON: []byte(`{}`)},
		}
		err = ms.AppendToLog(shapeID, logItems)
		require.NoError(t, err)

		offset, err := ms.GetLatestOffset(shapeID)
		require.NoError(t, err)
		assert.Equal(t, "200_5", offset)
	})

	t.Run("returns error for nonexistent shape", func(t *testing.T) {
		ms := NewDefault()
		_, err := ms.GetLatestOffset("nonexistent")
		assert.Equal(t, ErrShapeNotFound, err)
	})
}

func TestGetSchema(t *testing.T) {
	ms := NewDefault()
	shapeID := "shape-1"

	schema := storage.SchemaInfo{
		TableName: "users",
		Schema:    "public",
		Columns: []storage.ColumnInfo{
			{Name: "id", Type: "int4", PKIndex: 0, NotNull: true},
			{Name: "email", Type: "text", NotNull: true},
			{Name: "created_at", Type: "timestamptz"},
		},
	}

	err := ms.SetSnapshot(shapeID, schema, []storage.LogItem{}, 0)
	require.NoError(t, err)

	t.Run("retrieves schema correctly", func(t *testing.T) {
		retrieved, err := ms.GetSchema(shapeID)
		require.NoError(t, err)
		assert.Equal(t, "users", retrieved.TableName)
		assert.Equal(t, "public", retrieved.Schema)
		assert.Equal(t, 3, len(retrieved.Columns))
		assert.Equal(t, "id", retrieved.Columns[0].Name)
	})

	t.Run("returns error for nonexistent shape", func(t *testing.T) {
		_, err := ms.GetSchema("nonexistent")
		assert.Equal(t, ErrShapeNotFound, err)
	})
}

func TestPgSnapshot(t *testing.T) {
	ms := NewDefault()
	shapeID := "shape-1"

	err := ms.SetSnapshot(shapeID, storage.SchemaInfo{}, []storage.LogItem{}, 0)
	require.NoError(t, err)

	t.Run("returns nil when not set", func(t *testing.T) {
		snap, err := ms.GetPgSnapshot(shapeID)
		require.NoError(t, err)
		assert.Nil(t, snap)
	})

	t.Run("SetPgSnapshot and GetPgSnapshot roundtrip", func(t *testing.T) {
		pgSnap := &storage.PgSnapshot{
			Xmin:       100,
			Xmax:       200,
			XipList:    []int64{150, 160, 170},
			FilterTxns: true,
		}

		err := ms.SetPgSnapshot(shapeID, pgSnap)
		require.NoError(t, err)

		retrieved, err := ms.GetPgSnapshot(shapeID)
		require.NoError(t, err)
		assert.Equal(t, int64(100), retrieved.Xmin)
		assert.Equal(t, int64(200), retrieved.Xmax)
		assert.Equal(t, []int64{150, 160, 170}, retrieved.XipList)
		assert.True(t, retrieved.FilterTxns)
	})

	t.Run("returns error for nonexistent shape", func(t *testing.T) {
		_, err := ms.GetPgSnapshot("nonexistent")
		assert.Equal(t, ErrShapeNotFound, err)
	})

	t.Run("SetPgSnapshot returns error for nonexistent shape", func(t *testing.T) {
		err := ms.SetPgSnapshot("nonexistent", &storage.PgSnapshot{})
		assert.Equal(t, ErrShapeNotFound, err)
	})
}

func TestCleanup(t *testing.T) {
	ms := NewDefault()

	// Create multiple shapes
	for i := 0; i < 5; i++ {
		shapeID := ms.MakeNewShapeID()
		err := ms.SetSnapshot(shapeID, storage.SchemaInfo{}, []storage.LogItem{}, 0)
		require.NoError(t, err)
	}

	assert.Equal(t, 5, len(ms.ListShapes()))

	ms.Cleanup()

	assert.Empty(t, ms.ListShapes())
}

func TestConcurrentAccess(t *testing.T) {
	ms := NewDefault()
	shapeID := "concurrent-shape"

	err := ms.SetSnapshot(shapeID, storage.SchemaInfo{}, []storage.LogItem{}, 0)
	require.NoError(t, err)

	const numGoroutines = 50
	const numOps = 100

	var wg sync.WaitGroup

	// Concurrent writers
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(goroutineID int) {
			defer wg.Done()
			for j := 0; j < numOps; j++ {
				items := []storage.LogItem{
					{
						Offset: storage.FormatOffset(int64(goroutineID*1000+j), 0),
						Key:    "key",
						Op:     storage.OpInsert,
						JSON:   []byte(`{}`),
					},
				}
				_ = ms.AppendToLog(shapeID, items)
			}
		}(i)
	}

	// Concurrent readers
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < numOps; j++ {
				_, _ = ms.GetLogSince(shapeID, "-1")
				_, _ = ms.GetLatestOffset(shapeID)
				_ = ms.SnapshotExists(shapeID)
			}
		}()
	}

	wg.Wait()

	// Verify no race conditions occurred (test completes without panic)
	length, err := ms.GetLogLength(shapeID)
	require.NoError(t, err)
	assert.Equal(t, numGoroutines*numOps, length)
}

func TestConcurrentShapeCreation(t *testing.T) {
	ms := NewDefault()
	const numShapes = 100

	var wg sync.WaitGroup
	shapes := make(chan string, numShapes)

	for i := 0; i < numShapes; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			shapeID := ms.MakeNewShapeID()
			err := ms.SetSnapshot(shapeID, storage.SchemaInfo{TableName: "table"}, []storage.LogItem{}, int64(idx))
			if err == nil {
				shapes <- shapeID
			}
		}(i)
	}

	wg.Wait()
	close(shapes)

	// Verify all shapes were created
	createdShapes := ms.ListShapes()
	assert.Equal(t, numShapes, len(createdShapes))
}

// Test offset comparison helper functions
func TestOffsetHelpers(t *testing.T) {
	t.Run("CompareOffsets", func(t *testing.T) {
		tests := []struct {
			a, b     string
			expected int
		}{
			{"-1", "0_0", -1},
			{"0_0", "-1", 1},
			{"0_0", "0_0", 0},
			{"0_0", "0_1", -1},
			{"0_1", "0_0", 1},
			{"1_0", "0_100", 1},
			{"100_50", "100_50", 0},
			{"100_50", "100_51", -1},
			{"100_50", "101_0", -1},
		}

		for _, tc := range tests {
			result := storage.CompareOffsets(tc.a, tc.b)
			assert.Equal(t, tc.expected, result, "CompareOffsets(%q, %q)", tc.a, tc.b)
		}
	})

	t.Run("FormatOffset", func(t *testing.T) {
		tests := []struct {
			tx       int64
			op       int
			expected string
		}{
			{-1, 0, "-1"},
			{0, 0, "0_0"},
			{100, 50, "100_50"},
			{9223372036854775807, 0, "9223372036854775807_0"},
		}

		for _, tc := range tests {
			result := storage.FormatOffset(tc.tx, tc.op)
			assert.Equal(t, tc.expected, result)
		}
	})

	t.Run("IsBeforeAll", func(t *testing.T) {
		assert.True(t, storage.IsBeforeAll("-1"))
		assert.False(t, storage.IsBeforeAll("0_0"))
		assert.False(t, storage.IsBeforeAll("100_5"))
		assert.False(t, storage.IsBeforeAll(""))
	})
}

// Full CRUD cycle test
func TestFullCRUDCycle(t *testing.T) {
	ms := NewDefault()

	// 1. Create shape with snapshot
	shapeID := ms.MakeNewShapeID()
	schema := storage.SchemaInfo{
		TableName: "products",
		Schema:    "shop",
		Columns: []storage.ColumnInfo{
			{Name: "id", Type: "int4", PKIndex: 0, NotNull: true},
			{Name: "name", Type: "text"},
			{Name: "price", Type: "numeric", Precision: 10, Scale: 2},
		},
	}
	snapshotItems := []storage.LogItem{
		{Offset: "0_0", Key: `"shop"."products"/"1"`, Op: storage.OpInsert, JSON: []byte(`{"id":1,"name":"Widget","price":"9.99"}`)},
		{Offset: "0_1", Key: `"shop"."products"/"2"`, Op: storage.OpInsert, JSON: []byte(`{"id":2,"name":"Gadget","price":"19.99"}`)},
	}

	err := ms.SetSnapshot(shapeID, schema, snapshotItems, 1000)
	require.NoError(t, err)

	// 2. Verify snapshot
	items, xmin, err := ms.GetSnapshot(shapeID)
	require.NoError(t, err)
	assert.Equal(t, int64(1000), xmin)
	assert.Equal(t, 2, len(items))

	// 3. Append log entries
	logItems := []storage.LogItem{
		{Offset: "1001_0", Key: `"shop"."products"/"1"`, Op: storage.OpUpdate, JSON: []byte(`{"id":1,"name":"Super Widget","price":"12.99"}`)},
		{Offset: "1002_0", Key: `"shop"."products"/"3"`, Op: storage.OpInsert, JSON: []byte(`{"id":3,"name":"Thingamajig","price":"29.99"}`)},
		{Offset: "1002_1", Key: `"shop"."products"/"2"`, Op: storage.OpDelete, JSON: []byte(`{"id":2}`)},
	}
	err = ms.AppendToLog(shapeID, logItems)
	require.NoError(t, err)

	// 4. Read log stream
	allItems, err := ms.GetLogSince(shapeID, "-1")
	require.NoError(t, err)
	assert.Equal(t, 5, len(allItems)) // 2 snapshot + 3 log

	// 5. Read only changes since snapshot
	changes, err := ms.GetLogSince(shapeID, "0_1")
	require.NoError(t, err)
	assert.Equal(t, 3, len(changes))

	// 6. Set chunk boundaries
	err = ms.SetChunkEnd(shapeID, "0_0", "1001_0")
	require.NoError(t, err)

	// 7. Get chunk
	chunkItems, nextOffset, err := ms.GetLogChunk(shapeID, "0_0")
	require.NoError(t, err)
	assert.Equal(t, 1, len(chunkItems)) // Only 1001_0
	assert.Equal(t, "1001_0", nextOffset)

	// 8. Get latest offset
	latest, err := ms.GetLatestOffset(shapeID)
	require.NoError(t, err)
	assert.Equal(t, "1002_1", latest)

	// 9. Delete shape
	err = ms.DeleteShape(shapeID)
	require.NoError(t, err)
	assert.False(t, ms.ShapeExists(shapeID))
}

// Test empty shape (no snapshot yet)
func TestEmptyShapeBehavior(t *testing.T) {
	ms := NewDefault()
	shapeID := "shape-empty"

	// Shape doesn't exist initially
	assert.False(t, ms.ShapeExists(shapeID))
	assert.False(t, ms.SnapshotExists(shapeID))

	// Can't get snapshot
	_, _, err := ms.GetSnapshot(shapeID)
	assert.Error(t, err)

	// Can't append to log
	err = ms.AppendToLog(shapeID, []storage.LogItem{})
	assert.Error(t, err)

	// Can't get latest offset
	_, err = ms.GetLatestOffset(shapeID)
	assert.Error(t, err)
}

func TestOperationTypes(t *testing.T) {
	assert.Equal(t, storage.Operation("insert"), storage.OpInsert)
	assert.Equal(t, storage.Operation("update"), storage.OpUpdate)
	assert.Equal(t, storage.Operation("delete"), storage.OpDelete)
}
