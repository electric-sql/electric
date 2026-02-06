// Package shape provides the Consumer type that manages a single shape's lifecycle.
//
// Consumer handles:
// - Initial snapshot creation
// - WAL change filtering and processing
// - Transaction duplicate filtering via pg_snapshot
//
// Ported from: lib/electric/shapes/consumer.ex
package shape

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"

	"github.com/electric-sql/electric/packages/sync-service-go/pkg/offset"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/operations"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/schema"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/storage"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/wal"
)

// ShapeCache is an interface for cache operations needed by Consumer.
// This interface is implemented by shapecache.Cache.
type ShapeCache interface {
	// MarkSnapshotComplete marks a shape's snapshot as complete.
	MarkSnapshotComplete(handle string) error
	// UpdateOffset updates the latest offset for a shape.
	UpdateOffset(handle string, off offset.LogOffset) error
}

// PgSnapshot holds PostgreSQL snapshot information for filtering duplicates
// between snapshot data and WAL changes. This is a copy of the type from
// the snapshot package to avoid import cycles.
type PgSnapshot struct {
	// Xmin is the lowest transaction ID still active at snapshot time.
	Xmin int64
	// Xmax is one past the highest transaction ID at snapshot time.
	Xmax int64
	// XipList contains transaction IDs that were in-progress at snapshot time.
	XipList []int64
	// FilterTxns indicates whether transaction filtering is still active.
	FilterTxns bool
}

// Contains checks if a transaction ID is visible in this snapshot.
func (snap *PgSnapshot) Contains(txid int64) bool {
	if txid >= snap.Xmax {
		return false
	}
	for _, xip := range snap.XipList {
		if txid == xip {
			return false
		}
	}
	return true
}

// AfterSnapshot checks if a transaction ID is definitely after the snapshot.
func (snap *PgSnapshot) AfterSnapshot(txid int64) bool {
	if txid >= snap.Xmax {
		return true
	}
	for _, xip := range snap.XipList {
		if txid == xip {
			return true
		}
	}
	return false
}

// ShouldSkipTransaction determines if a WAL transaction should be skipped.
func (snap *PgSnapshot) ShouldSkipTransaction(txid int64) bool {
	if !snap.FilterTxns {
		return false
	}
	return snap.Contains(txid)
}

// SnapshotResult contains the snapshot query results.
type SnapshotResult struct {
	// Rows contains the snapshot data as a slice of maps (column name -> value).
	Rows []map[string]any
	// Snapshot is the pg_snapshot for duplicate filtering with WAL.
	Snapshot *PgSnapshot
	// LSN is the WAL position at the time of the snapshot.
	LSN int64
}

// SnapshotExecutor is an interface for executing initial snapshots.
// This allows injecting mock executors for testing.
type SnapshotExecutor interface {
	// Execute runs the initial snapshot query for a shape.
	Execute(ctx context.Context, s *Shape) (*SnapshotResult, error)
}

// ConsumerState represents the consumer's lifecycle state.
type ConsumerState int

const (
	// ConsumerInitializing indicates the consumer is being set up.
	ConsumerInitializing ConsumerState = iota
	// ConsumerSnapshotting indicates the consumer is taking the initial snapshot.
	ConsumerSnapshotting
	// ConsumerActive indicates the consumer is ready to process WAL changes.
	ConsumerActive
	// ConsumerStopped indicates the consumer has been stopped.
	ConsumerStopped
)

// String returns a human-readable representation of the state.
func (s ConsumerState) String() string {
	switch s {
	case ConsumerInitializing:
		return "initializing"
	case ConsumerSnapshotting:
		return "snapshotting"
	case ConsumerActive:
		return "active"
	case ConsumerStopped:
		return "stopped"
	default:
		return "unknown"
	}
}

// ConsumerErrors
var (
	// ErrConsumerStopped is returned when operations are attempted on a stopped consumer.
	ErrConsumerStopped = errors.New("consumer is stopped")
	// ErrConsumerNotActive is returned when processing changes before the consumer is active.
	ErrConsumerNotActive = errors.New("consumer is not active")
	// ErrSnapshotFailed is returned when the snapshot operation fails.
	ErrSnapshotFailed = errors.New("snapshot failed")
)

