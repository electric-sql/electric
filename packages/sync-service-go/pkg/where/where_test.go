package where

import (
	"sort"
	"strings"
	"testing"
)

// TestParseSimpleComparisons tests simple comparison operators
func TestParseSimpleComparisons(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantColumns []string
		wantErr     bool
	}{
		{
			name:        "equals integer",
			input:       "id = 1",
			wantColumns: []string{"id"},
		},
		{
			name:        "equals string",
			input:       "name = 'test'",
			wantColumns: []string{"name"},
		},
		{
			name:        "not equals",
			input:       "status <> 'inactive'",
			wantColumns: []string{"status"},
		},
		{
			name:        "not equals !=",
			input:       "status != 'inactive'",
			wantColumns: []string{"status"},
		},
		{
			name:        "less than",
			input:       "age < 18",
			wantColumns: []string{"age"},
		},
		{
			name:        "greater than",
			input:       "age > 21",
			wantColumns: []string{"age"},
		},
		{
			name:        "less than or equals",
			input:       "price <= 100",
			wantColumns: []string{"price"},
		},
		{
			name:        "greater than or equals",
			input:       "price >= 50",
			wantColumns: []string{"price"},
		},
		{
			name:        "multiple columns",
			input:       "id = 1 AND name = 'test'",
			wantColumns: []string{"id", "name"},
		},
		{
			name:        "same column multiple times",
			input:       "id > 5 AND id < 10",
			wantColumns: []string{"id"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Parse(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("Parse() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if err != nil {
				return
			}

			gotColumns := got.ReferencedColumns()
			sort.Strings(tt.wantColumns)
			if !equalStringSlices(gotColumns, tt.wantColumns) {
				t.Errorf("ReferencedColumns() = %v, want %v", gotColumns, tt.wantColumns)
			}
		})
	}
}

// TestParseCompoundExpressions tests compound expressions with AND/OR/NOT
func TestParseCompoundExpressions(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantColumns []string
	}{
		{
			name:        "AND expression",
			input:       "id > 5 AND status = 'active'",
			wantColumns: []string{"id", "status"},
		},
		{
			name:        "OR expression",
			input:       "status = 'active' OR status = 'pending'",
			wantColumns: []string{"status"},
		},
		{
			name:        "NOT expression",
			input:       "NOT deleted",
			wantColumns: []string{"deleted"},
		},
		{
			name:        "complex expression",
			input:       "(id > 5 AND status = 'active') OR (id < 3 AND status = 'pending')",
			wantColumns: []string{"id", "status"},
		},
		{
			name:        "nested NOT",
			input:       "NOT (status = 'deleted' OR status = 'archived')",
			wantColumns: []string{"status"},
		},
		{
			name:        "multiple AND",
			input:       "a = 1 AND b = 2 AND c = 3",
			wantColumns: []string{"a", "b", "c"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Parse(tt.input)
			if err != nil {
				t.Errorf("Parse() error = %v", err)
				return
			}

			gotColumns := got.ReferencedColumns()
			sort.Strings(tt.wantColumns)
			if !equalStringSlices(gotColumns, tt.wantColumns) {
				t.Errorf("ReferencedColumns() = %v, want %v", gotColumns, tt.wantColumns)
			}
		})
	}
}

// TestParseINLists tests IN and NOT IN expressions
func TestParseINLists(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantColumns []string
	}{
		{
			name:        "IN with integers",
			input:       "id IN (1, 2, 3)",
			wantColumns: []string{"id"},
		},
		{
			name:        "IN with strings",
			input:       "status IN ('active', 'pending', 'new')",
			wantColumns: []string{"status"},
		},
		{
			name:        "NOT IN with integers",
			input:       "id NOT IN (4, 5, 6)",
			wantColumns: []string{"id"},
		},
		{
			name:        "IN with single value",
			input:       "id IN (1)",
			wantColumns: []string{"id"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Parse(tt.input)
			if err != nil {
				t.Errorf("Parse() error = %v", err)
				return
			}

			gotColumns := got.ReferencedColumns()
			if !equalStringSlices(gotColumns, tt.wantColumns) {
				t.Errorf("ReferencedColumns() = %v, want %v", gotColumns, tt.wantColumns)
			}
		})
	}
}

// TestParseBETWEEN tests BETWEEN expressions
func TestParseBETWEEN(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantColumns []string
	}{
		{
			name:        "BETWEEN with integers",
			input:       "id BETWEEN 1 AND 100",
			wantColumns: []string{"id"},
		},
		{
			name:        "BETWEEN with dates",
			input:       "created_at BETWEEN '2024-01-01' AND '2024-12-31'",
			wantColumns: []string{"created_at"},
		},
		{
			name:        "NOT BETWEEN",
			input:       "age NOT BETWEEN 0 AND 17",
			wantColumns: []string{"age"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Parse(tt.input)
			if err != nil {
				t.Errorf("Parse() error = %v", err)
				return
			}

			gotColumns := got.ReferencedColumns()
			if !equalStringSlices(gotColumns, tt.wantColumns) {
				t.Errorf("ReferencedColumns() = %v, want %v", gotColumns, tt.wantColumns)
			}
		})
	}
}

