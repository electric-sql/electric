// Package replication provides components for PostgreSQL logical replication.
// The Collector dispatches WAL changes to shape consumers.
//
// Ported from: lib/electric/replication/shape_log_collector.ex
package replication

import (
	"context"
	"fmt"
	"sync"

	"github.com/electric-sql/electric/packages/sync-service-go/pkg/offset"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/wal"
	"github.com/jackc/pglogrepl"
)

// Consumer is an interface for shape consumers that receive WAL changes.
// Implementations process changes relevant to their shape definition.
type Consumer interface {
	// ProcessChange processes a single WAL change.
	// The offset indicates the position in the log.
	// Returns an error if processing fails.
	ProcessChange(ctx context.Context, change *Change) error

	// GetHandle returns the shape handle this consumer is for.
	GetHandle() string

	// GetTable returns the (schema, table) this consumer is interested in.
	// Returns empty strings if interested in all tables.
	GetTable() (schema, table string)
}

// Change represents a change to be dispatched to consumers.
type Change struct {
	// Type is the operation type (insert, update, delete).
	Type ChangeType
	// Offset is the log offset for this change.
	Offset offset.LogOffset
	// Relation is the (schema, table) of the affected table.
	Relation [2]string
	// RelationID is the PostgreSQL relation OID.
	RelationID uint32
	// NewRecord contains new values for insert/update.
	NewRecord map[string]any
	// OldRecord contains old values for update/delete.
	OldRecord map[string]any
	// Xid is the transaction ID.
	Xid uint32
	// IsLast indicates if this is the last change in the transaction.
	IsLast bool
	// ByteSize is the size of the change in bytes.
	ByteSize int
}

// ChangeType represents the type of a data change.
type ChangeType int

const (
	// ChangeInsert is an insert operation.
	ChangeInsert ChangeType = iota
	// ChangeUpdate is an update operation.
	ChangeUpdate
	// ChangeDelete is a delete operation.
	ChangeDelete
	// ChangeTruncate is a truncate operation.
	ChangeTruncate
)

// String returns a string representation of the ChangeType.
func (ct ChangeType) String() string {
	switch ct {
	case ChangeInsert:
		return "insert"
	case ChangeUpdate:
		return "update"
	case ChangeDelete:
		return "delete"
	case ChangeTruncate:
		return "truncate"
	default:
		return "unknown"
	}
}

// Transaction holds state for the current transaction.
type Transaction struct {
	// Xid is the PostgreSQL transaction ID.
	Xid uint32
	// LSN is the commit LSN of the transaction.
	LSN pglogrepl.LSN
	// Offset is the log offset for this transaction.
	Offset offset.LogOffset
	// OpCounter is a counter for generating unique op offsets within the transaction.
	OpCounter int64
	// Changes accumulates changes within this transaction.
	Changes []*Change
	// AffectedRelations tracks which relation IDs are affected.
	AffectedRelations map[uint32]struct{}
}

// NewTransaction creates a new transaction with the given Xid and LSN.
func NewTransaction(xid uint32, lsn pglogrepl.LSN) *Transaction {
	return &Transaction{
		Xid:               xid,
		LSN:               lsn,
		Offset:            offset.MustNew(int64(lsn), 0),
		OpCounter:         0,
		Changes:           make([]*Change, 0),
		AffectedRelations: make(map[uint32]struct{}),
	}
}

// NextOffset returns the next offset within the transaction and increments the counter.
func (t *Transaction) NextOffset() offset.LogOffset {
	off := offset.MustNew(int64(t.LSN), t.OpCounter)
	t.OpCounter++
	return off
}

// AddChange adds a change to the transaction.
func (t *Transaction) AddChange(change *Change) {
	t.Changes = append(t.Changes, change)
	t.AffectedRelations[change.RelationID] = struct{}{}
}

// Collector dispatches WAL changes to shape consumers.
// It tracks transaction state and routes changes to relevant consumers
// based on the tables they are subscribed to.
type Collector struct {

	// consumers maps handle -> consumer
	consumers map[string]Consumer

	// tableIndex maps (schema, table) -> set of handles
	// This allows efficient lookup of consumers interested in a specific table.
	tableIndex map[[2]string]map[string]struct{}

	mu sync.RWMutex

	// currentTxn holds the state of the current transaction being processed.
	currentTxn *Transaction

	// relations caches relation metadata by relation ID.
	relations map[uint32]*wal.RelationMessage

	// currentOffset tracks the last processed offset.
	currentOffset offset.LogOffset
}

// NewCollector creates a new shape log collector.
func NewCollector() *Collector {
	return &Collector{
		consumers:     make(map[string]Consumer),
		tableIndex:    make(map[[2]string]map[string]struct{}),
		relations:     make(map[uint32]*wal.RelationMessage),
		currentOffset: offset.InitialOffset,
	}
}