// ChangeFilter determines which WAL changes affect a shape.
// It evaluates changes against the shape's table and WHERE clause.
type ChangeFilter struct {
	shape    *Shape
	relation *wal.RelationMessage
}

// NewChangeFilter creates a new change filter for the given shape.
func NewChangeFilter(shape *Shape) *ChangeFilter {
	return &ChangeFilter{
		shape: shape,
	}
}

// SetRelation sets the relation metadata for the filter.
// This should be called when a Relation message is received from WAL.
func (cf *ChangeFilter) SetRelation(rel *wal.RelationMessage) {
	cf.relation = rel
}

// MatchesRelation checks if a WAL change's relation matches this shape's table.
func (cf *ChangeFilter) MatchesRelation(schemaName, tableName string) bool {
	return cf.shape.Schema == schemaName && cf.shape.TableName == tableName
}

// MatchesRelationID checks if a relation ID matches this shape's table.
// Requires that SetRelation was called with a matching relation.
func (cf *ChangeFilter) MatchesRelationID(relationID uint32) bool {
	if cf.relation == nil {
		return false
	}
	return cf.relation.ID == relationID
}

// FilterResult represents the result of filtering a WAL change.
type FilterResult struct {
	// Items contains the log items to write (may be empty, one, or two for PK changes).
	Items []LogItem
	// Matched indicates whether any part of the change matched the shape.
	Matched bool
}

// FilterChange processes a WAL data message and returns matching log items.
// For each WAL change:
// 1. Check if relation matches shape's table
// 2. For INSERT: check if new record matches WHERE
// 3. For DELETE: check if old record matches WHERE
// 4. For UPDATE: check both old and new records (may generate delete, insert, or update)
func (cf *ChangeFilter) FilterChange(
	msgType wal.MessageType,
	data *wal.DataMessage,
	txOffset offset.LogOffset,
	relation *wal.RelationMessage,
	txid int64,
	isLast bool,
) (*FilterResult, error) {
	if relation == nil {
		return &FilterResult{}, nil
	}

	// Check if the relation matches this shape's table
	if !cf.MatchesRelation(relation.Namespace, relation.Name) {
		return &FilterResult{}, nil
	}

	// Cache the relation for future use
	cf.relation = relation

	// Get PK column names
	pkCols := getPKColumns(relation)

	switch msgType {
	case wal.MessageInsert:
		return cf.filterInsert(data, txOffset, relation, pkCols, txid, isLast)
	case wal.MessageUpdate:
		return cf.filterUpdate(data, txOffset, relation, pkCols, txid, isLast)
	case wal.MessageDelete:
		return cf.filterDelete(data, txOffset, relation, pkCols, txid, isLast)
	default:
		return &FilterResult{}, nil
	}
}

// filterInsert handles INSERT operations.
// Returns an insert log item if the new record matches the WHERE clause.
func (cf *ChangeFilter) filterInsert(
	data *wal.DataMessage,
	txOffset offset.LogOffset,
	relation *wal.RelationMessage,
	pkCols []string,
	txid int64,
	isLast bool,
) (*FilterResult, error) {
	if data.NewValues == nil {
		return &FilterResult{}, nil
	}

	// Check if the new record matches the WHERE clause
	matches, err := cf.shape.Matches(data.NewValues)
	if err != nil {
		return nil, fmt.Errorf("failed to evaluate WHERE clause for insert: %w", err)
	}

	if !matches {
		return &FilterResult{}, nil
	}

	// Convert values to string map
	value := anyMapToStringMap(data.NewValues)

	// Apply column filtering if specified
	value = cf.shape.FilterColumnsString(value, pkCols)

	// Build the key
	key := operations.BuildKeyFromMap(relation.Namespace, relation.Name, pkCols, value)

	// Create the insert log item
	item := NewInsertItem(txOffset, key, value).
		WithRelation(relation.Namespace, relation.Name).
		WithTxids([]int64{txid}).
		WithLSN(fmt.Sprintf("%d", txOffset.TxOffset)).
		WithOpPosition(txOffset.OpOffset).
		WithLast(isLast)

	return &FilterResult{
		Items:   []LogItem{item},
		Matched: true,
	}, nil
}

