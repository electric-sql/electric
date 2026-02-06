// Package operations tests
// Ported from: packages/sync-service/test/electric/log_items_test.exs
package operations

import (
	"encoding/json"
	"testing"
)

func TestOperationType(t *testing.T) {
	tests := []struct {
		name     string
		opType   OperationType
		expected string
	}{
		{"insert operation", OpInsert, "insert"},
		{"update operation", OpUpdate, "update"},
		{"delete operation", OpDelete, "delete"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if string(tt.opType) != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, tt.opType)
			}
		})
	}
}

func TestReplicaMode(t *testing.T) {
	tests := []struct {
		name     string
		mode     ReplicaMode
		expected string
	}{
		{"default mode", ReplicaDefault, "default"},
		{"full mode", ReplicaFull, "full"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if string(tt.mode) != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, tt.mode)
			}
		})
	}
}

func TestNewInsertOperation(t *testing.T) {
	key := `"public"."items"/"id"/1`
	value := map[string]string{"id": "1", "name": "test"}
	offset := "123_0"
	relation := [2]string{"public", "items"}
	txids := []int64{12345}

	t.Run("basic insert", func(t *testing.T) {
		item := NewInsertOperation(key, value, offset, relation, txids, false)

		if item.Key != key {
			t.Errorf("expected key %q, got %q", key, item.Key)
		}

		if item.Headers["operation"] != "insert" {
			t.Errorf("expected operation 'insert', got %v", item.Headers["operation"])
		}

		rel := item.Headers["relation"].([]string)
		if rel[0] != "public" || rel[1] != "items" {
			t.Errorf("expected relation [public, items], got %v", rel)
		}

		if item.Headers["lsn"] != "123" {
			t.Errorf("expected lsn '123', got %v", item.Headers["lsn"])
		}

		if item.Headers["op_position"] != 0 {
			t.Errorf("expected op_position 0, got %v", item.Headers["op_position"])
		}

		if _, hasLast := item.Headers["last"]; hasLast {
			t.Error("expected no 'last' header when last=false")
		}

		if item.Offset != offset {
			t.Errorf("expected offset %q, got %q", offset, item.Offset)
		}
	})

	t.Run("insert with last=true", func(t *testing.T) {
		item := NewInsertOperation(key, value, offset, relation, txids, true)

		if item.Headers["last"] != true {
			t.Error("expected 'last' header to be true")
		}
	})

	t.Run("insert with multiple txids", func(t *testing.T) {
		multipleTxids := []int64{12345, 67890}
		item := NewInsertOperation(key, value, offset, relation, multipleTxids, false)

		txidsResult := item.Headers["txids"].([]int64)
		if len(txidsResult) != 2 {
			t.Errorf("expected 2 txids, got %d", len(txidsResult))
		}
	})
}

func TestNewUpdateOperation(t *testing.T) {
	key := `"public"."items"/"id"/1`
	value := map[string]string{"id": "1", "name": "updated"}
	oldValue := map[string]string{"name": "original"}
	offset := "456_2"
	relation := [2]string{"public", "items"}
	txids := []int64{12345}

	t.Run("update in default mode", func(t *testing.T) {
		item := NewUpdateOperation(key, value, nil, offset, relation, txids, false, ReplicaDefault)

		if item.Headers["operation"] != "update" {
			t.Errorf("expected operation 'update', got %v", item.Headers["operation"])
		}

		if item.OldValue != nil {
			t.Error("expected no old_value in default mode")
		}

		if item.Headers["lsn"] != "456" {
			t.Errorf("expected lsn '456', got %v", item.Headers["lsn"])
		}

		if item.Headers["op_position"] != 2 {
			t.Errorf("expected op_position 2, got %v", item.Headers["op_position"])
		}
	})

	t.Run("update in full mode with old_value", func(t *testing.T) {
		item := NewUpdateOperation(key, value, oldValue, offset, relation, txids, false, ReplicaFull)

		if item.OldValue == nil {
			t.Error("expected old_value in full mode")
		}

		if item.OldValue["name"] != "original" {
			t.Errorf("expected old_value name 'original', got %q", item.OldValue["name"])
		}
	})

	t.Run("update with last=true", func(t *testing.T) {
		item := NewUpdateOperation(key, value, nil, offset, relation, txids, true, ReplicaDefault)

		if item.Headers["last"] != true {
			t.Error("expected 'last' header to be true")
		}
	})
}

