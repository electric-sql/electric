package shape

import (
	"context"
	"testing"

	"github.com/electric-sql/electric/packages/sync-service-go/pkg/offset"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/schema"
	storagemem "github.com/electric-sql/electric/packages/sync-service-go/pkg/storage/memory"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/wal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockShapeCache is a mock implementation of ShapeCache for testing.
type mockShapeCache struct {
	snapshotCompleted map[string]bool
	offsets           map[string]offset.LogOffset
}

func newMockShapeCache() *mockShapeCache {
	return &mockShapeCache{
		snapshotCompleted: make(map[string]bool),
		offsets:           make(map[string]offset.LogOffset),
	}
}

func (m *mockShapeCache) MarkSnapshotComplete(handle string) error {
	m.snapshotCompleted[handle] = true
	return nil
}

func (m *mockShapeCache) UpdateOffset(handle string, off offset.LogOffset) error {
	m.offsets[handle] = off
	return nil
}

// TestConsumerState tests the ConsumerState type.
func TestConsumerState(t *testing.T) {
	tests := []struct {
		state    ConsumerState
		expected string
	}{
		{ConsumerInitializing, "initializing"},
		{ConsumerSnapshotting, "snapshotting"},
		{ConsumerActive, "active"},
		{ConsumerStopped, "stopped"},
		{ConsumerState(99), "unknown"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			assert.Equal(t, tt.expected, tt.state.String())
		})
	}
}

// TestNewConsumer tests creating a new consumer.
func TestNewConsumer(t *testing.T) {
	shape, err := New("users", WithSchema("public"))
	require.NoError(t, err)

	handle := NewHandle(shape.Hash())
	stor := storagemem.NewDefault()

	consumer := NewConsumer(ConsumerConfig{
		Handle:  handle,
		Shape:   shape,
		Storage: stor,
	})

	assert.NotNil(t, consumer)
	assert.Equal(t, handle, consumer.GetHandle())
	assert.Equal(t, shape, consumer.GetShape())
	assert.Equal(t, ConsumerInitializing, consumer.GetState())
	assert.Nil(t, consumer.GetPgSnapshot())
	assert.Equal(t, offset.InitialOffset, consumer.GetLatestOffset())
}

// TestConsumerStop tests stopping a consumer.
func TestConsumerStop(t *testing.T) {
	shape, err := New("users")
	require.NoError(t, err)

	handle := NewHandle(shape.Hash())
	stor := storagemem.NewDefault()

	consumer := NewConsumer(ConsumerConfig{
		Handle:  handle,
		Shape:   shape,
		Storage: stor,
	})

	assert.Equal(t, ConsumerInitializing, consumer.GetState())

	err = consumer.Stop()
	assert.NoError(t, err)
	assert.Equal(t, ConsumerStopped, consumer.GetState())
}

// TestChangeFilterMatchesRelation tests relation matching.
func TestChangeFilterMatchesRelation(t *testing.T) {
	shape, err := New("users", WithSchema("public"))
	require.NoError(t, err)

	filter := NewChangeFilter(shape)

	// Matching relation
	assert.True(t, filter.MatchesRelation("public", "users"))

	// Non-matching relations
	assert.False(t, filter.MatchesRelation("public", "orders"))
	assert.False(t, filter.MatchesRelation("other", "users"))
	assert.False(t, filter.MatchesRelation("other", "orders"))
}

