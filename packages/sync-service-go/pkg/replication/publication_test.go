// Package replication tests
// Ported from: test/electric/replication/publication_manager_test.exs
package replication

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"sync"
	"testing"
)

// MockDB implements a mock database for testing PublicationManager.
// It simulates PostgreSQL publication behavior.
type MockDB struct {
	mu           sync.Mutex
	publications map[string]map[string]bool // pubname -> set of "schema.table"
	queryErr     error                      // error to return on next query
	execErr      error                      // error to return on next exec
	closed       bool
}

// NewMockDB creates a new mock database.
func NewMockDB() *MockDB {
	return &MockDB{
		publications: make(map[string]map[string]bool),
	}
}

// SetQueryError sets an error to be returned on the next query.
func (m *MockDB) SetQueryError(err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.queryErr = err
}

// SetExecError sets an error to be returned on the next exec.
func (m *MockDB) SetExecError(err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.execErr = err
}

// AddPublication adds a publication to the mock.
func (m *MockDB) AddPublication(name string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.publications[name] == nil {
		m.publications[name] = make(map[string]bool)
	}
}

// AddTableToPublication adds a table to a publication in the mock.
func (m *MockDB) AddTableToPublication(pubName, schema, table string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.publications[pubName] == nil {
		m.publications[pubName] = make(map[string]bool)
	}
	m.publications[pubName][schema+"."+table] = true
}

// HasPublication checks if a publication exists.
func (m *MockDB) HasPublication(name string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, exists := m.publications[name]
	return exists
}

// HasTableInPublication checks if a table is in a publication.
func (m *MockDB) HasTableInPublication(pubName, schema, table string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	tables, exists := m.publications[pubName]
	if !exists {
		return false
	}
	return tables[schema+"."+table]
}

// GetTablesInPublication returns all tables in a publication.
func (m *MockDB) GetTablesInPublication(pubName string) []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	tables, exists := m.publications[pubName]
	if !exists {
		return nil
	}
	result := make([]string, 0, len(tables))
	for t := range tables {
		result = append(result, t)
	}
	sort.Strings(result)
	return result
}

// mockDriver implements database/sql/driver interfaces for testing.
type mockDriver struct {
	db *MockDB
}

type mockConn struct {
	db *MockDB
}

type mockStmt struct {
	db    *MockDB
	query string
}

type mockResult struct {
	rowsAffected int64
}

type mockRows struct {
	columns []string
	data    [][]driver.Value
	index   int
}

func (d *mockDriver) Open(name string) (driver.Conn, error) {
	return &mockConn{db: d.db}, nil
}

func (c *mockConn) Prepare(query string) (driver.Stmt, error) {
	return &mockStmt{db: c.db, query: query}, nil
}

func (c *mockConn) Close() error {
	return nil
}

func (c *mockConn) Begin() (driver.Tx, error) {
	return &mockTx{}, nil
}

type mockTx struct{}

func (t *mockTx) Commit() error   { return nil }
func (t *mockTx) Rollback() error { return nil }

func (s *mockStmt) Close() error {
	return nil
}

func (s *mockStmt) NumInput() int {
	return -1 // variable number of inputs
}

func (s *mockStmt) Exec(args []driver.Value) (driver.Result, error) {
	s.db.mu.Lock()
	defer s.db.mu.Unlock()

	if s.db.execErr != nil {
		err := s.db.execErr
		s.db.execErr = nil
		return nil, err
	}

	query := s.query

	// Handle CREATE PUBLICATION
	if strings.HasPrefix(query, "CREATE PUBLICATION") {
		pubName := extractPublicationName(query)
		if s.db.publications[pubName] != nil {
			return nil, errors.New("publication \"" + pubName + "\" already exists")
		}
		s.db.publications[pubName] = make(map[string]bool)
		return &mockResult{rowsAffected: 0}, nil
	}

	// Handle ALTER PUBLICATION ... ADD TABLE
	if strings.Contains(query, "ADD TABLE") {
		pubName := extractPublicationName(query)
		tableRef := extractTableRef(query, "ADD TABLE")

		if s.db.publications[pubName] == nil {
			return nil, errors.New("publication \"" + pubName + "\" does not exist")
		}
		if s.db.publications[pubName][tableRef] {
			return nil, errors.New("relation \"" + tableRef + "\" is already member of publication \"" + pubName + "\"")
		}
		s.db.publications[pubName][tableRef] = true
		return &mockResult{rowsAffected: 0}, nil
	}

	// Handle ALTER PUBLICATION ... DROP TABLE
	if strings.Contains(query, "DROP TABLE") {
		pubName := extractPublicationName(query)
		tableRef := extractTableRef(query, "DROP TABLE")

		if s.db.publications[pubName] == nil {
			return nil, errors.New("publication \"" + pubName + "\" does not exist")
		}
		if !s.db.publications[pubName][tableRef] {
			return nil, errors.New("relation \"" + tableRef + "\" is not part of the publication")
		}
		delete(s.db.publications[pubName], tableRef)
		return &mockResult{rowsAffected: 0}, nil
	}

	return &mockResult{rowsAffected: 0}, nil
}

