// Package snapshot tests
//
// Ported from: test/electric/shapes/consumer/initial_snapshot_test.exs
package snapshot

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"

	"github.com/electric-sql/electric/packages/sync-service-go/pkg/offset"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/schema"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/shape"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ============================================================================
// PgSnapshot Parsing Tests
// ============================================================================

func TestParsePgSnapshot(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantXmin    int64
		wantXmax    int64
		wantXipList []int64
		wantErr     bool
		errContains string
	}{
		{
			name:        "basic snapshot with xip_list",
			input:       "100:105:102,103",
			wantXmin:    100,
			wantXmax:    105,
			wantXipList: []int64{102, 103},
		},
		{
			name:        "snapshot with empty xip_list (trailing colon)",
			input:       "100:105:",
			wantXmin:    100,
			wantXmax:    105,
			wantXipList: nil,
		},
		{
			name:        "snapshot without xip_list (no trailing colon)",
			input:       "100:105",
			wantXmin:    100,
			wantXmax:    105,
			wantXipList: nil,
		},
		{
			name:        "snapshot with single xip",
			input:       "1:10:5",
			wantXmin:    1,
			wantXmax:    10,
			wantXipList: []int64{5},
		},
		{
			name:        "large transaction IDs",
			input:       "9223372036854775800:9223372036854775807:9223372036854775805",
			wantXmin:    9223372036854775800,
			wantXmax:    9223372036854775807,
			wantXipList: []int64{9223372036854775805},
		},
		{
			name:        "zero values",
			input:       "0:0:",
			wantXmin:    0,
			wantXmax:    0,
			wantXipList: nil,
		},
		{
			name:        "xmin equals xmax",
			input:       "100:100:",
			wantXmin:    100,
			wantXmax:    100,
			wantXipList: nil,
		},
		{
			name:        "whitespace around input",
			input:       "  100:105:102  ",
			wantXmin:    100,
			wantXmax:    105,
			wantXipList: []int64{102},
		},
		{
			name:        "empty string",
			input:       "",
			wantErr:     true,
			errContains: "empty pg_snapshot",
		},
		{
			name:        "invalid format - single value",
			input:       "100",
			wantErr:     true,
			errContains: "invalid pg_snapshot format",
		},
		{
			name:        "invalid format - too many colons",
			input:       "100:105:102:extra",
			wantErr:     true,
			errContains: "invalid pg_snapshot format",
		},
		{
			name:        "invalid xmin - not a number",
			input:       "abc:105:",
			wantErr:     true,
			errContains: "invalid xmin",
		},
		{
			name:        "invalid xmax - not a number",
			input:       "100:xyz:",
			wantErr:     true,
			errContains: "invalid xmax",
		},
		{
			name:        "invalid xip - not a number",
			input:       "100:105:abc",
			wantErr:     true,
			errContains: "invalid xip",
		},
		{
			name:        "xmin greater than xmax",
			input:       "200:100:",
			wantErr:     true,
			errContains: "xmin (200) > xmax (100)",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			snap, err := ParsePgSnapshot(tt.input)

			if tt.wantErr {
				require.Error(t, err)
				if tt.errContains != "" {
					assert.Contains(t, err.Error(), tt.errContains)
				}
				return
			}

			require.NoError(t, err)
			require.NotNil(t, snap)
			assert.Equal(t, tt.wantXmin, snap.Xmin)
			assert.Equal(t, tt.wantXmax, snap.Xmax)
			assert.Equal(t, tt.wantXipList, snap.XipList)
			assert.True(t, snap.FilterTxns, "FilterTxns should default to true")
		})
	}
}

// ============================================================================
// PgSnapshot Contains (Visibility) Tests
// ============================================================================

