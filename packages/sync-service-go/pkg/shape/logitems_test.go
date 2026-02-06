// Package shape tests
// Ported from: packages/sync-service/test/electric/log_items_test.exs
package shape

import (
	"encoding/json"
	"testing"

	"github.com/electric-sql/electric/packages/sync-service-go/pkg/offset"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestControlType(t *testing.T) {
	tests := []struct {
		name     string
		ct       ControlType
		expected string
	}{
		{"up-to-date", ControlUpToDate, "up-to-date"},
		{"must-refetch", ControlMustRefetch, "must-refetch"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, string(tt.ct))
		})
	}
}

func TestReplicaModeConstants(t *testing.T) {
	tests := []struct {
		name     string
		mode     ReplicaMode
		expected string
	}{
		{"default", ReplicaDefault, "default"},
		{"full", ReplicaFull, "full"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, string(tt.mode))
		})
	}
}

func TestNewInsertItem(t *testing.T) {
	t.Run("basic insert", func(t *testing.T) {
		off := offset.MustNew(1234, 0)
		key := `"public"."users"/"42"`
		value := map[string]string{"id": "42", "name": "Alice"}

		item := NewInsertItem(off, key, value)

		assert.True(t, item.IsOperation())
		assert.False(t, item.IsControl())
		assert.Equal(t, off, item.Offset)
		assert.Equal(t, key, item.Op.Key)
		assert.Equal(t, value, item.Op.Value)
		assert.Equal(t, "insert", item.OperationType())
		assert.Nil(t, item.OldValue)
	})

	t.Run("insert JSON encoding", func(t *testing.T) {
		off := offset.MustNew(1234, 0)
		key := `"public"."users"/"42"`
		value := map[string]string{"id": "42", "name": "Alice"}

		item := NewInsertItem(off, key, value)
		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		assert.Equal(t, "1234_0", parsed["offset"])
		assert.Equal(t, key, parsed["key"])

		parsedValue := parsed["value"].(map[string]any)
		assert.Equal(t, "42", parsedValue["id"])
		assert.Equal(t, "Alice", parsedValue["name"])

		headers := parsed["headers"].(map[string]any)
		assert.Equal(t, "insert", headers["operation"])
	})

	t.Run("insert with empty value", func(t *testing.T) {
		off := offset.MustNew(0, 0)
		key := `"public"."t"/"1"`
		value := map[string]string{}

		item := NewInsertItem(off, key, value)
		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		// Value should be present even if empty
		assert.NotNil(t, parsed["value"])
	})
}

func TestNewUpdateItem(t *testing.T) {
	t.Run("update in default mode", func(t *testing.T) {
		off := offset.MustNew(5678, 1)
		key := `"public"."users"/"42"`
		value := map[string]string{"id": "42", "name": "Bob"}

		item := NewUpdateItem(off, key, value, nil, ReplicaDefault)

		assert.True(t, item.IsOperation())
		assert.Equal(t, "update", item.OperationType())
		assert.Equal(t, value, item.Op.Value)
		assert.Nil(t, item.OldValue)
	})

	t.Run("update in full mode with old_value", func(t *testing.T) {
		off := offset.MustNew(5678, 1)
		key := `"public"."users"/"42"`
		value := map[string]string{"id": "42", "name": "Bob", "email": "bob@test.com"}
		oldValue := map[string]string{"name": "Alice"}

		item := NewUpdateItem(off, key, value, oldValue, ReplicaFull)

		assert.Equal(t, value, item.Op.Value)
		assert.Equal(t, oldValue, item.OldValue)
	})

	t.Run("update full mode JSON encoding includes old_value", func(t *testing.T) {
		off := offset.MustNew(5678, 1)
		key := `"public"."users"/"42"`
		value := map[string]string{"id": "42", "name": "Bob"}
		oldValue := map[string]string{"name": "Alice"}

		item := NewUpdateItem(off, key, value, oldValue, ReplicaFull)
		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		assert.NotNil(t, parsed["old_value"])
		parsedOldValue := parsed["old_value"].(map[string]any)
		assert.Equal(t, "Alice", parsedOldValue["name"])
	})

	t.Run("update default mode JSON encoding excludes old_value", func(t *testing.T) {
		off := offset.MustNew(5678, 1)
		key := `"public"."users"/"42"`
		value := map[string]string{"id": "42", "name": "Bob"}

		item := NewUpdateItem(off, key, value, nil, ReplicaDefault)
		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		// old_value should not be present
		_, hasOldValue := parsed["old_value"]
		assert.False(t, hasOldValue)
	})
}