// filterUpdate handles UPDATE operations.
// May return:
// - update: if both old and new records match
// - insert: if old doesn't match but new does (moved into shape)
// - delete: if old matches but new doesn't (moved out of shape)
// - PK change: if the primary key changed, returns delete + insert pair
func (cf *ChangeFilter) filterUpdate(
	data *wal.DataMessage,
	txOffset offset.LogOffset,
	relation *wal.RelationMessage,
	pkCols []string,
	txid int64,
	isLast bool,
) (*FilterResult, error) {
	if data.NewValues == nil {
		return &FilterResult{}, nil
	}

	// Get old values - may come from OldValues or ChangedKeyOldValues
	oldValues := data.OldValues
	if oldValues == nil && data.ChangedKeyOldValues != nil {
		oldValues = data.ChangedKeyOldValues
	}

	// Check if records match the WHERE clause
	oldMatches, newMatches, err := cf.shape.MatchesOldAndNew(oldValues, data.NewValues)
	if err != nil {
		return nil, fmt.Errorf("failed to evaluate WHERE clause for update: %w", err)
	}

	// Neither old nor new matches - skip entirely
	if !oldMatches && !newMatches {
		return &FilterResult{}, nil
	}

	// Convert values to string maps
	newValue := anyMapToStringMap(data.NewValues)
	oldValue := anyMapToStringMap(oldValues)

	// Check if PK changed
	oldKey := operations.BuildKeyFromMap(relation.Namespace, relation.Name, pkCols, oldValue)
	newKey := operations.BuildKeyFromMap(relation.Namespace, relation.Name, pkCols, newValue)
	pkChanged := oldKey != newKey && len(oldValue) > 0

	// Apply column filtering
	filteredNewValue := cf.shape.FilterColumnsString(newValue, pkCols)
	filteredOldValue := cf.shape.FilterColumnsString(oldValue, pkCols)

	var items []LogItem

	if pkChanged && oldMatches && newMatches {
		// PK change within the shape - emit delete + insert pair
		deleteItem := NewDeleteItemWithValue(txOffset, oldKey, getDeleteValue(filteredOldValue, pkCols, cf.shape.Replica)).
			WithRelation(relation.Namespace, relation.Name).
			WithTxids([]int64{txid}).
			WithLSN(fmt.Sprintf("%d", txOffset.TxOffset)).
			WithOpPosition(txOffset.OpOffset).
			WithKeyChangeTo(newKey)

		insertOffset := txOffset.Increment()
		insertItem := NewInsertItem(insertOffset, newKey, filteredNewValue).
			WithRelation(relation.Namespace, relation.Name).
			WithTxids([]int64{txid}).
			WithLSN(fmt.Sprintf("%d", insertOffset.TxOffset)).
			WithOpPosition(insertOffset.OpOffset).
			WithKeyChangeFrom(oldKey).
			WithLast(isLast)

		items = []LogItem{deleteItem, insertItem}
	} else if oldMatches && newMatches {
		// Regular update within the shape
		var updateOldValue map[string]string
		if cf.shape.Replica == ReplicaFull {
			// In full mode, include changed columns with old values
			updateOldValue = getChangedOldValues(filteredOldValue, filteredNewValue)
		}

		item := NewUpdateItem(txOffset, newKey, getUpdateValue(filteredNewValue, filteredOldValue, pkCols, cf.shape.Replica), updateOldValue, cf.shape.Replica).
			WithRelation(relation.Namespace, relation.Name).
			WithTxids([]int64{txid}).
			WithLSN(fmt.Sprintf("%d", txOffset.TxOffset)).
			WithOpPosition(txOffset.OpOffset).
			WithLast(isLast)

		items = []LogItem{item}
	} else if !oldMatches && newMatches {
		// Record moved into the shape - emit insert
		item := NewInsertItem(txOffset, newKey, filteredNewValue).
			WithRelation(relation.Namespace, relation.Name).
			WithTxids([]int64{txid}).
			WithLSN(fmt.Sprintf("%d", txOffset.TxOffset)).
			WithOpPosition(txOffset.OpOffset).
			WithLast(isLast)

		items = []LogItem{item}
	} else if oldMatches && !newMatches {
		// Record moved out of the shape - emit delete
		item := NewDeleteItemWithValue(txOffset, oldKey, getDeleteValue(filteredOldValue, pkCols, cf.shape.Replica)).
			WithRelation(relation.Namespace, relation.Name).
			WithTxids([]int64{txid}).
			WithLSN(fmt.Sprintf("%d", txOffset.TxOffset)).
			WithOpPosition(txOffset.OpOffset).
			WithLast(isLast)

		items = []LogItem{item}
	}

	return &FilterResult{
		Items:   items,
		Matched: len(items) > 0,
	}, nil
}