func TestPgSnapshotContains(t *testing.T) {
	// Snapshot: xmin=100, xmax=105, xip=[102,103]
	// Visible: <100, 100, 101, 104
	// Not visible: >=105, 102, 103
	snap := &PgSnapshot{
		Xmin:       100,
		Xmax:       105,
		XipList:    []int64{102, 103},
		FilterTxns: true,
	}

	tests := []struct {
		name    string
		txid    int64
		visible bool
	}{
		// Transactions < xmin are always visible (definitely committed)
		{"txid < xmin is visible", 99, true},
		{"txid = 0 is visible", 0, true},
		{"txid = 50 is visible", 50, true},

		// Transactions == xmin can be visible if not in xip_list
		{"txid = xmin is visible (not in xip)", 100, true},

		// Transactions between xmin and xmax, not in xip_list are visible
		{"txid = 101 is visible (not in xip)", 101, true},
		{"txid = 104 is visible (not in xip)", 104, true},

		// Transactions in xip_list are NOT visible (were in-progress)
		{"txid in xip_list (102) is not visible", 102, false},
		{"txid in xip_list (103) is not visible", 103, false},

		// Transactions >= xmax are NOT visible (not yet started)
		{"txid = xmax is not visible", 105, false},
		{"txid > xmax is not visible", 106, false},
		{"txid >> xmax is not visible", 1000, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := snap.Contains(tt.txid)
			assert.Equal(t, tt.visible, result, "txid %d visibility", tt.txid)
		})
	}
}

func TestPgSnapshotContainsEmptyXipList(t *testing.T) {
	snap := &PgSnapshot{
		Xmin:       100,
		Xmax:       110,
		XipList:    nil,
		FilterTxns: true,
	}

	tests := []struct {
		name    string
		txid    int64
		visible bool
	}{
		{"txid < xmin", 99, true},
		{"txid = xmin", 100, true},
		{"txid between xmin and xmax", 105, true},
		{"txid = xmax-1", 109, true},
		{"txid = xmax", 110, false},
		{"txid > xmax", 111, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.visible, snap.Contains(tt.txid))
		})
	}
}

// ============================================================================
// PgSnapshot AfterSnapshot Tests
// ============================================================================

func TestPgSnapshotAfterSnapshot(t *testing.T) {
	snap := &PgSnapshot{
		Xmin:       100,
		Xmax:       105,
		XipList:    []int64{102, 103},
		FilterTxns: true,
	}

	tests := []struct {
		name  string
		txid  int64
		after bool
	}{
		// Transactions < xmin are NOT after snapshot (definitely in snapshot)
		{"txid < xmin is not after", 99, false},

		// Transactions between xmin and xmax, not in xip_list are NOT after
		{"txid = xmin is not after", 100, false},
		{"txid = 101 is not after", 101, false},
		{"txid = 104 is not after", 104, false},

		// Transactions in xip_list ARE after (committed after snapshot)
		{"txid in xip_list (102) is after", 102, true},
		{"txid in xip_list (103) is after", 103, true},

		// Transactions >= xmax are after (not started at snapshot time)
		{"txid = xmax is after", 105, true},
		{"txid > xmax is after", 106, true},
		{"txid >> xmax is after", 1000, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := snap.AfterSnapshot(tt.txid)
			assert.Equal(t, tt.after, result, "txid %d after snapshot", tt.txid)
		})
	}
}

// ============================================================================
// PgSnapshot ShouldSkipTransaction Tests
// ============================================================================

func TestPgSnapshotShouldSkipTransaction(t *testing.T) {
	snap := &PgSnapshot{
		Xmin:       100,
		Xmax:       105,
		XipList:    []int64{102, 103},
		FilterTxns: true,
	}

	tests := []struct {
		name string
		txid int64
		skip bool
	}{
		// Skip visible transactions (already in snapshot)
		{"visible txid < xmin should skip", 99, true},
		{"visible txid between bounds should skip", 101, true},

		// Don't skip invisible transactions (not in snapshot)
		{"txid in xip_list should not skip", 102, false},
		{"txid >= xmax should not skip", 105, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := snap.ShouldSkipTransaction(tt.txid)
			assert.Equal(t, tt.skip, result)
		})
	}

	// Test with filtering disabled
	t.Run("filtering disabled - never skip", func(t *testing.T) {
		snapNoFilter := &PgSnapshot{
			Xmin:       100,
			Xmax:       105,
			XipList:    []int64{102, 103},
			FilterTxns: false,
		}

		// Even visible transactions shouldn't be skipped when filtering is off
		assert.False(t, snapNoFilter.ShouldSkipTransaction(99))
		assert.False(t, snapNoFilter.ShouldSkipTransaction(101))
	})
}