func TestNewDeleteItem(t *testing.T) {
	t.Run("basic delete", func(t *testing.T) {
		off := offset.MustNew(9999, 5)
		key := `"public"."users"/"42"`

		item := NewDeleteItem(off, key)

		assert.True(t, item.IsOperation())
		assert.Equal(t, "delete", item.OperationType())
		assert.Equal(t, key, item.Op.Key)
		assert.Empty(t, item.Op.Value)
	})

	t.Run("delete with value", func(t *testing.T) {
		off := offset.MustNew(9999, 5)
		key := `"public"."users"/"42"`
		value := map[string]string{"id": "42"}

		item := NewDeleteItemWithValue(off, key, value)

		assert.Equal(t, value, item.Op.Value)
	})

	t.Run("delete JSON encoding", func(t *testing.T) {
		off := offset.MustNew(9999, 5)
		key := `"public"."users"/"42"`
		value := map[string]string{"id": "42"}

		item := NewDeleteItemWithValue(off, key, value)
		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		assert.Equal(t, "9999_5", parsed["offset"])
		assert.Equal(t, key, parsed["key"])

		headers := parsed["headers"].(map[string]any)
		assert.Equal(t, "delete", headers["operation"])
	})
}

func TestNewUpToDateItem(t *testing.T) {
	t.Run("basic up-to-date", func(t *testing.T) {
		item := NewUpToDateItem()

		assert.False(t, item.IsOperation())
		assert.True(t, item.IsControl())
		assert.Equal(t, ControlUpToDate, item.Control.Type)
		assert.Nil(t, item.Control.Headers)
	})

	t.Run("up-to-date JSON encoding", func(t *testing.T) {
		item := NewUpToDateItem()
		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		headers := parsed["headers"].(map[string]any)
		assert.Equal(t, "up-to-date", headers["control"])
	})

	t.Run("up-to-date with LSN", func(t *testing.T) {
		item := NewUpToDateItemWithLSN(12345)
		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		headers := parsed["headers"].(map[string]any)
		assert.Equal(t, "up-to-date", headers["control"])
		assert.Equal(t, "12345", headers["global_last_seen_lsn"])
	})

	t.Run("up-to-date with large LSN", func(t *testing.T) {
		item := NewUpToDateItemWithLSN(9223372036854775807)
		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		headers := parsed["headers"].(map[string]any)
		assert.Equal(t, "9223372036854775807", headers["global_last_seen_lsn"])
	})
}

func TestNewMustRefetchItem(t *testing.T) {
	t.Run("basic must-refetch", func(t *testing.T) {
		item := NewMustRefetchItem()

		assert.True(t, item.IsControl())
		assert.Equal(t, ControlMustRefetch, item.Control.Type)
	})

	t.Run("must-refetch JSON encoding", func(t *testing.T) {
		item := NewMustRefetchItem()
		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		headers := parsed["headers"].(map[string]any)
		assert.Equal(t, "must-refetch", headers["control"])
	})

	t.Run("must-refetch with handle", func(t *testing.T) {
		item := NewMustRefetchItemWithHandle("new-handle-123")
		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		headers := parsed["headers"].(map[string]any)
		assert.Equal(t, "must-refetch", headers["control"])
		assert.Equal(t, "new-handle-123", headers["shape_handle"])
	})
}