// TestChangeFilterInsert tests filtering INSERT operations.
func TestChangeFilterInsert(t *testing.T) {
	tableSchema := schema.NewTableSchema("public", "users", []schema.Column{
		{Name: "id", Type: "int4", PKIndex: 0},
		{Name: "name", Type: "text", PKIndex: -1},
		{Name: "active", Type: "bool", PKIndex: -1},
	})

	shape, err := New("users",
		WithSchema("public"),
		WithWhere("active = true"),
		WithTableSchema(tableSchema),
	)
	require.NoError(t, err)

	filter := NewChangeFilter(shape)

	relation := &wal.RelationMessage{
		ID:        12345,
		Namespace: "public",
		Name:      "users",
		Columns: []wal.ColumnInfo{
			{Name: "id", IsKey: true},
			{Name: "name", IsKey: false},
			{Name: "active", IsKey: false},
		},
	}

	txOffset := offset.MustNew(100, 0)

	t.Run("matching insert", func(t *testing.T) {
		data := &wal.DataMessage{
			RelationID: 12345,
			NewValues: map[string]any{
				"id":     "1",
				"name":   "Alice",
				"active": "true",
			},
		}

		result, err := filter.FilterChange(wal.MessageInsert, data, txOffset, relation, 100, false)
		require.NoError(t, err)
		assert.True(t, result.Matched)
		assert.Len(t, result.Items, 1)
		assert.Equal(t, "insert", result.Items[0].OperationType())
	})

	t.Run("non-matching insert", func(t *testing.T) {
		data := &wal.DataMessage{
			RelationID: 12345,
			NewValues: map[string]any{
				"id":     "2",
				"name":   "Bob",
				"active": "false",
			},
		}

		result, err := filter.FilterChange(wal.MessageInsert, data, txOffset, relation, 100, false)
		require.NoError(t, err)
		assert.False(t, result.Matched)
		assert.Len(t, result.Items, 0)
	})

	t.Run("wrong relation", func(t *testing.T) {
		wrongRelation := &wal.RelationMessage{
			ID:        99999,
			Namespace: "public",
			Name:      "orders",
		}

		data := &wal.DataMessage{
			RelationID: 99999,
			NewValues: map[string]any{
				"id": "1",
			},
		}

		result, err := filter.FilterChange(wal.MessageInsert, data, txOffset, wrongRelation, 100, false)
		require.NoError(t, err)
		assert.False(t, result.Matched)
	})
}

// TestChangeFilterDelete tests filtering DELETE operations.
func TestChangeFilterDelete(t *testing.T) {
	tableSchema := schema.NewTableSchema("public", "users", []schema.Column{
		{Name: "id", Type: "int4", PKIndex: 0},
		{Name: "name", Type: "text", PKIndex: -1},
		{Name: "active", Type: "bool", PKIndex: -1},
	})

	shape, err := New("users",
		WithSchema("public"),
		WithWhere("active = true"),
		WithTableSchema(tableSchema),
	)
	require.NoError(t, err)

	filter := NewChangeFilter(shape)

	relation := &wal.RelationMessage{
		ID:        12345,
		Namespace: "public",
		Name:      "users",
		Columns: []wal.ColumnInfo{
			{Name: "id", IsKey: true},
			{Name: "name", IsKey: false},
			{Name: "active", IsKey: false},
		},
	}

	txOffset := offset.MustNew(100, 0)

	t.Run("matching delete", func(t *testing.T) {
		data := &wal.DataMessage{
			RelationID: 12345,
			OldValues: map[string]any{
				"id":     "1",
				"name":   "Alice",
				"active": "true",
			},
		}

		result, err := filter.FilterChange(wal.MessageDelete, data, txOffset, relation, 100, false)
		require.NoError(t, err)
		assert.True(t, result.Matched)
		assert.Len(t, result.Items, 1)
		assert.Equal(t, "delete", result.Items[0].OperationType())
	})

	t.Run("non-matching delete", func(t *testing.T) {
		data := &wal.DataMessage{
			RelationID: 12345,
			OldValues: map[string]any{
				"id":     "2",
				"name":   "Bob",
				"active": "false",
			},
		}

		result, err := filter.FilterChange(wal.MessageDelete, data, txOffset, relation, 100, false)
		require.NoError(t, err)
		assert.False(t, result.Matched)
	})

	t.Run("delete with key values only", func(t *testing.T) {
		data := &wal.DataMessage{
			RelationID:          12345,
			ChangedKeyOldValues: map[string]any{"id": "1", "active": "true"},
		}

		result, err := filter.FilterChange(wal.MessageDelete, data, txOffset, relation, 100, false)
		require.NoError(t, err)
		assert.True(t, result.Matched)
		assert.Len(t, result.Items, 1)
	})
}

