package replication

import (
	"context"
	"testing"
	"time"

	"github.com/electric-sql/electric/packages/sync-service-go/pkg/offset"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/wal"
	"github.com/jackc/pglogrepl"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockConsumer is a test implementation of Consumer.
type mockConsumer struct {
	handle  string
	schema  string
	table   string
	changes []*Change
	err     error
}

func newMockConsumer(handle, schema, table string) *mockConsumer {
	return &mockConsumer{
		handle:  handle,
		schema:  schema,
		table:   table,
		changes: make([]*Change, 0),
	}
}

func (c *mockConsumer) ProcessChange(ctx context.Context, change *Change) error {
	if c.err != nil {
		return c.err
	}
	c.changes = append(c.changes, change)
	return nil
}

func (c *mockConsumer) GetHandle() string {
	return c.handle
}

func (c *mockConsumer) GetTable() (schema, table string) {
	return c.schema, c.table
}

func (c *mockConsumer) reset() {
	c.changes = make([]*Change, 0)
}

// TestNewCollector tests collector creation.
func TestNewCollector(t *testing.T) {
	collector := NewCollector()
	require.NotNil(t, collector)

	assert.Equal(t, 0, collector.GetConsumerCount())
	assert.Equal(t, offset.InitialOffset, collector.GetOffset())
	assert.False(t, collector.IsInTransaction())
}

// TestRegisterUnregisterConsumer tests consumer registration and unregistration.
func TestRegisterUnregisterConsumer(t *testing.T) {
	collector := NewCollector()

	consumer := newMockConsumer("handle-1", "public", "users")

	// Register consumer
	collector.RegisterConsumer("handle-1", consumer)
	assert.Equal(t, 1, collector.GetConsumerCount())
	assert.True(t, collector.HasConsumer("handle-1"))

	// Check table index
	handles := collector.GetConsumersForTable("public", "users")
	assert.Contains(t, handles, "handle-1")

	// Unregister consumer
	collector.UnregisterConsumer("handle-1")
	assert.Equal(t, 0, collector.GetConsumerCount())
	assert.False(t, collector.HasConsumer("handle-1"))

	// Check table index is cleaned up
	handles = collector.GetConsumersForTable("public", "users")
	assert.Empty(t, handles)
}

// TestRegisterMultipleConsumersSameTable tests multiple consumers on the same table.
func TestRegisterMultipleConsumersSameTable(t *testing.T) {
	collector := NewCollector()

	consumer1 := newMockConsumer("handle-1", "public", "users")
	consumer2 := newMockConsumer("handle-2", "public", "users")

	collector.RegisterConsumer("handle-1", consumer1)
	collector.RegisterConsumer("handle-2", consumer2)

	assert.Equal(t, 2, collector.GetConsumerCount())

	handles := collector.GetConsumersForTable("public", "users")
	assert.Len(t, handles, 2)
	assert.Contains(t, handles, "handle-1")
	assert.Contains(t, handles, "handle-2")
}

// TestRegisterConsumersDifferentTables tests consumers on different tables.
func TestRegisterConsumersDifferentTables(t *testing.T) {
	collector := NewCollector()

	consumer1 := newMockConsumer("handle-1", "public", "users")
	consumer2 := newMockConsumer("handle-2", "public", "orders")

	collector.RegisterConsumer("handle-1", consumer1)
	collector.RegisterConsumer("handle-2", consumer2)

	assert.Equal(t, 2, collector.GetConsumerCount())

	usersHandles := collector.GetConsumersForTable("public", "users")
	assert.Len(t, usersHandles, 1)
	assert.Contains(t, usersHandles, "handle-1")

	ordersHandles := collector.GetConsumersForTable("public", "orders")
	assert.Len(t, ordersHandles, 1)
	assert.Contains(t, ordersHandles, "handle-2")
}

// TestProcessRelationMessage tests relation message caching.
func TestProcessRelationMessage(t *testing.T) {
	collector := NewCollector()
	ctx := context.Background()

	msg := &wal.Message{
		Type: wal.MessageRelation,
		Relation: &wal.RelationMessage{
			ID:        16384,
			Namespace: "public",
			Name:      "users",
			Columns: []wal.ColumnInfo{
				{Name: "id", TypeOID: 23, IsKey: true},
				{Name: "name", TypeOID: 25, IsKey: false},
			},
		},
	}

	err := collector.Process(ctx, msg)
	require.NoError(t, err)

	assert.Equal(t, 1, collector.GetRelationCount())

	rel, ok := collector.GetRelation(16384)
	require.True(t, ok)
	assert.Equal(t, "public", rel.Namespace)
	assert.Equal(t, "users", rel.Name)
	assert.Len(t, rel.Columns, 2)
}

// TestProcessBeginCommit tests transaction begin and commit.
func TestProcessBeginCommit(t *testing.T) {
	collector := NewCollector()
	ctx := context.Background()

	// Begin message
	beginMsg := &wal.Message{
		Type:       wal.MessageBegin,
		LSN:        pglogrepl.LSN(100),
		Xid:        42,
		CommitTime: time.Now(),
	}

	err := collector.Process(ctx, beginMsg)
	require.NoError(t, err)
	assert.True(t, collector.IsInTransaction())
	assert.Equal(t, uint32(42), collector.GetCurrentTransactionXid())

	// Commit message
	commitMsg := &wal.Message{
		Type:      wal.MessageCommit,
		LSN:       pglogrepl.LSN(200),
		CommitLSN: pglogrepl.LSN(200),
	}

	err = collector.Process(ctx, commitMsg)
	require.NoError(t, err)
	assert.False(t, collector.IsInTransaction())
	assert.Equal(t, uint32(0), collector.GetCurrentTransactionXid())

	// Check offset was updated
	expectedOffset := offset.MustNew(200, 0)
	assert.Equal(t, expectedOffset, collector.GetOffset())
}

// TestProcessInsert tests insert change processing.
func TestProcessInsert(t *testing.T) {
	collector := NewCollector()
	ctx := context.Background()
	consumer := newMockConsumer("handle-1", "public", "users")
	collector.RegisterConsumer("handle-1", consumer)

	// Register relation first
	relMsg := &wal.Message{
		Type: wal.MessageRelation,
		Relation: &wal.RelationMessage{
			ID:        16384,
			Namespace: "public",
			Name:      "users",
			Columns: []wal.ColumnInfo{
				{Name: "id", TypeOID: 23, IsKey: true},
				{Name: "name", TypeOID: 25, IsKey: false},
			},
		},
	}
	err := collector.Process(ctx, relMsg)
	require.NoError(t, err)

	// Begin transaction
	err = collector.Process(ctx, &wal.Message{
		Type: wal.MessageBegin,
		LSN:  pglogrepl.LSN(100),
		Xid:  42,
	})
	require.NoError(t, err)

	// Insert message
	err = collector.Process(ctx, &wal.Message{
		Type: wal.MessageInsert,
		Data: &wal.DataMessage{
			RelationID: 16384,
			NewValues: map[string]any{
				"id":   "1",
				"name": "Alice",
			},
			ByteSize: 10,
		},
	})
	require.NoError(t, err)

	// Commit transaction
	err = collector.Process(ctx, &wal.Message{
		Type:      wal.MessageCommit,
		LSN:       pglogrepl.LSN(200),
		CommitLSN: pglogrepl.LSN(200),
	})
	require.NoError(t, err)

	// Verify consumer received the change
	require.Len(t, consumer.changes, 1)
	change := consumer.changes[0]
	assert.Equal(t, ChangeInsert, change.Type)
	assert.Equal(t, [2]string{"public", "users"}, change.Relation)
	assert.Equal(t, uint32(42), change.Xid)
	assert.Equal(t, "1", change.NewRecord["id"])
	assert.Equal(t, "Alice", change.NewRecord["name"])
	assert.True(t, change.IsLast)
}

// TestProcessUpdate tests update change processing.
func TestProcessUpdate(t *testing.T) {
	collector := NewCollector()
	ctx := context.Background()
	consumer := newMockConsumer("handle-1", "public", "users")
	collector.RegisterConsumer("handle-1", consumer)

	// Register relation
	err := collector.Process(ctx, &wal.Message{
		Type: wal.MessageRelation,
		Relation: &wal.RelationMessage{
			ID:        16384,
			Namespace: "public",
			Name:      "users",
			Columns: []wal.ColumnInfo{
				{Name: "id", TypeOID: 23, IsKey: true},
				{Name: "name", TypeOID: 25, IsKey: false},
			},
		},
	})
	require.NoError(t, err)

	// Begin transaction
	err = collector.Process(ctx, &wal.Message{
		Type: wal.MessageBegin,
		LSN:  pglogrepl.LSN(100),
		Xid:  42,
	})
	require.NoError(t, err)

	// Update message with old values (REPLICA IDENTITY FULL)
	err = collector.Process(ctx, &wal.Message{
		Type: wal.MessageUpdate,
		Data: &wal.DataMessage{
			RelationID: 16384,
			NewValues: map[string]any{
				"id":   "1",
				"name": "Bob",
			},
			OldValues: map[string]any{
				"id":   "1",
				"name": "Alice",
			},
			ByteSize: 20,
		},
	})
	require.NoError(t, err)

	// Commit transaction
	err = collector.Process(ctx, &wal.Message{
		Type:      wal.MessageCommit,
		LSN:       pglogrepl.LSN(200),
		CommitLSN: pglogrepl.LSN(200),
	})
	require.NoError(t, err)

	// Verify consumer received the change
	require.Len(t, consumer.changes, 1)
	change := consumer.changes[0]
	assert.Equal(t, ChangeUpdate, change.Type)
	assert.Equal(t, "Bob", change.NewRecord["name"])
	assert.Equal(t, "Alice", change.OldRecord["name"])
}

// TestProcessDelete tests delete change processing.
func TestProcessDelete(t *testing.T) {
	collector := NewCollector()
	ctx := context.Background()
	consumer := newMockConsumer("handle-1", "public", "users")
	collector.RegisterConsumer("handle-1", consumer)

	// Register relation
	err := collector.Process(ctx, &wal.Message{
		Type: wal.MessageRelation,
		Relation: &wal.RelationMessage{
			ID:        16384,
			Namespace: "public",
			Name:      "users",
			Columns: []wal.ColumnInfo{
				{Name: "id", TypeOID: 23, IsKey: true},
				{Name: "name", TypeOID: 25, IsKey: false},
			},
		},
	})
	require.NoError(t, err)

	// Begin transaction
	err = collector.Process(ctx, &wal.Message{
		Type: wal.MessageBegin,
		LSN:  pglogrepl.LSN(100),
		Xid:  42,
	})
	require.NoError(t, err)

	// Delete message
	err = collector.Process(ctx, &wal.Message{
		Type: wal.MessageDelete,
		Data: &wal.DataMessage{
			RelationID: 16384,
			OldValues: map[string]any{
				"id":   "1",
				"name": "Alice",
			},
			ByteSize: 10,
		},
	})
	require.NoError(t, err)

	// Commit transaction
	err = collector.Process(ctx, &wal.Message{
		Type:      wal.MessageCommit,
		LSN:       pglogrepl.LSN(200),
		CommitLSN: pglogrepl.LSN(200),
	})
	require.NoError(t, err)

	// Verify consumer received the change
	require.Len(t, consumer.changes, 1)
	change := consumer.changes[0]
	assert.Equal(t, ChangeDelete, change.Type)
	assert.Nil(t, change.NewRecord)
	assert.Equal(t, "1", change.OldRecord["id"])
	assert.Equal(t, "Alice", change.OldRecord["name"])
}

// TestProcessMultipleChangesInTransaction tests multiple changes in one transaction.
func TestProcessMultipleChangesInTransaction(t *testing.T) {
	collector := NewCollector()
	ctx := context.Background()
	consumer := newMockConsumer("handle-1", "public", "users")
	collector.RegisterConsumer("handle-1", consumer)

	// Register relation
	err := collector.Process(ctx, &wal.Message{
		Type: wal.MessageRelation,
		Relation: &wal.RelationMessage{
			ID:        16384,
			Namespace: "public",
			Name:      "users",
			Columns: []wal.ColumnInfo{
				{Name: "id", TypeOID: 23, IsKey: true},
				{Name: "name", TypeOID: 25, IsKey: false},
			},
		},
	})
	require.NoError(t, err)

	// Begin transaction
	err = collector.Process(ctx, &wal.Message{
		Type: wal.MessageBegin,
		LSN:  pglogrepl.LSN(100),
		Xid:  42,
	})
	require.NoError(t, err)

	// First insert
	err = collector.Process(ctx, &wal.Message{
		Type: wal.MessageInsert,
		Data: &wal.DataMessage{
			RelationID: 16384,
			NewValues:  map[string]any{"id": "1", "name": "Alice"},
		},
	})
	require.NoError(t, err)

	// Second insert
	err = collector.Process(ctx, &wal.Message{
		Type: wal.MessageInsert,
		Data: &wal.DataMessage{
			RelationID: 16384,
			NewValues:  map[string]any{"id": "2", "name": "Bob"},
		},
	})
	require.NoError(t, err)

	// Third insert
	err = collector.Process(ctx, &wal.Message{
		Type: wal.MessageInsert,
		Data: &wal.DataMessage{
			RelationID: 16384,
			NewValues:  map[string]any{"id": "3", "name": "Charlie"},
		},
	})
	require.NoError(t, err)

	// Commit transaction
	err = collector.Process(ctx, &wal.Message{
		Type:      wal.MessageCommit,
		LSN:       pglogrepl.LSN(200),
		CommitLSN: pglogrepl.LSN(200),
	})
	require.NoError(t, err)

	// Verify consumer received all changes
	require.Len(t, consumer.changes, 3)

	// Check offsets are sequential
	for i, change := range consumer.changes {
		assert.Equal(t, int64(100), change.Offset.TxOffset) // All in same txn
		assert.Equal(t, int64(i), change.Offset.OpOffset)   // Sequential op offsets
	}

	// Only the last should have IsLast set
	assert.False(t, consumer.changes[0].IsLast)
	assert.False(t, consumer.changes[1].IsLast)
	assert.True(t, consumer.changes[2].IsLast)
}

// TestDispatchToMultipleConsumers tests that changes are dispatched to all relevant consumers.
func TestDispatchToMultipleConsumers(t *testing.T) {
	collector := NewCollector()
	ctx := context.Background()

	consumer1 := newMockConsumer("handle-1", "public", "users")
	consumer2 := newMockConsumer("handle-2", "public", "users")
	consumer3 := newMockConsumer("handle-3", "public", "orders")

	collector.RegisterConsumer("handle-1", consumer1)
	collector.RegisterConsumer("handle-2", consumer2)
	collector.RegisterConsumer("handle-3", consumer3)

	// Register users relation
	err := collector.Process(ctx, &wal.Message{
		Type: wal.MessageRelation,
		Relation: &wal.RelationMessage{
			ID:        16384,
			Namespace: "public",
			Name:      "users",
		},
	})
	require.NoError(t, err)

	// Begin, insert, commit
	err = collector.Process(ctx, &wal.Message{Type: wal.MessageBegin, LSN: pglogrepl.LSN(100), Xid: 42})
	require.NoError(t, err)

	err = collector.Process(ctx, &wal.Message{
		Type: wal.MessageInsert,
		Data: &wal.DataMessage{
			RelationID: 16384,
			NewValues:  map[string]any{"id": "1", "name": "Alice"},
		},
	})
	require.NoError(t, err)

	err = collector.Process(ctx, &wal.Message{Type: wal.MessageCommit, LSN: pglogrepl.LSN(200)})
	require.NoError(t, err)

	// Both users consumers should receive the change
	assert.Len(t, consumer1.changes, 1)
	assert.Len(t, consumer2.changes, 1)
	// Orders consumer should not receive it
	assert.Len(t, consumer3.changes, 0)
}

// TestNoConsumersForTable tests that changes are dropped when no consumers exist.
func TestNoConsumersForTable(t *testing.T) {
	collector := NewCollector()
	ctx := context.Background()

	// Register a relation but no consumer
	err := collector.Process(ctx, &wal.Message{
		Type: wal.MessageRelation,
		Relation: &wal.RelationMessage{
			ID:        16384,
			Namespace: "public",
			Name:      "users",
		},
	})
	require.NoError(t, err)

	// Begin, insert, commit
	err = collector.Process(ctx, &wal.Message{Type: wal.MessageBegin, LSN: pglogrepl.LSN(100), Xid: 42})
	require.NoError(t, err)

	err = collector.Process(ctx, &wal.Message{
		Type: wal.MessageInsert,
		Data: &wal.DataMessage{
			RelationID: 16384,
			NewValues:  map[string]any{"id": "1"},
		},
	})
	require.NoError(t, err)

	err = collector.Process(ctx, &wal.Message{Type: wal.MessageCommit, LSN: pglogrepl.LSN(200)})
	require.NoError(t, err)

	// No error should occur
}

// TestProcessTruncate tests truncate message processing.
func TestProcessTruncate(t *testing.T) {
	collector := NewCollector()
	ctx := context.Background()
	consumer := newMockConsumer("handle-1", "public", "users")
	collector.RegisterConsumer("handle-1", consumer)

	// Register relation
	err := collector.Process(ctx, &wal.Message{
		Type: wal.MessageRelation,
		Relation: &wal.RelationMessage{
			ID:        16384,
			Namespace: "public",
			Name:      "users",
		},
	})
	require.NoError(t, err)

	// Begin transaction
	err = collector.Process(ctx, &wal.Message{Type: wal.MessageBegin, LSN: pglogrepl.LSN(100), Xid: 42})
	require.NoError(t, err)

	// Truncate message
	err = collector.Process(ctx, &wal.Message{
		Type:                wal.MessageTruncate,
		TruncateRelationIDs: []uint32{16384},
	})
	require.NoError(t, err)

	// Commit transaction
	err = collector.Process(ctx, &wal.Message{Type: wal.MessageCommit, LSN: pglogrepl.LSN(200)})
	require.NoError(t, err)

	// Verify consumer received the truncate
	require.Len(t, consumer.changes, 1)
	change := consumer.changes[0]
	assert.Equal(t, ChangeTruncate, change.Type)
	assert.Equal(t, [2]string{"public", "users"}, change.Relation)
}

// TestTransaction tests the Transaction type directly.
func TestTransaction(t *testing.T) {
	txn := NewTransaction(42, pglogrepl.LSN(1000))

	assert.Equal(t, uint32(42), txn.Xid)
	assert.Equal(t, pglogrepl.LSN(1000), txn.LSN)
	assert.Equal(t, int64(0), txn.OpCounter)
	assert.Empty(t, txn.Changes)

	// Test NextOffset
	off1 := txn.NextOffset()
	assert.Equal(t, int64(1000), off1.TxOffset)
	assert.Equal(t, int64(0), off1.OpOffset)

	off2 := txn.NextOffset()
	assert.Equal(t, int64(1000), off2.TxOffset)
	assert.Equal(t, int64(1), off2.OpOffset)

	// Test AddChange
	change := &Change{
		Type:       ChangeInsert,
		RelationID: 16384,
	}
	txn.AddChange(change)

	assert.Len(t, txn.Changes, 1)
	_, ok := txn.AffectedRelations[16384]
	assert.True(t, ok)
}

// TestClearRelations tests clearing the relation cache.
func TestClearRelations(t *testing.T) {
	collector := NewCollector()
	ctx := context.Background()

	// Register a relation
	err := collector.Process(ctx, &wal.Message{
		Type: wal.MessageRelation,
		Relation: &wal.RelationMessage{
			ID:        16384,
			Namespace: "public",
			Name:      "users",
		},
	})
	require.NoError(t, err)

	assert.Equal(t, 1, collector.GetRelationCount())

	// Clear relations
	collector.ClearRelations()

	assert.Equal(t, 0, collector.GetRelationCount())
	_, ok := collector.GetRelation(16384)
	assert.False(t, ok)
}

// TestProcessNilMessage tests that nil messages are handled gracefully.
func TestProcessNilMessage(t *testing.T) {
	collector := NewCollector()
	ctx := context.Background()

	err := collector.Process(ctx, nil)
	require.NoError(t, err)
}

// TestProcessUnknownRelationID tests error handling for unknown relation IDs.
func TestProcessUnknownRelationID(t *testing.T) {
	collector := NewCollector()
	ctx := context.Background()

	// Begin transaction
	err := collector.Process(ctx, &wal.Message{Type: wal.MessageBegin, LSN: pglogrepl.LSN(100), Xid: 42})
	require.NoError(t, err)

	// Insert with unknown relation ID
	err = collector.Process(ctx, &wal.Message{
		Type: wal.MessageInsert,
		Data: &wal.DataMessage{
			RelationID: 99999,
			NewValues:  map[string]any{"id": "1"},
		},
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unknown relation ID")
}

// TestProcessInsertOutsideTransaction tests error handling for messages outside transactions.
func TestProcessInsertOutsideTransaction(t *testing.T) {
	collector := NewCollector()
	ctx := context.Background()

	// Register relation
	err := collector.Process(ctx, &wal.Message{
		Type: wal.MessageRelation,
		Relation: &wal.RelationMessage{
			ID:        16384,
			Namespace: "public",
			Name:      "users",
		},
	})
	require.NoError(t, err)

	// Insert without begin
	err = collector.Process(ctx, &wal.Message{
		Type: wal.MessageInsert,
		Data: &wal.DataMessage{
			RelationID: 16384,
			NewValues:  map[string]any{"id": "1"},
		},
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "outside of transaction")
}

// TestChangeTypeString tests ChangeType string conversion.
func TestChangeTypeString(t *testing.T) {
	assert.Equal(t, "insert", ChangeInsert.String())
	assert.Equal(t, "update", ChangeUpdate.String())
	assert.Equal(t, "delete", ChangeDelete.String())
	assert.Equal(t, "truncate", ChangeTruncate.String())
	assert.Equal(t, "unknown", ChangeType(99).String())
}

// TestUnregisterNonexistentConsumer tests that unregistering a non-existent consumer is safe.
func TestUnregisterNonexistentConsumer(t *testing.T) {
	collector := NewCollector()

	// Should not panic
	collector.UnregisterConsumer("nonexistent")
	assert.Equal(t, 0, collector.GetConsumerCount())
}

// TestMultipleRelationsSameTransaction tests changes to multiple tables in one transaction.
func TestMultipleRelationsSameTransaction(t *testing.T) {
	collector := NewCollector()
	ctx := context.Background()

	usersConsumer := newMockConsumer("users-handle", "public", "users")
	ordersConsumer := newMockConsumer("orders-handle", "public", "orders")

	collector.RegisterConsumer("users-handle", usersConsumer)
	collector.RegisterConsumer("orders-handle", ordersConsumer)

	// Register both relations
	err := collector.Process(ctx, &wal.Message{
		Type: wal.MessageRelation,
		Relation: &wal.RelationMessage{
			ID:        16384,
			Namespace: "public",
			Name:      "users",
		},
	})
	require.NoError(t, err)

	err = collector.Process(ctx, &wal.Message{
		Type: wal.MessageRelation,
		Relation: &wal.RelationMessage{
			ID:        16385,
			Namespace: "public",
			Name:      "orders",
		},
	})
	require.NoError(t, err)

	// Begin transaction
	err = collector.Process(ctx, &wal.Message{Type: wal.MessageBegin, LSN: pglogrepl.LSN(100), Xid: 42})
	require.NoError(t, err)

	// Insert into users
	err = collector.Process(ctx, &wal.Message{
		Type: wal.MessageInsert,
		Data: &wal.DataMessage{
			RelationID: 16384,
			NewValues:  map[string]any{"id": "1", "name": "Alice"},
		},
	})
	require.NoError(t, err)

	// Insert into orders
	err = collector.Process(ctx, &wal.Message{
		Type: wal.MessageInsert,
		Data: &wal.DataMessage{
			RelationID: 16385,
			NewValues:  map[string]any{"id": "100", "user_id": "1"},
		},
	})
	require.NoError(t, err)

	// Commit transaction
	err = collector.Process(ctx, &wal.Message{Type: wal.MessageCommit, LSN: pglogrepl.LSN(200)})
	require.NoError(t, err)

	// Each consumer should receive only their table's changes
	assert.Len(t, usersConsumer.changes, 1)
	assert.Len(t, ordersConsumer.changes, 1)

	assert.Equal(t, "Alice", usersConsumer.changes[0].NewRecord["name"])
	assert.Equal(t, "100", ordersConsumer.changes[0].NewRecord["id"])
}

// TestUpdateWithChangedKeyOldValues tests update with key changes.
func TestUpdateWithChangedKeyOldValues(t *testing.T) {
	collector := NewCollector()
	ctx := context.Background()
	consumer := newMockConsumer("handle-1", "public", "users")
	collector.RegisterConsumer("handle-1", consumer)

	// Register relation
	err := collector.Process(ctx, &wal.Message{
		Type: wal.MessageRelation,
		Relation: &wal.RelationMessage{
			ID:        16384,
			Namespace: "public",
			Name:      "users",
		},
	})
	require.NoError(t, err)

	// Begin transaction
	err = collector.Process(ctx, &wal.Message{Type: wal.MessageBegin, LSN: pglogrepl.LSN(100), Xid: 42})
	require.NoError(t, err)

	// Update with changed key (no OldValues, but has ChangedKeyOldValues)
	err = collector.Process(ctx, &wal.Message{
		Type: wal.MessageUpdate,
		Data: &wal.DataMessage{
			RelationID: 16384,
			NewValues:  map[string]any{"id": "2", "name": "Alice"},
			ChangedKeyOldValues: map[string]any{
				"id": "1", // Old key value
			},
		},
	})
	require.NoError(t, err)

	// Commit
	err = collector.Process(ctx, &wal.Message{Type: wal.MessageCommit, LSN: pglogrepl.LSN(200)})
	require.NoError(t, err)

	// Verify old record contains the changed key values
	require.Len(t, consumer.changes, 1)
	change := consumer.changes[0]
	assert.Equal(t, "1", change.OldRecord["id"])
	assert.Equal(t, "2", change.NewRecord["id"])
}

// TestDeleteWithChangedKeyOldValues tests delete with key-only old values.
func TestDeleteWithChangedKeyOldValues(t *testing.T) {
	collector := NewCollector()
	ctx := context.Background()
	consumer := newMockConsumer("handle-1", "public", "users")
	collector.RegisterConsumer("handle-1", consumer)

	// Register relation
	err := collector.Process(ctx, &wal.Message{
		Type: wal.MessageRelation,
		Relation: &wal.RelationMessage{
			ID:        16384,
			Namespace: "public",
			Name:      "users",
		},
	})
	require.NoError(t, err)

	// Begin transaction
	err = collector.Process(ctx, &wal.Message{Type: wal.MessageBegin, LSN: pglogrepl.LSN(100), Xid: 42})
	require.NoError(t, err)

	// Delete with key-only old values (default replica identity)
	err = collector.Process(ctx, &wal.Message{
		Type: wal.MessageDelete,
		Data: &wal.DataMessage{
			RelationID:          16384,
			ChangedKeyOldValues: map[string]any{"id": "1"},
		},
	})
	require.NoError(t, err)

	// Commit
	err = collector.Process(ctx, &wal.Message{Type: wal.MessageCommit, LSN: pglogrepl.LSN(200)})
	require.NoError(t, err)

	// Verify old record contains the key values
	require.Len(t, consumer.changes, 1)
	change := consumer.changes[0]
	assert.Equal(t, "1", change.OldRecord["id"])
}

// TestCommitWithoutBegin tests that commit without begin is handled gracefully.
func TestCommitWithoutBegin(t *testing.T) {
	collector := NewCollector()
	ctx := context.Background()

	// Commit without begin - should not error
	err := collector.Process(ctx, &wal.Message{
		Type:      wal.MessageCommit,
		LSN:       pglogrepl.LSN(200),
		CommitLSN: pglogrepl.LSN(200),
	})
	require.NoError(t, err)
}