func (s *mockStmt) Query(args []driver.Value) (driver.Rows, error) {
	s.db.mu.Lock()
	defer s.db.mu.Unlock()

	if s.db.queryErr != nil {
		err := s.db.queryErr
		s.db.queryErr = nil
		return nil, err
	}

	query := s.query

	// Handle EXISTS query for publication
	if strings.Contains(query, "SELECT EXISTS") && strings.Contains(query, "pg_publication") {
		pubName := args[0].(string)
		_, exists := s.db.publications[pubName]
		return &mockRows{
			columns: []string{"exists"},
			data:    [][]driver.Value{{exists}},
			index:   0,
		}, nil
	}

	// Handle pg_publication_tables query
	if strings.Contains(query, "pg_publication_tables") {
		pubName := args[0].(string)
		tables := s.db.publications[pubName]
		if tables == nil {
			return &mockRows{
				columns: []string{"schemaname", "tablename"},
				data:    [][]driver.Value{},
				index:   0,
			}, nil
		}

		// Sort tables for consistent ordering
		sortedTables := make([]string, 0, len(tables))
		for t := range tables {
			sortedTables = append(sortedTables, t)
		}
		sort.Strings(sortedTables)

		data := make([][]driver.Value, 0, len(sortedTables))
		for _, t := range sortedTables {
			parts := strings.SplitN(t, ".", 2)
			if len(parts) == 2 {
				data = append(data, []driver.Value{parts[0], parts[1]})
			}
		}

		return &mockRows{
			columns: []string{"schemaname", "tablename"},
			data:    data,
			index:   0,
		}, nil
	}

	return &mockRows{columns: []string{}, data: [][]driver.Value{}, index: 0}, nil
}

func (r *mockResult) LastInsertId() (int64, error) {
	return 0, nil
}

func (r *mockResult) RowsAffected() (int64, error) {
	return r.rowsAffected, nil
}

func (r *mockRows) Columns() []string {
	return r.columns
}

func (r *mockRows) Close() error {
	return nil
}

func (r *mockRows) Next(dest []driver.Value) error {
	if r.index >= len(r.data) {
		return io.EOF
	}
	for i, v := range r.data[r.index] {
		dest[i] = v
	}
	r.index++
	return nil
}

// Helper functions for parsing mock queries
func extractPublicationName(query string) string {
	// Extract publication name from queries like:
	// CREATE PUBLICATION "pubname"
	// ALTER PUBLICATION "pubname" ...
	start := strings.Index(query, `"`)
	if start == -1 {
		return ""
	}
	end := strings.Index(query[start+1:], `"`)
	if end == -1 {
		return ""
	}
	return query[start+1 : start+1+end]
}

func extractTableRef(query, keyword string) string {
	// Extract table reference from queries like:
	// ALTER PUBLICATION "pub" ADD TABLE "schema"."table"
	idx := strings.Index(query, keyword)
	if idx == -1 {
		return ""
	}
	rest := strings.TrimSpace(query[idx+len(keyword):])

	// Parse "schema"."table" format
	parts := strings.SplitN(rest, ".", 2)
	if len(parts) != 2 {
		return ""
	}

	schema := strings.Trim(parts[0], `" `)
	table := strings.Trim(parts[1], `" `)

	return schema + "." + table
}

