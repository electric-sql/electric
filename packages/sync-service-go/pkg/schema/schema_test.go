// Package schema tests
// Ported from: test/electric/schema_test.exs
package schema

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestColumn_IsPrimaryKey(t *testing.T) {
	tests := []struct {
		name     string
		pkIndex  int
		expected bool
	}{
		{"PKIndex -1 is not PK", -1, false},
		{"PKIndex 0 is PK", 0, true},
		{"PKIndex 1 is PK", 1, true},
		{"PKIndex 10 is PK", 10, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			col := Column{Name: "test", Type: "int4", PKIndex: tt.pkIndex}
			if got := col.IsPrimaryKey(); got != tt.expected {
				t.Errorf("IsPrimaryKey() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestNewTableSchema(t *testing.T) {
	t.Run("default schema is public", func(t *testing.T) {
		ts := NewTableSchema("", "users", nil)
		if ts.Schema != "public" {
			t.Errorf("Schema = %q, want %q", ts.Schema, "public")
		}
	})

	t.Run("custom schema is preserved", func(t *testing.T) {
		ts := NewTableSchema("myschema", "users", nil)
		if ts.Schema != "myschema" {
			t.Errorf("Schema = %q, want %q", ts.Schema, "myschema")
		}
	})

	t.Run("name is preserved", func(t *testing.T) {
		ts := NewTableSchema("public", "users", nil)
		if ts.Name != "users" {
			t.Errorf("Name = %q, want %q", ts.Name, "users")
		}
	})

	t.Run("columns are preserved", func(t *testing.T) {
		cols := []Column{{Name: "id", Type: "int4"}}
		ts := NewTableSchema("public", "users", cols)
		if len(ts.Columns) != 1 {
			t.Errorf("len(Columns) = %d, want %d", len(ts.Columns), 1)
		}
	})
}

func TestTableSchema_GetColumn(t *testing.T) {
	cols := []Column{
		{Name: "id", Type: "int4", PKIndex: 0},
		{Name: "name", Type: "text", PKIndex: -1},
		{Name: "email", Type: "varchar", PKIndex: -1},
	}
	ts := NewTableSchema("public", "users", cols)

	t.Run("finds existing column", func(t *testing.T) {
		col := ts.GetColumn("name")
		if col == nil {
			t.Fatal("expected to find column 'name'")
		}
		if col.Name != "name" {
			t.Errorf("Name = %q, want %q", col.Name, "name")
		}
		if col.Type != "text" {
			t.Errorf("Type = %q, want %q", col.Type, "text")
		}
	})

	t.Run("returns nil for non-existent column", func(t *testing.T) {
		col := ts.GetColumn("nonexistent")
		if col != nil {
			t.Errorf("expected nil, got %+v", col)
		}
	})

	t.Run("column lookup is case-sensitive", func(t *testing.T) {
		col := ts.GetColumn("Name")
		if col != nil {
			t.Errorf("expected nil for case-mismatched name, got %+v", col)
		}
	})
}

func TestTableSchema_PrimaryKeyColumns(t *testing.T) {
	t.Run("single primary key", func(t *testing.T) {
		cols := []Column{
			{Name: "id", Type: "int4", PKIndex: 0},
			{Name: "name", Type: "text", PKIndex: -1},
		}
		ts := NewTableSchema("public", "users", cols)
		pkCols := ts.PrimaryKeyColumns()

		if len(pkCols) != 1 {
			t.Fatalf("expected 1 PK column, got %d", len(pkCols))
		}
		if pkCols[0].Name != "id" {
			t.Errorf("PK column name = %q, want %q", pkCols[0].Name, "id")
		}
	})

	t.Run("composite primary key", func(t *testing.T) {
		cols := []Column{
			{Name: "tenant_id", Type: "int4", PKIndex: 0},
			{Name: "name", Type: "text", PKIndex: -1},
			{Name: "user_id", Type: "int4", PKIndex: 1},
		}
		ts := NewTableSchema("public", "users", cols)
		pkCols := ts.PrimaryKeyColumns()

		if len(pkCols) != 2 {
			t.Fatalf("expected 2 PK columns, got %d", len(pkCols))
		}
		// Should be sorted by PKIndex
		if pkCols[0].Name != "tenant_id" {
			t.Errorf("first PK column = %q, want %q", pkCols[0].Name, "tenant_id")
		}
		if pkCols[1].Name != "user_id" {
			t.Errorf("second PK column = %q, want %q", pkCols[1].Name, "user_id")
		}
	})

	t.Run("no primary key", func(t *testing.T) {
		cols := []Column{
			{Name: "id", Type: "int4", PKIndex: -1},
			{Name: "name", Type: "text", PKIndex: -1},
		}
		ts := NewTableSchema("public", "users", cols)
		pkCols := ts.PrimaryKeyColumns()

		if len(pkCols) != 0 {
			t.Errorf("expected 0 PK columns, got %d", len(pkCols))
		}
	})
}

func TestTableSchema_PrimaryKeyColumnNames(t *testing.T) {
	t.Run("returns names in order", func(t *testing.T) {
		cols := []Column{
			{Name: "name", Type: "text", PKIndex: -1},
			{Name: "user_id", Type: "int4", PKIndex: 1},
			{Name: "tenant_id", Type: "int4", PKIndex: 0},
		}
		ts := NewTableSchema("public", "users", cols)
		names := ts.PrimaryKeyColumnNames()

		if len(names) != 2 {
			t.Fatalf("expected 2 names, got %d", len(names))
		}
		if names[0] != "tenant_id" {
			t.Errorf("first name = %q, want %q", names[0], "tenant_id")
		}
		if names[1] != "user_id" {
			t.Errorf("second name = %q, want %q", names[1], "user_id")
		}
	})
}

func TestTableSchema_ColumnNames(t *testing.T) {
	cols := []Column{
		{Name: "id", Type: "int4"},
		{Name: "name", Type: "text"},
		{Name: "email", Type: "varchar"},
	}
	ts := NewTableSchema("public", "users", cols)
	names := ts.ColumnNames()

	if len(names) != 3 {
		t.Fatalf("expected 3 names, got %d", len(names))
	}
	// Order should match column order
	expected := []string{"id", "name", "email"}
	for i, exp := range expected {
		if names[i] != exp {
			t.Errorf("names[%d] = %q, want %q", i, names[i], exp)
		}
	}
}

func TestSchemaHeader_SimpleInt4PK(t *testing.T) {
	cols := []Column{
		{Name: "id", Type: "int4", PKIndex: 0, NotNull: true},
	}
	ts := NewTableSchema("public", "users", cols)
	header := ts.SchemaHeader()

	var result map[string]map[string]interface{}
	if err := json.Unmarshal([]byte(header), &result); err != nil {
		t.Fatalf("failed to unmarshal header: %v", err)
	}

	id, ok := result["id"]
	if !ok {
		t.Fatal("expected 'id' key in schema header")
	}
	if id["type"] != "int4" {
		t.Errorf("type = %v, want %q", id["type"], "int4")
	}
	if id["pk_index"] != float64(0) {
		t.Errorf("pk_index = %v, want %v", id["pk_index"], 0)
	}
	if id["not_null"] != true {
		t.Errorf("not_null = %v, want %v", id["not_null"], true)
	}
}

func TestSchemaHeader_TextColumn(t *testing.T) {
	cols := []Column{
		{Name: "name", Type: "text", PKIndex: -1},
	}
	ts := NewTableSchema("public", "users", cols)
	header := ts.SchemaHeader()

	var result map[string]map[string]interface{}
	if err := json.Unmarshal([]byte(header), &result); err != nil {
		t.Fatalf("failed to unmarshal header: %v", err)
	}

	name, ok := result["name"]
	if !ok {
		t.Fatal("expected 'name' key in schema header")
	}
	if name["type"] != "text" {
		t.Errorf("type = %v, want %q", name["type"], "text")
	}
	// pk_index should be omitted
	if _, exists := name["pk_index"]; exists {
		t.Errorf("pk_index should be omitted for non-PK columns")
	}
	// not_null should be omitted when false
	if _, exists := name["not_null"]; exists {
		t.Errorf("not_null should be omitted when false")
	}
}

func TestSchemaHeader_ArrayColumn(t *testing.T) {
	cols := []Column{
		{Name: "tags", Type: "text", PKIndex: -1, Dims: 1},
	}
	ts := NewTableSchema("public", "items", cols)
	header := ts.SchemaHeader()

	var result map[string]map[string]interface{}
	if err := json.Unmarshal([]byte(header), &result); err != nil {
		t.Fatalf("failed to unmarshal header: %v", err)
	}

	tags, ok := result["tags"]
	if !ok {
		t.Fatal("expected 'tags' key in schema header")
	}
	if tags["type"] != "text" {
		t.Errorf("type = %v, want %q", tags["type"], "text")
	}
	if tags["dims"] != float64(1) {
		t.Errorf("dims = %v, want %v", tags["dims"], 1)
	}
}

func TestSchemaHeader_VarcharWithMaxLength(t *testing.T) {
	cols := []Column{
		{Name: "email", Type: "varchar", PKIndex: -1, MaxLength: 255},
	}
	ts := NewTableSchema("public", "users", cols)
	header := ts.SchemaHeader()

	var result map[string]map[string]interface{}
	if err := json.Unmarshal([]byte(header), &result); err != nil {
		t.Fatalf("failed to unmarshal header: %v", err)
	}

	email, ok := result["email"]
	if !ok {
		t.Fatal("expected 'email' key in schema header")
	}
	if email["type"] != "varchar" {
		t.Errorf("type = %v, want %q", email["type"], "varchar")
	}
	if email["max_length"] != float64(255) {
		t.Errorf("max_length = %v, want %v", email["max_length"], 255)
	}
}

func TestSchemaHeader_NumericWithPrecisionAndScale(t *testing.T) {
	cols := []Column{
		{Name: "price", Type: "numeric", PKIndex: -1, Precision: 10, Scale: 2},
	}
	ts := NewTableSchema("public", "products", cols)
	header := ts.SchemaHeader()

	var result map[string]map[string]interface{}
	if err := json.Unmarshal([]byte(header), &result); err != nil {
		t.Fatalf("failed to unmarshal header: %v", err)
	}

	price, ok := result["price"]
	if !ok {
		t.Fatal("expected 'price' key in schema header")
	}
	if price["type"] != "numeric" {
		t.Errorf("type = %v, want %q", price["type"], "numeric")
	}
	if price["precision"] != float64(10) {
		t.Errorf("precision = %v, want %v", price["precision"], 10)
	}
	if price["scale"] != float64(2) {
		t.Errorf("scale = %v, want %v", price["scale"], 2)
	}
}

func TestSchemaHeader_NumericWithPrecisionOnly(t *testing.T) {
	// NUMERIC(5) has precision 5 and scale 0
	cols := []Column{
		{Name: "quantity", Type: "numeric", PKIndex: -1, Precision: 5, Scale: 0},
	}
	ts := NewTableSchema("public", "orders", cols)
	header := ts.SchemaHeader()

	var result map[string]map[string]interface{}
	if err := json.Unmarshal([]byte(header), &result); err != nil {
		t.Fatalf("failed to unmarshal header: %v", err)
	}

	qty, ok := result["quantity"]
	if !ok {
		t.Fatal("expected 'quantity' key in schema header")
	}
	if qty["precision"] != float64(5) {
		t.Errorf("precision = %v, want %v", qty["precision"], 5)
	}
	if qty["scale"] != float64(0) {
		t.Errorf("scale = %v, want %v", qty["scale"], 0)
	}
}

func TestSchemaHeader_MultipleColumns(t *testing.T) {
	cols := []Column{
		{Name: "id", Type: "int4", PKIndex: 0, NotNull: true},
		{Name: "name", Type: "text", PKIndex: -1},
		{Name: "created_at", Type: "timestamptz", PKIndex: -1},
	}
	ts := NewTableSchema("public", "users", cols)
	header := ts.SchemaHeader()

	var result map[string]map[string]interface{}
	if err := json.Unmarshal([]byte(header), &result); err != nil {
		t.Fatalf("failed to unmarshal header: %v", err)
	}

	if len(result) != 3 {
		t.Errorf("expected 3 columns in header, got %d", len(result))
	}

	// Check each column exists
	for _, colName := range []string{"id", "name", "created_at"} {
		if _, ok := result[colName]; !ok {
			t.Errorf("expected column %q in schema header", colName)
		}
	}
}

func TestSchemaHeader_CompositePK(t *testing.T) {
	cols := []Column{
		{Name: "tenant_id", Type: "int4", PKIndex: 0, NotNull: true},
		{Name: "user_id", Type: "int4", PKIndex: 1, NotNull: true},
		{Name: "name", Type: "text", PKIndex: -1},
	}
	ts := NewTableSchema("public", "users", cols)
	header := ts.SchemaHeader()

	var result map[string]map[string]interface{}
	if err := json.Unmarshal([]byte(header), &result); err != nil {
		t.Fatalf("failed to unmarshal header: %v", err)
	}

	if result["tenant_id"]["pk_index"] != float64(0) {
		t.Errorf("tenant_id pk_index = %v, want %v", result["tenant_id"]["pk_index"], 0)
	}
	if result["user_id"]["pk_index"] != float64(1) {
		t.Errorf("user_id pk_index = %v, want %v", result["user_id"]["pk_index"], 1)
	}
	if _, exists := result["name"]["pk_index"]; exists {
		t.Errorf("name should not have pk_index")
	}
}

func TestSchemaHeader_NotNullColumn(t *testing.T) {
	cols := []Column{
		{Name: "id", Type: "int4", PKIndex: 0, NotNull: true},
		{Name: "name", Type: "text", PKIndex: -1, NotNull: true},
		{Name: "email", Type: "varchar", PKIndex: -1, NotNull: false},
	}
	ts := NewTableSchema("public", "users", cols)
	header := ts.SchemaHeader()

	var result map[string]map[string]interface{}
	if err := json.Unmarshal([]byte(header), &result); err != nil {
		t.Fatalf("failed to unmarshal header: %v", err)
	}

	// id and name should have not_null: true
	if result["id"]["not_null"] != true {
		t.Errorf("id not_null = %v, want %v", result["id"]["not_null"], true)
	}
	if result["name"]["not_null"] != true {
		t.Errorf("name not_null = %v, want %v", result["name"]["not_null"], true)
	}
	// email should not have not_null key
	if _, exists := result["email"]["not_null"]; exists {
		t.Errorf("email should not have not_null key when false")
	}
}

func TestSchemaHeader_EmptyColumnList(t *testing.T) {
	ts := NewTableSchema("public", "empty", []Column{})
	header := ts.SchemaHeader()

	if header != "{}" {
		t.Errorf("header = %q, want %q", header, "{}")
	}
}

func TestSchemaHeader_BitWithLength(t *testing.T) {
	cols := []Column{
		{Name: "flags", Type: "bit", PKIndex: -1, Length: 8},
	}
	ts := NewTableSchema("public", "items", cols)
	header := ts.SchemaHeader()

	var result map[string]map[string]interface{}
	if err := json.Unmarshal([]byte(header), &result); err != nil {
		t.Fatalf("failed to unmarshal header: %v", err)
	}

	flags, ok := result["flags"]
	if !ok {
		t.Fatal("expected 'flags' key in schema header")
	}
	if flags["type"] != "bit" {
		t.Errorf("type = %v, want %q", flags["type"], "bit")
	}
	if flags["length"] != float64(8) {
		t.Errorf("length = %v, want %v", flags["length"], 8)
	}
}

func TestSchemaHeader_TimeWithPrecision(t *testing.T) {
	cols := []Column{
		{Name: "event_time", Type: "time", PKIndex: -1, Precision: 3},
	}
	ts := NewTableSchema("public", "events", cols)
	header := ts.SchemaHeader()

	var result map[string]map[string]interface{}
	if err := json.Unmarshal([]byte(header), &result); err != nil {
		t.Fatalf("failed to unmarshal header: %v", err)
	}

	eventTime, ok := result["event_time"]
	if !ok {
		t.Fatal("expected 'event_time' key in schema header")
	}
	if eventTime["type"] != "time" {
		t.Errorf("type = %v, want %q", eventTime["type"], "time")
	}
	if eventTime["precision"] != float64(3) {
		t.Errorf("precision = %v, want %v", eventTime["precision"], 3)
	}
}

func TestSchemaHeader_IntervalWithFields(t *testing.T) {
	tests := []struct {
		name     string
		fields   string
		expected string
	}{
		{"YEAR", "YEAR", "YEAR"},
		{"MONTH", "MONTH", "MONTH"},
		{"DAY", "DAY", "DAY"},
		{"HOUR", "HOUR", "HOUR"},
		{"MINUTE", "MINUTE", "MINUTE"},
		{"SECOND", "SECOND", "SECOND"},
		{"YEAR TO MONTH", "YEAR TO MONTH", "YEAR TO MONTH"},
		{"DAY TO HOUR", "DAY TO HOUR", "DAY TO HOUR"},
		{"DAY TO MINUTE", "DAY TO MINUTE", "DAY TO MINUTE"},
		{"DAY TO SECOND", "DAY TO SECOND", "DAY TO SECOND"},
		{"HOUR TO MINUTE", "HOUR TO MINUTE", "HOUR TO MINUTE"},
		{"HOUR TO SECOND", "HOUR TO SECOND", "HOUR TO SECOND"},
		{"MINUTE TO SECOND", "MINUTE TO SECOND", "MINUTE TO SECOND"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cols := []Column{
				{Name: "duration", Type: "interval", PKIndex: -1, Fields: tt.fields},
			}
			ts := NewTableSchema("public", "events", cols)
			header := ts.SchemaHeader()

			var result map[string]map[string]interface{}
			if err := json.Unmarshal([]byte(header), &result); err != nil {
				t.Fatalf("failed to unmarshal header: %v", err)
			}

			duration, ok := result["duration"]
			if !ok {
				t.Fatal("expected 'duration' key in schema header")
			}
			if duration["fields"] != tt.expected {
				t.Errorf("fields = %v, want %q", duration["fields"], tt.expected)
			}
		})
	}
}

func TestSchemaHeader_IntervalWithPrecision(t *testing.T) {
	cols := []Column{
		{Name: "duration", Type: "interval", PKIndex: -1, Precision: 4, Fields: "SECOND"},
	}
	ts := NewTableSchema("public", "events", cols)
	header := ts.SchemaHeader()

	var result map[string]map[string]interface{}
	if err := json.Unmarshal([]byte(header), &result); err != nil {
		t.Fatalf("failed to unmarshal header: %v", err)
	}

	duration, ok := result["duration"]
	if !ok {
		t.Fatal("expected 'duration' key in schema header")
	}
	if duration["precision"] != float64(4) {
		t.Errorf("precision = %v, want %v", duration["precision"], 4)
	}
	if duration["fields"] != "SECOND" {
		t.Errorf("fields = %v, want %q", duration["fields"], "SECOND")
	}
}

func TestSchemaHeader_MultiDimensionalArray(t *testing.T) {
	cols := []Column{
		{Name: "matrix", Type: "int4", PKIndex: -1, Dims: 2},
	}
	ts := NewTableSchema("public", "data", cols)
	header := ts.SchemaHeader()

	var result map[string]map[string]interface{}
	if err := json.Unmarshal([]byte(header), &result); err != nil {
		t.Fatalf("failed to unmarshal header: %v", err)
	}

	matrix, ok := result["matrix"]
	if !ok {
		t.Fatal("expected 'matrix' key in schema header")
	}
	if matrix["dims"] != float64(2) {
		t.Errorf("dims = %v, want %v", matrix["dims"], 2)
	}
}

func TestSchemaHeader_TypeMod(t *testing.T) {
	// For custom types that don't have special handling, include raw type_mod
	cols := []Column{
		{Name: "custom", Type: "mytype", PKIndex: -1, TypeMod: 42},
	}
	ts := NewTableSchema("public", "items", cols)
	header := ts.SchemaHeader()

	var result map[string]map[string]interface{}
	if err := json.Unmarshal([]byte(header), &result); err != nil {
		t.Fatalf("failed to unmarshal header: %v", err)
	}

	custom, ok := result["custom"]
	if !ok {
		t.Fatal("expected 'custom' key in schema header")
	}
	if custom["type_mod"] != float64(42) {
		t.Errorf("type_mod = %v, want %v", custom["type_mod"], 42)
	}
}

func TestSchemaHeader_AllFieldsSet(t *testing.T) {
	// Test a column with all optional fields set
	cols := []Column{
		{
			Name:      "complex",
			Type:      "varchar",
			PKIndex:   0,
			NotNull:   true,
			Dims:      1,
			MaxLength: 100,
		},
	}
	ts := NewTableSchema("public", "test", cols)
	header := ts.SchemaHeader()

	var result map[string]map[string]interface{}
	if err := json.Unmarshal([]byte(header), &result); err != nil {
		t.Fatalf("failed to unmarshal header: %v", err)
	}

	complex, ok := result["complex"]
	if !ok {
		t.Fatal("expected 'complex' key in schema header")
	}

	// Verify all fields are present
	if complex["type"] != "varchar" {
		t.Errorf("type = %v, want %q", complex["type"], "varchar")
	}
	if complex["pk_index"] != float64(0) {
		t.Errorf("pk_index = %v, want %v", complex["pk_index"], 0)
	}
	if complex["not_null"] != true {
		t.Errorf("not_null = %v, want %v", complex["not_null"], true)
	}
	if complex["dims"] != float64(1) {
		t.Errorf("dims = %v, want %v", complex["dims"], 1)
	}
	if complex["max_length"] != float64(100) {
		t.Errorf("max_length = %v, want %v", complex["max_length"], 100)
	}
}

func TestEncodeSchemaHeader(t *testing.T) {
	// Test the standalone function
	cols := []Column{
		{Name: "id", Type: "int4", PKIndex: 0},
		{Name: "name", Type: "text", PKIndex: -1},
	}
	header := EncodeSchemaHeader(cols)

	var result map[string]map[string]interface{}
	if err := json.Unmarshal([]byte(header), &result); err != nil {
		t.Fatalf("failed to unmarshal header: %v", err)
	}

	if len(result) != 2 {
		t.Errorf("expected 2 columns, got %d", len(result))
	}
}

// Test cases ported from Elixir schema_test.exs
func TestSchemaHeader_PostgresTypes(t *testing.T) {
	testCases := []struct {
		name     string
		column   Column
		expected map[string]interface{}
	}{
		{
			name:     "int2",
			column:   Column{Name: "value", Type: "int2", PKIndex: -1},
			expected: map[string]interface{}{"type": "int2"},
		},
		{
			name:     "int4",
			column:   Column{Name: "value", Type: "int4", PKIndex: -1},
			expected: map[string]interface{}{"type": "int4"},
		},
		{
			name:     "int8",
			column:   Column{Name: "value", Type: "int8", PKIndex: -1},
			expected: map[string]interface{}{"type": "int8"},
		},
		{
			name:     "serial (int4 not null)",
			column:   Column{Name: "value", Type: "int4", PKIndex: -1, NotNull: true},
			expected: map[string]interface{}{"type": "int4", "not_null": true},
		},
		{
			name:     "varchar",
			column:   Column{Name: "value", Type: "varchar", PKIndex: -1},
			expected: map[string]interface{}{"type": "varchar"},
		},
		{
			name:     "varchar(123)",
			column:   Column{Name: "value", Type: "varchar", PKIndex: -1, MaxLength: 123},
			expected: map[string]interface{}{"type": "varchar", "max_length": float64(123)},
		},
		{
			name:     "varchar(123)[]",
			column:   Column{Name: "value", Type: "varchar", PKIndex: -1, MaxLength: 123, Dims: 1},
			expected: map[string]interface{}{"type": "varchar", "max_length": float64(123), "dims": float64(1)},
		},
		{
			name:     "varchar(123)[][]",
			column:   Column{Name: "value", Type: "varchar", PKIndex: -1, MaxLength: 123, Dims: 2},
			expected: map[string]interface{}{"type": "varchar", "max_length": float64(123), "dims": float64(2)},
		},
		{
			name:     "bpchar(9)",
			column:   Column{Name: "value", Type: "bpchar", PKIndex: -1, Length: 9},
			expected: map[string]interface{}{"type": "bpchar", "length": float64(9)},
		},
		{
			name:     "text",
			column:   Column{Name: "value", Type: "text", PKIndex: -1},
			expected: map[string]interface{}{"type": "text"},
		},
		{
			name:     "time",
			column:   Column{Name: "value", Type: "time", PKIndex: -1},
			expected: map[string]interface{}{"type": "time"},
		},
		{
			name:     "time(3)",
			column:   Column{Name: "value", Type: "time", PKIndex: -1, Precision: 3},
			expected: map[string]interface{}{"type": "time", "precision": float64(3)},
		},
		{
			name:     "timestamp",
			column:   Column{Name: "value", Type: "timestamp", PKIndex: -1},
			expected: map[string]interface{}{"type": "timestamp"},
		},
		{
			name:     "timestamp(3)",
			column:   Column{Name: "value", Type: "timestamp", PKIndex: -1, Precision: 3},
			expected: map[string]interface{}{"type": "timestamp", "precision": float64(3)},
		},
		{
			name:     "timestamptz",
			column:   Column{Name: "value", Type: "timestamptz", PKIndex: -1},
			expected: map[string]interface{}{"type": "timestamptz"},
		},
		{
			name:     "interval",
			column:   Column{Name: "value", Type: "interval", PKIndex: -1},
			expected: map[string]interface{}{"type": "interval"},
		},
		{
			name:     "interval year",
			column:   Column{Name: "value", Type: "interval", PKIndex: -1, Fields: "YEAR"},
			expected: map[string]interface{}{"type": "interval", "fields": "YEAR"},
		},
		{
			name:     "interval(4)",
			column:   Column{Name: "value", Type: "interval", PKIndex: -1, Precision: 4},
			expected: map[string]interface{}{"type": "interval", "precision": float64(4)},
		},
		{
			name:     "bool",
			column:   Column{Name: "value", Type: "bool", PKIndex: -1},
			expected: map[string]interface{}{"type": "bool"},
		},
		{
			name:     "numeric",
			column:   Column{Name: "value", Type: "numeric", PKIndex: -1},
			expected: map[string]interface{}{"type": "numeric"},
		},
		{
			name:     "numeric(5,3)",
			column:   Column{Name: "value", Type: "numeric", PKIndex: -1, Precision: 5, Scale: 3},
			expected: map[string]interface{}{"type": "numeric", "precision": float64(5), "scale": float64(3)},
		},
		{
			name:     "numeric(5)",
			column:   Column{Name: "value", Type: "numeric", PKIndex: -1, Precision: 5, Scale: 0},
			expected: map[string]interface{}{"type": "numeric", "precision": float64(5), "scale": float64(0)},
		},
		{
			name:     "float4",
			column:   Column{Name: "value", Type: "float4", PKIndex: -1},
			expected: map[string]interface{}{"type": "float4"},
		},
		{
			name:     "float8",
			column:   Column{Name: "value", Type: "float8", PKIndex: -1},
			expected: map[string]interface{}{"type": "float8"},
		},
		{
			name:     "bit(5)",
			column:   Column{Name: "value", Type: "bit", PKIndex: -1, Length: 5},
			expected: map[string]interface{}{"type": "bit", "length": float64(5)},
		},
		{
			name:     "varbit(5)",
			column:   Column{Name: "value", Type: "varbit", PKIndex: -1, Length: 5},
			expected: map[string]interface{}{"type": "varbit", "length": float64(5)},
		},
		{
			name:     "uuid",
			column:   Column{Name: "value", Type: "uuid", PKIndex: -1},
			expected: map[string]interface{}{"type": "uuid"},
		},
		{
			name:     "json",
			column:   Column{Name: "value", Type: "json", PKIndex: -1},
			expected: map[string]interface{}{"type": "json"},
		},
		{
			name:     "jsonb",
			column:   Column{Name: "value", Type: "jsonb", PKIndex: -1},
			expected: map[string]interface{}{"type": "jsonb"},
		},
		{
			name:     "bytea",
			column:   Column{Name: "value", Type: "bytea", PKIndex: -1},
			expected: map[string]interface{}{"type": "bytea"},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			cols := []Column{tc.column}
			header := EncodeSchemaHeader(cols)

			var result map[string]map[string]interface{}
			if err := json.Unmarshal([]byte(header), &result); err != nil {
				t.Fatalf("failed to unmarshal header: %v", err)
			}

			schema, ok := result["value"]
			if !ok {
				t.Fatal("expected 'value' key in schema header")
			}

			for key, expectedVal := range tc.expected {
				actualVal, exists := schema[key]
				if !exists {
					t.Errorf("expected key %q in schema", key)
					continue
				}
				if actualVal != expectedVal {
					t.Errorf("%s = %v, want %v", key, actualVal, expectedVal)
				}
			}

			// Check no extra keys
			for key := range schema {
				if _, expected := tc.expected[key]; !expected {
					t.Errorf("unexpected key %q in schema", key)
				}
			}
		})
	}
}

func TestSchemaHeader_ExpectedFormat(t *testing.T) {
	// Test the exact format from the requirements
	cols := []Column{
		{Name: "id", Type: "int4", PKIndex: 0},
		{Name: "name", Type: "text", PKIndex: -1},
		{Name: "created_at", Type: "timestamptz", PKIndex: -1},
	}
	header := EncodeSchemaHeader(cols)

	// Verify it's valid JSON
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(header), &result); err != nil {
		t.Fatalf("header is not valid JSON: %v", err)
	}

	// Verify structure
	if len(result) != 3 {
		t.Errorf("expected 3 columns, got %d", len(result))
	}

	// Verify id has pk_index 0
	idMap := result["id"].(map[string]interface{})
	if idMap["pk_index"] != float64(0) {
		t.Errorf("id.pk_index = %v, want 0", idMap["pk_index"])
	}

	// Verify name has no pk_index
	nameMap := result["name"].(map[string]interface{})
	if _, exists := nameMap["pk_index"]; exists {
		t.Error("name should not have pk_index")
	}
}

func TestTableSchema_Validate(t *testing.T) {
	tests := []struct {
		name    string
		schema  *TableSchema
		wantErr bool
		errMsg  string
	}{
		{
			name: "valid schema with PK",
			schema: NewTableSchema("public", "users", []Column{
				{Name: "id", Type: "int4", PKIndex: 0},
				{Name: "name", Type: "text", PKIndex: -1},
			}),
			wantErr: false,
		},
		{
			name:    "no columns",
			schema:  NewTableSchema("public", "empty", []Column{}),
			wantErr: true,
			errMsg:  "no columns",
		},
		{
			name: "no primary key",
			schema: NewTableSchema("public", "nopk", []Column{
				{Name: "a", Type: "text", PKIndex: -1},
				{Name: "b", Type: "text", PKIndex: -1},
			}),
			wantErr: true,
			errMsg:  "no primary key",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.schema.Validate()
			if tt.wantErr {
				if err == nil {
					t.Errorf("Validate() expected error containing %q, got nil", tt.errMsg)
					return
				}
				if !strings.Contains(err.Error(), tt.errMsg) {
					t.Errorf("Validate() error = %q, want error containing %q", err.Error(), tt.errMsg)
				}
			} else {
				if err != nil {
					t.Errorf("Validate() unexpected error: %v", err)
				}
			}
		})
	}
}
