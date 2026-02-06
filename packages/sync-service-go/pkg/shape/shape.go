// Package shape provides the Shape type representing a subscription to a subset
// of a PostgreSQL table.
//
// Ported from: lib/electric/shapes/shape.ex
package shape

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"

	"github.com/electric-sql/electric/packages/sync-service-go/pkg/schema"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/where"
)

// ReplicaMode specifies what data to include in update/delete operations.
type ReplicaMode string

const (
	// ReplicaDefault includes only changed columns + PK in updates,
	// and only PK in deletes.
	ReplicaDefault ReplicaMode = "default"

	// ReplicaFull includes all columns including unchanged in updates,
	// and all columns in deletes.
	ReplicaFull ReplicaMode = "full"
)

// ValidateReplicaMode checks if the given replica mode is valid.
func ValidateReplicaMode(mode string) (ReplicaMode, error) {
	switch mode {
	case "default", "":
		return ReplicaDefault, nil
	case "full":
		return ReplicaFull, nil
	default:
		return "", fmt.Errorf("invalid replica mode: %q, expected 'default' or 'full'", mode)
	}
}

// Shape represents a subscription to a subset of a PostgreSQL table.
type Shape struct {
	// Schema is the PostgreSQL schema (default: "public")
	Schema string

	// TableName is the table name (required)
	TableName string

	// Where is the optional WHERE clause for filtering rows
	Where *where.WhereClause

	// Columns is the column selection (nil or empty = all columns)
	Columns []string

	// Replica specifies what data to include in update/delete operations
	Replica ReplicaMode

	// TableSchema is derived after schema lookup (optional, filled by caller)
	TableSchema *schema.TableSchema
}

// Option is a functional option for Shape creation.
type Option func(*Shape) error

// New creates a new Shape from a table name and options.
// The table name is required and must not be empty.
func New(tableName string, opts ...Option) (*Shape, error) {
	if tableName == "" {
		return nil, fmt.Errorf("table name is required")
	}

	s := &Shape{
		Schema:    "public",
		TableName: tableName,
		Replica:   ReplicaDefault,
	}

	for _, opt := range opts {
		if err := opt(s); err != nil {
			return nil, err
		}
	}

	// Validate after applying options
	if err := s.Validate(); err != nil {
		return nil, err
	}

	return s, nil
}

// WithSchema sets the PostgreSQL schema for the shape.
// If not called, defaults to "public".
func WithSchema(schemaName string) Option {
	return func(s *Shape) error {
		if schemaName == "" {
			s.Schema = "public"
		} else {
			s.Schema = schemaName
		}
		return nil
	}
}

// WithWhere parses and sets the WHERE clause for the shape.
// The clause should be a valid SQL boolean expression.
func WithWhere(whereClause string) Option {
	return func(s *Shape) error {
		if whereClause == "" {
			s.Where = nil
			return nil
		}

		parsed, err := where.Parse(whereClause)
		if err != nil {
			return fmt.Errorf("invalid WHERE clause: %w", err)
		}

		s.Where = parsed
		return nil
	}
}

// WithWhereClause sets an already-parsed WHERE clause for the shape.
func WithWhereClause(wc *where.WhereClause) Option {
	return func(s *Shape) error {
		s.Where = wc
		return nil
	}
}

// WithColumns sets the columns to include in the shape.
// If empty or nil, all columns are included.
func WithColumns(columns []string) Option {
	return func(s *Shape) error {
		if len(columns) == 0 {
			s.Columns = nil
			return nil
		}

		// Validate column names
		for _, col := range columns {
			if col == "" {
				return fmt.Errorf("column name cannot be empty")
			}
		}

		// Sort and deduplicate columns
		s.Columns = normalizeColumns(columns)
		return nil
	}
}

// WithReplica sets the replica mode for the shape.
func WithReplica(mode ReplicaMode) Option {
	return func(s *Shape) error {
		if mode == "" {
			s.Replica = ReplicaDefault
			return nil
		}

		if mode != ReplicaDefault && mode != ReplicaFull {
			return fmt.Errorf("invalid replica mode: %q", mode)
		}

		s.Replica = mode
		return nil
	}
}

