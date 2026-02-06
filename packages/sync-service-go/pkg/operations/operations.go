// Package operations defines the operation types and log items for the Electric sync protocol.
// This package handles the wire format for data changes sent to clients.
//
// Reference: packages/sync-service/lib/electric/log_items.ex
package operations

import (
	"encoding/json"
	"fmt"
	"strings"
)

// OperationType represents the type of data change operation.
type OperationType string

const (
	// OpInsert represents a new record insertion.
	OpInsert OperationType = "insert"
	// OpUpdate represents a record update.
	OpUpdate OperationType = "update"
	// OpDelete represents a record deletion.
	OpDelete OperationType = "delete"
)

// ReplicaMode controls the amount of data included in update/delete operations.
type ReplicaMode string

const (
	// ReplicaDefault includes only PKs + changed columns in updates, only PKs in deletes.
	ReplicaDefault ReplicaMode = "default"
	// ReplicaFull includes full record in value for updates/deletes, with old values for updates.
	ReplicaFull ReplicaMode = "full"
)

// Operation represents a data change operation with its associated data.
type Operation struct {
	// Key uniquely identifies the record. Format: "schema"."table"/"pk1"/"pk2"
	Key string
	// Value contains the record data as a map of column name to string value.
	Value map[string]string
	// Headers contains metadata about the operation.
	Headers map[string]any
	// Offset is the log offset for this operation. Format: "{tx}_{op}" or "-1" for BeforeAll.
	Offset string
}

// LogItem represents a log entry in the wire format sent to clients.
// It contains all the data needed to serialize a change for the HTTP response.
type LogItem struct {
	// Headers contains operation metadata (operation type, relation, txids, etc.)
	Headers map[string]any `json:"headers"`
	// Key uniquely identifies the record.
	Key string `json:"key"`
	// Value contains the record data. Always present in wire format.
	Value map[string]string `json:"value"`
	// OldValue contains the old record data (for full replica mode updates).
	OldValue map[string]string `json:"old_value,omitempty"`
	// Offset is the string representation of the log offset.
	Offset string `json:"offset"`
}

// NewInsertOperation creates a new insert operation.
func NewInsertOperation(key string, value map[string]string, offset string, relation [2]string, txids []int64, last bool) *LogItem {
	headers := map[string]any{
		"operation":   string(OpInsert),
		"relation":    []string{relation[0], relation[1]},
		"txids":       txids,
		"lsn":         extractLSN(offset),
		"op_position": extractOpPosition(offset),
	}
	if last {
		headers["last"] = true
	}

	return &LogItem{
		Headers: headers,
		Key:     key,
		Value:   value,
		Offset:  offset,
	}
}

// NewUpdateOperation creates a new update operation.
// In default replica mode, value contains only PKs + changed columns.
// In full replica mode, value contains full new record and oldValue contains changed columns with old values.
func NewUpdateOperation(key string, value map[string]string, oldValue map[string]string, offset string, relation [2]string, txids []int64, last bool, replicaMode ReplicaMode) *LogItem {
	headers := map[string]any{
		"operation":   string(OpUpdate),
		"relation":    []string{relation[0], relation[1]},
		"txids":       txids,
		"lsn":         extractLSN(offset),
		"op_position": extractOpPosition(offset),
	}
	if last {
		headers["last"] = true
	}

	item := &LogItem{
		Headers: headers,
		Key:     key,
		Value:   value,
		Offset:  offset,
	}

	if replicaMode == ReplicaFull && oldValue != nil {
		item.OldValue = oldValue
	}

	return item
}

// NewDeleteOperation creates a new delete operation.
// In default replica mode, value contains only PKs.
// In full replica mode, value contains the full old record.
func NewDeleteOperation(key string, value map[string]string, offset string, relation [2]string, txids []int64, last bool) *LogItem {
	headers := map[string]any{
		"operation":   string(OpDelete),
		"relation":    []string{relation[0], relation[1]},
		"txids":       txids,
		"lsn":         extractLSN(offset),
		"op_position": extractOpPosition(offset),
	}
	if last {
		headers["last"] = true
	}

	return &LogItem{
		Headers: headers,
		Key:     key,
		Value:   value,
		Offset:  offset,
	}
}

// NewPKChangeOperations creates the delete + insert pair for a primary key change.
// When a PK changes, we emit a delete with the old key (with key_change_to header)
// followed by an insert with the new key (with key_change_from header).
// The insert's offset has op_position incremented by 1.
func NewPKChangeOperations(oldKey, newKey string, oldValue, newValue map[string]string, offset string, relation [2]string, txids []int64, last bool, replicaMode ReplicaMode) []*LogItem {
	deleteHeaders := map[string]any{
		"operation":     string(OpDelete),
		"relation":      []string{relation[0], relation[1]},
		"txids":         txids,
		"lsn":           extractLSN(offset),
		"op_position":   extractOpPosition(offset),
		"key_change_to": newKey,
	}

	deleteItem := &LogItem{
		Headers: deleteHeaders,
		Key:     oldKey,
		Value:   oldValue,
		Offset:  offset,
	}

	// Increment the op_position for the insert
	insertOffset := incrementOffset(offset)

	insertHeaders := map[string]any{
		"operation":       string(OpInsert),
		"relation":        []string{relation[0], relation[1]},
		"txids":           txids,
		"lsn":             extractLSN(insertOffset),
		"op_position":     extractOpPosition(insertOffset),
		"key_change_from": oldKey,
	}
	if last {
		insertHeaders["last"] = true
	}

	insertItem := &LogItem{
		Headers: insertHeaders,
		Key:     newKey,
		Value:   newValue,
		Offset:  insertOffset,
	}

	return []*LogItem{deleteItem, insertItem}
}