// filterDelete handles DELETE operations.
// Returns a delete log item if the old record matches the WHERE clause.
func (cf *ChangeFilter) filterDelete(
	data *wal.DataMessage,
	txOffset offset.LogOffset,
	relation *wal.RelationMessage,
	pkCols []string,
	txid int64,
	isLast bool,
) (*FilterResult, error) {
	// Get old values - may come from OldValues or ChangedKeyOldValues
	oldValues := data.OldValues
	if oldValues == nil && data.ChangedKeyOldValues != nil {
		oldValues = data.ChangedKeyOldValues
	}

	if oldValues == nil {
		return &FilterResult{}, nil
	}

	// Check if the old record matches the WHERE clause
	matches, err := cf.shape.Matches(oldValues)
	if err != nil {
		return nil, fmt.Errorf("failed to evaluate WHERE clause for delete: %w", err)
	}

	if !matches {
		return &FilterResult{}, nil
	}

	// Convert values to string map
	value := anyMapToStringMap(oldValues)

	// Apply column filtering
	value = cf.shape.FilterColumnsString(value, pkCols)

	// Build the key
	key := operations.BuildKeyFromMap(relation.Namespace, relation.Name, pkCols, value)

	// Create the delete log item
	deleteValue := getDeleteValue(value, pkCols, cf.shape.Replica)
	item := NewDeleteItemWithValue(txOffset, key, deleteValue).
		WithRelation(relation.Namespace, relation.Name).
		WithTxids([]int64{txid}).
		WithLSN(fmt.Sprintf("%d", txOffset.TxOffset)).
		WithOpPosition(txOffset.OpOffset).
		WithLast(isLast)

	return &FilterResult{
		Items:   []LogItem{item},
		Matched: true,
	}, nil
}

// Consumer manages a single shape's lifecycle.
// It handles initial snapshot creation and WAL change processing.
type Consumer struct {
	handle  Handle
	shape   *Shape
	state   ConsumerState
	cache   ShapeCache
	storage storage.Storage
	db      *sql.DB
	mu      sync.RWMutex

	// Snapshot executor (can be injected for testing)
	snapshotExecutor SnapshotExecutor

	// Snapshot state
	pgSnapshot *PgSnapshot

	// For change filtering
	changeFilter *ChangeFilter

	// Relation cache (populated from WAL messages)
	relations map[uint32]*wal.RelationMessage

	// Latest offset processed
	latestOffset offset.LogOffset

	// Error from initialization/snapshot
	initErr error
}

// ConsumerConfig holds configuration for creating a new Consumer.
type ConsumerConfig struct {
	Handle           Handle
	Shape            *Shape
	Cache            ShapeCache
	Storage          storage.Storage
	DB               *sql.DB
	SnapshotExecutor SnapshotExecutor // Optional, uses defaultSnapshotExecutor if nil
}