// WithTableSchema sets the table schema information for the shape.
// This is typically set after schema introspection.
func WithTableSchema(ts *schema.TableSchema) Option {
	return func(s *Shape) error {
		s.TableSchema = ts
		return nil
	}
}

// Validate validates the shape configuration.
func (s *Shape) Validate() error {
	if s.TableName == "" {
		return fmt.Errorf("table name is required")
	}

	// Schema defaults to public if empty
	if s.Schema == "" {
		s.Schema = "public"
	}

	// Validate replica mode
	if s.Replica != "" && s.Replica != ReplicaDefault && s.Replica != ReplicaFull {
		return fmt.Errorf("invalid replica mode: %q", s.Replica)
	}

	// Validate column names if specified
	for _, col := range s.Columns {
		if col == "" {
			return fmt.Errorf("column name cannot be empty")
		}
	}

	// If we have a table schema, validate that requested columns exist
	if s.TableSchema != nil && len(s.Columns) > 0 {
		schemaColNames := s.TableSchema.ColumnNames()
		schemaColSet := make(map[string]struct{}, len(schemaColNames))
		for _, col := range schemaColNames {
			schemaColSet[col] = struct{}{}
		}

		var missing []string
		for _, col := range s.Columns {
			if _, ok := schemaColSet[col]; !ok {
				missing = append(missing, col)
			}
		}

		if len(missing) > 0 {
			sort.Strings(missing)
			return fmt.Errorf("unknown column(s): %s", strings.Join(missing, ", "))
		}
	}

	// If we have a table schema and a WHERE clause, validate the columns
	if s.TableSchema != nil && s.Where != nil {
		if err := s.Where.Validate(s.TableSchema.ColumnNames()); err != nil {
			return fmt.Errorf("WHERE clause validation failed: %w", err)
		}
	}

	return nil
}

// Hash returns a deterministic hash of the shape definition.
// This is used for deduplication and handle generation.
// The hash is the first 16 characters of the SHA256 hex digest.
func (s *Shape) Hash() string {
	// Build the hash input by concatenating normalized components
	var parts []string

	// 1. Schema
	parts = append(parts, s.Schema)

	// 2. Table name
	parts = append(parts, s.TableName)

	// 3. Sorted columns (or empty string if all)
	if len(s.Columns) > 0 {
		sortedCols := make([]string, len(s.Columns))
		copy(sortedCols, s.Columns)
		sort.Strings(sortedCols)
		parts = append(parts, strings.Join(sortedCols, ","))
	} else {
		parts = append(parts, "")
	}

	// 4. Normalized WHERE SQL (or empty string if none)
	if s.Where != nil {
		parts = append(parts, s.Where.ToSQL())
	} else {
		parts = append(parts, "")
	}

	// 5. Replica mode
	parts = append(parts, string(s.Replica))

	// Join with a separator and hash
	input := strings.Join(parts, "\x00")
	hash := sha256.Sum256([]byte(input))
	hexHash := hex.EncodeToString(hash[:])

	// Return first 16 characters
	return hexHash[:16]
}

// Matches checks if a record matches this shape's WHERE clause filter.
// Returns (true, nil) if the record matches or if there's no WHERE clause.
// Returns (false, nil) if the record doesn't match.
// Returns (false, error) if there's an evaluation error.
func (s *Shape) Matches(record map[string]any) (bool, error) {
	if s.Where == nil {
		return true, nil
	}

	return s.Where.Evaluate(record)
}

// MatchesOldAndNew returns whether old and new records match this shape's filter.
// This is used for update filtering to determine what operation to emit:
//   - (true, true) -> emit update
//   - (true, false) -> emit delete (record moved out of shape)
//   - (false, true) -> emit insert (record moved into shape)
//   - (false, false) -> skip
func (s *Shape) MatchesOldAndNew(oldRecord, newRecord map[string]any) (bool, bool, error) {
	oldMatches, err := s.Matches(oldRecord)
	if err != nil {
		return false, false, fmt.Errorf("error evaluating old record: %w", err)
	}

	newMatches, err := s.Matches(newRecord)
	if err != nil {
		return false, false, fmt.Errorf("error evaluating new record: %w", err)
	}

	return oldMatches, newMatches, nil
}