// ControlMessage represents a control message in the log.
type ControlMessage struct {
	Headers map[string]any `json:"headers"`
}

// NewUpToDateControl creates an "up-to-date" control message.
func NewUpToDateControl(globalLastSeenLSN int64) *ControlMessage {
	return &ControlMessage{
		Headers: map[string]any{
			"control":              "up-to-date",
			"global_last_seen_lsn": fmt.Sprintf("%d", globalLastSeenLSN),
		},
	}
}

// ToJSON serializes a LogItem to JSON bytes.
func (l *LogItem) ToJSON() ([]byte, error) {
	return json.Marshal(l)
}

// ToJSON serializes a ControlMessage to JSON bytes.
func (c *ControlMessage) ToJSON() ([]byte, error) {
	return json.Marshal(c)
}

// escapeRelComponent escapes special characters in schema/table names for key encoding.
// Dots are escaped as .. and slashes are escaped as //
func escapeRelComponent(s string) string {
	// Escape dots first, then slashes
	s = strings.ReplaceAll(s, ".", "..")
	s = strings.ReplaceAll(s, "/", "//")
	return s
}

// escapePKValue escapes special characters in PK values.
// Slashes are escaped as // and double quotes are escaped as ""
func escapePKValue(s string) string {
	s = strings.ReplaceAll(s, "/", "//")
	s = strings.ReplaceAll(s, `"`, `""`)
	return s
}

// BuildKeySimple constructs a key using only PK values (without column names).
// Format: "schema"."table"/"pk_val1"/"pk_val2"
// This is the format used in the wire protocol.
//
// PK value handling:
//   - nil pointer = NULL, rendered as /_
//   - pointer to empty string = empty string, rendered as /""
//   - pointer to value = quoted value, rendered as /"value"
func BuildKeySimple(schema, table string, pkValues []*string) string {
	var sb strings.Builder

	// Write schema.table part with quotes, escaping special characters
	sb.WriteString(fmt.Sprintf(`"%s"."%s"`, escapeRelComponent(schema), escapeRelComponent(table)))

	// Write each PK value
	for _, val := range pkValues {
		sb.WriteByte('/')
		if val == nil {
			// NULL value
			sb.WriteByte('_')
		} else {
			// Quote the value, escaping special characters
			sb.WriteString(fmt.Sprintf(`"%s"`, escapePKValue(*val)))
		}
	}

	return sb.String()
}

// BuildKeyFromMap constructs a key from a value map using the specified PK columns.
// Format: "schema"."table"/"pk_val1"/"pk_val2"
//
// PK value handling:
//   - Missing key in map = NULL, rendered as /_
//   - Empty string value = empty string, rendered as /""
//   - Value present = quoted value, rendered as /"value"
func BuildKeyFromMap(schema, table string, pkCols []string, value map[string]string) string {
	pkValues := make([]*string, len(pkCols))
	for i, col := range pkCols {
		if val, ok := value[col]; ok {
			pkValues[i] = &val
		} else {
			pkValues[i] = nil // NULL
		}
	}
	return BuildKeySimple(schema, table, pkValues)
}

// extractLSN extracts the LSN (transaction offset) from an offset string.
// For offset "123_45", returns "123".
// For offset "-1", returns "-1".
func extractLSN(offset string) string {
	if offset == "-1" {
		return "-1"
	}
	parts := strings.Split(offset, "_")
	if len(parts) >= 1 {
		return parts[0]
	}
	return "0"
}

// extractOpPosition extracts the operation position from an offset string.
// For offset "123_45", returns 45.
// For offset "-1", returns 0.
func extractOpPosition(offset string) int {
	if offset == "-1" {
		return 0
	}
	parts := strings.Split(offset, "_")
	if len(parts) >= 2 {
		var pos int
		fmt.Sscanf(parts[1], "%d", &pos)
		return pos
	}
	return 0
}

// incrementOffset increments the op_position of an offset string by 1.
// For offset "123_45", returns "123_46".
func incrementOffset(offset string) string {
	if offset == "-1" {
		return "0_0"
	}
	parts := strings.Split(offset, "_")
	if len(parts) != 2 {
		return offset
	}
	var tx int64
	var op int
	fmt.Sscanf(parts[0], "%d", &tx)
	fmt.Sscanf(parts[1], "%d", &op)
	return fmt.Sprintf("%d_%d", tx, op+1)
}

// FilterValueByPKs returns a new map containing only the specified PK columns.
func FilterValueByPKs(value map[string]string, pkCols []string) map[string]string {
	if len(pkCols) == 0 {
		// No PK columns specified, return all
		return value
	}
	result := make(map[string]string, len(pkCols))
	for _, col := range pkCols {
		if val, ok := value[col]; ok {
			result[col] = val
		}
	}
	return result
}

// FilterValueByColumns returns a new map containing only the specified columns.
func FilterValueByColumns(value map[string]string, columns []string) map[string]string {
	result := make(map[string]string, len(columns))
	for _, col := range columns {
		if val, ok := value[col]; ok {
			result[col] = val
		}
	}
	return result
}

// MergeColumns returns the union of PKs and changed columns.
func MergeColumns(pkCols, changedCols []string) []string {
	seen := make(map[string]struct{})
	var result []string

	for _, col := range pkCols {
		if _, ok := seen[col]; !ok {
			seen[col] = struct{}{}
			result = append(result, col)
		}
	}
	for _, col := range changedCols {
		if _, ok := seen[col]; !ok {
			seen[col] = struct{}{}
			result = append(result, col)
		}
	}
	return result
}
