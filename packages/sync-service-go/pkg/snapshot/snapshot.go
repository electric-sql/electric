// Package snapshot handles initial data loading from PostgreSQL for shapes.
// It manages snapshot queries, pg_snapshot parsing for duplicate filtering,
// and conversion of snapshot rows to log items.
//
// Reference:
//   - packages/sync-service/lib/electric/shapes/consumer/initial_snapshot.ex
//   - packages/sync-service/lib/electric/postgres/snapshot_query.ex
package snapshot

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/electric-sql/electric/packages/sync-service-go/pkg/offset"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/operations"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/schema"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/shape"
)

// PgSnapshot holds PostgreSQL snapshot information for filtering duplicates
// between snapshot data and WAL changes.
//
// PostgreSQL snapshots define transaction visibility:
//   - Transactions with xid < xmin are definitely committed and visible
//   - Transactions with xid >= xmax are not yet started (invisible)
//   - Transactions with xid in xip_list were in-progress when snapshot was taken (invisible)
//   - Transactions with xmin <= xid < xmax and NOT in xip_list are committed and visible
type PgSnapshot struct {
	// Xmin is the lowest transaction ID still active at snapshot time.
	// All transactions below this are definitely committed.
	Xmin int64

	// Xmax is one past the highest transaction ID at snapshot time.
	// All transactions >= Xmax were not yet started.
	Xmax int64

	// XipList contains transaction IDs that were in-progress at snapshot time.
	// These transactions should be excluded from visibility (they weren't committed yet).
	XipList []int64

	// FilterTxns indicates whether transaction filtering is still active.
	// Set to false after a transaction >= xmax arrives (no more duplicates possible).
	FilterTxns bool
}

// ParsePgSnapshot parses a PostgreSQL pg_snapshot text representation.
// Format: "xmin:xmax:xip1,xip2,..." where xip_list may be empty.
//
// Examples:
//   - "100:105:102,103" -> xmin=100, xmax=105, xip=[102,103]
//   - "100:105:" -> xmin=100, xmax=105, xip=[]
//   - "100:105" -> xmin=100, xmax=105, xip=[]
func ParsePgSnapshot(s string) (*PgSnapshot, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, fmt.Errorf("empty pg_snapshot string")
	}

	parts := strings.Split(s, ":")
	if len(parts) < 2 || len(parts) > 3 {
		return nil, fmt.Errorf("invalid pg_snapshot format: %q (expected xmin:xmax[:xip_list])", s)
	}

	xmin, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return nil, fmt.Errorf("invalid xmin in pg_snapshot %q: %w", s, err)
	}

	xmax, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return nil, fmt.Errorf("invalid xmax in pg_snapshot %q: %w", s, err)
	}

	if xmin > xmax {
		return nil, fmt.Errorf("invalid pg_snapshot %q: xmin (%d) > xmax (%d)", s, xmin, xmax)
	}

	var xipList []int64
	if len(parts) == 3 && parts[2] != "" {
		xipParts := strings.Split(parts[2], ",")
		xipList = make([]int64, 0, len(xipParts))
		for _, xipStr := range xipParts {
			xipStr = strings.TrimSpace(xipStr)
			if xipStr == "" {
				continue
			}
			xip, err := strconv.ParseInt(xipStr, 10, 64)
			if err != nil {
				return nil, fmt.Errorf("invalid xip in pg_snapshot %q: %w", s, err)
			}
			xipList = append(xipList, xip)
		}
	}

	return &PgSnapshot{
		Xmin:       xmin,
		Xmax:       xmax,
		XipList:    xipList,
		FilterTxns: true,
	}, nil
}