func TestNewDeleteOperation(t *testing.T) {
	key := `"public"."items"/"id"/1`
	value := map[string]string{"id": "1"}
	offset := "789_5"
	relation := [2]string{"public", "items"}
	txids := []int64{12345}

	t.Run("basic delete", func(t *testing.T) {
		item := NewDeleteOperation(key, value, offset, relation, txids, false)

		if item.Headers["operation"] != "delete" {
			t.Errorf("expected operation 'delete', got %v", item.Headers["operation"])
		}

		if item.Key != key {
			t.Errorf("expected key %q, got %q", key, item.Key)
		}

		if item.Headers["lsn"] != "789" {
			t.Errorf("expected lsn '789', got %v", item.Headers["lsn"])
		}

		if item.Headers["op_position"] != 5 {
			t.Errorf("expected op_position 5, got %v", item.Headers["op_position"])
		}
	})

	t.Run("delete with last=true", func(t *testing.T) {
		item := NewDeleteOperation(key, value, offset, relation, txids, true)

		if item.Headers["last"] != true {
			t.Error("expected 'last' header to be true")
		}
	})
}

func TestNewPKChangeOperations(t *testing.T) {
	oldKey := `"public"."items"/"id"/1`
	newKey := `"public"."items"/"id"/2`
	oldValue := map[string]string{"id": "1"}
	newValue := map[string]string{"id": "2", "name": "test"}
	offset := "100_10"
	relation := [2]string{"public", "items"}
	txids := []int64{12345}

	t.Run("pk change produces delete and insert", func(t *testing.T) {
		items := NewPKChangeOperations(oldKey, newKey, oldValue, newValue, offset, relation, txids, false, ReplicaDefault)

		if len(items) != 2 {
			t.Fatalf("expected 2 items, got %d", len(items))
		}

		// First item should be delete
		deleteItem := items[0]
		if deleteItem.Headers["operation"] != "delete" {
			t.Errorf("expected first operation 'delete', got %v", deleteItem.Headers["operation"])
		}
		if deleteItem.Key != oldKey {
			t.Errorf("expected delete key %q, got %q", oldKey, deleteItem.Key)
		}
		if deleteItem.Headers["key_change_to"] != newKey {
			t.Errorf("expected key_change_to %q, got %v", newKey, deleteItem.Headers["key_change_to"])
		}
		if deleteItem.Offset != "100_10" {
			t.Errorf("expected delete offset '100_10', got %q", deleteItem.Offset)
		}

		// Second item should be insert
		insertItem := items[1]
		if insertItem.Headers["operation"] != "insert" {
			t.Errorf("expected second operation 'insert', got %v", insertItem.Headers["operation"])
		}
		if insertItem.Key != newKey {
			t.Errorf("expected insert key %q, got %q", newKey, insertItem.Key)
		}
		if insertItem.Headers["key_change_from"] != oldKey {
			t.Errorf("expected key_change_from %q, got %v", oldKey, insertItem.Headers["key_change_from"])
		}
		// Insert offset should be incremented
		if insertItem.Offset != "100_11" {
			t.Errorf("expected insert offset '100_11', got %q", insertItem.Offset)
		}
	})

	t.Run("pk change with last=true only on insert", func(t *testing.T) {
		items := NewPKChangeOperations(oldKey, newKey, oldValue, newValue, offset, relation, txids, true, ReplicaDefault)

		// Delete should not have last
		if _, hasLast := items[0].Headers["last"]; hasLast {
			t.Error("expected delete to not have 'last' header")
		}

		// Insert should have last
		if items[1].Headers["last"] != true {
			t.Error("expected insert to have 'last' header")
		}
	})

	t.Run("pk change offset increments correctly", func(t *testing.T) {
		items := NewPKChangeOperations(oldKey, newKey, oldValue, newValue, "50_99", relation, txids, false, ReplicaDefault)

		if items[0].Offset != "50_99" {
			t.Errorf("expected delete offset '50_99', got %q", items[0].Offset)
		}
		if items[1].Offset != "50_100" {
			t.Errorf("expected insert offset '50_100', got %q", items[1].Offset)
		}
	})
}