// NewConsumer creates a new shape consumer.
func NewConsumer(config ConsumerConfig) *Consumer {
	c := &Consumer{
		handle:           config.Handle,
		shape:            config.Shape,
		state:            ConsumerInitializing,
		cache:            config.Cache,
		storage:          config.Storage,
		db:               config.DB,
		snapshotExecutor: config.SnapshotExecutor,
		changeFilter:     NewChangeFilter(config.Shape),
		relations:        make(map[uint32]*wal.RelationMessage),
		latestOffset:     offset.InitialOffset,
	}
	// Use a default no-op executor if none provided
	// Real snapshot execution requires the snapshot package to be injected
	if c.snapshotExecutor == nil {
		c.snapshotExecutor = &noopSnapshotExecutor{}
	}
	return c
}

// noopSnapshotExecutor is a no-op implementation used when no executor is provided.
// In production, a real executor from the snapshot package should be injected.
type noopSnapshotExecutor struct{}

func (e *noopSnapshotExecutor) Execute(ctx context.Context, s *Shape) (*SnapshotResult, error) {
	return &SnapshotResult{
		Rows: nil,
		Snapshot: &PgSnapshot{
			Xmin:       0,
			Xmax:       0,
			XipList:    nil,
			FilterTxns: false,
		},
		LSN: 0,
	}, nil
}

// Start begins the consumer lifecycle.
// 1. Takes initial snapshot
// 2. Stores pg_snapshot for duplicate filtering
// 3. Marks shape as active
// 4. Ready to receive WAL changes
func (c *Consumer) Start(ctx context.Context) error {
	c.mu.Lock()
	if c.state == ConsumerStopped {
		c.mu.Unlock()
		return ErrConsumerStopped
	}
	c.state = ConsumerSnapshotting
	c.mu.Unlock()

	// Execute the snapshot using the injected executor
	result, err := c.snapshotExecutor.Execute(ctx, c.shape)
	if err != nil {
		c.mu.Lock()
		c.state = ConsumerStopped
		c.initErr = err
		c.mu.Unlock()
		return fmt.Errorf("%w: %v", ErrSnapshotFailed, err)
	}

	// Store the pg_snapshot for duplicate filtering
	c.mu.Lock()
	c.pgSnapshot = result.Snapshot
	c.mu.Unlock()

	// Store pg_snapshot in storage
	if result.Snapshot != nil {
		storageSnapshot := &storage.PgSnapshot{
			Xmin:       result.Snapshot.Xmin,
			Xmax:       result.Snapshot.Xmax,
			XipList:    result.Snapshot.XipList,
			FilterTxns: result.Snapshot.FilterTxns,
		}
		if err := c.storage.SetPgSnapshot(c.handle.String(), storageSnapshot); err != nil {
			c.mu.Lock()
			c.state = ConsumerStopped
			c.initErr = err
			c.mu.Unlock()
			return fmt.Errorf("failed to store pg_snapshot: %w", err)
		}
	}

	// Convert snapshot rows to log items
	if len(result.Rows) > 0 && c.shape.TableSchema != nil {
		items := c.rowsToLogItems(
			result.Rows,
			c.shape.TableSchema,
			c.shape.Schema,
			c.shape.TableName,
			offset.InitialOffset,
		)

		// Convert to storage log items and append
		storageItems := make([]storage.LogItem, 0, len(items))
		for _, item := range items {
			jsonBytes, err := item.ToJSON()
			if err != nil {
				continue
			}
			storageItems = append(storageItems, storage.LogItem{
				Offset: item.Offset.String(),
				Key:    item.Op.Key,
				Op:     storage.OpInsert,
				JSON:   jsonBytes,
			})
		}

		if len(storageItems) > 0 {
			// Get schema info
			schemaInfo := storage.SchemaInfo{
				TableName: c.shape.TableName,
				Schema:    c.shape.Schema,
			}
			if c.shape.TableSchema != nil {
				schemaInfo.Columns = convertColumnsToStorageFormat(c.shape.TableSchema)
			}

			// Store the snapshot
			snapshotXmin := int64(0)
			if result.Snapshot != nil {
				snapshotXmin = result.Snapshot.Xmin
			}
			if err := c.storage.SetSnapshot(c.handle.String(), schemaInfo, storageItems, snapshotXmin); err != nil {
				c.mu.Lock()
				c.state = ConsumerStopped
				c.initErr = err
				c.mu.Unlock()
				return fmt.Errorf("failed to store snapshot: %w", err)
			}

			// Update the latest offset
			if len(items) > 0 {
				c.mu.Lock()
				c.latestOffset = items[len(items)-1].Offset
				c.mu.Unlock()
			}
		}
	}

	// Mark the shape as active
	c.mu.Lock()
	c.state = ConsumerActive
	c.mu.Unlock()

	// Update cache state
	if c.cache != nil {
		if err := c.cache.MarkSnapshotComplete(c.handle.String()); err != nil {
			// Log but don't fail - the shape is still usable
		}
	}

	return nil
}