// Contains checks if a transaction ID is visible in this snapshot.
// A transaction is visible if:
//   - txid < xmax (it was started before the snapshot), AND
//   - txid is NOT in xip_list (it wasn't in-progress when snapshot was taken)
//
// Transactions < xmin are always visible (definitely committed).
// Transactions >= xmax are never visible (not yet started).
// Transactions in xip_list are not visible (were in-progress).
func (snap *PgSnapshot) Contains(txid int64) bool {
	// Transactions >= xmax were not yet started when snapshot was taken
	if txid >= snap.Xmax {
		return false
	}

	// Check if the transaction was in-progress at snapshot time
	for _, xip := range snap.XipList {
		if txid == xip {
			return false
		}
	}

	// Transaction was committed and visible at snapshot time
	return true
}

// AfterSnapshot checks if a transaction ID is definitely after the snapshot.
// A transaction is after the snapshot if:
//   - txid >= xmax, OR
//   - txid is in xip_list (was in-progress, so committed after snapshot)
//
// This is used to determine when to stop filtering WAL transactions.
func (snap *PgSnapshot) AfterSnapshot(txid int64) bool {
	// If txid >= xmax, it's definitely after the snapshot
	if txid >= snap.Xmax {
		return true
	}

	// If txid is in xip_list, it was in-progress and committed after snapshot
	for _, xip := range snap.XipList {
		if txid == xip {
			return true
		}
	}

	return false
}

// ShouldSkipTransaction determines if a WAL transaction should be skipped
// because its changes are already included in the snapshot.
//
// Returns true if the transaction is visible in the snapshot (already included).
// Returns false if the transaction is after the snapshot (should be kept).
func (snap *PgSnapshot) ShouldSkipTransaction(txid int64) bool {
	// If filtering is disabled, keep all transactions
	if !snap.FilterTxns {
		return false
	}

	// Skip if the transaction is visible in the snapshot
	return snap.Contains(txid)
}

// String returns a string representation of the snapshot for debugging.
func (snap *PgSnapshot) String() string {
	if len(snap.XipList) == 0 {
		return fmt.Sprintf("%d:%d:", snap.Xmin, snap.Xmax)
	}

	xipStrs := make([]string, len(snap.XipList))
	for i, xip := range snap.XipList {
		xipStrs[i] = strconv.FormatInt(xip, 10)
	}
	return fmt.Sprintf("%d:%d:%s", snap.Xmin, snap.Xmax, strings.Join(xipStrs, ","))
}

// Executor handles snapshot query execution against PostgreSQL.
type Executor struct {
	db *sql.DB
}

// NewExecutor creates a new snapshot executor with the given database connection.
func NewExecutor(db *sql.DB) *Executor {
	return &Executor{db: db}
}

// Result contains the snapshot query results.
type Result struct {
	// Rows contains the snapshot data as a slice of maps (column name -> value).
	Rows []map[string]any

	// Schema contains the table schema with column information.
	Schema *schema.TableSchema

	// Snapshot is the pg_snapshot for duplicate filtering with WAL.
	Snapshot *PgSnapshot

	// Offset is the starting log offset for this snapshot.
	// Snapshot rows are assigned offsets starting from this value.
	Offset offset.LogOffset

	// LSN is the WAL position at the time of the snapshot.
	LSN int64
}