// TestParseNULLChecks tests IS NULL and IS NOT NULL
func TestParseNULLChecks(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantColumns []string
	}{
		{
			name:        "IS NULL",
			input:       "deleted_at IS NULL",
			wantColumns: []string{"deleted_at"},
		},
		{
			name:        "IS NOT NULL",
			input:       "email IS NOT NULL",
			wantColumns: []string{"email"},
		},
		{
			name:        "combined with other conditions",
			input:       "deleted_at IS NULL AND status = 'active'",
			wantColumns: []string{"deleted_at", "status"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Parse(tt.input)
			if err != nil {
				t.Errorf("Parse() error = %v", err)
				return
			}

			gotColumns := got.ReferencedColumns()
			sort.Strings(tt.wantColumns)
			if !equalStringSlices(gotColumns, tt.wantColumns) {
				t.Errorf("ReferencedColumns() = %v, want %v", gotColumns, tt.wantColumns)
			}
		})
	}
}

// TestParseLIKE tests LIKE and ILIKE expressions
func TestParseLIKE(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantColumns []string
	}{
		{
			name:        "LIKE",
			input:       "name LIKE 'John%'",
			wantColumns: []string{"name"},
		},
		{
			name:        "NOT LIKE",
			input:       "email NOT LIKE '%@example.com'",
			wantColumns: []string{"email"},
		},
		{
			name:        "ILIKE",
			input:       "name ILIKE 'john%'",
			wantColumns: []string{"name"},
		},
		{
			name:        "NOT ILIKE",
			input:       "name NOT ILIKE 'test%'",
			wantColumns: []string{"name"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Parse(tt.input)
			if err != nil {
				t.Errorf("Parse() error = %v", err)
				return
			}

			gotColumns := got.ReferencedColumns()
			if !equalStringSlices(gotColumns, tt.wantColumns) {
				t.Errorf("ReferencedColumns() = %v, want %v", gotColumns, tt.wantColumns)
			}
		})
	}
}

// TestParseLiterals tests various literal types
func TestParseLiterals(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantColumns []string
	}{
		{
			name:        "string literal",
			input:       "name = 'hello world'",
			wantColumns: []string{"name"},
		},
		{
			name:        "integer literal",
			input:       "count = 42",
			wantColumns: []string{"count"},
		},
		{
			name:        "float literal",
			input:       "price = 19.99",
			wantColumns: []string{"price"},
		},
		{
			name:        "boolean true",
			input:       "active = true",
			wantColumns: []string{"active"},
		},
		{
			name:        "boolean false",
			input:       "deleted = false",
			wantColumns: []string{"deleted"},
		},
		{
			name:        "NULL literal",
			input:       "value = NULL",
			wantColumns: []string{"value"},
		},
		{
			name:        "negative number",
			input:       "balance = -100",
			wantColumns: []string{"balance"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Parse(tt.input)
			if err != nil {
				t.Errorf("Parse() error = %v", err)
				return
			}

			gotColumns := got.ReferencedColumns()
			if !equalStringSlices(gotColumns, tt.wantColumns) {
				t.Errorf("ReferencedColumns() = %v, want %v", gotColumns, tt.wantColumns)
			}
		})
	}
}

// TestParseRejectedSubqueries tests that subqueries are rejected
func TestParseRejectedSubqueries(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr string
	}{
		{
			name:    "scalar subquery",
			input:   "id = (SELECT 1)",
			wantErr: "subqueries are not allowed",
		},
		{
			name:    "EXISTS subquery",
			input:   "EXISTS (SELECT 1 FROM users)",
			wantErr: "subqueries are not allowed",
		},
		{
			name:    "IN with subquery",
			input:   "id IN (SELECT id FROM other_table)",
			wantErr: "subqueries are not allowed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := Parse(tt.input)
			if err == nil {
				t.Errorf("Parse() expected error, got nil")
				return
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("Parse() error = %v, want error containing %q", err, tt.wantErr)
			}
		})
	}
}