// TestChangeFilterUpdate tests filtering UPDATE operations.
func TestChangeFilterUpdate(t *testing.T) {
	tableSchema := schema.NewTableSchema("public", "users", []schema.Column{
		{Name: "id", Type: "int4", PKIndex: 0},
		{Name: "name", Type: "text", PKIndex: -1},
		{Name: "active", Type: "bool", PKIndex: -1},
	})

	shape, err := New("users",
		WithSchema("public"),
		WithWhere("active = true"),
		WithTableSchema(tableSchema),
	)
	require.NoError(t, err)

	filter := NewChangeFilter(shape)

	relation := &wal.RelationMessage{
		ID:        12345,
		Namespace: "public",
		Name:      "users",
		Columns: []wal.ColumnInfo{
			{Name: "id", IsKey: true},
			{Name: "name", IsKey: false},
			{Name: "active", IsKey: false},
		},
	}

	txOffset := offset.MustNew(100, 0)

	t.Run("update within shape (in -> in)", func(t *testing.T) {
		data := &wal.DataMessage{
			RelationID: 12345,
			OldValues: map[string]any{
				"id":     "1",
				"name":   "Alice",
				"active": "true",
			},
			NewValues: map[string]any{
				"id":     "1",
				"name":   "Alice Smith",
				"active": "true",
			},
		}

		result, err := filter.FilterChange(wal.MessageUpdate, data, txOffset, relation, 100, false)
		require.NoError(t, err)
		assert.True(t, result.Matched)
		assert.Len(t, result.Items, 1)
		assert.Equal(t, "update", result.Items[0].OperationType())
	})

	t.Run("move into shape (out -> in)", func(t *testing.T) {
		data := &wal.DataMessage{
			RelationID: 12345,
			OldValues: map[string]any{
				"id":     "2",
				"name":   "Bob",
				"active": "false",
			},
			NewValues: map[string]any{
				"id":     "2",
				"name":   "Bob",
				"active": "true",
			},
		}

		result, err := filter.FilterChange(wal.MessageUpdate, data, txOffset, relation, 100, false)
		require.NoError(t, err)
		assert.True(t, result.Matched)
		assert.Len(t, result.Items, 1)
		assert.Equal(t, "insert", result.Items[0].OperationType())
	})

	t.Run("move out of shape (in -> out)", func(t *testing.T) {
		data := &wal.DataMessage{
			RelationID: 12345,
			OldValues: map[string]any{
				"id":     "1",
				"name":   "Alice",
				"active": "true",
			},
			NewValues: map[string]any{
				"id":     "1",
				"name":   "Alice",
				"active": "false",
			},
		}

		result, err := filter.FilterChange(wal.MessageUpdate, data, txOffset, relation, 100, false)
		require.NoError(t, err)
		assert.True(t, result.Matched)
		assert.Len(t, result.Items, 1)
		assert.Equal(t, "delete", result.Items[0].OperationType())
	})

	t.Run("update outside shape (out -> out)", func(t *testing.T) {
		data := &wal.DataMessage{
			RelationID: 12345,
			OldValues: map[string]any{
				"id":     "3",
				"name":   "Charlie",
				"active": "false",
			},
			NewValues: map[string]any{
				"id":     "3",
				"name":   "Charlie Brown",
				"active": "false",
			},
		}

		result, err := filter.FilterChange(wal.MessageUpdate, data, txOffset, relation, 100, false)
		require.NoError(t, err)
		assert.False(t, result.Matched)
		assert.Len(t, result.Items, 0)
	})

	t.Run("PK change within shape", func(t *testing.T) {
		data := &wal.DataMessage{
			RelationID: 12345,
			OldValues: map[string]any{
				"id":     "1",
				"name":   "Alice",
				"active": "true",
			},
			NewValues: map[string]any{
				"id":     "100",
				"name":   "Alice",
				"active": "true",
			},
		}

		result, err := filter.FilterChange(wal.MessageUpdate, data, txOffset, relation, 100, false)
		require.NoError(t, err)
		assert.True(t, result.Matched)
		// PK change should produce delete + insert
		assert.Len(t, result.Items, 2)
		assert.Equal(t, "delete", result.Items[0].OperationType())
		assert.Equal(t, "insert", result.Items[1].OperationType())

		// Check that the delete has key_change_to header
		if deleteHeaders := result.Items[0].Op.Headers; deleteHeaders != nil {
			_, hasKeyChangeTo := deleteHeaders["key_change_to"]
			assert.True(t, hasKeyChangeTo)
		}

		// Check that the insert has key_change_from header
		if insertHeaders := result.Items[1].Op.Headers; insertHeaders != nil {
			_, hasKeyChangeFrom := insertHeaders["key_change_from"]
			assert.True(t, hasKeyChangeFrom)
		}
	})
}