// Execute runs the initial snapshot query for a shape.
// This should be called within a transaction with REPEATABLE READ isolation.
//
// The function:
// 1. Captures the current pg_snapshot and WAL LSN
// 2. Builds and executes the SELECT query for the shape
// 3. Returns all matching rows along with snapshot information
func (e *Executor) Execute(ctx context.Context, s *shape.Shape) (*Result, error) {
	if s == nil {
		return nil, fmt.Errorf("shape is nil")
	}
	if e.db == nil {
		return nil, fmt.Errorf("database connection is nil")
	}

	// Start a transaction with REPEATABLE READ isolation
	tx, err := e.db.BeginTx(ctx, &sql.TxOptions{
		Isolation: sql.LevelRepeatableRead,
		ReadOnly:  true,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to start transaction: %w", err)
	}
	defer tx.Rollback()

	// Get the pg_snapshot and WAL LSN
	var snapshotStr string
	var lsn int64
	err = tx.QueryRowContext(ctx, "SELECT pg_current_snapshot()::text, pg_current_wal_lsn()::bigint").Scan(&snapshotStr, &lsn)
	if err != nil {
		return nil, fmt.Errorf("failed to get snapshot info: %w", err)
	}

	pgSnapshot, err := ParsePgSnapshot(snapshotStr)
	if err != nil {
		return nil, fmt.Errorf("failed to parse pg_snapshot: %w", err)
	}

	// Set display settings for consistent output format
	displaySettings := []string{
		"SET bytea_output = 'hex'",
		"SET DateStyle = 'ISO, DMY'",
		"SET TimeZone = 'UTC'",
		"SET extra_float_digits = 1",
		"SET IntervalStyle = 'iso_8601'",
	}
	for _, setting := range displaySettings {
		if _, err := tx.ExecContext(ctx, setting); err != nil {
			return nil, fmt.Errorf("failed to set display setting: %w", err)
		}
	}

	// Build and execute the snapshot query
	query := BuildQuery(s, s.TableSchema)
	rows, err := tx.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("snapshot query failed: %w", err)
	}
	defer rows.Close()

	// Get column names from the result
	columns, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("failed to get columns: %w", err)
	}

	// Read all rows
	var resultRows []map[string]any
	for rows.Next() {
		// Create scanners for each column
		values := make([]any, len(columns))
		scanners := make([]any, len(columns))
		for i := range values {
			scanners[i] = &values[i]
		}

		if err := rows.Scan(scanners...); err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}

		// Convert to map
		row := make(map[string]any, len(columns))
		for i, col := range columns {
			row[col] = values[i]
		}
		resultRows = append(resultRows, row)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error reading rows: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	return &Result{
		Rows:     resultRows,
		Schema:   s.TableSchema,
		Snapshot: pgSnapshot,
		Offset:   offset.InitialOffset,
		LSN:      lsn,
	}, nil
}

// BuildQuery constructs the snapshot SELECT query for a shape.
// The query:
//   - Selects only the specified columns (or all if none specified)
//   - Always includes PK columns (needed for key generation)
//   - Applies the shape's WHERE clause
//   - Orders by PK columns for deterministic results
//
// All identifiers are properly quoted to handle special characters.
func BuildQuery(s *shape.Shape, tableSchema *schema.TableSchema) string {
	var sb strings.Builder

	sb.WriteString("SELECT ")

	// Determine columns to select
	var columns []string
	if len(s.Columns) > 0 {
		// User specified columns - ensure PKs are included
		colSet := make(map[string]struct{})
		for _, col := range s.Columns {
			colSet[col] = struct{}{}
		}

		// Add PK columns if not already included
		if tableSchema != nil {
			for _, pkCol := range tableSchema.PrimaryKeyColumnNames() {
				if _, ok := colSet[pkCol]; !ok {
					colSet[pkCol] = struct{}{}
				}
			}
		}

		// Convert to sorted slice for deterministic output
		columns = make([]string, 0, len(colSet))
		for col := range colSet {
			columns = append(columns, col)
		}
		sort.Strings(columns)
	} else if tableSchema != nil {
		// All columns from schema
		columns = tableSchema.ColumnNames()
	} else {
		// No schema available, use *
		sb.WriteString("*")
		sb.WriteString(" FROM ")
		sb.WriteString(quoteIdentifier(s.Schema))
		sb.WriteString(".")
		sb.WriteString(quoteIdentifier(s.TableName))

		if s.HasWhere() {
			sb.WriteString(" WHERE ")
			sb.WriteString(s.WhereSQL())
		}

		return sb.String()
	}

	// Write column list
	for i, col := range columns {
		if i > 0 {
			sb.WriteString(", ")
		}
		sb.WriteString(quoteIdentifier(col))
	}

	// Write FROM clause
	sb.WriteString(" FROM ")
	sb.WriteString(quoteIdentifier(s.Schema))
	sb.WriteString(".")
	sb.WriteString(quoteIdentifier(s.TableName))

	// Write WHERE clause if present
	if s.HasWhere() {
		sb.WriteString(" WHERE ")
		sb.WriteString(s.WhereSQL())
	}

	// Write ORDER BY clause for deterministic results
	if tableSchema != nil {
		pkCols := tableSchema.PrimaryKeyColumnNames()
		if len(pkCols) > 0 {
			sb.WriteString(" ORDER BY ")
			for i, col := range pkCols {
				if i > 0 {
					sb.WriteString(", ")
				}
				sb.WriteString(quoteIdentifier(col))
			}
		}
	}

	return sb.String()
}