func TestEncodeLogItems(t *testing.T) {
	t.Run("empty array", func(t *testing.T) {
		result, err := EncodeLogItems([]LogItem{})
		require.NoError(t, err)
		assert.Equal(t, "[]", string(result))
	})

	t.Run("single item", func(t *testing.T) {
		off := offset.MustNew(100, 0)
		item := NewInsertItem(off, `"public"."t"/"1"`, map[string]string{"id": "1"})

		result, err := EncodeLogItems([]LogItem{item})
		require.NoError(t, err)

		var parsed []map[string]any
		err = json.Unmarshal(result, &parsed)
		require.NoError(t, err)

		assert.Len(t, parsed, 1)
		assert.Equal(t, "100_0", parsed[0]["offset"])
	})

	t.Run("multiple items", func(t *testing.T) {
		items := []LogItem{
			NewInsertItem(offset.MustNew(100, 0), `"public"."t"/"1"`, map[string]string{"id": "1"}),
			NewUpdateItem(offset.MustNew(101, 0), `"public"."t"/"1"`, map[string]string{"id": "1", "name": "test"}, nil, ReplicaDefault),
			NewUpToDateItem(),
		}

		result, err := EncodeLogItems(items)
		require.NoError(t, err)

		var parsed []map[string]any
		err = json.Unmarshal(result, &parsed)
		require.NoError(t, err)

		assert.Len(t, parsed, 3)

		// First item: insert
		headers0 := parsed[0]["headers"].(map[string]any)
		assert.Equal(t, "insert", headers0["operation"])

		// Second item: update
		headers1 := parsed[1]["headers"].(map[string]any)
		assert.Equal(t, "update", headers1["operation"])

		// Third item: control
		headers2 := parsed[2]["headers"].(map[string]any)
		assert.Equal(t, "up-to-date", headers2["control"])
	})
}

func TestWithHeaders(t *testing.T) {
	t.Run("add relation header", func(t *testing.T) {
		off := offset.MustNew(100, 0)
		item := NewInsertItem(off, `"public"."users"/"1"`, map[string]string{"id": "1"}).
			WithRelation("public", "users")

		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		headers := parsed["headers"].(map[string]any)
		relation := headers["relation"].([]any)
		assert.Equal(t, "public", relation[0])
		assert.Equal(t, "users", relation[1])
	})

	t.Run("add txids header", func(t *testing.T) {
		off := offset.MustNew(100, 0)
		item := NewInsertItem(off, `"public"."t"/"1"`, map[string]string{"id": "1"}).
			WithTxids([]int64{12345, 67890})

		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		headers := parsed["headers"].(map[string]any)
		txids := headers["txids"].([]any)
		assert.Len(t, txids, 2)
	})

	t.Run("add LSN and op_position headers", func(t *testing.T) {
		off := offset.MustNew(100, 5)
		item := NewInsertItem(off, `"public"."t"/"1"`, map[string]string{"id": "1"}).
			WithLSN("100").
			WithOpPosition(5)

		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		headers := parsed["headers"].(map[string]any)
		assert.Equal(t, "100", headers["lsn"])
		assert.Equal(t, float64(5), headers["op_position"])
	})

	t.Run("add last header", func(t *testing.T) {
		off := offset.MustNew(100, 0)
		item := NewInsertItem(off, `"public"."t"/"1"`, map[string]string{"id": "1"}).
			WithLast(true)

		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		headers := parsed["headers"].(map[string]any)
		assert.Equal(t, true, headers["last"])
	})

	t.Run("remove last header when false", func(t *testing.T) {
		off := offset.MustNew(100, 0)
		item := NewInsertItem(off, `"public"."t"/"1"`, map[string]string{"id": "1"}).
			WithLast(true).
			WithLast(false)

		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		headers := parsed["headers"].(map[string]any)
		_, hasLast := headers["last"]
		assert.False(t, hasLast)
	})

	t.Run("chain multiple headers", func(t *testing.T) {
		off := offset.MustNew(100, 0)
		item := NewInsertItem(off, `"public"."t"/"1"`, map[string]string{"id": "1"}).
			WithRelation("public", "t").
			WithTxids([]int64{123}).
			WithLSN("100").
			WithOpPosition(0).
			WithLast(true)

		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		headers := parsed["headers"].(map[string]any)
		assert.Equal(t, "insert", headers["operation"])
		assert.NotNil(t, headers["relation"])
		assert.NotNil(t, headers["txids"])
		assert.Equal(t, "100", headers["lsn"])
		assert.Equal(t, float64(0), headers["op_position"])
		assert.Equal(t, true, headers["last"])
	})
}

func TestWithKeyChange(t *testing.T) {
	t.Run("key_change_to header for delete", func(t *testing.T) {
		off := offset.MustNew(100, 0)
		item := NewDeleteItemWithValue(off, `"public"."t"/"1"`, map[string]string{"id": "1"}).
			WithKeyChangeTo(`"public"."t"/"2"`)

		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		headers := parsed["headers"].(map[string]any)
		assert.Equal(t, `"public"."t"/"2"`, headers["key_change_to"])
	})

	t.Run("key_change_from header for insert", func(t *testing.T) {
		off := offset.MustNew(100, 1)
		item := NewInsertItem(off, `"public"."t"/"2"`, map[string]string{"id": "2", "name": "test"}).
			WithKeyChangeFrom(`"public"."t"/"1"`)

		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		headers := parsed["headers"].(map[string]any)
		assert.Equal(t, `"public"."t"/"1"`, headers["key_change_from"])
	})
}

