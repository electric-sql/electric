// Package replication provides PostgreSQL logical replication functionality.
//
// Ported from: lib/electric/replication/publication_manager/
package replication

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"sync"
)

// PublicationManager manages PostgreSQL publications for logical replication.
// It tracks which tables are part of a publication and provides methods to
// add/remove tables dynamically.
//
// Thread-safe for concurrent access.
type PublicationManager struct {
	db      *sql.DB
	pubName string
	mu      sync.Mutex
	tables  map[string]bool // "schema.table" -> in publication
}

// NewPublicationManager creates a new publication manager.
//
// Parameters:
//   - db: Database connection pool
//   - pubName: Name of the PostgreSQL publication to manage
func NewPublicationManager(db *sql.DB, pubName string) *PublicationManager {
	return &PublicationManager{
		db:      db,
		pubName: pubName,
		tables:  make(map[string]bool),
	}
}

// EnsurePublication creates the publication if it doesn't exist.
// If the publication already exists, this is a no-op.
//
// The publication is created empty (FOR ALL TABLES is not used) so that
// tables can be added dynamically.
func (pm *PublicationManager) EnsurePublication(ctx context.Context) error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	// Check if publication exists
	var exists bool
	query := `SELECT EXISTS(SELECT 1 FROM pg_publication WHERE pubname = $1)`
	err := pm.db.QueryRowContext(ctx, query, pm.pubName).Scan(&exists)
	if err != nil {
		return fmt.Errorf("checking publication existence: %w", err)
	}

	if exists {
		// Publication exists, refresh our cache
		return pm.refreshLocked(ctx)
	}

	// Create the publication
	// Note: We quote the publication name to handle special characters
	createQuery := fmt.Sprintf(`CREATE PUBLICATION %s`, quoteIdentifier(pm.pubName))
	_, err = pm.db.ExecContext(ctx, createQuery)
	if err != nil {
		// Check if it was created by a concurrent process
		if isPublicationExistsError(err) {
			return pm.refreshLocked(ctx)
		}
		return fmt.Errorf("creating publication: %w", err)
	}

	return nil
}

// AddTable adds a table to the publication.
// Returns true if the table was added, false if it was already present.
//
// Parameters:
//   - schema: The schema name (e.g., "public")
//   - table: The table name
func (pm *PublicationManager) AddTable(ctx context.Context, schema, table string) (bool, error) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	key := tableKey(schema, table)

	// Check if already in our cache
	if pm.tables[key] {
		return false, nil
	}

	// Try to add the table
	query := fmt.Sprintf(
		`ALTER PUBLICATION %s ADD TABLE %s`,
		quoteIdentifier(pm.pubName),
		quoteRelation(schema, table),
	)

	_, err := pm.db.ExecContext(ctx, query)
	if err != nil {
		// Handle "table already in publication" gracefully
		if isDuplicateObjectError(err) {
			pm.tables[key] = true
			return false, nil
		}
		// Handle "publication doesn't exist"
		if isUndefinedObjectError(err) {
			return false, fmt.Errorf("publication %q does not exist: %w", pm.pubName, err)
		}
		return false, fmt.Errorf("adding table to publication: %w", err)
	}

	pm.tables[key] = true
	return true, nil
}

// RemoveTable removes a table from the publication.
// If the table is not in the publication, this is a no-op.
//
// Parameters:
//   - schema: The schema name (e.g., "public")
//   - table: The table name
func (pm *PublicationManager) RemoveTable(ctx context.Context, schema, table string) error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	key := tableKey(schema, table)

	// Try to remove the table
	query := fmt.Sprintf(
		`ALTER PUBLICATION %s DROP TABLE %s`,
		quoteIdentifier(pm.pubName),
		quoteRelation(schema, table),
	)

	_, err := pm.db.ExecContext(ctx, query)
	if err != nil {
		// Handle "table not in publication" gracefully
		if isUndefinedObjectError(err) {
			delete(pm.tables, key)
			return nil
		}
		return fmt.Errorf("removing table from publication: %w", err)
	}

	delete(pm.tables, key)
	return nil
}