// rowsToLogItems converts snapshot rows to log items.
// This is an internal implementation that doesn't require the snapshot package.
func (c *Consumer) rowsToLogItems(rows []map[string]any, tableSchema *schema.TableSchema, schemaName, tableName string, startOffset offset.LogOffset) []LogItem {
	if len(rows) == 0 {
		return nil
	}

	items := make([]LogItem, 0, len(rows))
	currentOffset := startOffset
	pkCols := tableSchema.PrimaryKeyColumnNames()

	for _, row := range rows {
		// Convert row values to strings
		value := rowToStringMap(row)

		// Build the key from PK values
		key := operations.BuildKeyFromMap(schemaName, tableName, pkCols, value)

		// Create insert log item
		item := NewInsertItem(currentOffset, key, value)
		items = append(items, item)

		// Increment offset for next row
		currentOffset = currentOffset.Increment()
	}

	return items
}

// rowToStringMap converts a database row (any values) to a string map.
func rowToStringMap(row map[string]any) map[string]string {
	result := make(map[string]string, len(row))
	for col, val := range row {
		if val == nil {
			continue
		}
		switch v := val.(type) {
		case string:
			result[col] = v
		default:
			result[col] = fmt.Sprintf("%v", val)
		}
	}
	return result
}

// ProcessChange processes a WAL change for this shape.
// Filters the change and writes to storage if it matches.
func (c *Consumer) ProcessChange(ctx context.Context, msg *wal.Message, txOffset offset.LogOffset) error {
	c.mu.RLock()
	state := c.state
	pgSnap := c.pgSnapshot
	c.mu.RUnlock()

	if state == ConsumerStopped {
		return ErrConsumerStopped
	}

	if state != ConsumerActive {
		return ErrConsumerNotActive
	}

	// Handle different message types
	switch msg.Type {
	case wal.MessageRelation:
		// Cache the relation for later use
		if msg.Relation != nil {
			c.mu.Lock()
			c.relations[msg.Relation.ID] = msg.Relation
			// Also update the change filter if this relation matches our shape
			if c.changeFilter.MatchesRelation(msg.Relation.Namespace, msg.Relation.Name) {
				c.changeFilter.SetRelation(msg.Relation)
			}
			c.mu.Unlock()
		}
		return nil

	case wal.MessageBegin:
		// Check for duplicate transaction (already in snapshot)
		if pgSnap != nil && pgSnap.ShouldSkipTransaction(int64(msg.Xid)) {
			return nil
		}
		return nil

	case wal.MessageCommit:
		// Check if we should disable transaction filtering
		if pgSnap != nil && pgSnap.FilterTxns && msg.Xid > 0 {
			if pgSnap.AfterSnapshot(int64(msg.Xid)) {
				c.mu.Lock()
				c.pgSnapshot.FilterTxns = false
				// Update storage
				storageSnapshot := &storage.PgSnapshot{
					Xmin:       c.pgSnapshot.Xmin,
					Xmax:       c.pgSnapshot.Xmax,
					XipList:    c.pgSnapshot.XipList,
					FilterTxns: false,
				}
				c.mu.Unlock()
				if err := c.storage.SetPgSnapshot(c.handle.String(), storageSnapshot); err != nil {
					// Log but don't fail
				}
			}
		}
		return nil

	case wal.MessageInsert, wal.MessageUpdate, wal.MessageDelete:
		// Process data message
		return c.processDataMessage(ctx, msg, txOffset)

	case wal.MessageTruncate:
		// Truncate invalidates the shape - caller should handle this
		// by stopping and recreating the shape
		return nil

	default:
		return nil
	}
}