// ============================================================================
// PgSnapshot String Representation Tests
// ============================================================================

func TestPgSnapshotString(t *testing.T) {
	tests := []struct {
		name     string
		snap     *PgSnapshot
		expected string
	}{
		{
			name: "with xip_list",
			snap: &PgSnapshot{Xmin: 100, Xmax: 105, XipList: []int64{102, 103}},
			expected: "100:105:102,103",
		},
		{
			name: "empty xip_list",
			snap: &PgSnapshot{Xmin: 100, Xmax: 105, XipList: nil},
			expected: "100:105:",
		},
		{
			name: "single xip",
			snap: &PgSnapshot{Xmin: 1, Xmax: 10, XipList: []int64{5}},
			expected: "1:10:5",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, tt.snap.String())
		})
	}
}

// ============================================================================
// Query Building Tests
// ============================================================================

func TestBuildQuery(t *testing.T) {
	// Create a test table schema
	tableSchema := schema.NewTableSchema("public", "users", []schema.Column{
		{Name: "id", Type: "int4", PKIndex: 0, NotNull: true},
		{Name: "name", Type: "text", PKIndex: -1},
		{Name: "email", Type: "text", PKIndex: -1},
		{Name: "created_at", Type: "timestamptz", PKIndex: -1},
	})

	tests := []struct {
		name     string
		shape    *shape.Shape
		schema   *schema.TableSchema
		contains []string
		excludes []string
	}{
		{
			name: "simple table - all columns",
			shape: &shape.Shape{
				Schema:      "public",
				TableName:   "users",
				TableSchema: tableSchema,
			},
			schema: tableSchema,
			contains: []string{
				"SELECT",
				`"id"`, `"name"`, `"email"`, `"created_at"`,
				`FROM "public"."users"`,
				`ORDER BY "id"`,
			},
		},
		{
			name: "with WHERE clause",
			shape: func() *shape.Shape {
				s, _ := shape.New("users",
					shape.WithSchema("public"),
					shape.WithWhere("id > 10"),
					shape.WithTableSchema(tableSchema),
				)
				return s
			}(),
			schema: tableSchema,
			contains: []string{
				"SELECT",
				`FROM "public"."users"`,
				"WHERE",
				`ORDER BY "id"`,
			},
		},
		{
			name: "with column selection - PK included automatically",
			shape: &shape.Shape{
				Schema:      "public",
				TableName:   "users",
				Columns:     []string{"name", "email"},
				TableSchema: tableSchema,
			},
			schema: tableSchema,
			contains: []string{
				"SELECT",
				`"email"`, `"id"`, `"name"`, // id added, columns sorted
				`FROM "public"."users"`,
				`ORDER BY "id"`,
			},
			excludes: []string{
				`"created_at"`, // not selected
			},
		},
		{
			name: "schema with special characters",
			shape: &shape.Shape{
				Schema:      "my schema",
				TableName:   "my table",
				TableSchema: tableSchema,
			},
			schema: tableSchema,
			contains: []string{
				`FROM "my schema"."my table"`,
			},
		},
		{
			name: "no schema available - uses star",
			shape: &shape.Shape{
				Schema:      "public",
				TableName:   "unknown",
				TableSchema: nil,
			},
			schema: nil,
			contains: []string{
				"SELECT *",
				`FROM "public"."unknown"`,
			},
			excludes: []string{
				"ORDER BY", // no PK info without schema
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			query := BuildQuery(tt.shape, tt.schema)

			for _, s := range tt.contains {
				assert.Contains(t, query, s, "query should contain %q", s)
			}

			for _, s := range tt.excludes {
				assert.NotContains(t, query, s, "query should not contain %q", s)
			}
		})
	}
}

func TestBuildQueryCompositeKey(t *testing.T) {
	// Table with composite primary key
	// PKIndex 0 = region, PKIndex 1 = order_id
	tableSchema := schema.NewTableSchema("public", "orders", []schema.Column{
		{Name: "region", Type: "text", PKIndex: 0, NotNull: true},
		{Name: "order_id", Type: "int4", PKIndex: 1, NotNull: true},
		{Name: "total", Type: "numeric", PKIndex: -1},
	})

	s := &shape.Shape{
		Schema:      "public",
		TableName:   "orders",
		TableSchema: tableSchema,
	}

	query := BuildQuery(s, tableSchema)

	// Should order by both PK columns in PKIndex order
	assert.Contains(t, query, `ORDER BY "region", "order_id"`)
}