// TestParseRejectedFunctionCalls tests that function calls are rejected
func TestParseRejectedFunctionCalls(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr string
	}{
		{
			name:    "now() function",
			input:   "created_at > now()",
			wantErr: "function calls are not allowed",
		},
		{
			name:    "upper() function",
			input:   "upper(name) = 'JOHN'",
			wantErr: "function calls are not allowed",
		},
		{
			name:    "coalesce() function",
			input:   "coalesce(value, 0) > 0",
			wantErr: "unsupported expression type",
		},
		{
			name:    "length() function",
			input:   "length(name) > 5",
			wantErr: "function calls are not allowed",
		},
		{
			name:    "current_timestamp",
			input:   "created_at < current_timestamp",
			wantErr: "unsupported expression type",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := Parse(tt.input)
			if err == nil {
				t.Errorf("Parse() expected error, got nil")
				return
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("Parse() error = %v, want error containing %q", err, tt.wantErr)
			}
		})
	}
}

// TestParseRejectedCASE tests that CASE expressions are rejected
func TestParseRejectedCASE(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr string
	}{
		{
			name:    "simple CASE",
			input:   "CASE WHEN status = 1 THEN 'active' ELSE 'inactive' END = 'active'",
			wantErr: "CASE expressions are not allowed",
		},
		{
			name:    "searched CASE",
			input:   "CASE status WHEN 1 THEN true ELSE false END",
			wantErr: "CASE expressions are not allowed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := Parse(tt.input)
			if err == nil {
				t.Errorf("Parse() expected error, got nil")
				return
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("Parse() error = %v, want error containing %q", err, tt.wantErr)
			}
		})
	}
}

// TestParseRejectedAggregates tests that aggregate functions are rejected
func TestParseRejectedAggregates(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr string
	}{
		{
			name:    "count aggregate",
			input:   "count(*) > 0",
			wantErr: "function calls are not allowed",
		},
		{
			name:    "sum aggregate",
			input:   "sum(amount) > 100",
			wantErr: "function calls are not allowed",
		},
		{
			name:    "avg aggregate",
			input:   "avg(score) >= 50",
			wantErr: "function calls are not allowed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := Parse(tt.input)
			if err == nil {
				t.Errorf("Parse() expected error, got nil")
				return
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("Parse() error = %v, want error containing %q", err, tt.wantErr)
			}
		})
	}
}

// TestParseRejectedQualifiedColumns tests that qualified column refs are rejected
func TestParseRejectedQualifiedColumns(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr string
	}{
		{
			name:    "table.column",
			input:   "users.id = 1",
			wantErr: "qualified column references are not allowed",
		},
		{
			name:    "schema.table.column",
			input:   "public.users.name = 'test'",
			wantErr: "qualified column references are not allowed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := Parse(tt.input)
			if err == nil {
				t.Errorf("Parse() expected error, got nil")
				return
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("Parse() error = %v, want error containing %q", err, tt.wantErr)
			}
		})
	}
}

// TestParseInvalidSyntax tests various syntax errors
func TestParseInvalidSyntax(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr string
	}{
		{
			name:    "empty string",
			input:   "",
			wantErr: "empty WHERE clause",
		},
		{
			name:    "whitespace only",
			input:   "   ",
			wantErr: "empty WHERE clause",
		},
		{
			name:    "incomplete expression",
			input:   "id =",
			wantErr: "parse error",
		},
		{
			name:    "missing operator",
			input:   "id 1",
			wantErr: "parse error",
		},
		{
			name:    "semicolon",
			input:   "id = 1; SELECT * FROM users",
			wantErr: "unexpected ';' causing statement split",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := Parse(tt.input)
			if err == nil {
				t.Errorf("Parse() expected error, got nil")
				return
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("Parse() error = %v, want error containing %q", err, tt.wantErr)
			}
		})
	}
}

// TestValidate tests the Validate method
func TestValidate(t *testing.T) {
	tests := []struct {
		name             string
		input            string
		availableColumns []string
		wantErr          bool
		wantErrMsg       string
	}{
		{
			name:             "all columns available",
			input:            "id = 1 AND name = 'test'",
			availableColumns: []string{"id", "name", "status"},
			wantErr:          false,
		},
		{
			name:             "exact columns available",
			input:            "id = 1",
			availableColumns: []string{"id"},
			wantErr:          false,
		},
		{
			name:             "missing column",
			input:            "id = 1",
			availableColumns: []string{"name", "status"},
			wantErr:          true,
			wantErrMsg:       "unknown column(s): id",
		},
		{
			name:             "multiple missing columns",
			input:            "id = 1 AND name = 'test'",
			availableColumns: []string{"status"},
			wantErr:          true,
			wantErrMsg:       "id, name",
		},
		{
			name:             "empty available columns",
			input:            "id = 1",
			availableColumns: []string{},
			wantErr:          true,
			wantErrMsg:       "unknown column(s): id",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wc, err := Parse(tt.input)
			if err != nil {
				t.Fatalf("Parse() error = %v", err)
			}

			err = wc.Validate(tt.availableColumns)
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if err != nil && tt.wantErrMsg != "" && !strings.Contains(err.Error(), tt.wantErrMsg) {
				t.Errorf("Validate() error = %v, want error containing %q", err, tt.wantErrMsg)
			}
		})
	}
}