// HasTable checks if a table is in the publication.
// This uses the local cache and does not query the database.
//
// Parameters:
//   - schema: The schema name (e.g., "public")
//   - table: The table name
func (pm *PublicationManager) HasTable(schema, table string) bool {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	key := tableKey(schema, table)
	return pm.tables[key]
}

// ListTables returns all tables in the publication.
// This queries the database directly to ensure accuracy.
//
// Returns a slice of table identifiers in "schema.table" format.
func (pm *PublicationManager) ListTables(ctx context.Context) ([]string, error) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	return pm.listTablesLocked(ctx)
}

// listTablesLocked queries the database for tables in the publication.
// Caller must hold the mutex.
func (pm *PublicationManager) listTablesLocked(ctx context.Context) ([]string, error) {
	query := `
		SELECT schemaname, tablename
		FROM pg_publication_tables
		WHERE pubname = $1
		ORDER BY schemaname, tablename
	`

	rows, err := pm.db.QueryContext(ctx, query, pm.pubName)
	if err != nil {
		return nil, fmt.Errorf("listing publication tables: %w", err)
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var schema, table string
		if err := rows.Scan(&schema, &table); err != nil {
			return nil, fmt.Errorf("scanning publication table row: %w", err)
		}
		tables = append(tables, tableKey(schema, table))
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating publication tables: %w", err)
	}

	return tables, nil
}

// Refresh reloads the table list from the database into the local cache.
// This should be called periodically or when the publication may have been
// modified externally.
func (pm *PublicationManager) Refresh(ctx context.Context) error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	return pm.refreshLocked(ctx)
}

// refreshLocked reloads the table list from the database.
// Caller must hold the mutex.
func (pm *PublicationManager) refreshLocked(ctx context.Context) error {
	tables, err := pm.listTablesLocked(ctx)
	if err != nil {
		return err
	}

	// Rebuild the cache
	pm.tables = make(map[string]bool, len(tables))
	for _, t := range tables {
		pm.tables[t] = true
	}

	return nil
}

// GetPublicationName returns the name of the publication being managed.
func (pm *PublicationManager) GetPublicationName() string {
	return pm.pubName
}

// tableKey creates a cache key for a schema.table pair.
func tableKey(schema, table string) string {
	return schema + "." + table
}

// quoteIdentifier quotes a PostgreSQL identifier.
// This properly handles identifiers with special characters.
func quoteIdentifier(name string) string {
	// Replace any double quotes with two double quotes (escaping)
	escaped := strings.ReplaceAll(name, `"`, `""`)
	return `"` + escaped + `"`
}

// quoteRelation quotes a schema.table relation for SQL.
func quoteRelation(schema, table string) string {
	return quoteIdentifier(schema) + "." + quoteIdentifier(table)
}

// isPublicationExistsError checks if the error indicates the publication already exists.
func isPublicationExistsError(err error) bool {
	if err == nil {
		return false
	}
	errStr := err.Error()
	// PostgreSQL error: publication "name" already exists
	return strings.Contains(errStr, "already exists") ||
		strings.Contains(errStr, "42710") // duplicate_object error code
}

// isDuplicateObjectError checks if the error indicates a duplicate object.
func isDuplicateObjectError(err error) bool {
	if err == nil {
		return false
	}
	errStr := err.Error()
	// PostgreSQL error: relation "schema.table" is already member of publication "name"
	return strings.Contains(errStr, "already member") ||
		strings.Contains(errStr, "42710") // duplicate_object error code
}

// isUndefinedObjectError checks if the error indicates an undefined object.
func isUndefinedObjectError(err error) bool {
	if err == nil {
		return false
	}
	errStr := err.Error()
	// PostgreSQL error: relation "schema.table" is not part of the publication
	// or: publication "name" does not exist
	return strings.Contains(errStr, "does not exist") ||
		strings.Contains(errStr, "is not part of") ||
		strings.Contains(errStr, "42704") // undefined_object error code
}