// ============================================================================
// ToLogItems Tests
// ============================================================================

func TestToLogItems(t *testing.T) {
	tableSchema := schema.NewTableSchema("public", "users", []schema.Column{
		{Name: "id", Type: "int4", PKIndex: 0, NotNull: true},
		{Name: "name", Type: "text", PKIndex: -1},
	})

	rows := []map[string]any{
		{"id": int64(1), "name": "Alice"},
		{"id": int64(2), "name": "Bob"},
		{"id": int64(3), "name": "Charlie"},
	}

	startOffset := offset.InitialOffset
	items := ToLogItems(rows, tableSchema, "public", "users", startOffset)

	require.Len(t, items, 3)

	// Check first item
	assert.Equal(t, offset.LogOffset{TxOffset: 0, OpOffset: 0}, items[0].Offset)
	assert.True(t, items[0].IsOperation())
	assert.Equal(t, "insert", items[0].OperationType())

	// Check second item has incremented offset
	assert.Equal(t, offset.LogOffset{TxOffset: 0, OpOffset: 1}, items[1].Offset)

	// Check third item
	assert.Equal(t, offset.LogOffset{TxOffset: 0, OpOffset: 2}, items[2].Offset)
}

func TestToLogItemsEmptyRows(t *testing.T) {
	tableSchema := schema.NewTableSchema("public", "users", []schema.Column{
		{Name: "id", Type: "int4", PKIndex: 0, NotNull: true},
	})

	items := ToLogItems(nil, tableSchema, "public", "users", offset.InitialOffset)
	assert.Nil(t, items)

	items = ToLogItems([]map[string]any{}, tableSchema, "public", "users", offset.InitialOffset)
	assert.Nil(t, items)
}

func TestToLogItemsKeyGeneration(t *testing.T) {
	tableSchema := schema.NewTableSchema("public", "users", []schema.Column{
		{Name: "id", Type: "int4", PKIndex: 0, NotNull: true},
		{Name: "name", Type: "text", PKIndex: -1},
	})

	rows := []map[string]any{
		{"id": "42", "name": "Test"},
	}

	items := ToLogItems(rows, tableSchema, "public", "users", offset.InitialOffset)

	require.Len(t, items, 1)
	// Key format: "schema"."table"/"pk_value"
	assert.Contains(t, items[0].Op.Key, `"public"."users"`)
	assert.Contains(t, items[0].Op.Key, `"42"`)
}

func TestToLogItemsCompositeKey(t *testing.T) {
	tableSchema := schema.NewTableSchema("public", "orders", []schema.Column{
		{Name: "region", Type: "text", PKIndex: 0, NotNull: true},
		{Name: "order_id", Type: "int4", PKIndex: 1, NotNull: true},
		{Name: "total", Type: "numeric", PKIndex: -1},
	})

	rows := []map[string]any{
		{"region": "EU", "order_id": "123", "total": "99.99"},
	}

	items := ToLogItems(rows, tableSchema, "public", "orders", offset.InitialOffset)

	require.Len(t, items, 1)
	// Key should contain both PK values
	key := items[0].Op.Key
	assert.Contains(t, key, `"public"."orders"`)
	assert.Contains(t, key, `"EU"`)
	assert.Contains(t, key, `"123"`)
}

// ============================================================================
// Value Conversion Tests
// ============================================================================

