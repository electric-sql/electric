// Package shape provides types and functions for encoding shape log items to wire format.
// LogItems handles encoding operations to the JSON format sent to clients over HTTP.
//
// Reference: packages/sync-service/lib/electric/log_items.ex
package shape

import (
	"encoding/json"
	"fmt"

	"github.com/electric-sql/electric/packages/sync-service-go/pkg/offset"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/operations"
)

// Note: ReplicaMode is defined in shape.go

// ControlType represents the type of control message.
type ControlType string

const (
	// ControlUpToDate indicates the client is up-to-date with the shape.
	ControlUpToDate ControlType = "up-to-date"
	// ControlMustRefetch indicates the client must refetch the shape from scratch.
	ControlMustRefetch ControlType = "must-refetch"
)

// LogItem represents a single item in the shape log.
// It can be either a data operation (insert/update/delete) or a control message.
type LogItem struct {
	// Offset is the log offset for this item.
	Offset offset.LogOffset
	// Op is the data operation (nil for control messages).
	Op *operations.Operation
	// Control is the control message (nil for data operations).
	Control *ControlMessage
	// OldValue contains the previous record values for updates in full replica mode.
	OldValue map[string]string
}

// ControlMessage represents a control message in the log.
type ControlMessage struct {
	// Type is the control message type.
	Type ControlType
	// Headers contains additional headers for the control message.
	Headers map[string]string
}

// wireOperation represents the wire format for a data operation.
type wireOperation struct {
	Offset   string            `json:"offset"`
	Key      string            `json:"key"`
	Value    map[string]string `json:"value"`
	Headers  map[string]any    `json:"headers"`
	OldValue map[string]string `json:"old_value,omitempty"`
}

// wireControl represents the wire format for a control message.
type wireControl struct {
	Headers map[string]any `json:"headers"`
}

// ToJSON encodes a log item to wire format.
// Returns JSON bytes ready for HTTP response.
//
// Wire format for operations:
//
//	{
//	  "offset": "1234_0",
//	  "key": "\"public\".\"users\"/\"42\"",
//	  "value": {"id": "42", "name": "Alice"},
//	  "headers": {"operation": "insert"}
//	}
//
// Wire format for control messages:
//
//	{
//	  "headers": {"control": "up-to-date"}
//	}
func (li *LogItem) ToJSON() ([]byte, error) {
	if li.Control != nil {
		return li.controlToJSON()
	}
	return li.operationToJSON()
}

// operationToJSON encodes a data operation to wire format.
func (li *LogItem) operationToJSON() ([]byte, error) {
	if li.Op == nil {
		// Empty operation - shouldn't happen but handle gracefully
		return json.Marshal(wireOperation{
			Offset:  li.Offset.String(),
			Headers: map[string]any{},
			Value:   map[string]string{},
		})
	}

	wire := wireOperation{
		Offset:   li.Offset.String(),
		Key:      li.Op.Key,
		Value:    li.Op.Value,
		Headers:  li.Op.Headers,
		OldValue: li.OldValue,
	}

	return json.Marshal(wire)
}

// controlToJSON encodes a control message to wire format.
func (li *LogItem) controlToJSON() ([]byte, error) {
	headers := map[string]any{
		"control": string(li.Control.Type),
	}

	// Add any additional headers from the control message
	for k, v := range li.Control.Headers {
		headers[k] = v
	}

	return json.Marshal(wireControl{
		Headers: headers,
	})
}

// EncodeLogItems encodes multiple items as a JSON array.
// Each item is encoded individually and then combined into an array.
func EncodeLogItems(items []LogItem) ([]byte, error) {
	if len(items) == 0 {
		return []byte("[]"), nil
	}

	// Encode each item
	encoded := make([]json.RawMessage, len(items))
	for i, item := range items {
		jsonBytes, err := item.ToJSON()
		if err != nil {
			return nil, err
		}
		encoded[i] = jsonBytes
	}

	return json.Marshal(encoded)
}

// NewInsertItem creates a log item for an insert operation.
//
// Parameters:
//   - off: The log offset for this operation
//   - key: The record key (format: "schema"."table"/"pk1"/"pk2")
//   - value: The record data as column name to string value map
func NewInsertItem(off offset.LogOffset, key string, value map[string]string) LogItem {
	return LogItem{
		Offset: off,
		Op: &operations.Operation{
			Key:    key,
			Value:  value,
			Offset: off.String(),
			Headers: map[string]any{
				"operation": string(operations.OpInsert),
			},
		},
	}
}