// RegisterConsumer adds a consumer for a shape.
// The consumer will receive changes for its subscribed table.
func (c *Collector) RegisterConsumer(handle string, consumer Consumer) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Store the consumer
	c.consumers[handle] = consumer

	// Add to table index
	schema, table := consumer.GetTable()
	if schema != "" && table != "" {
		tableKey := [2]string{schema, table}
		if c.tableIndex[tableKey] == nil {
			c.tableIndex[tableKey] = make(map[string]struct{})
		}
		c.tableIndex[tableKey][handle] = struct{}{}
	}
}

// UnregisterConsumer removes a consumer.
func (c *Collector) UnregisterConsumer(handle string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	consumer, exists := c.consumers[handle]
	if !exists {
		return
	}

	// Remove from table index
	schema, table := consumer.GetTable()
	if schema != "" && table != "" {
		tableKey := [2]string{schema, table}
		if handles, ok := c.tableIndex[tableKey]; ok {
			delete(handles, handle)
			if len(handles) == 0 {
				delete(c.tableIndex, tableKey)
			}
		}
	}

	// Remove the consumer
	delete(c.consumers, handle)
}

// Process processes a WAL message.
// It dispatches data changes to relevant consumers based on the message type.
func (c *Collector) Process(ctx context.Context, msg *wal.Message) error {
	if msg == nil {
		return nil
	}

	switch msg.Type {
	case wal.MessageBegin:
		return c.handleBegin(msg)
	case wal.MessageCommit:
		return c.handleCommit(ctx, msg)
	case wal.MessageRelation:
		return c.handleRelation(msg)
	case wal.MessageInsert:
		return c.handleInsert(ctx, msg)
	case wal.MessageUpdate:
		return c.handleUpdate(ctx, msg)
	case wal.MessageDelete:
		return c.handleDelete(ctx, msg)
	case wal.MessageTruncate:
		return c.handleTruncate(ctx, msg)
	default:
		// Ignore other message types (Origin, Type, etc.)
		return nil
	}
}

// handleBegin processes a Begin message, starting a new transaction.
func (c *Collector) handleBegin(msg *wal.Message) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Start a new transaction
	c.currentTxn = NewTransaction(msg.Xid, msg.LSN)
	return nil
}

// handleCommit processes a Commit message, finalizing the transaction.
func (c *Collector) handleCommit(ctx context.Context, msg *wal.Message) error {
	c.mu.Lock()
	txn := c.currentTxn
	c.currentTxn = nil

	if txn == nil {
		c.mu.Unlock()
		return nil
	}

	// Update the current offset to the commit LSN
	commitOffset := offset.MustNew(int64(msg.LSN), 0)
	c.currentOffset = commitOffset
	c.mu.Unlock()

	// Mark the last change in the transaction
	if len(txn.Changes) > 0 {
		txn.Changes[len(txn.Changes)-1].IsLast = true
	}

	// Dispatch all changes to consumers
	return c.dispatchChanges(ctx, txn)
}