// TestChangeFilterNoWhere tests filtering without a WHERE clause.
func TestChangeFilterNoWhere(t *testing.T) {
	tableSchema := schema.NewTableSchema("public", "users", []schema.Column{
		{Name: "id", Type: "int4", PKIndex: 0},
		{Name: "name", Type: "text", PKIndex: -1},
	})

	shape, err := New("users",
		WithSchema("public"),
		WithTableSchema(tableSchema),
	)
	require.NoError(t, err)

	filter := NewChangeFilter(shape)

	relation := &wal.RelationMessage{
		ID:        12345,
		Namespace: "public",
		Name:      "users",
		Columns: []wal.ColumnInfo{
			{Name: "id", IsKey: true},
			{Name: "name", IsKey: false},
		},
	}

	txOffset := offset.MustNew(100, 0)

	t.Run("all inserts match without WHERE", func(t *testing.T) {
		data := &wal.DataMessage{
			RelationID: 12345,
			NewValues: map[string]any{
				"id":   "1",
				"name": "Alice",
			},
		}

		result, err := filter.FilterChange(wal.MessageInsert, data, txOffset, relation, 100, false)
		require.NoError(t, err)
		assert.True(t, result.Matched)
		assert.Len(t, result.Items, 1)
	})
}

// TestChangeFilterColumnSelection tests column filtering.
func TestChangeFilterColumnSelection(t *testing.T) {
	tableSchema := schema.NewTableSchema("public", "users", []schema.Column{
		{Name: "id", Type: "int4", PKIndex: 0},
		{Name: "name", Type: "text", PKIndex: -1},
		{Name: "email", Type: "text", PKIndex: -1},
		{Name: "age", Type: "int4", PKIndex: -1},
	})

	shape, err := New("users",
		WithSchema("public"),
		WithColumns([]string{"name", "email"}), // Only name and email (+ implicit id)
		WithTableSchema(tableSchema),
	)
	require.NoError(t, err)

	filter := NewChangeFilter(shape)

	relation := &wal.RelationMessage{
		ID:        12345,
		Namespace: "public",
		Name:      "users",
		Columns: []wal.ColumnInfo{
			{Name: "id", IsKey: true},
			{Name: "name", IsKey: false},
			{Name: "email", IsKey: false},
			{Name: "age", IsKey: false},
		},
	}

	txOffset := offset.MustNew(100, 0)

	data := &wal.DataMessage{
		RelationID: 12345,
		NewValues: map[string]any{
			"id":    "1",
			"name":  "Alice",
			"email": "alice@example.com",
			"age":   "30",
		},
	}

	result, err := filter.FilterChange(wal.MessageInsert, data, txOffset, relation, 100, false)
	require.NoError(t, err)
	assert.True(t, result.Matched)
	assert.Len(t, result.Items, 1)

	// Check that only selected columns + PK are in the value
	value := result.Items[0].Op.Value
	assert.Contains(t, value, "id")    // PK always included
	assert.Contains(t, value, "name")  // Selected
	assert.Contains(t, value, "email") // Selected
	assert.NotContains(t, value, "age")
}