func TestNewUpToDateControl(t *testing.T) {
	t.Run("basic control message", func(t *testing.T) {
		ctrl := NewUpToDateControl(12345)

		if ctrl.Headers["control"] != "up-to-date" {
			t.Errorf("expected control 'up-to-date', got %v", ctrl.Headers["control"])
		}

		if ctrl.Headers["global_last_seen_lsn"] != "12345" {
			t.Errorf("expected global_last_seen_lsn '12345', got %v", ctrl.Headers["global_last_seen_lsn"])
		}
	})

	t.Run("control message with large lsn", func(t *testing.T) {
		ctrl := NewUpToDateControl(9223372036854775807)

		if ctrl.Headers["global_last_seen_lsn"] != "9223372036854775807" {
			t.Errorf("expected large lsn string, got %v", ctrl.Headers["global_last_seen_lsn"])
		}
	})
}

func TestLogItemToJSON(t *testing.T) {
	t.Run("insert item serialization", func(t *testing.T) {
		key := `"public"."items"/"id"/1`
		value := map[string]string{"id": "1", "name": "test"}
		item := NewInsertOperation(key, value, "0_0", [2]string{"public", "items"}, []int64{123}, false)

		jsonBytes, err := item.ToJSON()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		var parsed map[string]any
		if err := json.Unmarshal(jsonBytes, &parsed); err != nil {
			t.Fatalf("failed to parse JSON: %v", err)
		}

		if parsed["key"] != key {
			t.Errorf("expected key %q in JSON, got %v", key, parsed["key"])
		}

		if parsed["offset"] != "0_0" {
			t.Errorf("expected offset '0_0' in JSON, got %v", parsed["offset"])
		}

		headers := parsed["headers"].(map[string]any)
		if headers["operation"] != "insert" {
			t.Errorf("expected operation 'insert' in JSON, got %v", headers["operation"])
		}
	})

	t.Run("update item with old_value serialization", func(t *testing.T) {
		key := `"public"."items"/"id"/1`
		value := map[string]string{"id": "1", "name": "new"}
		oldValue := map[string]string{"name": "old"}
		item := NewUpdateOperation(key, value, oldValue, "1_1", [2]string{"public", "items"}, []int64{123}, false, ReplicaFull)

		jsonBytes, err := item.ToJSON()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		var parsed map[string]any
		if err := json.Unmarshal(jsonBytes, &parsed); err != nil {
			t.Fatalf("failed to parse JSON: %v", err)
		}

		if parsed["old_value"] == nil {
			t.Error("expected old_value in JSON")
		}
	})

	t.Run("wire format example matches spec", func(t *testing.T) {
		// Wire format example from requirements:
		// {"headers": {"operation": "insert"}, "key": "\"public\".\"items\"/\"id\"/1", "value": {"id": "1", "name": "test"}, "offset": "0_0"}
		key := `"public"."items"/"id"/1`
		value := map[string]string{"id": "1", "name": "test"}
		item := NewInsertOperation(key, value, "0_0", [2]string{"public", "items"}, []int64{}, false)

		jsonBytes, err := item.ToJSON()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		var parsed map[string]any
		if err := json.Unmarshal(jsonBytes, &parsed); err != nil {
			t.Fatalf("failed to parse JSON: %v", err)
		}

		// Verify structure
		if parsed["key"] != key {
			t.Errorf("expected key %q, got %v", key, parsed["key"])
		}

		if parsed["offset"] != "0_0" {
			t.Errorf("expected offset '0_0', got %v", parsed["offset"])
		}

		headers := parsed["headers"].(map[string]any)
		if headers["operation"] != "insert" {
			t.Errorf("expected operation 'insert', got %v", headers["operation"])
		}
	})
}

func TestControlMessageToJSON(t *testing.T) {
	ctrl := NewUpToDateControl(123)

	jsonBytes, err := ctrl.ToJSON()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var parsed map[string]any
	if err := json.Unmarshal(jsonBytes, &parsed); err != nil {
		t.Fatalf("failed to parse JSON: %v", err)
	}

	headers := parsed["headers"].(map[string]any)
	if headers["control"] != "up-to-date" {
		t.Errorf("expected control 'up-to-date', got %v", headers["control"])
	}
}

func TestEscapeRelComponent(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"no escaping needed", "public", "public"},
		{"dot escaping", "my.schema", "my..schema"},
		{"slash escaping", "my/schema", "my//schema"},
		{"both escaping", "my.schema/name", "my..schema//name"},
		{"multiple dots", "a.b.c", "a..b..c"},
		{"multiple slashes", "a/b/c", "a//b//c"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := escapeRelComponent(tt.input)
			if result != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, result)
			}
		})
	}
}