// handleRelation processes a Relation message, caching table metadata.
func (c *Collector) handleRelation(msg *wal.Message) error {
	if msg.Relation == nil {
		return nil
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	c.relations[msg.Relation.ID] = msg.Relation
	return nil
}

// handleInsert processes an Insert message.
func (c *Collector) handleInsert(ctx context.Context, msg *wal.Message) error {
	if msg.Data == nil {
		return nil
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if c.currentTxn == nil {
		return fmt.Errorf("insert message received outside of transaction")
	}

	rel, ok := c.relations[msg.Data.RelationID]
	if !ok {
		return fmt.Errorf("unknown relation ID: %d", msg.Data.RelationID)
	}

	change := &Change{
		Type:       ChangeInsert,
		Offset:     c.currentTxn.NextOffset(),
		Relation:   [2]string{rel.Namespace, rel.Name},
		RelationID: msg.Data.RelationID,
		NewRecord:  msg.Data.NewValues,
		Xid:        c.currentTxn.Xid,
		ByteSize:   msg.Data.ByteSize,
	}

	c.currentTxn.AddChange(change)
	return nil
}

// handleUpdate processes an Update message.
func (c *Collector) handleUpdate(ctx context.Context, msg *wal.Message) error {
	if msg.Data == nil {
		return nil
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if c.currentTxn == nil {
		return fmt.Errorf("update message received outside of transaction")
	}

	rel, ok := c.relations[msg.Data.RelationID]
	if !ok {
		return fmt.Errorf("unknown relation ID: %d", msg.Data.RelationID)
	}

	// Determine old values: prefer OldValues if present (REPLICA IDENTITY FULL),
	// otherwise use ChangedKeyOldValues if present (key changed)
	oldValues := msg.Data.OldValues
	if oldValues == nil {
		oldValues = msg.Data.ChangedKeyOldValues
	}

	change := &Change{
		Type:       ChangeUpdate,
		Offset:     c.currentTxn.NextOffset(),
		Relation:   [2]string{rel.Namespace, rel.Name},
		RelationID: msg.Data.RelationID,
		NewRecord:  msg.Data.NewValues,
		OldRecord:  oldValues,
		Xid:        c.currentTxn.Xid,
		ByteSize:   msg.Data.ByteSize,
	}

	c.currentTxn.AddChange(change)
	return nil
}

// handleDelete processes a Delete message.
func (c *Collector) handleDelete(ctx context.Context, msg *wal.Message) error {
	if msg.Data == nil {
		return nil
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if c.currentTxn == nil {
		return fmt.Errorf("delete message received outside of transaction")
	}

	rel, ok := c.relations[msg.Data.RelationID]
	if !ok {
		return fmt.Errorf("unknown relation ID: %d", msg.Data.RelationID)
	}

	// Determine old values: prefer OldValues if present (REPLICA IDENTITY FULL),
	// otherwise use ChangedKeyOldValues (contains the key columns)
	oldValues := msg.Data.OldValues
	if oldValues == nil {
		oldValues = msg.Data.ChangedKeyOldValues
	}

	change := &Change{
		Type:       ChangeDelete,
		Offset:     c.currentTxn.NextOffset(),
		Relation:   [2]string{rel.Namespace, rel.Name},
		RelationID: msg.Data.RelationID,
		OldRecord:  oldValues,
		Xid:        c.currentTxn.Xid,
		ByteSize:   msg.Data.ByteSize,
	}

	c.currentTxn.AddChange(change)
	return nil
}

// handleTruncate processes a Truncate message.
func (c *Collector) handleTruncate(ctx context.Context, msg *wal.Message) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.currentTxn == nil {
		return fmt.Errorf("truncate message received outside of transaction")
	}

	// Create a truncate change for each affected relation
	for _, relID := range msg.TruncateRelationIDs {
		rel, ok := c.relations[relID]
		if !ok {
			continue // Skip unknown relations
		}

		change := &Change{
			Type:       ChangeTruncate,
			Offset:     c.currentTxn.NextOffset(),
			Relation:   [2]string{rel.Namespace, rel.Name},
			RelationID: relID,
			Xid:        c.currentTxn.Xid,
		}

		c.currentTxn.AddChange(change)
	}

	return nil
}

// dispatchChanges sends accumulated changes to relevant consumers.
func (c *Collector) dispatchChanges(ctx context.Context, txn *Transaction) error {
	c.mu.RLock()
	defer c.mu.RUnlock()

	// Group changes by table for efficient dispatch
	for _, change := range txn.Changes {
		tableKey := change.Relation

		// Find consumers interested in this table
		handles, ok := c.tableIndex[tableKey]
		if !ok {
			continue
		}

		// Dispatch to each consumer
		for handle := range handles {
			consumer, ok := c.consumers[handle]
			if !ok {
				continue
			}

			if err := consumer.ProcessChange(ctx, change); err != nil {
				return fmt.Errorf("consumer %s failed to process change: %w", handle, err)
			}
		}
	}

	return nil
}

// GetOffset returns the current offset (for bookkeeping).
func (c *Collector) GetOffset() offset.LogOffset {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.currentOffset
}

// GetConsumerCount returns the number of registered consumers.
func (c *Collector) GetConsumerCount() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.consumers)
}

// GetConsumersForTable returns handles of consumers interested in a specific table.
func (c *Collector) GetConsumersForTable(schema, table string) []string {
	c.mu.RLock()
	defer c.mu.RUnlock()

	tableKey := [2]string{schema, table}
	handles, ok := c.tableIndex[tableKey]
	if !ok {
		return nil
	}

	result := make([]string, 0, len(handles))
	for handle := range handles {
		result = append(result, handle)
	}
	return result
}

// HasConsumer checks if a consumer with the given handle exists.
func (c *Collector) HasConsumer(handle string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	_, exists := c.consumers[handle]
	return exists
}

// GetRelation returns the cached relation metadata for the given ID.
func (c *Collector) GetRelation(id uint32) (*wal.RelationMessage, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	rel, ok := c.relations[id]
	return rel, ok
}

// GetRelationCount returns the number of cached relations.
func (c *Collector) GetRelationCount() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.relations)
}

// ClearRelations clears the relation cache.
// This should be called when the replication stream is reset.
func (c *Collector) ClearRelations() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.relations = make(map[uint32]*wal.RelationMessage)
}

// IsInTransaction returns true if currently processing a transaction.
func (c *Collector) IsInTransaction() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.currentTxn != nil
}

// GetCurrentTransactionXid returns the current transaction's Xid, or 0 if not in a transaction.
func (c *Collector) GetCurrentTransactionXid() uint32 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.currentTxn == nil {
		return 0
	}
	return c.currentTxn.Xid
}