// processDataMessage handles INSERT, UPDATE, DELETE messages.
func (c *Consumer) processDataMessage(ctx context.Context, msg *wal.Message, txOffset offset.LogOffset) error {
	if msg.Data == nil {
		return nil
	}

	// Get the relation metadata
	c.mu.RLock()
	relation, ok := c.relations[msg.Data.RelationID]
	c.mu.RUnlock()

	if !ok {
		// Relation not yet known - skip for now
		return nil
	}

	// Check for duplicate transaction
	c.mu.RLock()
	pgSnap := c.pgSnapshot
	c.mu.RUnlock()

	if pgSnap != nil && pgSnap.ShouldSkipTransaction(txOffset.TxOffset) {
		return nil
	}

	// Filter the change
	result, err := c.changeFilter.FilterChange(
		msg.Type,
		msg.Data,
		txOffset,
		relation,
		txOffset.TxOffset,
		false, // isLast will be set by the collector based on transaction boundaries
	)
	if err != nil {
		return fmt.Errorf("failed to filter change: %w", err)
	}

	if !result.Matched || len(result.Items) == 0 {
		return nil
	}

	// Convert to storage items and append
	storageItems := make([]storage.LogItem, 0, len(result.Items))
	for _, item := range result.Items {
		jsonBytes, err := item.ToJSON()
		if err != nil {
			continue
		}

		op := storage.OpInsert
		if opType := item.OperationType(); opType != "" {
			switch opType {
			case "update":
				op = storage.OpUpdate
			case "delete":
				op = storage.OpDelete
			}
		}

		storageItems = append(storageItems, storage.LogItem{
			Offset: item.Offset.String(),
			Key:    item.Op.Key,
			Op:     op,
			JSON:   jsonBytes,
		})
	}

	if len(storageItems) > 0 {
		if err := c.storage.AppendToLog(c.handle.String(), storageItems); err != nil {
			return fmt.Errorf("failed to append to log: %w", err)
		}

		// Update latest offset
		lastItem := result.Items[len(result.Items)-1]
		c.mu.Lock()
		if lastItem.Offset.After(c.latestOffset) {
			c.latestOffset = lastItem.Offset
		}
		c.mu.Unlock()

		// Notify cache of new changes
		if c.cache != nil {
			if err := c.cache.UpdateOffset(c.handle.String(), lastItem.Offset); err != nil {
				// Log but don't fail
			}
		}
	}

	return nil
}

// Stop stops the consumer.
func (c *Consumer) Stop() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.state = ConsumerStopped
	return nil
}

// GetState returns the current state.
func (c *Consumer) GetState() ConsumerState {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.state
}

// GetHandle returns the shape handle.
func (c *Consumer) GetHandle() Handle {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.handle
}

// GetShape returns the shape definition.
func (c *Consumer) GetShape() *Shape {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.shape
}

// GetPgSnapshot returns the snapshot for duplicate filtering.
func (c *Consumer) GetPgSnapshot() *PgSnapshot {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.pgSnapshot
}

// GetLatestOffset returns the latest processed offset.
func (c *Consumer) GetLatestOffset() offset.LogOffset {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.latestOffset
}

// ShouldSkipTransaction checks if a transaction should be skipped (duplicate filtering).
func (c *Consumer) ShouldSkipTransaction(txid int64) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if c.pgSnapshot == nil {
		return false
	}

	return c.pgSnapshot.ShouldSkipTransaction(txid)
}