// createMockDB creates a sql.DB backed by MockDB for testing.
func createMockDB(mock *MockDB) (*sql.DB, error) {
	driverName := fmt.Sprintf("mock_%p", mock)
	sql.Register(driverName, &mockDriver{db: mock})
	return sql.Open(driverName, "")
}

// Tests

func TestNewPublicationManager(t *testing.T) {
	mock := NewMockDB()
	db, err := createMockDB(mock)
	if err != nil {
		t.Fatalf("failed to create mock db: %v", err)
	}
	defer db.Close()

	pm := NewPublicationManager(db, "test_pub")

	if pm == nil {
		t.Fatal("NewPublicationManager returned nil")
	}
	if pm.GetPublicationName() != "test_pub" {
		t.Errorf("GetPublicationName() = %q, want %q", pm.GetPublicationName(), "test_pub")
	}
}

func TestEnsurePublication_CreatesNew(t *testing.T) {
	mock := NewMockDB()
	db, err := createMockDB(mock)
	if err != nil {
		t.Fatalf("failed to create mock db: %v", err)
	}
	defer db.Close()

	pm := NewPublicationManager(db, "new_pub")
	ctx := context.Background()

	err = pm.EnsurePublication(ctx)
	if err != nil {
		t.Fatalf("EnsurePublication() error: %v", err)
	}

	if !mock.HasPublication("new_pub") {
		t.Error("publication was not created")
	}
}

func TestEnsurePublication_ExistingPublication(t *testing.T) {
	mock := NewMockDB()
	mock.AddPublication("existing_pub")
	mock.AddTableToPublication("existing_pub", "public", "users")

	db, err := createMockDB(mock)
	if err != nil {
		t.Fatalf("failed to create mock db: %v", err)
	}
	defer db.Close()

	pm := NewPublicationManager(db, "existing_pub")
	ctx := context.Background()

	err = pm.EnsurePublication(ctx)
	if err != nil {
		t.Fatalf("EnsurePublication() error: %v", err)
	}

	// Should have loaded existing tables into cache
	if !pm.HasTable("public", "users") {
		t.Error("existing table not loaded into cache")
	}
}

func TestAddTable_Success(t *testing.T) {
	mock := NewMockDB()
	mock.AddPublication("test_pub")

	db, err := createMockDB(mock)
	if err != nil {
		t.Fatalf("failed to create mock db: %v", err)
	}
	defer db.Close()

	pm := NewPublicationManager(db, "test_pub")
	ctx := context.Background()

	added, err := pm.AddTable(ctx, "public", "users")
	if err != nil {
		t.Fatalf("AddTable() error: %v", err)
	}
	if !added {
		t.Error("AddTable() returned false, want true")
	}

	if !mock.HasTableInPublication("test_pub", "public", "users") {
		t.Error("table not added to publication in database")
	}
	if !pm.HasTable("public", "users") {
		t.Error("table not added to cache")
	}
}

func TestAddTable_AlreadyPresent(t *testing.T) {
	mock := NewMockDB()
	mock.AddPublication("test_pub")
	mock.AddTableToPublication("test_pub", "public", "users")

	db, err := createMockDB(mock)
	if err != nil {
		t.Fatalf("failed to create mock db: %v", err)
	}
	defer db.Close()

	pm := NewPublicationManager(db, "test_pub")
	ctx := context.Background()

	// First add to cache via AddTable (will get "already member" error but handle it)
	added, err := pm.AddTable(ctx, "public", "users")
	if err != nil {
		t.Fatalf("AddTable() error: %v", err)
	}
	if added {
		t.Error("AddTable() returned true for existing table, want false")
	}

	// Second add should use cache and return false
	added, err = pm.AddTable(ctx, "public", "users")
	if err != nil {
		t.Fatalf("AddTable() second call error: %v", err)
	}
	if added {
		t.Error("AddTable() returned true for cached table, want false")
	}
}

func TestAddTable_PublicationDoesNotExist(t *testing.T) {
	mock := NewMockDB()
	// Don't add publication

	db, err := createMockDB(mock)
	if err != nil {
		t.Fatalf("failed to create mock db: %v", err)
	}
	defer db.Close()

	pm := NewPublicationManager(db, "nonexistent_pub")
	ctx := context.Background()

	_, err = pm.AddTable(ctx, "public", "users")
	if err == nil {
		t.Error("AddTable() expected error for nonexistent publication")
	}
	if !strings.Contains(err.Error(), "does not exist") {
		t.Errorf("error should mention 'does not exist': %v", err)
	}
}