// TestToSQL tests the ToSQL method
func TestToSQL(t *testing.T) {
	tests := []struct {
		name  string
		input string
		// We check that ToSQL returns valid SQL that can be reparsed
	}{
		{
			name:  "simple comparison",
			input: "id = 1",
		},
		{
			name:  "string literal",
			input: "name = 'test'",
		},
		{
			name:  "AND expression",
			input: "id > 5 AND status = 'active'",
		},
		{
			name:  "IN list",
			input: "id IN (1, 2, 3)",
		},
		{
			name:  "BETWEEN",
			input: "id BETWEEN 1 AND 100",
		},
		{
			name:  "IS NULL",
			input: "deleted_at IS NULL",
		},
		{
			name:  "LIKE",
			input: "name LIKE 'test%'",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wc, err := Parse(tt.input)
			if err != nil {
				t.Fatalf("Parse() error = %v", err)
			}

			sql := wc.ToSQL()
			if sql == "" {
				t.Error("ToSQL() returned empty string")
				return
			}

			// Verify the generated SQL can be reparsed
			reparsed, err := Parse(sql)
			if err != nil {
				t.Errorf("ToSQL() generated unparseable SQL: %v (SQL: %s)", err, sql)
				return
			}

			// Check that column references are preserved
			originalCols := wc.ReferencedColumns()
			reparsedCols := reparsed.ReferencedColumns()
			if !equalStringSlices(originalCols, reparsedCols) {
				t.Errorf("ToSQL() columns mismatch: original %v, reparsed %v", originalCols, reparsedCols)
			}
		})
	}
}

// TestOriginal tests the Original method
func TestOriginal(t *testing.T) {
	input := "id = 1 AND name = 'test'"
	wc, err := Parse(input)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}

	if got := wc.Original(); got != input {
		t.Errorf("Original() = %v, want %v", got, input)
	}
}

// TestParseBooleanTest tests IS TRUE, IS FALSE, etc.
func TestParseBooleanTest(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantColumns []string
	}{
		{
			name:        "IS TRUE",
			input:       "active IS TRUE",
			wantColumns: []string{"active"},
		},
		{
			name:        "IS FALSE",
			input:       "active IS FALSE",
			wantColumns: []string{"active"},
		},
		{
			name:        "IS NOT TRUE",
			input:       "active IS NOT TRUE",
			wantColumns: []string{"active"},
		},
		{
			name:        "IS NOT FALSE",
			input:       "active IS NOT FALSE",
			wantColumns: []string{"active"},
		},
		{
			name:        "IS UNKNOWN",
			input:       "active IS UNKNOWN",
			wantColumns: []string{"active"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Parse(tt.input)
			if err != nil {
				t.Errorf("Parse() error = %v", err)
				return
			}

			gotColumns := got.ReferencedColumns()
			if !equalStringSlices(gotColumns, tt.wantColumns) {
				t.Errorf("ReferencedColumns() = %v, want %v", gotColumns, tt.wantColumns)
			}
		})
	}
}

// TestParseTypeCast tests type cast expressions
func TestParseTypeCast(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantColumns []string
	}{
		{
			name:        "cast to integer",
			input:       "id = '1'::integer",
			wantColumns: []string{"id"},
		},
		{
			name:        "cast to text",
			input:       "name = 123::text",
			wantColumns: []string{"name"},
		},
		{
			name:        "cast to boolean",
			input:       "active = 'true'::boolean",
			wantColumns: []string{"active"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Parse(tt.input)
			if err != nil {
				t.Errorf("Parse() error = %v", err)
				return
			}

			gotColumns := got.ReferencedColumns()
			if !equalStringSlices(gotColumns, tt.wantColumns) {
				t.Errorf("ReferencedColumns() = %v, want %v", gotColumns, tt.wantColumns)
			}
		})
	}
}

// TestParseComplexExpressions tests more complex expression combinations
func TestParseComplexExpressions(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantColumns []string
	}{
		{
			name:        "deeply nested",
			input:       "((a = 1 AND b = 2) OR (c = 3 AND d = 4)) AND e = 5",
			wantColumns: []string{"a", "b", "c", "d", "e"},
		},
		{
			name:        "mixed operators",
			input:       "id IN (1, 2, 3) AND name LIKE 'test%' AND deleted_at IS NULL",
			wantColumns: []string{"deleted_at", "id", "name"},
		},
		{
			name:        "between with and",
			input:       "age BETWEEN 18 AND 65 AND status = 'active'",
			wantColumns: []string{"age", "status"},
		},
		{
			name:        "multiple null checks",
			input:       "a IS NULL OR b IS NOT NULL",
			wantColumns: []string{"a", "b"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Parse(tt.input)
			if err != nil {
				t.Errorf("Parse() error = %v", err)
				return
			}

			gotColumns := got.ReferencedColumns()
			sort.Strings(tt.wantColumns)
			if !equalStringSlices(gotColumns, tt.wantColumns) {
				t.Errorf("ReferencedColumns() = %v, want %v", gotColumns, tt.wantColumns)
			}
		})
	}
}