func TestEscapePKValue(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"no escaping needed", "42", "42"},
		{"slash escaping", "a/b", "a//b"},
		{"quote escaping", `a"b`, `a""b`},
		{"both escaping", `a/b"c`, `a//b""c`},
		{"multiple slashes", "a/b/c", "a//b//c"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := escapePKValue(tt.input)
			if result != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, result)
			}
		})
	}
}

// Helper to create string pointer
func strPtr(s string) *string {
	return &s
}

func TestBuildKeySimple(t *testing.T) {
	tests := []struct {
		name     string
		schema   string
		table    string
		pkValues []*string
		expected string
	}{
		{
			name:     "single pk - quoted value",
			schema:   "public",
			table:    "users",
			pkValues: []*string{strPtr("42")},
			expected: `"public"."users"/"42"`,
		},
		{
			name:     "composite pk - quoted values",
			schema:   "public",
			table:    "orders",
			pkValues: []*string{strPtr("EU"), strPtr("7")},
			expected: `"public"."orders"/"EU"/"7"`,
		},
		{
			name:     "pk with slash escaping",
			schema:   "public",
			table:    "t",
			pkValues: []*string{strPtr("a/b")},
			expected: `"public"."t"/"a//b"`,
		},
		{
			name:     "multiple slashes",
			schema:   "public",
			table:    "t",
			pkValues: []*string{strPtr("a/b/c")},
			expected: `"public"."t"/"a//b//c"`,
		},
		{
			name:     "unicode in pk",
			schema:   "public",
			table:    "t",
			pkValues: []*string{strPtr("cafe")},
			expected: `"public"."t"/"cafe"`,
		},
		{
			name:     "no pk values (empty table)",
			schema:   "public",
			table:    "t",
			pkValues: []*string{},
			expected: `"public"."t"`,
		},
		{
			name:     "NULL value in pk",
			schema:   "public",
			table:    "t",
			pkValues: []*string{nil},
			expected: `"public"."t"/_`,
		},
		{
			name:     "empty string in pk",
			schema:   "public",
			table:    "t",
			pkValues: []*string{strPtr("")},
			expected: `"public"."t"/""`,
		},
		{
			name:     "composite pk with NULL middle value",
			schema:   "public",
			table:    "t",
			pkValues: []*string{strPtr("1"), nil, strPtr("2")},
			expected: `"public"."t"/"1"/_/"2"`,
		},
		{
			name:     "schema with dot - escaped",
			schema:   "my.schema",
			table:    "t",
			pkValues: []*string{strPtr("1")},
			expected: `"my..schema"."t"/"1"`,
		},
		{
			name:     "table with slash - escaped",
			schema:   "public",
			table:    "my/table",
			pkValues: []*string{strPtr("1")},
			expected: `"public"."my//table"/"1"`,
		},
		{
			name:     "value with double quote - escaped",
			schema:   "public",
			table:    "t",
			pkValues: []*string{strPtr(`a"b`)},
			expected: `"public"."t"/"a""b"`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := BuildKeySimple(tt.schema, tt.table, tt.pkValues)
			if result != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, result)
			}
		})
	}
}

func TestBuildKeyFromMap(t *testing.T) {
	tests := []struct {
		name     string
		schema   string
		table    string
		pkCols   []string
		value    map[string]string
		expected string
	}{
		{
			name:     "single pk from map",
			schema:   "public",
			table:    "users",
			pkCols:   []string{"id"},
			value:    map[string]string{"id": "42", "name": "test"},
			expected: `"public"."users"/"42"`,
		},
		{
			name:     "composite pk from map",
			schema:   "public",
			table:    "orders",
			pkCols:   []string{"region", "order_id"},
			value:    map[string]string{"region": "EU", "order_id": "7", "total": "100"},
			expected: `"public"."orders"/"EU"/"7"`,
		},
		{
			name:     "missing pk column is NULL",
			schema:   "public",
			table:    "t",
			pkCols:   []string{"id", "missing", "other"},
			value:    map[string]string{"id": "1", "other": "2"},
			expected: `"public"."t"/"1"/_/"2"`,
		},
		{
			name:     "empty string value is not NULL",
			schema:   "public",
			table:    "t",
			pkCols:   []string{"id"},
			value:    map[string]string{"id": ""},
			expected: `"public"."t"/""`,
		},
		{
			name:     "value with special characters",
			schema:   "public",
			table:    "t",
			pkCols:   []string{"id"},
			value:    map[string]string{"id": `a/b"c`},
			expected: `"public"."t"/"a//b""c"`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := BuildKeyFromMap(tt.schema, tt.table, tt.pkCols, tt.value)
			if result != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, result)
			}
		})
	}
}