// ToLogItems converts snapshot rows to log items.
// All snapshot rows are represented as INSERT operations.
//
// Parameters:
//   - rows: The snapshot data rows (column name -> value)
//   - tableSchema: The table schema for PK column identification
//   - schemaName: The PostgreSQL schema name (e.g., "public")
//   - tableName: The table name
//   - startOffset: The starting log offset for the first row
//
// Each row is assigned a sequential offset starting from startOffset.
func ToLogItems(rows []map[string]any, tableSchema *schema.TableSchema, schemaName, tableName string, startOffset offset.LogOffset) []shape.LogItem {
	if len(rows) == 0 {
		return nil
	}

	items := make([]shape.LogItem, 0, len(rows))
	currentOffset := startOffset
	pkCols := tableSchema.PrimaryKeyColumnNames()

	for _, row := range rows {
		// Convert row values to strings
		value := RowToStringMap(row)

		// Build the key from PK values
		key := operations.BuildKeyFromMap(schemaName, tableName, pkCols, value)

		// Create insert log item
		item := shape.NewInsertItem(currentOffset, key, value)
		items = append(items, item)

		// Increment offset for next row
		currentOffset = currentOffset.Increment()
	}

	return items
}

// RowToStringMap converts a database row (any values) to a string map.
// This handles the conversion of various Go types to PostgreSQL text format.
func RowToStringMap(row map[string]any) map[string]string {
	result := make(map[string]string, len(row))
	for col, val := range row {
		result[col] = valueToString(val)
	}
	return result
}

// valueToString converts a database value to its string representation.
// Returns empty string for nil values.
func valueToString(val any) string {
	if val == nil {
		return ""
	}

	switch v := val.(type) {
	case string:
		return v
	case []byte:
		return string(v)
	case int:
		return strconv.Itoa(v)
	case int32:
		return strconv.FormatInt(int64(v), 10)
	case int64:
		return strconv.FormatInt(v, 10)
	case float32:
		return strconv.FormatFloat(float64(v), 'f', -1, 32)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case bool:
		if v {
			return "true"
		}
		return "false"
	default:
		return fmt.Sprintf("%v", v)
	}
}

// quoteIdentifier quotes a PostgreSQL identifier (table, column, schema name).
// Handles special characters by doubling internal quotes.
func quoteIdentifier(name string) string {
	// Escape any existing double quotes by doubling them
	escaped := strings.ReplaceAll(name, `"`, `""`)
	return `"` + escaped + `"`
}

// VisibleInSnapshot checks if a transaction is visible within the given snapshot.
// This is an alias for PgSnapshot.Contains for API compatibility.
func VisibleInSnapshot(txid int64, snap *PgSnapshot) bool {
	if snap == nil {
		return false
	}
	return snap.Contains(txid)
}

// AfterSnapshotCheck checks if a transaction is after the given snapshot.
// This is an alias for PgSnapshot.AfterSnapshot for API compatibility.
func AfterSnapshotCheck(txid int64, snap *PgSnapshot) bool {
	if snap == nil {
		return true
	}
	return snap.AfterSnapshot(txid)
}