// equalStringSlices compares two string slices for equality
func equalStringSlices(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// TestWhereClause_Evaluate tests the Evaluate method
func TestWhereClause_Evaluate(t *testing.T) {
	tests := []struct {
		name    string
		where   string
		row     map[string]any
		want    bool
		wantErr bool
	}{
		// Basic equality
		{"equal match int64", "id = 1", map[string]any{"id": int64(1)}, true, false},
		{"equal no match int64", "id = 1", map[string]any{"id": int64(2)}, false, false},
		{"string equal match", "name = 'foo'", map[string]any{"name": "foo"}, true, false},
		{"string equal no match", "name = 'foo'", map[string]any{"name": "bar"}, false, false},

		// Not equal
		{"not equal match", "id <> 1", map[string]any{"id": int64(2)}, true, false},
		{"not equal no match", "id <> 1", map[string]any{"id": int64(1)}, false, false},
		{"not equal != match", "id != 1", map[string]any{"id": int64(2)}, true, false},

		// Comparison operators
		{"less than true", "age < 18", map[string]any{"age": int64(17)}, true, false},
		{"less than false", "age < 18", map[string]any{"age": int64(18)}, false, false},
		{"greater than true", "age > 18", map[string]any{"age": int64(19)}, true, false},
		{"greater than false", "age > 18", map[string]any{"age": int64(18)}, false, false},
		{"less than or equal true", "age <= 18", map[string]any{"age": int64(18)}, true, false},
		{"less than or equal false", "age <= 18", map[string]any{"age": int64(19)}, false, false},
		{"greater than or equal true", "age >= 18", map[string]any{"age": int64(18)}, true, false},
		{"greater than or equal false", "age >= 18", map[string]any{"age": int64(17)}, false, false},

		// Float comparisons
		{"float equal", "price = 19.99", map[string]any{"price": 19.99}, true, false},
		{"float less than", "price < 20.0", map[string]any{"price": 19.99}, true, false},
		{"float greater than", "price > 19.0", map[string]any{"price": 19.99}, true, false},

		// AND expressions
		{"AND true", "a = 1 AND b = 2", map[string]any{"a": int64(1), "b": int64(2)}, true, false},
		{"AND false left", "a = 1 AND b = 2", map[string]any{"a": int64(2), "b": int64(2)}, false, false},
		{"AND false right", "a = 1 AND b = 2", map[string]any{"a": int64(1), "b": int64(3)}, false, false},
		{"AND both false", "a = 1 AND b = 2", map[string]any{"a": int64(2), "b": int64(3)}, false, false},
		{"multiple AND true", "a = 1 AND b = 2 AND c = 3", map[string]any{"a": int64(1), "b": int64(2), "c": int64(3)}, true, false},
		{"multiple AND false", "a = 1 AND b = 2 AND c = 3", map[string]any{"a": int64(1), "b": int64(2), "c": int64(4)}, false, false},

		// OR expressions
		{"OR true left", "a = 1 OR b = 2", map[string]any{"a": int64(1), "b": int64(3)}, true, false},
		{"OR true right", "a = 1 OR b = 2", map[string]any{"a": int64(2), "b": int64(2)}, true, false},
		{"OR both true", "a = 1 OR b = 2", map[string]any{"a": int64(1), "b": int64(2)}, true, false},
		{"OR false", "a = 1 OR b = 2", map[string]any{"a": int64(2), "b": int64(3)}, false, false},
		{"multiple OR true", "a = 1 OR b = 2 OR c = 3", map[string]any{"a": int64(2), "b": int64(3), "c": int64(3)}, true, false},

		// NOT expressions
		{"NOT true", "NOT active", map[string]any{"active": true}, false, false},
		{"NOT false", "NOT active", map[string]any{"active": false}, true, false},

		// IS NULL / IS NOT NULL
		{"IS NULL true", "x IS NULL", map[string]any{"x": nil}, true, false},
		{"IS NULL false", "x IS NULL", map[string]any{"x": "val"}, false, false},
		{"IS NULL missing column", "x IS NULL", map[string]any{}, true, false},
		{"IS NOT NULL true", "x IS NOT NULL", map[string]any{"x": "val"}, true, false},
		{"IS NOT NULL false", "x IS NOT NULL", map[string]any{"x": nil}, false, false},

		// NULL handling in comparisons (three-valued logic)
		{"equal NULL returns false", "id = 1", map[string]any{"id": nil}, false, false},
		{"NULL = NULL returns false", "id = NULL", map[string]any{"id": nil}, false, false},
		{"AND with NULL operand false", "a = 1 AND b = 2", map[string]any{"a": int64(1), "b": nil}, false, false},
		{"AND with NULL operand definite false", "a = 1 AND b = 2", map[string]any{"a": int64(2), "b": nil}, false, false},
		{"OR with NULL operand true", "a = 1 OR b = 2", map[string]any{"a": int64(1), "b": nil}, true, false},
		{"OR with NULL operand false", "a = 1 OR b = 2", map[string]any{"a": int64(2), "b": nil}, false, false},

		// LIKE patterns
		{"LIKE suffix match", "name LIKE 'foo%'", map[string]any{"name": "foobar"}, true, false},
		{"LIKE suffix no match", "name LIKE 'foo%'", map[string]any{"name": "barfoo"}, false, false},
		{"LIKE prefix match", "name LIKE '%bar'", map[string]any{"name": "foobar"}, true, false},
		{"LIKE contains match", "name LIKE '%oba%'", map[string]any{"name": "foobar"}, true, false},
		{"LIKE underscore match", "name LIKE 'fo_bar'", map[string]any{"name": "foobar"}, true, false},
		{"LIKE underscore no match", "name LIKE 'fo_bar'", map[string]any{"name": "fooobar"}, false, false},
		{"LIKE exact match", "name LIKE 'foobar'", map[string]any{"name": "foobar"}, true, false},
		{"LIKE exact no match", "name LIKE 'foobar'", map[string]any{"name": "foobarbaz"}, false, false},
		{"NOT LIKE match", "name NOT LIKE 'foo%'", map[string]any{"name": "barfoo"}, true, false},
		{"NOT LIKE no match", "name NOT LIKE 'foo%'", map[string]any{"name": "foobar"}, false, false},

		// ILIKE (case-insensitive)
		{"ILIKE case insensitive match", "name ILIKE 'FOO%'", map[string]any{"name": "foobar"}, true, false},
		{"ILIKE case insensitive match 2", "name ILIKE 'foo%'", map[string]any{"name": "FOOBAR"}, true, false},
		{"NOT ILIKE case insensitive", "name NOT ILIKE 'FOO%'", map[string]any{"name": "barfoo"}, true, false},

		// IN lists
		{"IN list match first", "status IN ('a', 'b', 'c')", map[string]any{"status": "a"}, true, false},
		{"IN list match middle", "status IN ('a', 'b', 'c')", map[string]any{"status": "b"}, true, false},
		{"IN list match last", "status IN ('a', 'b', 'c')", map[string]any{"status": "c"}, true, false},
		{"IN list no match", "status IN ('a', 'b', 'c')", map[string]any{"status": "d"}, false, false},
		{"IN list integer match", "id IN (1, 2, 3)", map[string]any{"id": int64(2)}, true, false},
		{"IN list integer no match", "id IN (1, 2, 3)", map[string]any{"id": int64(4)}, false, false},
		{"NOT IN list match", "status NOT IN ('a', 'b')", map[string]any{"status": "c"}, true, false},
		{"NOT IN list no match", "status NOT IN ('a', 'b')", map[string]any{"status": "a"}, false, false},

		// BETWEEN
		{"BETWEEN match lower", "age BETWEEN 18 AND 65", map[string]any{"age": int64(18)}, true, false},
		{"BETWEEN match upper", "age BETWEEN 18 AND 65", map[string]any{"age": int64(65)}, true, false},
		{"BETWEEN match middle", "age BETWEEN 18 AND 65", map[string]any{"age": int64(40)}, true, false},
		{"BETWEEN no match below", "age BETWEEN 18 AND 65", map[string]any{"age": int64(17)}, false, false},
		{"BETWEEN no match above", "age BETWEEN 18 AND 65", map[string]any{"age": int64(66)}, false, false},
		{"NOT BETWEEN match", "age NOT BETWEEN 18 AND 65", map[string]any{"age": int64(17)}, true, false},
		{"NOT BETWEEN no match", "age NOT BETWEEN 18 AND 65", map[string]any{"age": int64(40)}, false, false},

		// Boolean tests
		{"IS TRUE with true", "active IS TRUE", map[string]any{"active": true}, true, false},
		{"IS TRUE with false", "active IS TRUE", map[string]any{"active": false}, false, false},
		{"IS TRUE with null", "active IS TRUE", map[string]any{"active": nil}, false, false},
		{"IS FALSE with true", "active IS FALSE", map[string]any{"active": true}, false, false},
		{"IS FALSE with false", "active IS FALSE", map[string]any{"active": false}, true, false},
		{"IS FALSE with null", "active IS FALSE", map[string]any{"active": nil}, false, false},
		{"IS NOT TRUE with true", "active IS NOT TRUE", map[string]any{"active": true}, false, false},
		{"IS NOT TRUE with false", "active IS NOT TRUE", map[string]any{"active": false}, true, false},
		{"IS NOT TRUE with null", "active IS NOT TRUE", map[string]any{"active": nil}, true, false},
		{"IS NOT FALSE with true", "active IS NOT FALSE", map[string]any{"active": true}, true, false},
		{"IS NOT FALSE with false", "active IS NOT FALSE", map[string]any{"active": false}, false, false},
		{"IS NOT FALSE with null", "active IS NOT FALSE", map[string]any{"active": nil}, true, false},
		{"IS UNKNOWN with null", "active IS UNKNOWN", map[string]any{"active": nil}, true, false},
		{"IS UNKNOWN with value", "active IS UNKNOWN", map[string]any{"active": true}, false, false},

		// Complex expressions
		{"nested AND OR", "(a = 1 AND b = 2) OR c = 3", map[string]any{"a": int64(1), "b": int64(2), "c": int64(4)}, true, false},
		{"nested AND OR 2", "(a = 1 AND b = 2) OR c = 3", map[string]any{"a": int64(2), "b": int64(2), "c": int64(3)}, true, false},
		{"nested AND OR 3", "(a = 1 AND b = 2) OR c = 3", map[string]any{"a": int64(2), "b": int64(3), "c": int64(4)}, false, false},
		{"mixed conditions", "id IN (1, 2) AND name LIKE 'foo%' AND deleted_at IS NULL", map[string]any{"id": int64(1), "name": "foobar", "deleted_at": nil}, true, false},
		{"mixed conditions fail", "id IN (1, 2) AND name LIKE 'foo%' AND deleted_at IS NULL", map[string]any{"id": int64(1), "name": "barfoo", "deleted_at": nil}, false, false},

		// Type coercion
		{"int vs int64", "id = 1", map[string]any{"id": 1}, true, false},
		{"int32 vs int64", "id = 1", map[string]any{"id": int32(1)}, true, false},
		{"float32 comparison", "price > 19.0", map[string]any{"price": float32(20.0)}, true, false},
		{"string numeric comparison", "id = 1", map[string]any{"id": "1"}, true, false},

		// Boolean literals
		{"boolean true literal", "active = true", map[string]any{"active": true}, true, false},
		{"boolean false literal", "active = false", map[string]any{"active": false}, true, false},
		{"boolean mismatch", "active = true", map[string]any{"active": false}, false, false},

		// String comparisons
		{"string less than", "name < 'b'", map[string]any{"name": "a"}, true, false},
		{"string greater than", "name > 'a'", map[string]any{"name": "b"}, true, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wc, err := Parse(tt.where)
			if err != nil {
				t.Fatalf("Parse() error = %v", err)
			}

			got, err := wc.Evaluate(tt.row)
			if (err != nil) != tt.wantErr {
				t.Errorf("Evaluate() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if got != tt.want {
				t.Errorf("Evaluate() = %v, want %v", got, tt.want)
			}
		})
	}
}

// TestEvaluate_LikePatternEdgeCases tests edge cases in LIKE pattern matching
func TestEvaluate_LikePatternEdgeCases(t *testing.T) {
	tests := []struct {
		name    string
		where   string
		row     map[string]any
		want    bool
	}{
		{"LIKE with regex special chars", "name LIKE 'foo.bar'", map[string]any{"name": "foo.bar"}, true},
		{"LIKE does not interpret regex", "name LIKE 'foo.bar'", map[string]any{"name": "fooxbar"}, false},
		{"LIKE with brackets", "name LIKE '[test]'", map[string]any{"name": "[test]"}, true},
		{"LIKE with plus", "name LIKE 'a+b'", map[string]any{"name": "a+b"}, true},
		{"LIKE with star", "name LIKE 'a*b'", map[string]any{"name": "a*b"}, true},
		{"LIKE with caret", "name LIKE '^test$'", map[string]any{"name": "^test$"}, true},
		{"LIKE escaped percent", "name LIKE 'foo\\%bar'", map[string]any{"name": "foo%bar"}, true},
		{"LIKE escaped underscore", "name LIKE 'foo\\_bar'", map[string]any{"name": "foo_bar"}, true},
		{"LIKE empty pattern", "name LIKE ''", map[string]any{"name": ""}, true},
		{"LIKE empty string no match", "name LIKE ''", map[string]any{"name": "foo"}, false},
		{"LIKE percent only", "name LIKE '%'", map[string]any{"name": "anything"}, true},
		{"LIKE percent only empty", "name LIKE '%'", map[string]any{"name": ""}, true},
		{"LIKE underscore only", "name LIKE '_'", map[string]any{"name": "x"}, true},
		{"LIKE underscore only no match", "name LIKE '_'", map[string]any{"name": "xx"}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wc, err := Parse(tt.where)
			if err != nil {
				t.Fatalf("Parse() error = %v", err)
			}

			got, err := wc.Evaluate(tt.row)
			if err != nil {
				t.Errorf("Evaluate() error = %v", err)
				return
			}
			if got != tt.want {
				t.Errorf("Evaluate() = %v, want %v", got, tt.want)
			}
		})
	}
}