func TestExtractLSN(t *testing.T) {
	tests := []struct {
		offset   string
		expected string
	}{
		{"123_45", "123"},
		{"0_0", "0"},
		{"-1", "-1"},
		{"9999999999_0", "9999999999"},
	}

	for _, tt := range tests {
		t.Run(tt.offset, func(t *testing.T) {
			result := extractLSN(tt.offset)
			if result != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, result)
			}
		})
	}
}

func TestExtractOpPosition(t *testing.T) {
	tests := []struct {
		offset   string
		expected int
	}{
		{"123_45", 45},
		{"0_0", 0},
		{"-1", 0},
		{"100_999", 999},
	}

	for _, tt := range tests {
		t.Run(tt.offset, func(t *testing.T) {
			result := extractOpPosition(tt.offset)
			if result != tt.expected {
				t.Errorf("expected %d, got %d", tt.expected, result)
			}
		})
	}
}

func TestIncrementOffset(t *testing.T) {
	tests := []struct {
		offset   string
		expected string
	}{
		{"123_45", "123_46"},
		{"0_0", "0_1"},
		{"-1", "0_0"},
		{"100_99", "100_100"},
	}

	for _, tt := range tests {
		t.Run(tt.offset, func(t *testing.T) {
			result := incrementOffset(tt.offset)
			if result != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, result)
			}
		})
	}
}

func TestFilterValueByPKs(t *testing.T) {
	value := map[string]string{
		"id":    "1",
		"name":  "test",
		"email": "test@example.com",
	}

	t.Run("filter to single pk", func(t *testing.T) {
		result := FilterValueByPKs(value, []string{"id"})

		if len(result) != 1 {
			t.Errorf("expected 1 key, got %d", len(result))
		}
		if result["id"] != "1" {
			t.Errorf("expected id '1', got %q", result["id"])
		}
	})

	t.Run("filter to multiple pks", func(t *testing.T) {
		result := FilterValueByPKs(value, []string{"id", "name"})

		if len(result) != 2 {
			t.Errorf("expected 2 keys, got %d", len(result))
		}
	})

	t.Run("empty pk list returns all", func(t *testing.T) {
		result := FilterValueByPKs(value, []string{})

		if len(result) != 3 {
			t.Errorf("expected 3 keys, got %d", len(result))
		}
	})

	t.Run("missing pk column ignored", func(t *testing.T) {
		result := FilterValueByPKs(value, []string{"id", "nonexistent"})

		if len(result) != 1 {
			t.Errorf("expected 1 key, got %d", len(result))
		}
	})
}

func TestFilterValueByColumns(t *testing.T) {
	value := map[string]string{
		"id":    "1",
		"name":  "test",
		"email": "test@example.com",
	}

	t.Run("filter specific columns", func(t *testing.T) {
		result := FilterValueByColumns(value, []string{"name", "email"})

		if len(result) != 2 {
			t.Errorf("expected 2 keys, got %d", len(result))
		}
		if result["name"] != "test" {
			t.Errorf("expected name 'test', got %q", result["name"])
		}
	})

	t.Run("missing column ignored", func(t *testing.T) {
		result := FilterValueByColumns(value, []string{"name", "nonexistent"})

		if len(result) != 1 {
			t.Errorf("expected 1 key, got %d", len(result))
		}
	})
}

func TestMergeColumns(t *testing.T) {
	t.Run("merge pk and changed columns", func(t *testing.T) {
		result := MergeColumns([]string{"id"}, []string{"name", "email"})

		if len(result) != 3 {
			t.Errorf("expected 3 columns, got %d", len(result))
		}
	})

	t.Run("deduplicates overlapping columns", func(t *testing.T) {
		result := MergeColumns([]string{"id", "name"}, []string{"name", "email"})

		if len(result) != 3 {
			t.Errorf("expected 3 columns (deduplicated), got %d", len(result))
		}

		// Verify order: pks first, then changed
		if result[0] != "id" {
			t.Errorf("expected first column to be 'id', got %q", result[0])
		}
	})

	t.Run("empty lists", func(t *testing.T) {
		result := MergeColumns([]string{}, []string{})

		if len(result) != 0 {
			t.Errorf("expected 0 columns, got %d", len(result))
		}
	})
}

