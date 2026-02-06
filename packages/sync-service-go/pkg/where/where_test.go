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