// FilterColumns returns only the columns this shape is interested in.
// If no column selection is configured (all columns), returns a copy of the input.
// If columns are specified, returns only those columns that exist in the record.
func (s *Shape) FilterColumns(record map[string]any) map[string]any {
	if len(s.Columns) == 0 {
		// All columns - return a copy
		result := make(map[string]any, len(record))
		for k, v := range record {
			result[k] = v
		}
		return result
	}

	// Filter to selected columns
	result := make(map[string]any, len(s.Columns))
	for _, col := range s.Columns {
		if v, ok := record[col]; ok {
			result[col] = v
		}
	}
	return result
}

// TableRef returns the fully qualified table reference.
// Format: "schema"."table"
func (s *Shape) TableRef() string {
	return fmt.Sprintf("%q.%q", s.Schema, s.TableName)
}

// Relation returns the schema and table name as a tuple.
func (s *Shape) Relation() (string, string) {
	return s.Schema, s.TableName
}

// HasWhere returns true if the shape has a WHERE clause.
func (s *Shape) HasWhere() bool {
	return s.Where != nil
}

// HasColumnSelection returns true if the shape has a column selection
// (i.e., not all columns are included).
func (s *Shape) HasColumnSelection() bool {
	return len(s.Columns) > 0
}

// AllColumns returns true if the shape includes all columns.
func (s *Shape) AllColumns() bool {
	return len(s.Columns) == 0
}

// GetColumns returns the selected columns, or nil if all columns are selected.
func (s *Shape) GetColumns() []string {
	if len(s.Columns) == 0 {
		return nil
	}
	result := make([]string, len(s.Columns))
	copy(result, s.Columns)
	return result
}

// WhereSQL returns the normalized WHERE clause SQL, or empty string if none.
func (s *Shape) WhereSQL() string {
	if s.Where == nil {
		return ""
	}
	return s.Where.ToSQL()
}

// normalizeColumns sorts and deduplicates a list of column names.
func normalizeColumns(columns []string) []string {
	if len(columns) == 0 {
		return nil
	}

	// Deduplicate
	seen := make(map[string]struct{}, len(columns))
	unique := make([]string, 0, len(columns))
	for _, col := range columns {
		if _, ok := seen[col]; !ok {
			seen[col] = struct{}{}
			unique = append(unique, col)
		}
	}

	// Sort
	sort.Strings(unique)
	return unique
}

// String returns a human-readable representation of the shape.
func (s *Shape) String() string {
	var sb strings.Builder
	sb.WriteString(s.TableRef())

	if len(s.Columns) > 0 {
		sb.WriteString(" [")
		sb.WriteString(strings.Join(s.Columns, ", "))
		sb.WriteString("]")
	}

	if s.Where != nil {
		sb.WriteString(" WHERE ")
		sb.WriteString(s.Where.ToSQL())
	}

	if s.Replica == ReplicaFull {
		sb.WriteString(" (replica=full)")
	}

	return sb.String()
}

// Equal returns true if two shapes have the same definition.
// This compares schema, table, where clause, columns, and replica mode.
func (s *Shape) Equal(other *Shape) bool {
	if s == nil || other == nil {
		return s == other
	}

	// Compare schema and table
	if s.Schema != other.Schema || s.TableName != other.TableName {
		return false
	}

	// Compare replica mode
	if s.Replica != other.Replica {
		return false
	}

	// Compare columns
	if len(s.Columns) != len(other.Columns) {
		return false
	}
	for i := range s.Columns {
		if s.Columns[i] != other.Columns[i] {
			return false
		}
	}

	// Compare WHERE clause
	if s.Where == nil && other.Where == nil {
		return true
	}
	if s.Where == nil || other.Where == nil {
		return false
	}
	return s.Where.ToSQL() == other.Where.ToSQL()
}