// TestChangeFilterReplicaModes tests replica mode handling.
func TestChangeFilterReplicaModes(t *testing.T) {
	tableSchema := schema.NewTableSchema("public", "users", []schema.Column{
		{Name: "id", Type: "int4", PKIndex: 0},
		{Name: "name", Type: "text", PKIndex: -1},
		{Name: "email", Type: "text", PKIndex: -1},
	})

	t.Run("default mode - delete only has PKs", func(t *testing.T) {
		shape, err := New("users",
			WithSchema("public"),
			WithReplica(ReplicaDefault),
			WithTableSchema(tableSchema),
		)
		require.NoError(t, err)

		filter := NewChangeFilter(shape)

		relation := &wal.RelationMessage{
			ID:        12345,
			Namespace: "public",
			Name:      "users",
			Columns: []wal.ColumnInfo{
				{Name: "id", IsKey: true},
				{Name: "name", IsKey: false},
				{Name: "email", IsKey: false},
			},
		}

		data := &wal.DataMessage{
			RelationID: 12345,
			OldValues: map[string]any{
				"id":    "1",
				"name":  "Alice",
				"email": "alice@example.com",
			},
		}

		result, err := filter.FilterChange(wal.MessageDelete, data, offset.MustNew(100, 0), relation, 100, false)
		require.NoError(t, err)
		assert.True(t, result.Matched)

		value := result.Items[0].Op.Value
		assert.Contains(t, value, "id")
		// In default mode, delete only has PKs
		assert.NotContains(t, value, "name")
		assert.NotContains(t, value, "email")
	})

	t.Run("full mode - delete has all columns", func(t *testing.T) {
		shape, err := New("users",
			WithSchema("public"),
			WithReplica(ReplicaFull),
			WithTableSchema(tableSchema),
		)
		require.NoError(t, err)

		filter := NewChangeFilter(shape)

		relation := &wal.RelationMessage{
			ID:        12345,
			Namespace: "public",
			Name:      "users",
			Columns: []wal.ColumnInfo{
				{Name: "id", IsKey: true},
				{Name: "name", IsKey: false},
				{Name: "email", IsKey: false},
			},
		}

		data := &wal.DataMessage{
			RelationID: 12345,
			OldValues: map[string]any{
				"id":    "1",
				"name":  "Alice",
				"email": "alice@example.com",
			},
		}

		result, err := filter.FilterChange(wal.MessageDelete, data, offset.MustNew(100, 0), relation, 100, false)
		require.NoError(t, err)
		assert.True(t, result.Matched)

		value := result.Items[0].Op.Value
		assert.Contains(t, value, "id")
		assert.Contains(t, value, "name")
		assert.Contains(t, value, "email")
	})
}

// TestShouldSkipTransaction tests duplicate filtering with pg_snapshot.
func TestShouldSkipTransaction(t *testing.T) {
	shape, err := New("users")
	require.NoError(t, err)

	handle := NewHandle(shape.Hash())
	stor := storagemem.NewDefault()

	consumer := NewConsumer(ConsumerConfig{
		Handle:  handle,
		Shape:   shape,
		Storage: stor,
	})

	// Without pg_snapshot, nothing should be skipped
	assert.False(t, consumer.ShouldSkipTransaction(100))

	// Set a pg_snapshot
	consumer.mu.Lock()
	consumer.pgSnapshot = &PgSnapshot{
		Xmin:       100,
		Xmax:       110,
		XipList:    []int64{102, 105},
		FilterTxns: true,
	}
	consumer.mu.Unlock()

	// Transactions < xmin are visible in snapshot, should be skipped
	assert.True(t, consumer.ShouldSkipTransaction(50))
	assert.True(t, consumer.ShouldSkipTransaction(99))

	// Transactions >= xmax are after snapshot, should NOT be skipped
	assert.False(t, consumer.ShouldSkipTransaction(110))
	assert.False(t, consumer.ShouldSkipTransaction(150))

	// Transactions in xip_list were in-progress, should NOT be skipped
	assert.False(t, consumer.ShouldSkipTransaction(102))
	assert.False(t, consumer.ShouldSkipTransaction(105))

	// Transactions between xmin and xmax not in xip_list are visible, should be skipped
	assert.True(t, consumer.ShouldSkipTransaction(101))
	assert.True(t, consumer.ShouldSkipTransaction(103))
	assert.True(t, consumer.ShouldSkipTransaction(104))
	assert.True(t, consumer.ShouldSkipTransaction(106))
}

