// Package schema provides types and functions for representing database table schemas
// and encoding them into the x-electric-schema HTTP header format.
//
// Ported from: lib/electric/schema.ex
package schema

import (
	"encoding/json"
	"sort"
)

// Column represents a database column with its type information and constraints.
type Column struct {
	// Name is the column name
	Name string

	// Type is the PostgreSQL type name (e.g., "int4", "text", "timestamptz")
	Type string

	// PKIndex is the position in the primary key (0-indexed), or -1 if not part of PK
	PKIndex int

	// NotNull indicates whether the column has a NOT NULL constraint
	NotNull bool

	// Dims is the number of array dimensions (0 if not an array)
	Dims int

	// MaxLength is the maximum length for varchar types (0 if not applicable)
	MaxLength int

	// Length is the fixed length for char/bit types (0 if not applicable)
	Length int

	// Precision is the precision for numeric/time types (0 if not applicable)
	Precision int

	// Scale is the scale for numeric types (0 if not applicable)
	Scale int

	// Fields is the interval field restriction (empty string if not applicable)
	Fields string

	// TypeMod is the raw type modifier for unknown types (0 if not applicable)
	TypeMod int
}

// IsPrimaryKey returns true if this column is part of the primary key.
func (c Column) IsPrimaryKey() bool {
	return c.PKIndex >= 0
}

// TableSchema represents the schema of a database table.
type TableSchema struct {
	// Schema is the PostgreSQL namespace (default "public")
	Schema string

	// Name is the table name
	Name string

	// Columns is the list of columns in the table
	Columns []Column
}

// NewTableSchema creates a new TableSchema with the given schema namespace, table name, and columns.
// If schema is empty, it defaults to "public".
func NewTableSchema(schema, name string, columns []Column) *TableSchema {
	if schema == "" {
		schema = "public"
	}
	return &TableSchema{
		Schema:  schema,
		Name:    name,
		Columns: columns,
	}
}

// GetColumn returns the column with the given name, or nil if not found.
func (t *TableSchema) GetColumn(name string) *Column {
	for i := range t.Columns {
		if t.Columns[i].Name == name {
			return &t.Columns[i]
		}
	}
	return nil
}

// PrimaryKeyColumns returns the columns that are part of the primary key,
// sorted by their PKIndex.
func (t *TableSchema) PrimaryKeyColumns() []Column {
	var pkCols []Column
	for _, col := range t.Columns {
		if col.IsPrimaryKey() {
			pkCols = append(pkCols, col)
		}
	}
	// Sort by PKIndex
	sort.Slice(pkCols, func(i, j int) bool {
		return pkCols[i].PKIndex < pkCols[j].PKIndex
	})
	return pkCols
}

// PrimaryKeyColumnNames returns the names of the primary key columns in order.
func (t *TableSchema) PrimaryKeyColumnNames() []string {
	pkCols := t.PrimaryKeyColumns()
	names := make([]string, len(pkCols))
	for i, col := range pkCols {
		names[i] = col.Name
	}
	return names
}

// schemaEntry represents a column's type information in the x-electric-schema header.
// Fields with zero values are omitted from JSON output.
type schemaEntry struct {
	Type      string `json:"type"`
	PKIndex   *int   `json:"pk_index,omitempty"`
	NotNull   *bool  `json:"not_null,omitempty"`
	Dims      *int   `json:"dims,omitempty"`
	MaxLength *int   `json:"max_length,omitempty"`
	Length    *int   `json:"length,omitempty"`
	Precision *int   `json:"precision,omitempty"`
	Scale     *int   `json:"scale,omitempty"`
	Fields    string `json:"fields,omitempty"`
	TypeMod   *int   `json:"type_mod,omitempty"`
}

// SchemaHeader returns the JSON-encoded schema for the x-electric-schema HTTP header.
// The format is a JSON object mapping column names to type descriptors.
// Zero-value optional fields are omitted.
//
// Example output:
//
//	{"id":{"type":"int4","pk_index":0},"name":{"type":"text"},"created_at":{"type":"timestamptz"}}
func (t *TableSchema) SchemaHeader() string {
	return EncodeSchemaHeader(t.Columns)
}

// EncodeSchemaHeader encodes a slice of columns into the x-electric-schema header format.
// The format is a JSON object mapping column names to type descriptors.
// Zero-value optional fields are omitted.
func EncodeSchemaHeader(columns []Column) string {
	result := make(map[string]schemaEntry, len(columns))

	for _, col := range columns {
		entry := schemaEntry{
			Type: col.Type,
		}

		// Only include PKIndex if it's a primary key column
		if col.PKIndex >= 0 {
			pkIdx := col.PKIndex
			entry.PKIndex = &pkIdx
		}

		// Only include NotNull if true
		if col.NotNull {
			notNull := true
			entry.NotNull = &notNull
		}

		// Only include Dims if > 0
		if col.Dims > 0 {
			dims := col.Dims
			entry.Dims = &dims
		}

		// Only include MaxLength if > 0
		if col.MaxLength > 0 {
			maxLen := col.MaxLength
			entry.MaxLength = &maxLen
		}

		// Only include Length if > 0
		if col.Length > 0 {
			length := col.Length
			entry.Length = &length
		}

		// Only include Precision if > 0
		if col.Precision > 0 {
			precision := col.Precision
			entry.Precision = &precision
		}

		// Only include Scale for numeric types when precision is set.
		// Scale is only meaningful for the "numeric" type in PostgreSQL.
		// Other types like time, timestamp, interval have precision but not scale.
		if col.Type == "numeric" && col.Precision > 0 {
			scale := col.Scale
			entry.Scale = &scale
		}

		// Only include Fields if non-empty
		if col.Fields != "" {
			entry.Fields = col.Fields
		}

		// Only include TypeMod if > 0
		if col.TypeMod > 0 {
			typeMod := col.TypeMod
			entry.TypeMod = &typeMod
		}

		result[col.Name] = entry
	}

	// Marshal to JSON - errors are not expected for this simple structure
	jsonBytes, err := json.Marshal(result)
	if err != nil {
		// This should never happen with our simple data structures
		return "{}"
	}

	return string(jsonBytes)
}

// ColumnNames returns the names of all columns in the table.
func (t *TableSchema) ColumnNames() []string {
	names := make([]string, len(t.Columns))
	for i, col := range t.Columns {
		names[i] = col.Name
	}
	return names
}