// SetRelation caches a relation message for later use.
func (c *Consumer) SetRelation(rel *wal.RelationMessage) {
	if rel == nil {
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	c.relations[rel.ID] = rel
	if c.changeFilter.MatchesRelation(rel.Namespace, rel.Name) {
		c.changeFilter.SetRelation(rel)
	}
}

// GetError returns any initialization error.
func (c *Consumer) GetError() error {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.initErr
}

// Helper functions

// getPKColumns extracts PK column names from a relation.
func getPKColumns(relation *wal.RelationMessage) []string {
	var pkCols []string
	for _, col := range relation.Columns {
		if col.IsKey {
			pkCols = append(pkCols, col.Name)
		}
	}
	return pkCols
}

// anyMapToStringMap converts a map[string]any to map[string]string.
func anyMapToStringMap(m map[string]any) map[string]string {
	if m == nil {
		return nil
	}
	result := make(map[string]string, len(m))
	for k, v := range m {
		if v == nil {
			continue // Skip nil values
		}
		switch val := v.(type) {
		case string:
			result[k] = val
		default:
			result[k] = fmt.Sprintf("%v", val)
		}
	}
	return result
}

// getDeleteValue returns the value to include in a delete operation.
// In default mode, only PKs are included. In full mode, all columns are included.
func getDeleteValue(value map[string]string, pkCols []string, replica ReplicaMode) map[string]string {
	if replica == ReplicaFull {
		return value
	}
	// Default mode - only PKs
	return operations.FilterValueByPKs(value, pkCols)
}

// getUpdateValue returns the value to include in an update operation.
// In default mode, PKs + changed columns are included. In full mode, all columns are included.
func getUpdateValue(newValue, oldValue map[string]string, pkCols []string, replica ReplicaMode) map[string]string {
	if replica == ReplicaFull {
		return newValue
	}
	// Default mode - PKs + changed columns
	changedCols := getChangedColumns(oldValue, newValue)
	return operations.FilterValueByColumns(newValue, operations.MergeColumns(pkCols, changedCols))
}

// getChangedColumns returns the names of columns that changed between old and new values.
func getChangedColumns(oldValue, newValue map[string]string) []string {
	var changed []string
	for k, newV := range newValue {
		oldV, exists := oldValue[k]
		if !exists || oldV != newV {
			changed = append(changed, k)
		}
	}
	return changed
}

// getChangedOldValues returns a map of changed columns with their old values.
func getChangedOldValues(oldValue, newValue map[string]string) map[string]string {
	result := make(map[string]string)
	for k, newV := range newValue {
		if oldV, exists := oldValue[k]; exists && oldV != newV {
			result[k] = oldV
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

// convertColumnsToStorageFormat converts table schema columns to storage format.
func convertColumnsToStorageFormat(ts *schema.TableSchema) []storage.ColumnInfo {
	if ts == nil {
		return nil
	}

	columns := make([]storage.ColumnInfo, 0, len(ts.Columns))

	for _, col := range ts.Columns {
		columns = append(columns, storage.ColumnInfo{
			Name:    col.Name,
			Type:    col.Type,
			PKIndex: col.PKIndex,
			NotNull: col.NotNull,
		})
	}

	return columns
}

// FilterColumnsString filters a string map to only include selected columns plus PKs.
func (s *Shape) FilterColumnsString(record map[string]string, pkCols []string) map[string]string {
	if len(s.Columns) == 0 {
		// All columns - return a copy
		result := make(map[string]string, len(record))
		for k, v := range record {
			result[k] = v
		}
		return result
	}

	// Filter to selected columns, always including PKs
	result := make(map[string]string, len(s.Columns)+len(pkCols))

	// Add selected columns
	for _, col := range s.Columns {
		if v, ok := record[col]; ok {
			result[col] = v
		}
	}

	// Ensure PKs are always included
	for _, col := range pkCols {
		if v, ok := record[col]; ok {
			result[col] = v
		}
	}

	return result
}