// NewUpdateItem creates a log item for an update operation.
//
// Parameters:
//   - off: The log offset for this operation
//   - key: The record key
//   - value: The new record data (in default mode: PKs + changed columns; in full mode: full record)
//   - oldValue: The old values (nil in default mode; in full mode: changed columns with old values)
//   - replica: The replica mode controlling what data is included
func NewUpdateItem(off offset.LogOffset, key string, value map[string]string, oldValue map[string]string, replica ReplicaMode) LogItem {
	item := LogItem{
		Offset: off,
		Op: &operations.Operation{
			Key:    key,
			Value:  value,
			Offset: off.String(),
			Headers: map[string]any{
				"operation": string(operations.OpUpdate),
			},
		},
	}

	// In full replica mode, include old_value if provided
	if replica == ReplicaFull && oldValue != nil && len(oldValue) > 0 {
		item.OldValue = oldValue
	}

	return item
}

// NewDeleteItem creates a log item for a delete operation.
//
// Parameters:
//   - off: The log offset for this operation
//   - key: The record key
func NewDeleteItem(off offset.LogOffset, key string) LogItem {
	return LogItem{
		Offset: off,
		Op: &operations.Operation{
			Key:    key,
			Value:  map[string]string{},
			Offset: off.String(),
			Headers: map[string]any{
				"operation": string(operations.OpDelete),
			},
		},
	}
}

// NewDeleteItemWithValue creates a log item for a delete operation with value data.
// In default mode, value contains only PKs. In full mode, value contains the full old record.
func NewDeleteItemWithValue(off offset.LogOffset, key string, value map[string]string) LogItem {
	return LogItem{
		Offset: off,
		Op: &operations.Operation{
			Key:    key,
			Value:  value,
			Offset: off.String(),
			Headers: map[string]any{
				"operation": string(operations.OpDelete),
			},
		},
	}
}

// NewUpToDateItem creates an up-to-date control message.
// This indicates the client is caught up with the shape.
func NewUpToDateItem() LogItem {
	return LogItem{
		Offset: offset.LogOffset{},
		Control: &ControlMessage{
			Type:    ControlUpToDate,
			Headers: nil,
		},
	}
}

// NewUpToDateItemWithLSN creates an up-to-date control message with the global LSN.
func NewUpToDateItemWithLSN(globalLastSeenLSN int64) LogItem {
	return LogItem{
		Offset: offset.LogOffset{},
		Control: &ControlMessage{
			Type: ControlUpToDate,
			Headers: map[string]string{
				"global_last_seen_lsn": fmt.Sprintf("%d", globalLastSeenLSN),
			},
		},
	}
}

// NewMustRefetchItem creates a must-refetch control message.
// This indicates the client must discard its local state and refetch the shape.
func NewMustRefetchItem() LogItem {
	return LogItem{
		Offset: offset.LogOffset{},
		Control: &ControlMessage{
			Type:    ControlMustRefetch,
			Headers: nil,
		},
	}
}

// NewMustRefetchItemWithHandle creates a must-refetch control message with a new handle.
func NewMustRefetchItemWithHandle(newHandle string) LogItem {
	return LogItem{
		Offset: offset.LogOffset{},
		Control: &ControlMessage{
			Type: ControlMustRefetch,
			Headers: map[string]string{
				"shape_handle": newHandle,
			},
		},
	}
}

// IsOperation returns true if this log item is a data operation.
func (li *LogItem) IsOperation() bool {
	return li.Op != nil
}

// IsControl returns true if this log item is a control message.
func (li *LogItem) IsControl() bool {
	return li.Control != nil
}

// OperationType returns the operation type if this is a data operation.
// Returns empty string for control messages.
func (li *LogItem) OperationType() string {
	if li.Op == nil || li.Op.Headers == nil {
		return ""
	}
	if op, ok := li.Op.Headers["operation"].(string); ok {
		return op
	}
	return ""
}

// WithHeaders adds additional headers to an operation log item.
// Returns the modified LogItem for chaining.
func (li LogItem) WithHeaders(headers map[string]any) LogItem {
	if li.Op != nil {
		if li.Op.Headers == nil {
			li.Op.Headers = make(map[string]any)
		}
		for k, v := range headers {
			li.Op.Headers[k] = v
		}
	}
	return li
}

// WithRelation adds the relation (schema, table) header to an operation.
func (li LogItem) WithRelation(schema, table string) LogItem {
	if li.Op != nil {
		if li.Op.Headers == nil {
			li.Op.Headers = make(map[string]any)
		}
		li.Op.Headers["relation"] = []string{schema, table}
	}
	return li
}

// WithTxids adds the transaction IDs header to an operation.
func (li LogItem) WithTxids(txids []int64) LogItem {
	if li.Op != nil {
		if li.Op.Headers == nil {
			li.Op.Headers = make(map[string]any)
		}
		li.Op.Headers["txids"] = txids
	}
	return li
}