func TestRemoveTable_Success(t *testing.T) {
	mock := NewMockDB()
	mock.AddPublication("test_pub")
	mock.AddTableToPublication("test_pub", "public", "users")

	db, err := createMockDB(mock)
	if err != nil {
		t.Fatalf("failed to create mock db: %v", err)
	}
	defer db.Close()

	pm := NewPublicationManager(db, "test_pub")
	ctx := context.Background()

	// First add to cache
	pm.AddTable(ctx, "public", "users")

	err = pm.RemoveTable(ctx, "public", "users")
	if err != nil {
		t.Fatalf("RemoveTable() error: %v", err)
	}

	if mock.HasTableInPublication("test_pub", "public", "users") {
		t.Error("table still in publication after removal")
	}
	if pm.HasTable("public", "users") {
		t.Error("table still in cache after removal")
	}
}

func TestRemoveTable_NotPresent(t *testing.T) {
	mock := NewMockDB()
	mock.AddPublication("test_pub")

	db, err := createMockDB(mock)
	if err != nil {
		t.Fatalf("failed to create mock db: %v", err)
	}
	defer db.Close()

	pm := NewPublicationManager(db, "test_pub")
	ctx := context.Background()

	// Removing a table that doesn't exist should not error
	err = pm.RemoveTable(ctx, "public", "nonexistent")
	if err != nil {
		t.Fatalf("RemoveTable() error for nonexistent table: %v", err)
	}
}

func TestHasTable(t *testing.T) {
	mock := NewMockDB()
	mock.AddPublication("test_pub")

	db, err := createMockDB(mock)
	if err != nil {
		t.Fatalf("failed to create mock db: %v", err)
	}
	defer db.Close()

	pm := NewPublicationManager(db, "test_pub")
	ctx := context.Background()

	if pm.HasTable("public", "users") {
		t.Error("HasTable() returned true for non-existent table")
	}

	pm.AddTable(ctx, "public", "users")

	if !pm.HasTable("public", "users") {
		t.Error("HasTable() returned false for existing table")
	}
}

func TestListTables(t *testing.T) {
	mock := NewMockDB()
	mock.AddPublication("test_pub")
	mock.AddTableToPublication("test_pub", "public", "users")
	mock.AddTableToPublication("test_pub", "public", "orders")
	mock.AddTableToPublication("test_pub", "other", "items")

	db, err := createMockDB(mock)
	if err != nil {
		t.Fatalf("failed to create mock db: %v", err)
	}
	defer db.Close()

	pm := NewPublicationManager(db, "test_pub")
	ctx := context.Background()

	tables, err := pm.ListTables(ctx)
	if err != nil {
		t.Fatalf("ListTables() error: %v", err)
	}

	expected := []string{"other.items", "public.orders", "public.users"}
	if len(tables) != len(expected) {
		t.Fatalf("ListTables() returned %d tables, want %d", len(tables), len(expected))
	}

	for i, table := range tables {
		if table != expected[i] {
			t.Errorf("ListTables()[%d] = %q, want %q", i, table, expected[i])
		}
	}
}

func TestListTables_EmptyPublication(t *testing.T) {
	mock := NewMockDB()
	mock.AddPublication("empty_pub")

	db, err := createMockDB(mock)
	if err != nil {
		t.Fatalf("failed to create mock db: %v", err)
	}
	defer db.Close()

	pm := NewPublicationManager(db, "empty_pub")
	ctx := context.Background()

	tables, err := pm.ListTables(ctx)
	if err != nil {
		t.Fatalf("ListTables() error: %v", err)
	}

	if len(tables) != 0 {
		t.Errorf("ListTables() returned %d tables, want 0", len(tables))
	}
}

func TestRefresh(t *testing.T) {
	mock := NewMockDB()
	mock.AddPublication("test_pub")

	db, err := createMockDB(mock)
	if err != nil {
		t.Fatalf("failed to create mock db: %v", err)
	}
	defer db.Close()

	pm := NewPublicationManager(db, "test_pub")
	ctx := context.Background()

	// Add table directly to mock (simulating external modification)
	mock.AddTableToPublication("test_pub", "public", "users")

	// Cache doesn't have it yet
	if pm.HasTable("public", "users") {
		t.Error("HasTable() should return false before refresh")
	}

	err = pm.Refresh(ctx)
	if err != nil {
		t.Fatalf("Refresh() error: %v", err)
	}

	// Now cache should have it
	if !pm.HasTable("public", "users") {
		t.Error("HasTable() should return true after refresh")
	}
}