func TestRowToStringMap(t *testing.T) {
	tests := []struct {
		name     string
		input    map[string]any
		expected map[string]string
	}{
		{
			name:     "string values",
			input:    map[string]any{"name": "Alice", "city": "Boston"},
			expected: map[string]string{"name": "Alice", "city": "Boston"},
		},
		{
			name:     "integer values",
			input:    map[string]any{"id": int64(42), "count": int32(10)},
			expected: map[string]string{"id": "42", "count": "10"},
		},
		{
			name:     "float values",
			input:    map[string]any{"price": 19.99, "rate": float32(0.5)},
			expected: map[string]string{"price": "19.99", "rate": "0.5"},
		},
		{
			name:     "boolean values",
			input:    map[string]any{"active": true, "deleted": false},
			expected: map[string]string{"active": "true", "deleted": "false"},
		},
		{
			name:     "nil values",
			input:    map[string]any{"name": nil, "id": int64(1)},
			expected: map[string]string{"name": "", "id": "1"},
		},
		{
			name:     "byte array",
			input:    map[string]any{"data": []byte("hello")},
			expected: map[string]string{"data": "hello"},
		},
		{
			name:     "empty map",
			input:    map[string]any{},
			expected: map[string]string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := RowToStringMap(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestValueToString(t *testing.T) {
	tests := []struct {
		name     string
		input    any
		expected string
	}{
		{"nil", nil, ""},
		{"string", "hello", "hello"},
		{"empty string", "", ""},
		{"int", 42, "42"},
		{"int32", int32(100), "100"},
		{"int64", int64(9999999999), "9999999999"},
		{"float32", float32(3.14), "3.14"},
		{"float64", 2.718281828, "2.718281828"},
		{"true", true, "true"},
		{"false", false, "false"},
		{"byte slice", []byte("data"), "data"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := valueToString(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

// ============================================================================
// Quote Identifier Tests
// ============================================================================

func TestQuoteIdentifier(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"simple name", "users", `"users"`},
		{"with space", "my table", `"my table"`},
		{"with quotes", `foo"bar`, `"foo""bar"`},
		{"multiple quotes", `a"b"c`, `"a""b""c"`},
		{"empty", "", `""`},
		{"uppercase", "Users", `"Users"`},
		{"mixed case", "MyTable", `"MyTable"`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := quoteIdentifier(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

// ============================================================================
// Helper Function Tests
// ============================================================================

func TestVisibleInSnapshot(t *testing.T) {
	snap := &PgSnapshot{
		Xmin:       100,
		Xmax:       105,
		XipList:    []int64{102},
		FilterTxns: true,
	}

	assert.True(t, VisibleInSnapshot(99, snap))
	assert.True(t, VisibleInSnapshot(101, snap))
	assert.False(t, VisibleInSnapshot(102, snap))
	assert.False(t, VisibleInSnapshot(105, snap))

	// nil snapshot
	assert.False(t, VisibleInSnapshot(99, nil))
}

func TestAfterSnapshotCheck(t *testing.T) {
	snap := &PgSnapshot{
		Xmin:       100,
		Xmax:       105,
		XipList:    []int64{102},
		FilterTxns: true,
	}

	assert.False(t, AfterSnapshotCheck(99, snap))
	assert.False(t, AfterSnapshotCheck(101, snap))
	assert.True(t, AfterSnapshotCheck(102, snap))
	assert.True(t, AfterSnapshotCheck(105, snap))

	// nil snapshot
	assert.True(t, AfterSnapshotCheck(99, nil))
}

// ============================================================================
// Executor Tests (with mocks)
// ============================================================================

// MockDB is a simple mock for testing without actual database
type MockDB struct {
	QueryFunc   func(ctx context.Context, query string) (*sql.Rows, error)
	ExecFunc    func(ctx context.Context, query string) (sql.Result, error)
	BeginTxFunc func(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error)
}

func TestNewExecutor(t *testing.T) {
	// Test that NewExecutor creates an executor
	// We can't use a real *sql.DB without a database, but we can test the constructor
	var db *sql.DB = nil
	executor := NewExecutor(db)
	assert.NotNil(t, executor)
	assert.Nil(t, executor.db)
}

func TestExecuteNilShape(t *testing.T) {
	executor := &Executor{db: nil}
	_, err := executor.Execute(context.Background(), nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "shape is nil")
}

// ============================================================================
// Integration-style tests (without real DB)
// ============================================================================

func TestSnapshotWorkflow(t *testing.T) {
	// Test the complete workflow of snapshot processing

	// 1. Parse a pg_snapshot
	snap, err := ParsePgSnapshot("100:110:102,105")
	require.NoError(t, err)

	// 2. Simulate receiving WAL transactions
	walTxns := []struct {
		txid     int64
		expected string // "skip" or "keep"
	}{
		{95, "skip"},   // visible in snapshot (< xmin)
		{100, "skip"},  // visible (= xmin, not in xip)
		{102, "keep"},  // in xip_list
		{105, "keep"},  // in xip_list
		{108, "skip"},  // visible (between xmin/xmax, not in xip)
		{110, "keep"},  // >= xmax
		{115, "keep"},  // >= xmax
	}

	for _, txn := range walTxns {
		shouldSkip := snap.ShouldSkipTransaction(txn.txid)
		if txn.expected == "skip" {
			assert.True(t, shouldSkip, "txid %d should be skipped", txn.txid)
		} else {
			assert.False(t, shouldSkip, "txid %d should be kept", txn.txid)
		}
	}

	// 3. Check when to stop filtering
	// After seeing txid >= xmax, we can stop filtering
	assert.True(t, snap.AfterSnapshot(110), "txid 110 is after snapshot")

	// Disable filtering
	snap.FilterTxns = false

	// Now nothing should be skipped
	assert.False(t, snap.ShouldSkipTransaction(95))
	assert.False(t, snap.ShouldSkipTransaction(100))
}

func TestBuildQueryWithAllOptions(t *testing.T) {
	tableSchema := schema.NewTableSchema("my_schema", "my_table", []schema.Column{
		{Name: "pk1", Type: "int4", PKIndex: 0, NotNull: true},
		{Name: "pk2", Type: "text", PKIndex: 1, NotNull: true},
		{Name: "col1", Type: "text", PKIndex: -1},
		{Name: "col2", Type: "int4", PKIndex: -1},
		{Name: "col3", Type: "boolean", PKIndex: -1},
	})

	s, err := shape.New("my_table",
		shape.WithSchema("my_schema"),
		shape.WithColumns([]string{"col1", "col2"}),
		shape.WithWhere("col2 > 10"),
		shape.WithTableSchema(tableSchema),
	)
	require.NoError(t, err)

	query := BuildQuery(s, tableSchema)

	// Should have selected columns + PKs
	assert.Contains(t, query, `"col1"`)
	assert.Contains(t, query, `"col2"`)
	assert.Contains(t, query, `"pk1"`)
	assert.Contains(t, query, `"pk2"`)

	// Should NOT have unselected columns
	assert.NotContains(t, query, `"col3"`)

	// Should have WHERE clause
	assert.Contains(t, query, "WHERE")

	// Should have ORDER BY with both PKs
	assert.Contains(t, query, "ORDER BY")
	assert.Contains(t, query, `"pk1"`)
	assert.Contains(t, query, `"pk2"`)
}

// ============================================================================
// Edge Case Tests
// ============================================================================

func TestPgSnapshotLargeXipList(t *testing.T) {
	// Create snapshot with many in-progress transactions
	xipList := make([]int64, 100)
	xipStrs := make([]string, 100)
	for i := range xipList {
		xipList[i] = int64(100 + i)
		xipStrs[i] = string(rune('0'+i/10)) + string(rune('0'+i%10)) + "0" // 100, 110, 120, etc simplified
	}

	// Build input string with actual numbers
	var sb strings.Builder
	sb.WriteString("50:200:")
	for i := 0; i < 100; i++ {
		if i > 0 {
			sb.WriteString(",")
		}
		sb.WriteString(string(rune('1')))
		sb.WriteString(string(rune('0' + i/10)))
		sb.WriteString(string(rune('0' + i%10)))
	}

	snap, err := ParsePgSnapshot(sb.String())
	require.NoError(t, err)
	assert.Len(t, snap.XipList, 100)

	// Check visibility for some xip values
	assert.False(t, snap.Contains(100)) // first xip
	assert.False(t, snap.Contains(150)) // middle xip
	assert.False(t, snap.Contains(199)) // last xip

	// Values not in xip should be visible if < xmax
	assert.True(t, snap.Contains(99)) // < first xip and < xmin technically this doesn't hit the xip path
}

func TestParsePgSnapshotXipWithSpaces(t *testing.T) {
	// Test that spaces in xip_list are handled
	snap, err := ParsePgSnapshot("100:110: 102 , 103 , 104 ")
	require.NoError(t, err)
	assert.Equal(t, []int64{102, 103, 104}, snap.XipList)
}

func TestToLogItemsWithNilValues(t *testing.T) {
	tableSchema := schema.NewTableSchema("public", "test", []schema.Column{
		{Name: "id", Type: "int4", PKIndex: 0, NotNull: true},
		{Name: "nullable_col", Type: "text", PKIndex: -1},
	})

	rows := []map[string]any{
		{"id": int64(1), "nullable_col": nil},
	}

	items := ToLogItems(rows, tableSchema, "public", "test", offset.InitialOffset)
	require.Len(t, items, 1)

	// The nil value should be converted to empty string
	assert.Equal(t, "", items[0].Op.Value["nullable_col"])
}

func TestToLogItemsStartOffsetRespected(t *testing.T) {
	tableSchema := schema.NewTableSchema("public", "test", []schema.Column{
		{Name: "id", Type: "int4", PKIndex: 0, NotNull: true},
	})

	rows := []map[string]any{
		{"id": int64(1)},
		{"id": int64(2)},
	}

	// Start from a non-zero offset
	startOffset := offset.MustNew(1000, 50)
	items := ToLogItems(rows, tableSchema, "public", "test", startOffset)

	require.Len(t, items, 2)
	assert.Equal(t, offset.LogOffset{TxOffset: 1000, OpOffset: 50}, items[0].Offset)
	assert.Equal(t, offset.LogOffset{TxOffset: 1000, OpOffset: 51}, items[1].Offset)
}

// Test for errors
func TestExecuteWithNilDB(t *testing.T) {
	executor := &Executor{db: nil}
	s, _ := shape.New("test")
	_, err := executor.Execute(context.Background(), s)

	// Should error because db is nil
	require.Error(t, err)
	assert.Contains(t, err.Error(), "database connection is nil")
}

// Helper function to create string pointer
func strPtr(s string) *string {
	return &s
}

// Test roundtrip of pg_snapshot string conversion
func TestPgSnapshotRoundtrip(t *testing.T) {
	tests := []struct {
		input string
	}{
		{"100:105:102,103"},
		{"1:10:5"},
		{"0:0:"},
		{"100:100:"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			snap, err := ParsePgSnapshot(tt.input)
			require.NoError(t, err)

			// Convert back to string and parse again
			str := snap.String()
			snap2, err := ParsePgSnapshot(str)
			require.NoError(t, err)

			assert.Equal(t, snap.Xmin, snap2.Xmin)
			assert.Equal(t, snap.Xmax, snap2.Xmax)
			assert.Equal(t, snap.XipList, snap2.XipList)
		})
	}
}

// ============================================================================
// Benchmark Tests
// ============================================================================

func BenchmarkParsePgSnapshot(b *testing.B) {
	input := "100:200:102,103,104,105,110,115,120,125,130,135"
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = ParsePgSnapshot(input)
	}
}

func BenchmarkPgSnapshotContains(b *testing.B) {
	snap := &PgSnapshot{
		Xmin:       100,
		Xmax:       1000,
		XipList:    []int64{102, 103, 104, 105, 110, 115, 120, 125, 130, 135},
		FilterTxns: true,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = snap.Contains(int64(i % 1100))
	}
}

func BenchmarkBuildQuery(b *testing.B) {
	tableSchema := schema.NewTableSchema("public", "users", []schema.Column{
		{Name: "id", Type: "int4", PKIndex: 0, NotNull: true},
		{Name: "name", Type: "text", PKIndex: -1},
		{Name: "email", Type: "text", PKIndex: -1},
	})

	s := &shape.Shape{
		Schema:      "public",
		TableName:   "users",
		TableSchema: tableSchema,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = BuildQuery(s, tableSchema)
	}
}

func BenchmarkToLogItems(b *testing.B) {
	tableSchema := schema.NewTableSchema("public", "users", []schema.Column{
		{Name: "id", Type: "int4", PKIndex: 0, NotNull: true},
		{Name: "name", Type: "text", PKIndex: -1},
	})

	rows := make([]map[string]any, 100)
	for i := range rows {
		rows[i] = map[string]any{"id": int64(i), "name": "User"}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = ToLogItems(rows, tableSchema, "public", "users", offset.InitialOffset)
	}
}

// Test errors package import workaround (to avoid unused import error)
var _ = errors.New("test")
