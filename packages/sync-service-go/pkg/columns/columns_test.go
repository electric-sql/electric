// Ported from: test/electric/plug/utils_test.exs (column parsing)
// and lib/electric/postgres/identifiers.ex (doctests)
package columns

import (
	"strings"
	"testing"
)

func TestParseColumns(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    []string
		wantErr string
	}{
		// Basic cases from Elixir doctests
		{
			name:  "single column",
			input: "id",
			want:  []string{"id"},
		},
		{
			name:  "two columns",
			input: "id,name",
			want:  []string{"id", "name"},
		},
		{
			name:  "three columns",
			input: "id,name,email",
			want:  []string{"id", "name", "email"},
		},

		// Case handling
		{
			name:  "unquoted uppercase is lowercased",
			input: "PoTaTo",
			want:  []string{"potato"},
		},
		{
			name:  "quoted preserves case",
			input: `"PoTaTo"`,
			want:  []string{"PoTaTo"},
		},
		{
			name:  "mixed quoted and unquoted",
			input: `"PoT@To",PoTaTo`,
			want:  []string{"PoT@To", "potato"},
		},

		// Special characters in quoted identifiers
		{
			name:  "comma inside quotes",
			input: `"PoTaTo,sunday",foo`,
			want:  []string{"PoTaTo,sunday", "foo"},
		},
		{
			name:  "escaped quote inside quotes",
			input: `"fo""o",bar`,
			want:  []string{`fo"o`, "bar"},
		},
		{
			name:  "space inside quotes",
			input: `" "`,
			want:  []string{" "},
		},
		{
			name:  "at sign inside quotes",
			input: `"foo@bar"`,
			want:  []string{"foo@bar"},
		},
		{
			name:  "multiple special chars in quotes",
			input: `"has spaces and, commas"`,
			want:  []string{"has spaces and, commas"},
		},

		// Unquoted with valid special chars
		{
			name:  "unquoted with underscore",
			input: "foo_bar",
			want:  []string{"foo_bar"},
		},
		{
			name:  "unquoted with dollar sign",
			input: "foo$bar",
			want:  []string{"foo$bar"},
		},
		{
			name:  "unquoted with number",
			input: "foo123",
			want:  []string{"foo123"},
		},
		{
			name:  "unquoted starting with underscore",
			input: "_foo",
			want:  []string{"_foo"},
		},

		// Error cases
		{
			name:    "empty string",
			input:   "",
			wantErr: "invalid zero-length delimited identifier",
		},
		{
			name:    "trailing comma",
			input:   "foo,",
			wantErr: "invalid zero-length delimited identifier",
		},
		{
			name:    "leading comma",
			input:   ",foo",
			wantErr: "invalid zero-length delimited identifier",
		},
		{
			name:    "double comma",
			input:   "foo,,bar",
			wantErr: "invalid zero-length delimited identifier",
		},
		{
			name:    "only comma",
			input:   ",",
			wantErr: "invalid zero-length delimited identifier",
		},
		{
			name:    "empty quoted identifier",
			input:   `""`,
			wantErr: "invalid zero-length delimited identifier",
		},
		{
			name:    "unquoted with special characters",
			input:   "foob@r",
			wantErr: "invalid unquoted identifier contains special characters: foob@r",
		},
		{
			name:    "unquoted with space",
			input:   "foo bar",
			wantErr: "invalid unquoted identifier contains special characters: foo bar",
		},
		{
			name:    "unquoted with quote",
			input:   `Foo"Bar"`,
			wantErr: `invalid unquoted identifier contains special characters: Foo"Bar"`,
		},
		{
			name:    "unescaped quote in quoted identifier",
			input:   `"Foo"Bar"`,
			wantErr: "invalid identifier with unescaped quote: Foo\"Bar",
		},
		{
			name:    "invalid mixed quote pattern",
			input:   `"id,"name"`,
			wantErr: "invalid identifier with unescaped quote",
		},

		// Edge cases
		{
			name:  "single quoted column",
			input: `"id"`,
			want:  []string{"id"},
		},
		{
			name:  "multiple escaped quotes",
			input: `"a""b""c"`,
			want:  []string{`a"b"c`},
		},
		{
			name:  "only spaces in quoted",
			input: `"   "`,
			want:  []string{"   "},
		},
		{
			name:  "unicode letters unquoted",
			input: "cafe",
			want:  []string{"cafe"},
		},
		{
			name:  "underscore only",
			input: "_",
			want:  []string{"_"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseColumns(tt.input)

			if tt.wantErr != "" {
				if err == nil {
					t.Errorf("ParseColumns(%q) expected error containing %q, got nil", tt.input, tt.wantErr)
					return
				}
				if !strings.Contains(err.Error(), tt.wantErr) {
					t.Errorf("ParseColumns(%q) error = %q, want error containing %q", tt.input, err.Error(), tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Errorf("ParseColumns(%q) unexpected error: %v", tt.input, err)
				return
			}

			if !sliceEqual(got, tt.want) {
				t.Errorf("ParseColumns(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestParseColumnsLongIdentifier(t *testing.T) {
	// Test identifier at max length (63 characters)
	maxLengthIdent := strings.Repeat("a", MaxIdentifierLength)
	got, err := ParseColumns(maxLengthIdent)
	if err != nil {
		t.Errorf("ParseColumns with 63-char identifier: unexpected error: %v", err)
	}
	if len(got) != 1 || got[0] != maxLengthIdent {
		t.Errorf("ParseColumns with 63-char identifier = %v, want [%s]", got, maxLengthIdent)
	}

	// Test identifier exceeding max length (64 characters)
	tooLongIdent := strings.Repeat("a", MaxIdentifierLength+1)
	_, err = ParseColumns(tooLongIdent)
	if err == nil {
		t.Errorf("ParseColumns with 64-char identifier: expected error, got nil")
	}
	if !strings.Contains(err.Error(), "too long") {
		t.Errorf("ParseColumns with 64-char identifier: expected 'too long' error, got: %v", err)
	}

	// Test quoted identifier at max length
	quotedMaxLength := `"` + strings.Repeat("a", MaxIdentifierLength) + `"`
	got, err = ParseColumns(quotedMaxLength)
	if err != nil {
		t.Errorf("ParseColumns with quoted 63-char identifier: unexpected error: %v", err)
	}
	if len(got) != 1 || got[0] != strings.Repeat("a", MaxIdentifierLength) {
		t.Errorf("ParseColumns with quoted 63-char identifier: unexpected result")
	}

	// Test quoted identifier exceeding max length
	quotedTooLong := `"` + strings.Repeat("a", MaxIdentifierLength+1) + `"`
	_, err = ParseColumns(quotedTooLong)
	if err == nil {
		t.Errorf("ParseColumns with quoted 64-char identifier: expected error, got nil")
	}
}

func TestValidateColumns(t *testing.T) {
	available := []string{"id", "name", "email", "created_at"}
	pkColumns := []string{"id"}

	tests := []struct {
		name      string
		requested []string
		available []string
		pkColumns []string
		want      []string
		wantErr   string
	}{
		// Empty requested returns all available
		{
			name:      "empty requested returns all available",
			requested: nil,
			available: available,
			pkColumns: pkColumns,
			want:      available,
		},
		{
			name:      "empty slice requested returns all available",
			requested: []string{},
			available: available,
			pkColumns: pkColumns,
			want:      available,
		},

		// Basic validation
		{
			name:      "all requested columns exist",
			requested: []string{"name", "email"},
			available: available,
			pkColumns: pkColumns,
			want:      []string{"id", "name", "email"}, // PK added first
		},
		{
			name:      "requested columns include PK",
			requested: []string{"id", "name"},
			available: available,
			pkColumns: pkColumns,
			want:      []string{"id", "name"}, // PK not duplicated
		},

		// PK handling
		{
			name:      "PK added when not requested",
			requested: []string{"name"},
			available: available,
			pkColumns: pkColumns,
			want:      []string{"id", "name"},
		},
		{
			name:      "multiple PK columns added",
			requested: []string{"email"},
			available: []string{"id", "tenant_id", "name", "email"},
			pkColumns: []string{"id", "tenant_id"},
			want:      []string{"id", "tenant_id", "email"},
		},
		{
			name:      "partial PK columns requested",
			requested: []string{"id", "email"},
			available: []string{"id", "tenant_id", "name", "email"},
			pkColumns: []string{"id", "tenant_id"},
			want:      []string{"tenant_id", "id", "email"}, // missing PK added first
		},

		// Duplicate handling
		{
			name:      "duplicates removed",
			requested: []string{"name", "email", "name"},
			available: available,
			pkColumns: pkColumns,
			want:      []string{"id", "name", "email"},
		},
		{
			name:      "multiple duplicates removed",
			requested: []string{"name", "name", "name", "email", "email"},
			available: available,
			pkColumns: pkColumns,
			want:      []string{"id", "name", "email"},
		},

		// Error cases
		{
			name:      "column does not exist",
			requested: []string{"nonexistent"},
			available: available,
			pkColumns: pkColumns,
			wantErr:   `column "nonexistent" does not exist`,
		},
		{
			name:      "one of many columns does not exist",
			requested: []string{"name", "nonexistent", "email"},
			available: available,
			pkColumns: pkColumns,
			wantErr:   `column "nonexistent" does not exist`,
		},

		// Edge cases
		{
			name:      "empty available returns error for any request",
			requested: []string{"name"},
			available: []string{},
			pkColumns: []string{},
			wantErr:   `column "name" does not exist`,
		},
		{
			name:      "empty available with empty request returns empty",
			requested: []string{},
			available: []string{},
			pkColumns: []string{},
			want:      []string{},
		},
		{
			name:      "no PK columns",
			requested: []string{"name", "email"},
			available: available,
			pkColumns: []string{},
			want:      []string{"name", "email"},
		},
		{
			name:      "all columns are PKs",
			requested: []string{"email"},
			available: []string{"id", "email"},
			pkColumns: []string{"id", "email"},
			want:      []string{"id", "email"}, // id added, email was requested
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ValidateColumns(tt.requested, tt.available, tt.pkColumns)

			if tt.wantErr != "" {
				if err == nil {
					t.Errorf("ValidateColumns() expected error containing %q, got nil", tt.wantErr)
					return
				}
				if !strings.Contains(err.Error(), tt.wantErr) {
					t.Errorf("ValidateColumns() error = %q, want error containing %q", err.Error(), tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Errorf("ValidateColumns() unexpected error: %v", err)
				return
			}

			if !sliceEqual(got, tt.want) {
				t.Errorf("ValidateColumns() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSplitByCommaOutsideQuotes(t *testing.T) {
	tests := []struct {
		input string
		want  []string
	}{
		{"a,b,c", []string{"a", "b", "c"}},
		{`"a,b",c`, []string{`"a,b"`, "c"}},
		{`a,"b,c"`, []string{"a", `"b,c"`}},
		{`"a","b"`, []string{`"a"`, `"b"`}},
		{`"a,b","c,d"`, []string{`"a,b"`, `"c,d"`}},
		{"a", []string{"a"}},
		{`""`, []string{`""`}},
		{",", []string{"", ""}},
		{"a,", []string{"a", ""}},
		{",a", []string{"", "a"}},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := splitByCommaOutsideQuotes(tt.input)
			if !sliceEqual(got, tt.want) {
				t.Errorf("splitByCommaOutsideQuotes(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestParseIdentifier(t *testing.T) {
	tests := []struct {
		input   string
		want    string
		wantErr bool
	}{
		// Unquoted - lowercased
		{"FooBar", "foobar", false},
		{"foobar", "foobar", false},
		{"FOOBAR", "foobar", false},
		{"foo_bar", "foo_bar", false},
		{"foo123", "foo123", false},
		{"_foo", "_foo", false},

		// Quoted - preserve case
		{`"FooBar"`, "FooBar", false},
		{`"foobar"`, "foobar", false},
		{`"FOOBAR"`, "FOOBAR", false},

		// Quoted with special chars
		{`"foo bar"`, "foo bar", false},
		{`"foo@bar"`, "foo@bar", false},
		{`" "`, " ", false},

		// Escaped quotes
		{`"Foo""Bar"`, `Foo"Bar`, false},
		{`"a""b""c"`, `a"b"c`, false},

		// Errors
		{"", "", true},
		{`""`, "", true},
		{`"Foo"Bar"`, "", true}, // unescaped quote
		{"foo bar", "", true},   // space in unquoted
		{"foo@bar", "", true},   // special char in unquoted
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, err := parseIdentifier(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Errorf("parseIdentifier(%q) expected error, got nil", tt.input)
				}
				return
			}
			if err != nil {
				t.Errorf("parseIdentifier(%q) unexpected error: %v", tt.input, err)
				return
			}
			if got != tt.want {
				t.Errorf("parseIdentifier(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestDowncaseIdentifier(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"FooBar", "foobar"},
		{"FOOBAR", "foobar"},
		{"foobar", "foobar"},
		{"Foo_Bar", "foo_bar"},
		{"FOO123", "foo123"},
		{"foo", "foo"},
		{"A", "a"},
		{"Z", "z"},
		{"", ""},
		// Non-ASCII letters are NOT lowercased (PostgreSQL behavior)
		{"ABC", "abc"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := downcaseIdentifier(tt.input)
			if got != tt.want {
				t.Errorf("downcaseIdentifier(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestContainsUnescapedQuote(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{`Foo"Bar`, true},     // unescaped
		{`Foo""Bar`, false},   // escaped
		{`""`, false},         // escaped at start
		{`"""`, true},         // escaped + unescaped
		{`""""`, false},       // two escaped pairs
		{`FooBar`, false},     // no quotes
		{`"`, true},           // single quote
		{`a"b"c`, true},       // unescaped quotes
		{`a""b""c`, false},    // all escaped
		{`a"""b`, true},       // escaped + unescaped
		{`a""b"c`, true},      // escaped then unescaped
		{`Foo"Bar"`, true},    // ends with unescaped pair
		{`Foo""`, false},      // ends with escaped
		{`""Foo`, false},      // starts with escaped
		{`"Foo`, true},        // starts with unescaped
		{`a""b""c""d`, false}, // multiple escaped
		{`a""b"c""d`, true},   // middle unescaped
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := containsUnescapedQuote(tt.input)
			if got != tt.want {
				t.Errorf("containsUnescapedQuote(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

// Helper function to compare string slices
func sliceEqual(a, b []string) bool {
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

// Benchmark tests
func BenchmarkParseColumns(b *testing.B) {
	input := `id,name,"Email Address","First Name",created_at`
	for i := 0; i < b.N; i++ {
		_, _ = ParseColumns(input)
	}
}

func BenchmarkValidateColumns(b *testing.B) {
	requested := []string{"name", "email", "created_at"}
	available := []string{"id", "name", "email", "created_at", "updated_at", "deleted_at"}
	pkColumns := []string{"id"}

	for i := 0; i < b.N; i++ {
		_, _ = ValidateColumns(requested, available, pkColumns)
	}
}