// WithLSN adds the LSN header to an operation.
func (li LogItem) WithLSN(lsn string) LogItem {
	if li.Op != nil {
		if li.Op.Headers == nil {
			li.Op.Headers = make(map[string]any)
		}
		li.Op.Headers["lsn"] = lsn
	}
	return li
}

// WithOpPosition adds the operation position header.
func (li LogItem) WithOpPosition(pos int64) LogItem {
	if li.Op != nil {
		if li.Op.Headers == nil {
			li.Op.Headers = make(map[string]any)
		}
		li.Op.Headers["op_position"] = pos
	}
	return li
}

// WithLast marks this as the last operation in a transaction.
func (li LogItem) WithLast(last bool) LogItem {
	if li.Op != nil {
		if li.Op.Headers == nil {
			li.Op.Headers = make(map[string]any)
		}
		if last {
			li.Op.Headers["last"] = true
		} else {
			delete(li.Op.Headers, "last")
		}
	}
	return li
}

// WithKeyChangeTo adds the key_change_to header for PK change deletes.
func (li LogItem) WithKeyChangeTo(newKey string) LogItem {
	if li.Op != nil {
		if li.Op.Headers == nil {
			li.Op.Headers = make(map[string]any)
		}
		li.Op.Headers["key_change_to"] = newKey
	}
	return li
}

// WithKeyChangeFrom adds the key_change_from header for PK change inserts.
func (li LogItem) WithKeyChangeFrom(oldKey string) LogItem {
	if li.Op != nil {
		if li.Op.Headers == nil {
			li.Op.Headers = make(map[string]any)
		}
		li.Op.Headers["key_change_from"] = oldKey
	}
	return li
}

// NewPKChangeItems creates the delete + insert pair for a primary key change.
// When a PK changes, we emit a delete with the old key (with key_change_to header)
// followed by an insert with the new key (with key_change_from header).
// The insert's offset has op_position incremented by 1.
func NewPKChangeItems(off offset.LogOffset, oldKey, newKey string, oldValue, newValue map[string]string, replica ReplicaMode) []LogItem {
	deleteItem := NewDeleteItemWithValue(off, oldKey, oldValue).
		WithKeyChangeTo(newKey)

	insertOffset := off.Increment()
	insertItem := NewInsertItem(insertOffset, newKey, newValue).
		WithKeyChangeFrom(oldKey)

	return []LogItem{deleteItem, insertItem}
}

// MergeUpdates combines two consecutive updates on the same key.
// This is used for log compaction. The newer update's values take precedence.
func MergeUpdates(older, newer LogItem) LogItem {
	if older.Op == nil || newer.Op == nil {
		return newer
	}

	// Merge values (newer takes precedence)
	mergedValue := make(map[string]string)
	for k, v := range older.Op.Value {
		mergedValue[k] = v
	}
	for k, v := range newer.Op.Value {
		mergedValue[k] = v
	}

	// Merge old_value (older takes precedence for old values)
	var mergedOldValue map[string]string
	if older.OldValue != nil || newer.OldValue != nil {
		mergedOldValue = make(map[string]string)
		if newer.OldValue != nil {
			for k, v := range newer.OldValue {
				mergedOldValue[k] = v
			}
		}
		if older.OldValue != nil {
			for k, v := range older.OldValue {
				mergedOldValue[k] = v
			}
		}
	}

	// Keep operation and relation from older (they should be the same)
	headers := make(map[string]any)
	if op, ok := older.Op.Headers["operation"]; ok {
		headers["operation"] = op
	}
	if rel, ok := older.Op.Headers["relation"]; ok {
		headers["relation"] = rel
	}

	return LogItem{
		Offset: older.Offset,
		Op: &operations.Operation{
			Key:     older.Op.Key,
			Value:   mergedValue,
			Offset:  older.Offset.String(),
			Headers: headers,
		},
		OldValue: mergedOldValue,
	}
}

// KeepGenericHeaders returns a copy of the log item with only generic headers.
// Generic headers are: operation, relation.
func (li LogItem) KeepGenericHeaders() LogItem {
	if li.Op == nil {
		return li
	}

	headers := make(map[string]any)
	if op, ok := li.Op.Headers["operation"]; ok {
		headers["operation"] = op
	}
	if rel, ok := li.Op.Headers["relation"]; ok {
		headers["relation"] = rel
	}

	return LogItem{
		Offset: li.Offset,
		Op: &operations.Operation{
			Key:     li.Op.Key,
			Value:   li.Op.Value,
			Offset:  li.Op.Offset,
			Headers: headers,
		},
		OldValue: li.OldValue,
	}
}