func TestNewPKChangeItems(t *testing.T) {
	t.Run("produces delete and insert pair", func(t *testing.T) {
		off := offset.MustNew(100, 10)
		oldKey := `"public"."t"/"1"`
		newKey := `"public"."t"/"2"`
		oldValue := map[string]string{"id": "1"}
		newValue := map[string]string{"id": "2", "name": "test"}

		items := NewPKChangeItems(off, oldKey, newKey, oldValue, newValue, ReplicaDefault)

		assert.Len(t, items, 2)

		// First item should be delete
		assert.Equal(t, "delete", items[0].OperationType())
		assert.Equal(t, oldKey, items[0].Op.Key)
		assert.Equal(t, oldValue, items[0].Op.Value)
		assert.Equal(t, off, items[0].Offset)
		assert.Equal(t, newKey, items[0].Op.Headers["key_change_to"])

		// Second item should be insert
		assert.Equal(t, "insert", items[1].OperationType())
		assert.Equal(t, newKey, items[1].Op.Key)
		assert.Equal(t, newValue, items[1].Op.Value)
		assert.Equal(t, off.Increment(), items[1].Offset)
		assert.Equal(t, oldKey, items[1].Op.Headers["key_change_from"])
	})

	t.Run("offset increments correctly", func(t *testing.T) {
		off := offset.MustNew(50, 99)
		items := NewPKChangeItems(off, `"a"`, `"b"`, map[string]string{}, map[string]string{}, ReplicaDefault)

		assert.Equal(t, "50_99", items[0].Offset.String())
		assert.Equal(t, "50_100", items[1].Offset.String())
	})
}

func TestMergeUpdates(t *testing.T) {
	t.Run("merge values from two updates", func(t *testing.T) {
		off1 := offset.MustNew(100, 0)
		off2 := offset.MustNew(101, 0)

		older := NewUpdateItem(off1, `"public"."t"/"1"`, map[string]string{"id": "1", "a": "old_a"}, nil, ReplicaDefault).
			WithRelation("public", "t")
		newer := NewUpdateItem(off2, `"public"."t"/"1"`, map[string]string{"id": "1", "b": "new_b"}, nil, ReplicaDefault)

		merged := MergeUpdates(older, newer)

		// Newer values take precedence, but both should be present
		assert.Equal(t, "1", merged.Op.Value["id"])
		assert.Equal(t, "old_a", merged.Op.Value["a"])
		assert.Equal(t, "new_b", merged.Op.Value["b"])

		// Offset should be from older
		assert.Equal(t, off1, merged.Offset)
	})

	t.Run("merge old_values - older takes precedence", func(t *testing.T) {
		off1 := offset.MustNew(100, 0)
		off2 := offset.MustNew(101, 0)

		older := NewUpdateItem(off1, `"public"."t"/"1"`, map[string]string{"a": "new_a"}, map[string]string{"a": "orig_a"}, ReplicaFull)
		newer := NewUpdateItem(off2, `"public"."t"/"1"`, map[string]string{"b": "new_b"}, map[string]string{"a": "mid_a", "b": "orig_b"}, ReplicaFull)

		merged := MergeUpdates(older, newer)

		// Older's old_value takes precedence
		assert.Equal(t, "orig_a", merged.OldValue["a"])
		assert.Equal(t, "orig_b", merged.OldValue["b"])
	})

	t.Run("preserve operation and relation headers", func(t *testing.T) {
		off1 := offset.MustNew(100, 0)
		off2 := offset.MustNew(101, 0)

		older := NewUpdateItem(off1, `"public"."t"/"1"`, map[string]string{"a": "1"}, nil, ReplicaDefault).
			WithRelation("public", "t")
		newer := NewUpdateItem(off2, `"public"."t"/"1"`, map[string]string{"b": "2"}, nil, ReplicaDefault)

		merged := MergeUpdates(older, newer)

		assert.Equal(t, "update", merged.OperationType())
		relation := merged.Op.Headers["relation"].([]string)
		assert.Equal(t, "public", relation[0])
		assert.Equal(t, "t", relation[1])
	})
}