// TestConsumerSetRelation tests caching relation messages.
func TestConsumerSetRelation(t *testing.T) {
	shape, err := New("users", WithSchema("public"))
	require.NoError(t, err)

	handle := NewHandle(shape.Hash())
	stor := storagemem.NewDefault()

	consumer := NewConsumer(ConsumerConfig{
		Handle:  handle,
		Shape:   shape,
		Storage: stor,
	})

	// Set a matching relation
	relation := &wal.RelationMessage{
		ID:        12345,
		Namespace: "public",
		Name:      "users",
	}

	consumer.SetRelation(relation)

	consumer.mu.RLock()
	cached, ok := consumer.relations[12345]
	consumer.mu.RUnlock()

	assert.True(t, ok)
	assert.Equal(t, relation, cached)

	// Change filter should also have the relation
	assert.True(t, consumer.changeFilter.MatchesRelationID(12345))
}

// TestConsumerProcessChangeNotActive tests processing changes before consumer is active.
func TestConsumerProcessChangeNotActive(t *testing.T) {
	shape, err := New("users")
	require.NoError(t, err)

	handle := NewHandle(shape.Hash())
	stor := storagemem.NewDefault()

	consumer := NewConsumer(ConsumerConfig{
		Handle:  handle,
		Shape:   shape,
		Storage: stor,
	})

	msg := &wal.Message{
		Type: wal.MessageInsert,
	}

	err = consumer.ProcessChange(context.Background(), msg, offset.MustNew(100, 0))
	assert.ErrorIs(t, err, ErrConsumerNotActive)
}

// TestConsumerProcessChangeStopped tests processing changes after consumer is stopped.
func TestConsumerProcessChangeStopped(t *testing.T) {
	shape, err := New("users")
	require.NoError(t, err)

	handle := NewHandle(shape.Hash())
	stor := storagemem.NewDefault()

	consumer := NewConsumer(ConsumerConfig{
		Handle:  handle,
		Shape:   shape,
		Storage: stor,
	})

	err = consumer.Stop()
	require.NoError(t, err)

	msg := &wal.Message{
		Type: wal.MessageInsert,
	}

	err = consumer.ProcessChange(context.Background(), msg, offset.MustNew(100, 0))
	assert.ErrorIs(t, err, ErrConsumerStopped)
}