func TestOperationStruct(t *testing.T) {
	t.Run("basic operation struct", func(t *testing.T) {
		op := Operation{
			Key:    `"public"."items"/"id"/1`,
			Value:  map[string]string{"id": "1", "name": "test"},
			Offset: "123_0",
			Headers: map[string]any{
				"operation": "insert",
			},
		}

		if op.Key != `"public"."items"/"id"/1` {
			t.Errorf("unexpected key: %s", op.Key)
		}

		if op.Value["id"] != "1" {
			t.Errorf("unexpected value id: %s", op.Value["id"])
		}

		if op.Offset != "123_0" {
			t.Errorf("unexpected offset: %s", op.Offset)
		}

		if op.Headers["operation"] != "insert" {
			t.Errorf("unexpected operation: %v", op.Headers["operation"])
		}
	})
}

func TestNullValuesInRecord(t *testing.T) {
	// Test handling of empty string (representing NULL)
	key := `"public"."items"/"id"/1`
	value := map[string]string{
		"id":   "1",
		"name": "", // NULL represented as empty string
	}

	item := NewInsertOperation(key, value, "0_0", [2]string{"public", "items"}, []int64{123}, false)

	jsonBytes, err := item.ToJSON()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var parsed map[string]any
	if err := json.Unmarshal(jsonBytes, &parsed); err != nil {
		t.Fatalf("failed to parse JSON: %v", err)
	}

	parsedValue := parsed["value"].(map[string]any)
	if parsedValue["name"] != "" {
		t.Errorf("expected empty string for null, got %v", parsedValue["name"])
	}
}

func TestEmptyRecord(t *testing.T) {
	key := `"public"."items"/"id"/1`
	value := map[string]string{}

	item := NewInsertOperation(key, value, "0_0", [2]string{"public", "items"}, []int64{123}, false)

	jsonBytes, err := item.ToJSON()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var parsed map[string]any
	if err := json.Unmarshal(jsonBytes, &parsed); err != nil {
		t.Fatalf("failed to parse JSON: %v", err)
	}

	// Value should always be present in wire format (even if empty)
	parsedValue, ok := parsed["value"]
	if !ok {
		t.Fatal("expected 'value' key to be present in JSON")
	}

	// Empty map serializes to null in JSON when nil, or {} when initialized but empty
	if parsedValue != nil {
		valueMap, isMap := parsedValue.(map[string]any)
		if isMap && len(valueMap) != 0 {
			t.Errorf("expected empty value, got %v", valueMap)
		}
	}
}

func TestLargeRecord(t *testing.T) {
	key := `"public"."items"/"id"/1`
	value := make(map[string]string)

	// Create a record with many columns
	for i := 0; i < 100; i++ {
		value[string(rune('a'+i%26))+string(rune('0'+i/26))] = "value"
	}

	item := NewInsertOperation(key, value, "0_0", [2]string{"public", "items"}, []int64{123}, false)

	jsonBytes, err := item.ToJSON()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var parsed map[string]any
	if err := json.Unmarshal(jsonBytes, &parsed); err != nil {
		t.Fatalf("failed to parse JSON: %v", err)
	}

	parsedValue := parsed["value"].(map[string]any)
	if len(parsedValue) != 100 {
		t.Errorf("expected 100 columns, got %d", len(parsedValue))
	}
}

func TestSpecialOffsetValues(t *testing.T) {
	t.Run("BeforeAll offset (-1)", func(t *testing.T) {
		key := `"public"."items"/"id"/1`
		value := map[string]string{"id": "1"}

		item := NewInsertOperation(key, value, "-1", [2]string{"public", "items"}, []int64{123}, false)

		if item.Headers["lsn"] != "-1" {
			t.Errorf("expected lsn '-1', got %v", item.Headers["lsn"])
		}
		if item.Headers["op_position"] != 0 {
			t.Errorf("expected op_position 0, got %v", item.Headers["op_position"])
		}
	})

	t.Run("First offset (0_0)", func(t *testing.T) {
		key := `"public"."items"/"id"/1`
		value := map[string]string{"id": "1"}

		item := NewInsertOperation(key, value, "0_0", [2]string{"public", "items"}, []int64{123}, false)

		if item.Headers["lsn"] != "0" {
			t.Errorf("expected lsn '0', got %v", item.Headers["lsn"])
		}
		if item.Headers["op_position"] != 0 {
			t.Errorf("expected op_position 0, got %v", item.Headers["op_position"])
		}
	})
}