func TestKeepGenericHeaders(t *testing.T) {
	t.Run("keeps only operation and relation", func(t *testing.T) {
		off := offset.MustNew(100, 0)
		item := NewInsertItem(off, `"public"."t"/"1"`, map[string]string{"id": "1"}).
			WithRelation("public", "t").
			WithTxids([]int64{123}).
			WithLSN("100").
			WithOpPosition(0).
			WithLast(true)

		generic := item.KeepGenericHeaders()

		assert.Equal(t, "insert", generic.Op.Headers["operation"])
		assert.NotNil(t, generic.Op.Headers["relation"])
		assert.Nil(t, generic.Op.Headers["txids"])
		assert.Nil(t, generic.Op.Headers["lsn"])
		assert.Nil(t, generic.Op.Headers["op_position"])
		assert.Nil(t, generic.Op.Headers["last"])
	})
}

func TestWireFormat(t *testing.T) {
	t.Run("operation wire format matches spec", func(t *testing.T) {
		// Wire format example from requirements:
		// {
		//   "offset": "1234_0",
		//   "key": "\"public\".\"users\"/\"42\"",
		//   "value": {"id": "42", "name": "Alice"},
		//   "headers": {"operation": "insert"}
		// }
		off := offset.MustNew(1234, 0)
		key := `"public"."users"/"42"`
		value := map[string]string{"id": "42", "name": "Alice"}

		item := NewInsertItem(off, key, value)
		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		// Verify all required fields
		assert.Equal(t, "1234_0", parsed["offset"])
		assert.Equal(t, key, parsed["key"])

		parsedValue := parsed["value"].(map[string]any)
		assert.Equal(t, "42", parsedValue["id"])
		assert.Equal(t, "Alice", parsedValue["name"])

		headers := parsed["headers"].(map[string]any)
		assert.Equal(t, "insert", headers["operation"])
	})

	t.Run("control wire format matches spec", func(t *testing.T) {
		// Wire format example:
		// {"headers": {"control": "up-to-date"}}
		item := NewUpToDateItem()
		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		headers := parsed["headers"].(map[string]any)
		assert.Equal(t, "up-to-date", headers["control"])

		// Control messages should NOT have offset, key, or value
		_, hasOffset := parsed["offset"]
		_, hasKey := parsed["key"]
		_, hasValue := parsed["value"]
		assert.False(t, hasOffset, "control message should not have offset")
		assert.False(t, hasKey, "control message should not have key")
		assert.False(t, hasValue, "control message should not have value")
	})
}

func TestNilOperation(t *testing.T) {
	t.Run("handles nil Op gracefully", func(t *testing.T) {
		item := LogItem{
			Offset: offset.MustNew(0, 0),
			Op:     nil,
		}

		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		assert.Equal(t, "0_0", parsed["offset"])
	})
}

func TestOffsetFormats(t *testing.T) {
	tests := []struct {
		name     string
		offset   offset.LogOffset
		expected string
	}{
		{"regular offset", offset.MustNew(1234, 56), "1234_56"},
		{"first offset", offset.InitialOffset, "0_0"},
		{"zero offset", offset.MustNew(0, 0), "0_0"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			item := NewInsertItem(tt.offset, `"t"/"1"`, map[string]string{})
			jsonBytes, err := item.ToJSON()
			require.NoError(t, err)

			var parsed map[string]any
			err = json.Unmarshal(jsonBytes, &parsed)
			require.NoError(t, err)

			assert.Equal(t, tt.expected, parsed["offset"])
		})
	}
}

func TestLargeRecords(t *testing.T) {
	t.Run("large record with many columns", func(t *testing.T) {
		off := offset.MustNew(0, 0)
		value := make(map[string]string)

		// Create a record with 100 columns
		for i := 0; i < 100; i++ {
			col := string(rune('a' + i%26))
			if i >= 26 {
				col += string(rune('0' + i/26))
			}
			value[col] = "value"
		}

		item := NewInsertItem(off, `"public"."t"/"1"`, value)
		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		parsedValue := parsed["value"].(map[string]any)
		assert.Len(t, parsedValue, 100)
	})

	t.Run("encode many log items", func(t *testing.T) {
		var items []LogItem
		for i := 0; i < 1000; i++ {
			off := offset.MustNew(int64(i), 0)
			item := NewInsertItem(off, `"public"."t"/"1"`, map[string]string{"id": "1"})
			items = append(items, item)
		}

		result, err := EncodeLogItems(items)
		require.NoError(t, err)

		var parsed []map[string]any
		err = json.Unmarshal(result, &parsed)
		require.NoError(t, err)

		assert.Len(t, parsed, 1000)
	})
}