func TestGetPublicationName(t *testing.T) {
	mock := NewMockDB()
	db, err := createMockDB(mock)
	if err != nil {
		t.Fatalf("failed to create mock db: %v", err)
	}
	defer db.Close()

	tests := []string{
		"simple",
		"with_underscore",
		"CamelCase",
		"with-dash",
	}

	for _, name := range tests {
		t.Run(name, func(t *testing.T) {
			pm := NewPublicationManager(db, name)
			if got := pm.GetPublicationName(); got != name {
				t.Errorf("GetPublicationName() = %q, want %q", got, name)
			}
		})
	}
}

func TestQuoteIdentifier(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"simple", `"simple"`},
		{"with spaces", `"with spaces"`},
		{`with"quotes`, `"with""quotes"`},
		{`mix"of"things`, `"mix""of""things"`},
		{"", `""`},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := quoteIdentifier(tt.input)
			if got != tt.expected {
				t.Errorf("quoteIdentifier(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestQuoteRelation(t *testing.T) {
	tests := []struct {
		schema   string
		table    string
		expected string
	}{
		{"public", "users", `"public"."users"`},
		{"my schema", "my table", `"my schema"."my table"`},
		{`sch"ema`, `tab"le`, `"sch""ema"."tab""le"`},
	}

	for _, tt := range tests {
		t.Run(tt.schema+"."+tt.table, func(t *testing.T) {
			got := quoteRelation(tt.schema, tt.table)
			if got != tt.expected {
				t.Errorf("quoteRelation(%q, %q) = %q, want %q", tt.schema, tt.table, got, tt.expected)
			}
		})
	}
}

func TestConcurrentAccess(t *testing.T) {
	mock := NewMockDB()
	mock.AddPublication("test_pub")

	db, err := createMockDB(mock)
	if err != nil {
		t.Fatalf("failed to create mock db: %v", err)
	}
	defer db.Close()

	pm := NewPublicationManager(db, "test_pub")
	ctx := context.Background()

	var wg sync.WaitGroup
	numGoroutines := 10
	tablesPerGoroutine := 5

	// Concurrent adds
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(goroutineID int) {
			defer wg.Done()
			for j := 0; j < tablesPerGoroutine; j++ {
				tableName := fmt.Sprintf("table_%d_%d", goroutineID, j)
				_, err := pm.AddTable(ctx, "public", tableName)
				if err != nil {
					t.Errorf("AddTable() error in goroutine %d: %v", goroutineID, err)
				}
			}
		}(i)
	}

	wg.Wait()

	// Verify all tables were added
	tables, err := pm.ListTables(ctx)
	if err != nil {
		t.Fatalf("ListTables() error: %v", err)
	}

	expectedCount := numGoroutines * tablesPerGoroutine
	if len(tables) != expectedCount {
		t.Errorf("expected %d tables, got %d", expectedCount, len(tables))
	}
}

func TestErrorHandling_QueryError(t *testing.T) {
	mock := NewMockDB()
	mock.AddPublication("test_pub")

	db, err := createMockDB(mock)
	if err != nil {
		t.Fatalf("failed to create mock db: %v", err)
	}
	defer db.Close()

	pm := NewPublicationManager(db, "test_pub")
	ctx := context.Background()

	// Set error for next query
	mock.SetQueryError(errors.New("database connection lost"))

	_, err = pm.ListTables(ctx)
	if err == nil {
		t.Error("ListTables() expected error when database fails")
	}
}

func TestErrorHandling_ExecError(t *testing.T) {
	mock := NewMockDB()
	mock.AddPublication("test_pub")

	db, err := createMockDB(mock)
	if err != nil {
		t.Fatalf("failed to create mock db: %v", err)
	}
	defer db.Close()

	pm := NewPublicationManager(db, "test_pub")
	ctx := context.Background()

	// Set error for next exec
	mock.SetExecError(errors.New("permission denied"))

	_, err = pm.AddTable(ctx, "public", "users")
	if err == nil {
		t.Error("AddTable() expected error when database fails")
	}
}