// TestEvaluate_NullSemantics tests three-valued logic with NULL values
func TestEvaluate_NullSemantics(t *testing.T) {
	tests := []struct {
		name  string
		where string
		row   map[string]any
		want  bool
	}{
		// NULL comparisons always return NULL (which becomes false)
		{"NULL = NULL", "x = y", map[string]any{"x": nil, "y": nil}, false},
		{"NULL = value", "x = 1", map[string]any{"x": nil}, false},
		{"value = NULL", "x = y", map[string]any{"x": int64(1), "y": nil}, false},

		// AND with NULL
		{"false AND NULL = false", "a = 1 AND b = 2", map[string]any{"a": int64(2), "b": nil}, false},
		{"NULL AND false = false", "a = 1 AND b = 2", map[string]any{"a": nil, "b": int64(3)}, false},
		{"true AND NULL = NULL (false)", "a = 1 AND b = 2", map[string]any{"a": int64(1), "b": nil}, false},
		{"NULL AND NULL = NULL (false)", "a = 1 AND b = 2", map[string]any{"a": nil, "b": nil}, false},

		// OR with NULL
		{"true OR NULL = true", "a = 1 OR b = 2", map[string]any{"a": int64(1), "b": nil}, true},
		{"NULL OR true = true", "a = 1 OR b = 2", map[string]any{"a": nil, "b": int64(2)}, true},
		{"false OR NULL = NULL (false)", "a = 1 OR b = 2", map[string]any{"a": int64(2), "b": nil}, false},
		{"NULL OR NULL = NULL (false)", "a = 1 OR b = 2", map[string]any{"a": nil, "b": nil}, false},

		// NOT with NULL
		{"NOT NULL = NULL (false)", "NOT a", map[string]any{"a": nil}, false},

		// IN with NULL in list (not currently testable with literal syntax)
		// These test the value being NULL
		{"NULL IN list", "x IN (1, 2, 3)", map[string]any{"x": nil}, false},
		{"NULL NOT IN list", "x NOT IN (1, 2, 3)", map[string]any{"x": nil}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wc, err := Parse(tt.where)
			if err != nil {
				t.Fatalf("Parse() error = %v", err)
			}

			got, err := wc.Evaluate(tt.row)
			if err != nil {
				t.Errorf("Evaluate() error = %v", err)
				return
			}
			if got != tt.want {
				t.Errorf("Evaluate() = %v, want %v", got, tt.want)
			}
		})
	}
}