// TestAnyMapToStringMap tests the conversion helper.
func TestAnyMapToStringMap(t *testing.T) {
	tests := []struct {
		name     string
		input    map[string]any
		expected map[string]string
	}{
		{
			name:     "nil input",
			input:    nil,
			expected: nil,
		},
		{
			name:     "empty input",
			input:    map[string]any{},
			expected: map[string]string{},
		},
		{
			name: "string values",
			input: map[string]any{
				"a": "hello",
				"b": "world",
			},
			expected: map[string]string{
				"a": "hello",
				"b": "world",
			},
		},
		{
			name: "mixed types",
			input: map[string]any{
				"string": "hello",
				"int":    42,
				"bool":   true,
				"float":  3.14,
			},
			expected: map[string]string{
				"string": "hello",
				"int":    "42",
				"bool":   "true",
				"float":  "3.14",
			},
		},
		{
			name: "nil values are skipped",
			input: map[string]any{
				"a":   "hello",
				"nil": nil,
			},
			expected: map[string]string{
				"a": "hello",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := anyMapToStringMap(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

// TestGetPKColumns tests extracting PK columns from a relation.
func TestGetPKColumns(t *testing.T) {
	tests := []struct {
		name     string
		relation *wal.RelationMessage
		expected []string
	}{
		{
			name: "single PK",
			relation: &wal.RelationMessage{
				Columns: []wal.ColumnInfo{
					{Name: "id", IsKey: true},
					{Name: "name", IsKey: false},
				},
			},
			expected: []string{"id"},
		},
		{
			name: "composite PK",
			relation: &wal.RelationMessage{
				Columns: []wal.ColumnInfo{
					{Name: "org_id", IsKey: true},
					{Name: "user_id", IsKey: true},
					{Name: "name", IsKey: false},
				},
			},
			expected: []string{"org_id", "user_id"},
		},
		{
			name: "no PK",
			relation: &wal.RelationMessage{
				Columns: []wal.ColumnInfo{
					{Name: "col1", IsKey: false},
					{Name: "col2", IsKey: false},
				},
			},
			expected: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := getPKColumns(tt.relation)
			assert.Equal(t, tt.expected, result)
		})
	}
}

// TestGetChangedColumns tests detecting changed columns.
func TestGetChangedColumns(t *testing.T) {
	tests := []struct {
		name     string
		oldValue map[string]string
		newValue map[string]string
		expected []string
	}{
		{
			name:     "no changes",
			oldValue: map[string]string{"a": "1", "b": "2"},
			newValue: map[string]string{"a": "1", "b": "2"},
			expected: nil,
		},
		{
			name:     "one change",
			oldValue: map[string]string{"a": "1", "b": "2"},
			newValue: map[string]string{"a": "1", "b": "3"},
			expected: []string{"b"},
		},
		{
			name:     "new column",
			oldValue: map[string]string{"a": "1"},
			newValue: map[string]string{"a": "1", "b": "2"},
			expected: []string{"b"},
		},
		{
			name:     "all changed",
			oldValue: map[string]string{"a": "1", "b": "2"},
			newValue: map[string]string{"a": "10", "b": "20"},
			expected: []string{"a", "b"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := getChangedColumns(tt.oldValue, tt.newValue)
			assert.ElementsMatch(t, tt.expected, result)
		})
	}
}

// TestGetChangedOldValues tests getting old values of changed columns.
func TestGetChangedOldValues(t *testing.T) {
	tests := []struct {
		name     string
		oldValue map[string]string
		newValue map[string]string
		expected map[string]string
	}{
		{
			name:     "no changes",
			oldValue: map[string]string{"a": "1", "b": "2"},
			newValue: map[string]string{"a": "1", "b": "2"},
			expected: nil,
		},
		{
			name:     "one change",
			oldValue: map[string]string{"a": "1", "b": "2"},
			newValue: map[string]string{"a": "1", "b": "3"},
			expected: map[string]string{"b": "2"},
		},
		{
			name:     "multiple changes",
			oldValue: map[string]string{"a": "1", "b": "2", "c": "3"},
			newValue: map[string]string{"a": "10", "b": "2", "c": "30"},
			expected: map[string]string{"a": "1", "c": "3"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := getChangedOldValues(tt.oldValue, tt.newValue)
			assert.Equal(t, tt.expected, result)
		})
	}
}

// TestFilterColumnsString tests shape column filtering.
func TestFilterColumnsString(t *testing.T) {
	t.Run("no column selection - returns all", func(t *testing.T) {
		shape, err := New("users")
		require.NoError(t, err)

		record := map[string]string{"a": "1", "b": "2", "c": "3"}
		result := shape.FilterColumnsString(record, []string{"a"})

		assert.Equal(t, record, result)
	})

	t.Run("with column selection - filters", func(t *testing.T) {
		shape, err := New("users", WithColumns([]string{"b", "c"}))
		require.NoError(t, err)

		record := map[string]string{"a": "1", "b": "2", "c": "3", "d": "4"}
		result := shape.FilterColumnsString(record, []string{"a"}) // a is PK

		assert.Contains(t, result, "a") // PK included
		assert.Contains(t, result, "b") // Selected
		assert.Contains(t, result, "c") // Selected
		assert.NotContains(t, result, "d")
	})
}

// TestConvertColumnsToStorageFormat tests column conversion.
func TestConvertColumnsToStorageFormat(t *testing.T) {
	t.Run("nil input", func(t *testing.T) {
		result := convertColumnsToStorageFormat(nil)
		assert.Nil(t, result)
	})

	t.Run("with columns", func(t *testing.T) {
		ts := schema.NewTableSchema("public", "users", []schema.Column{
			{Name: "id", Type: "int4", PKIndex: 0, NotNull: true},
			{Name: "name", Type: "text", PKIndex: -1, NotNull: false},
		})

		result := convertColumnsToStorageFormat(ts)

		require.Len(t, result, 2)
		assert.Equal(t, "id", result[0].Name)
		assert.Equal(t, "int4", result[0].Type)
		assert.Equal(t, 0, result[0].PKIndex)
		assert.True(t, result[0].NotNull)

		assert.Equal(t, "name", result[1].Name)
		assert.Equal(t, "text", result[1].Type)
		assert.Equal(t, -1, result[1].PKIndex)
		assert.False(t, result[1].NotNull)
	})
}

// Benchmarks

func BenchmarkChangeFilterInsert(b *testing.B) {
	tableSchema := schema.NewTableSchema("public", "users", []schema.Column{
		{Name: "id", Type: "int4", PKIndex: 0},
		{Name: "name", Type: "text", PKIndex: -1},
		{Name: "active", Type: "bool", PKIndex: -1},
	})

	shape, _ := New("users",
		WithSchema("public"),
		WithWhere("active = true"),
		WithTableSchema(tableSchema),
	)

	filter := NewChangeFilter(shape)

	relation := &wal.RelationMessage{
		ID:        12345,
		Namespace: "public",
		Name:      "users",
		Columns: []wal.ColumnInfo{
			{Name: "id", IsKey: true},
			{Name: "name", IsKey: false},
			{Name: "active", IsKey: false},
		},
	}

	data := &wal.DataMessage{
		RelationID: 12345,
		NewValues: map[string]any{
			"id":     "1",
			"name":   "Alice",
			"active": "true",
		},
	}

	txOffset := offset.MustNew(100, 0)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = filter.FilterChange(wal.MessageInsert, data, txOffset, relation, 100, false)
	}
}

func BenchmarkChangeFilterUpdate(b *testing.B) {
	tableSchema := schema.NewTableSchema("public", "users", []schema.Column{
		{Name: "id", Type: "int4", PKIndex: 0},
		{Name: "name", Type: "text", PKIndex: -1},
		{Name: "active", Type: "bool", PKIndex: -1},
	})

	shape, _ := New("users",
		WithSchema("public"),
		WithWhere("active = true"),
		WithTableSchema(tableSchema),
	)

	filter := NewChangeFilter(shape)

	relation := &wal.RelationMessage{
		ID:        12345,
		Namespace: "public",
		Name:      "users",
		Columns: []wal.ColumnInfo{
			{Name: "id", IsKey: true},
			{Name: "name", IsKey: false},
			{Name: "active", IsKey: false},
		},
	}

	data := &wal.DataMessage{
		RelationID: 12345,
		OldValues: map[string]any{
			"id":     "1",
			"name":   "Alice",
			"active": "true",
		},
		NewValues: map[string]any{
			"id":     "1",
			"name":   "Alice Smith",
			"active": "true",
		},
	}

	txOffset := offset.MustNew(100, 0)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = filter.FilterChange(wal.MessageUpdate, data, txOffset, relation, 100, false)
	}
}