func TestTableKey(t *testing.T) {
	tests := []struct {
		schema   string
		table    string
		expected string
	}{
		{"public", "users", "public.users"},
		{"my_schema", "my_table", "my_schema.my_table"},
		{"", "table", ".table"},
		{"schema", "", "schema."},
	}

	for _, tt := range tests {
		t.Run(tt.schema+"."+tt.table, func(t *testing.T) {
			got := tableKey(tt.schema, tt.table)
			if got != tt.expected {
				t.Errorf("tableKey(%q, %q) = %q, want %q", tt.schema, tt.table, got, tt.expected)
			}
		})
	}
}

func TestIsPublicationExistsError(t *testing.T) {
	tests := []struct {
		err      error
		expected bool
	}{
		{nil, false},
		{errors.New("publication already exists"), true},
		{errors.New("error code 42710"), true},
		{errors.New("some other error"), false},
	}

	for _, tt := range tests {
		name := "nil"
		if tt.err != nil {
			name = tt.err.Error()
		}
		t.Run(name, func(t *testing.T) {
			got := isPublicationExistsError(tt.err)
			if got != tt.expected {
				t.Errorf("isPublicationExistsError(%v) = %v, want %v", tt.err, got, tt.expected)
			}
		})
	}
}

func TestIsDuplicateObjectError(t *testing.T) {
	tests := []struct {
		err      error
		expected bool
	}{
		{nil, false},
		{errors.New("table is already member of publication"), true},
		{errors.New("error code 42710"), true},
		{errors.New("some other error"), false},
	}

	for _, tt := range tests {
		name := "nil"
		if tt.err != nil {
			name = tt.err.Error()
		}
		t.Run(name, func(t *testing.T) {
			got := isDuplicateObjectError(tt.err)
			if got != tt.expected {
				t.Errorf("isDuplicateObjectError(%v) = %v, want %v", tt.err, got, tt.expected)
			}
		})
	}
}

func TestIsUndefinedObjectError(t *testing.T) {
	tests := []struct {
		err      error
		expected bool
	}{
		{nil, false},
		{errors.New("publication does not exist"), true},
		{errors.New("relation is not part of the publication"), true},
		{errors.New("error code 42704"), true},
		{errors.New("some other error"), false},
	}

	for _, tt := range tests {
		name := "nil"
		if tt.err != nil {
			name = tt.err.Error()
		}
		t.Run(name, func(t *testing.T) {
			got := isUndefinedObjectError(tt.err)
			if got != tt.expected {
				t.Errorf("isUndefinedObjectError(%v) = %v, want %v", tt.err, got, tt.expected)
			}
		})
	}
}

func TestMultipleSchemasAndTables(t *testing.T) {
	mock := NewMockDB()
	mock.AddPublication("test_pub")

	db, err := createMockDB(mock)
	if err != nil {
		t.Fatalf("failed to create mock db: %v", err)
	}
	defer db.Close()

	pm := NewPublicationManager(db, "test_pub")
	ctx := context.Background()

	// Add tables from different schemas
	tables := []struct {
		schema string
		table  string
	}{
		{"public", "users"},
		{"public", "orders"},
		{"inventory", "items"},
		{"inventory", "warehouses"},
		{"accounting", "transactions"},
	}

	for _, table := range tables {
		added, err := pm.AddTable(ctx, table.schema, table.table)
		if err != nil {
			t.Fatalf("AddTable(%s, %s) error: %v", table.schema, table.table, err)
		}
		if !added {
			t.Errorf("AddTable(%s, %s) returned false, want true", table.schema, table.table)
		}
	}

	// Verify all tables are present
	for _, table := range tables {
		if !pm.HasTable(table.schema, table.table) {
			t.Errorf("HasTable(%s, %s) = false, want true", table.schema, table.table)
		}
	}

	// Verify list contains all tables
	listedTables, err := pm.ListTables(ctx)
	if err != nil {
		t.Fatalf("ListTables() error: %v", err)
	}

	if len(listedTables) != len(tables) {
		t.Errorf("ListTables() returned %d tables, want %d", len(listedTables), len(tables))
	}
}