func TestSpecialValues(t *testing.T) {
	t.Run("empty string value", func(t *testing.T) {
		off := offset.MustNew(0, 0)
		value := map[string]string{"name": ""}

		item := NewInsertItem(off, `"t"/"1"`, value)
		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		parsedValue := parsed["value"].(map[string]any)
		assert.Equal(t, "", parsedValue["name"])
	})

	t.Run("unicode values", func(t *testing.T) {
		off := offset.MustNew(0, 0)
		value := map[string]string{"name": "Hello, World!"}

		item := NewInsertItem(off, `"t"/"1"`, value)
		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		parsedValue := parsed["value"].(map[string]any)
		assert.Equal(t, "Hello, World!", parsedValue["name"])
	})

	t.Run("special JSON characters in value", func(t *testing.T) {
		off := offset.MustNew(0, 0)
		value := map[string]string{"data": `{"nested": "json"}`}

		item := NewInsertItem(off, `"t"/"1"`, value)
		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		parsedValue := parsed["value"].(map[string]any)
		assert.Equal(t, `{"nested": "json"}`, parsedValue["data"])
	})
}

func TestIsOperationAndIsControl(t *testing.T) {
	t.Run("insert is operation", func(t *testing.T) {
		item := NewInsertItem(offset.MustNew(0, 0), `"t"/"1"`, map[string]string{})
		assert.True(t, item.IsOperation())
		assert.False(t, item.IsControl())
	})

	t.Run("update is operation", func(t *testing.T) {
		item := NewUpdateItem(offset.MustNew(0, 0), `"t"/"1"`, map[string]string{}, nil, ReplicaDefault)
		assert.True(t, item.IsOperation())
		assert.False(t, item.IsControl())
	})

	t.Run("delete is operation", func(t *testing.T) {
		item := NewDeleteItem(offset.MustNew(0, 0), `"t"/"1"`)
		assert.True(t, item.IsOperation())
		assert.False(t, item.IsControl())
	})

	t.Run("up-to-date is control", func(t *testing.T) {
		item := NewUpToDateItem()
		assert.False(t, item.IsOperation())
		assert.True(t, item.IsControl())
	})

	t.Run("must-refetch is control", func(t *testing.T) {
		item := NewMustRefetchItem()
		assert.False(t, item.IsOperation())
		assert.True(t, item.IsControl())
	})
}

func TestOperationType(t *testing.T) {
	tests := []struct {
		name     string
		item     LogItem
		expected string
	}{
		{"insert", NewInsertItem(offset.MustNew(0, 0), "", map[string]string{}), "insert"},
		{"update", NewUpdateItem(offset.MustNew(0, 0), "", map[string]string{}, nil, ReplicaDefault), "update"},
		{"delete", NewDeleteItem(offset.MustNew(0, 0), ""), "delete"},
		{"control", NewUpToDateItem(), ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, tt.item.OperationType())
		})
	}
}

func TestGenericHeadersWithCustomHeaders(t *testing.T) {
	t.Run("WithHeaders adds custom headers", func(t *testing.T) {
		off := offset.MustNew(100, 0)
		item := NewInsertItem(off, `"public"."t"/"1"`, map[string]string{"id": "1"}).
			WithHeaders(map[string]any{
				"custom_header": "custom_value",
				"another":       123,
			})

		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		headers := parsed["headers"].(map[string]any)
		assert.Equal(t, "custom_value", headers["custom_header"])
		assert.Equal(t, float64(123), headers["another"])
	})
}

func TestControlMessageExtraHeaders(t *testing.T) {
	t.Run("control message with multiple extra headers", func(t *testing.T) {
		item := LogItem{
			Control: &ControlMessage{
				Type: ControlUpToDate,
				Headers: map[string]string{
					"header1": "value1",
					"header2": "value2",
				},
			},
		}

		jsonBytes, err := item.ToJSON()
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(jsonBytes, &parsed)
		require.NoError(t, err)

		headers := parsed["headers"].(map[string]any)
		assert.Equal(t, "up-to-date", headers["control"])
		assert.Equal(t, "value1", headers["header1"])
		assert.Equal(t, "value2", headers["header2"])
	})
}