// TestEvaluate_TypeCoercion tests type coercion in comparisons
func TestEvaluate_TypeCoercion(t *testing.T) {
	tests := []struct {
		name  string
		where string
		row   map[string]any
		want  bool
	}{
		// Integer types
		{"int to int64", "x = 42", map[string]any{"x": 42}, true},
		{"int32 to int64", "x = 42", map[string]any{"x": int32(42)}, true},
		{"int64 to int64", "x = 42", map[string]any{"x": int64(42)}, true},

		// Float types (note: exact equality with float32 can be tricky due to precision)
		{"float32 greater", "x > 3.0", map[string]any{"x": float32(3.14)}, true},
		{"float64 equals", "x = 3.14", map[string]any{"x": float64(3.14)}, true},

		// Mixed numeric
		{"int vs float", "x > 3", map[string]any{"x": 3.5}, true},
		{"float vs int", "x < 4", map[string]any{"x": 3.5}, true},

		// String to number
		{"string number equals", "x = 42", map[string]any{"x": "42"}, true},
		{"string float equals", "x = 3.14", map[string]any{"x": "3.14"}, true},

		// Non-numeric strings fall back to string comparison
		{"string comparison", "x = 'hello'", map[string]any{"x": "hello"}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wc, err := Parse(tt.where)
			if err != nil {
				t.Fatalf("Parse() error = %v", err)
			}

			got, err := wc.Evaluate(tt.row)
			if err != nil {
				t.Errorf("Evaluate() error = %v", err)
				return
			}
			if got != tt.want {
				t.Errorf("Evaluate() = %v, want %v", got, tt.want)
			}
		})
	}
}
