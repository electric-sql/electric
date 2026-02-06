// Package shape tests
//
// Ported from: test/electric/shapes/shape_test.exs
package shape

import (
	"strings"
	"testing"

	"github.com/electric-sql/electric/packages/sync-service-go/pkg/schema"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/where"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestValidateReplicaMode tests the ReplicaMode type and validation
func TestValidateReplicaMode(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected ReplicaMode
		hasError bool
	}{
		{
			name:     "default mode",
			input:    "default",
			expected: ReplicaDefault,
			hasError: false,
		},
		{
			name:     "empty defaults to default",
			input:    "",
			expected: ReplicaDefault,
			hasError: false,
		},
		{
			name:     "full mode",
			input:    "full",
			expected: ReplicaFull,
			hasError: false,
		},
		{
			name:     "invalid mode",
			input:    "invalid",
			expected: "",
			hasError: true,
		},
		{
			name:     "case sensitive",
			input:    "FULL",
			expected: "",
			hasError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mode, err := ValidateReplicaMode(tt.input)
			if tt.hasError {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
				assert.Equal(t, tt.expected, mode)
			}
		})
	}
}

// TestNew tests shape creation with New() and options
func TestNew(t *testing.T) {
	t.Run("creates shape with table name", func(t *testing.T) {
		s, err := New("users")
		require.NoError(t, err)
		assert.Equal(t, "users", s.TableName)
		assert.Equal(t, "public", s.Schema)
		assert.Equal(t, ReplicaDefault, s.Replica)
		assert.Nil(t, s.Where)
		assert.Nil(t, s.Columns)
	})

	t.Run("fails with empty table name", func(t *testing.T) {
		_, err := New("")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "table name is required")
	})

	t.Run("with custom schema", func(t *testing.T) {
		s, err := New("users", WithSchema("myschema"))
		require.NoError(t, err)
		assert.Equal(t, "myschema", s.Schema)
	})

	t.Run("empty schema defaults to public", func(t *testing.T) {
		s, err := New("users", WithSchema(""))
		require.NoError(t, err)
		assert.Equal(t, "public", s.Schema)
	})

	t.Run("with columns", func(t *testing.T) {
		s, err := New("users", WithColumns([]string{"name", "email", "id"}))
		require.NoError(t, err)
		assert.Equal(t, []string{"email", "id", "name"}, s.Columns) // sorted
	})

	t.Run("empty columns means all columns", func(t *testing.T) {
		s, err := New("users", WithColumns([]string{}))
		require.NoError(t, err)
		assert.Nil(t, s.Columns)
	})

	t.Run("nil columns means all columns", func(t *testing.T) {
		s, err := New("users", WithColumns(nil))
		require.NoError(t, err)
		assert.Nil(t, s.Columns)
	})

	t.Run("duplicate columns are removed", func(t *testing.T) {
		s, err := New("users", WithColumns([]string{"id", "name", "id", "email", "name"}))
		require.NoError(t, err)
		assert.Equal(t, []string{"email", "id", "name"}, s.Columns)
	})

	t.Run("empty column name fails", func(t *testing.T) {
		_, err := New("users", WithColumns([]string{"id", "", "name"}))
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "column name cannot be empty")
	})

	t.Run("with replica mode full", func(t *testing.T) {
		s, err := New("users", WithReplica(ReplicaFull))
		require.NoError(t, err)
		assert.Equal(t, ReplicaFull, s.Replica)
	})

	t.Run("with replica mode default", func(t *testing.T) {
		s, err := New("users", WithReplica(ReplicaDefault))
		require.NoError(t, err)
		assert.Equal(t, ReplicaDefault, s.Replica)
	})

	t.Run("empty replica mode defaults to default", func(t *testing.T) {
		s, err := New("users", WithReplica(""))
		require.NoError(t, err)
		assert.Equal(t, ReplicaDefault, s.Replica)
	})

	t.Run("invalid replica mode fails", func(t *testing.T) {
		_, err := New("users", WithReplica("invalid"))
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid replica mode")
	})

	t.Run("with valid WHERE clause", func(t *testing.T) {
		s, err := New("users", WithWhere("id = 1"))
		require.NoError(t, err)
		assert.NotNil(t, s.Where)
		// where.Parse normalizes SQL - actual format depends on pg_query_go
		assert.Contains(t, s.Where.ToSQL(), "id")
		assert.Contains(t, s.Where.ToSQL(), "1")
	})

	t.Run("empty WHERE clause is allowed", func(t *testing.T) {
		s, err := New("users", WithWhere(""))
		require.NoError(t, err)
		assert.Nil(t, s.Where)
	})

	t.Run("invalid WHERE clause fails", func(t *testing.T) {
		_, err := New("users", WithWhere("invalid sql !!!"))
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid WHERE clause")
	})

	t.Run("multiple options combined", func(t *testing.T) {
		s, err := New("orders",
			WithSchema("sales"),
			WithColumns([]string{"total", "id", "customer_id"}),
			WithWhere("total > 100"),
			WithReplica(ReplicaFull),
		)
		require.NoError(t, err)
		assert.Equal(t, "orders", s.TableName)
		assert.Equal(t, "sales", s.Schema)
		assert.Equal(t, []string{"customer_id", "id", "total"}, s.Columns)
		assert.NotNil(t, s.Where)
		assert.Equal(t, ReplicaFull, s.Replica)
	})
}

// TestWithWhereClause tests the WithWhereClause option
func TestWithWhereClause(t *testing.T) {
	t.Run("with pre-parsed WHERE clause", func(t *testing.T) {
		wc, err := where.Parse("status = 'active'")
		require.NoError(t, err)

		s, err := New("users", WithWhereClause(wc))
		require.NoError(t, err)
		assert.Equal(t, wc, s.Where)
	})

	t.Run("with nil WHERE clause", func(t *testing.T) {
		s, err := New("users", WithWhereClause(nil))
		require.NoError(t, err)
		assert.Nil(t, s.Where)
	})
}

// TestWithTableSchema tests the WithTableSchema option
func TestWithTableSchema(t *testing.T) {
	t.Run("with table schema", func(t *testing.T) {
		ts := schema.NewTableSchema("public", "users", []schema.Column{
			{Name: "id", Type: "int4", PKIndex: 0, NotNull: true},
			{Name: "name", Type: "text"},
		})

		s, err := New("users", WithTableSchema(ts))
		require.NoError(t, err)
		assert.Equal(t, ts, s.TableSchema)
	})

	t.Run("validates columns against table schema", func(t *testing.T) {
		ts := schema.NewTableSchema("public", "users", []schema.Column{
			{Name: "id", Type: "int4", PKIndex: 0, NotNull: true},
			{Name: "name", Type: "text"},
		})

		_, err := New("users",
			WithColumns([]string{"id", "nonexistent"}),
			WithTableSchema(ts),
		)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "unknown column(s): nonexistent")
	})

	t.Run("valid columns pass validation", func(t *testing.T) {
		ts := schema.NewTableSchema("public", "users", []schema.Column{
			{Name: "id", Type: "int4", PKIndex: 0, NotNull: true},
			{Name: "name", Type: "text"},
			{Name: "email", Type: "text"},
		})

		s, err := New("users",
			WithColumns([]string{"id", "name"}),
			WithTableSchema(ts),
		)
		require.NoError(t, err)
		assert.Equal(t, []string{"id", "name"}, s.Columns)
	})
}

// TestHash tests the Hash method
func TestHash(t *testing.T) {
	t.Run("returns 16 character hex string", func(t *testing.T) {
		s, err := New("users")
		require.NoError(t, err)
		hash := s.Hash()
		assert.Len(t, hash, 16)
		// Verify it's valid hex
		for _, c := range hash {
			assert.True(t, (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'),
				"expected hex character, got %c", c)
		}
	})

	t.Run("same shape produces same hash", func(t *testing.T) {
		s1, _ := New("users", WithSchema("public"), WithWhere("id > 0"))
		s2, _ := New("users", WithSchema("public"), WithWhere("id > 0"))
		assert.Equal(t, s1.Hash(), s2.Hash())
	})

	t.Run("different table produces different hash", func(t *testing.T) {
		s1, _ := New("users")
		s2, _ := New("orders")
		assert.NotEqual(t, s1.Hash(), s2.Hash())
	})

	t.Run("different schema produces different hash", func(t *testing.T) {
		s1, _ := New("users", WithSchema("public"))
		s2, _ := New("users", WithSchema("private"))
		assert.NotEqual(t, s1.Hash(), s2.Hash())
	})

	t.Run("different WHERE produces different hash", func(t *testing.T) {
		s1, _ := New("users", WithWhere("id = 1"))
		s2, _ := New("users", WithWhere("id = 2"))
		assert.NotEqual(t, s1.Hash(), s2.Hash())
	})

	t.Run("with WHERE vs without produces different hash", func(t *testing.T) {
		s1, _ := New("users")
		s2, _ := New("users", WithWhere("id = 1"))
		assert.NotEqual(t, s1.Hash(), s2.Hash())
	})

	t.Run("different columns produces different hash", func(t *testing.T) {
		s1, _ := New("users", WithColumns([]string{"id", "name"}))
		s2, _ := New("users", WithColumns([]string{"id", "email"}))
		assert.NotEqual(t, s1.Hash(), s2.Hash())
	})

	t.Run("column order doesn't affect hash (sorted)", func(t *testing.T) {
		s1, _ := New("users", WithColumns([]string{"id", "name", "email"}))
		s2, _ := New("users", WithColumns([]string{"email", "name", "id"}))
		assert.Equal(t, s1.Hash(), s2.Hash())
	})

	t.Run("different replica mode produces different hash", func(t *testing.T) {
		s1, _ := New("users", WithReplica(ReplicaDefault))
		s2, _ := New("users", WithReplica(ReplicaFull))
		assert.NotEqual(t, s1.Hash(), s2.Hash())
	})

	t.Run("hash is deterministic", func(t *testing.T) {
		for i := 0; i < 10; i++ {
			s, _ := New("users",
				WithSchema("myschema"),
				WithColumns([]string{"a", "b", "c"}),
				WithWhere("id > 0"),
				WithReplica(ReplicaFull),
			)
			// All iterations should produce the same hash
			assert.Equal(t, s.Hash(), s.Hash())
		}
	})
}

// TestMatches tests the Matches method for WHERE clause evaluation
func TestMatches(t *testing.T) {
	t.Run("matches all without WHERE clause", func(t *testing.T) {
		s, _ := New("users")
		matches, err := s.Matches(map[string]any{"id": 1, "name": "Alice"})
		require.NoError(t, err)
		assert.True(t, matches)
	})

	t.Run("empty record matches without WHERE", func(t *testing.T) {
		s, _ := New("users")
		matches, err := s.Matches(map[string]any{})
		require.NoError(t, err)
		assert.True(t, matches)
	})

	t.Run("simple equality match", func(t *testing.T) {
		s, _ := New("users", WithWhere("id = 1"))
		matches, err := s.Matches(map[string]any{"id": int64(1)})
		require.NoError(t, err)
		assert.True(t, matches)
	})

	t.Run("simple equality no match", func(t *testing.T) {
		s, _ := New("users", WithWhere("id = 1"))
		matches, err := s.Matches(map[string]any{"id": int64(2)})
		require.NoError(t, err)
		assert.False(t, matches)
	})

	t.Run("string equality match", func(t *testing.T) {
		s, _ := New("users", WithWhere("name = 'Alice'"))
		matches, err := s.Matches(map[string]any{"name": "Alice"})
		require.NoError(t, err)
		assert.True(t, matches)
	})

	t.Run("comparison operators", func(t *testing.T) {
		tests := []struct {
			where   string
			record  map[string]any
			matches bool
		}{
			{"age > 18", map[string]any{"age": int64(20)}, true},
			{"age > 18", map[string]any{"age": int64(18)}, false},
			{"age >= 18", map[string]any{"age": int64(18)}, true},
			{"age < 18", map[string]any{"age": int64(17)}, true},
			{"age < 18", map[string]any{"age": int64(18)}, false},
			{"age <= 18", map[string]any{"age": int64(18)}, true},
			{"age <> 18", map[string]any{"age": int64(20)}, true},
			{"age <> 18", map[string]any{"age": int64(18)}, false},
		}

		for _, tt := range tests {
			t.Run(tt.where, func(t *testing.T) {
				s, _ := New("users", WithWhere(tt.where))
				matches, err := s.Matches(tt.record)
				require.NoError(t, err)
				assert.Equal(t, tt.matches, matches)
			})
		}
	})

	t.Run("AND logic", func(t *testing.T) {
		s, _ := New("users", WithWhere("age > 18 AND active = true"))

		matches, _ := s.Matches(map[string]any{"age": int64(20), "active": true})
		assert.True(t, matches)

		matches, _ = s.Matches(map[string]any{"age": int64(20), "active": false})
		assert.False(t, matches)

		matches, _ = s.Matches(map[string]any{"age": int64(17), "active": true})
		assert.False(t, matches)
	})

	t.Run("OR logic", func(t *testing.T) {
		s, _ := New("users", WithWhere("age < 18 OR age > 65"))

		matches, _ := s.Matches(map[string]any{"age": int64(17)})
		assert.True(t, matches)

		matches, _ = s.Matches(map[string]any{"age": int64(70)})
		assert.True(t, matches)

		matches, _ = s.Matches(map[string]any{"age": int64(30)})
		assert.False(t, matches)
	})

	t.Run("NULL handling with IS NULL", func(t *testing.T) {
		s, _ := New("users", WithWhere("email IS NULL"))
		matches, _ := s.Matches(map[string]any{"email": nil})
		assert.True(t, matches)

		matches, _ = s.Matches(map[string]any{"email": "test@example.com"})
		assert.False(t, matches)
	})

	t.Run("NULL handling with IS NOT NULL", func(t *testing.T) {
		s, _ := New("users", WithWhere("email IS NOT NULL"))
		matches, _ := s.Matches(map[string]any{"email": "test@example.com"})
		assert.True(t, matches)

		matches, _ = s.Matches(map[string]any{"email": nil})
		assert.False(t, matches)
	})

	t.Run("NULL in comparison returns NULL (false)", func(t *testing.T) {
		s, _ := New("users", WithWhere("age = 20"))
		matches, _ := s.Matches(map[string]any{"age": nil})
		assert.False(t, matches) // NULL = 20 -> NULL -> false
	})

	t.Run("LIKE pattern matching", func(t *testing.T) {
		s, _ := New("users", WithWhere("name LIKE 'Al%'"))

		matches, _ := s.Matches(map[string]any{"name": "Alice"})
		assert.True(t, matches)

		matches, _ = s.Matches(map[string]any{"name": "Al"})
		assert.True(t, matches)

		matches, _ = s.Matches(map[string]any{"name": "Bob"})
		assert.False(t, matches)
	})

	t.Run("ILIKE case insensitive matching", func(t *testing.T) {
		s, _ := New("users", WithWhere("name ILIKE 'alice'"))

		matches, _ := s.Matches(map[string]any{"name": "Alice"})
		assert.True(t, matches)

		matches, _ = s.Matches(map[string]any{"name": "ALICE"})
		assert.True(t, matches)

		matches, _ = s.Matches(map[string]any{"name": "alice"})
		assert.True(t, matches)
	})

	t.Run("IN list", func(t *testing.T) {
		s, _ := New("users", WithWhere("status IN ('active', 'pending')"))

		matches, _ := s.Matches(map[string]any{"status": "active"})
		assert.True(t, matches)

		matches, _ = s.Matches(map[string]any{"status": "pending"})
		assert.True(t, matches)

		matches, _ = s.Matches(map[string]any{"status": "inactive"})
		assert.False(t, matches)
	})

	t.Run("BETWEEN", func(t *testing.T) {
		s, _ := New("users", WithWhere("age BETWEEN 18 AND 65"))

		matches, _ := s.Matches(map[string]any{"age": int64(18)})
		assert.True(t, matches)

		matches, _ = s.Matches(map[string]any{"age": int64(65)})
		assert.True(t, matches)

		matches, _ = s.Matches(map[string]any{"age": int64(30)})
		assert.True(t, matches)

		matches, _ = s.Matches(map[string]any{"age": int64(17)})
		assert.False(t, matches)

		matches, _ = s.Matches(map[string]any{"age": int64(66)})
		assert.False(t, matches)
	})
}

// TestMatchesOldAndNew tests the MatchesOldAndNew method for update filtering
func TestMatchesOldAndNew(t *testing.T) {
	t.Run("both match without WHERE", func(t *testing.T) {
		s, _ := New("users")
		old, new, err := s.MatchesOldAndNew(
			map[string]any{"id": 1, "name": "Old"},
			map[string]any{"id": 1, "name": "New"},
		)
		require.NoError(t, err)
		assert.True(t, old)
		assert.True(t, new)
	})

	t.Run("both match with WHERE", func(t *testing.T) {
		s, _ := New("users", WithWhere("active = true"))
		old, new, err := s.MatchesOldAndNew(
			map[string]any{"active": true},
			map[string]any{"active": true},
		)
		require.NoError(t, err)
		assert.True(t, old)
		assert.True(t, new)
	})

	t.Run("neither matches", func(t *testing.T) {
		s, _ := New("users", WithWhere("active = true"))
		old, new, err := s.MatchesOldAndNew(
			map[string]any{"active": false},
			map[string]any{"active": false},
		)
		require.NoError(t, err)
		assert.False(t, old)
		assert.False(t, new)
	})

	t.Run("moved out of shape", func(t *testing.T) {
		s, _ := New("users", WithWhere("active = true"))
		old, new, err := s.MatchesOldAndNew(
			map[string]any{"active": true},  // was in shape
			map[string]any{"active": false}, // now out of shape
		)
		require.NoError(t, err)
		assert.True(t, old)
		assert.False(t, new)
	})

	t.Run("moved into shape", func(t *testing.T) {
		s, _ := New("users", WithWhere("active = true"))
		old, new, err := s.MatchesOldAndNew(
			map[string]any{"active": false}, // was out of shape
			map[string]any{"active": true},  // now in shape
		)
		require.NoError(t, err)
		assert.False(t, old)
		assert.True(t, new)
	})
}

// TestFilterColumns tests the FilterColumns method
func TestFilterColumns(t *testing.T) {
	t.Run("all columns when no selection", func(t *testing.T) {
		s, _ := New("users")
		record := map[string]any{"id": 1, "name": "Alice", "email": "alice@example.com"}
		result := s.FilterColumns(record)
		assert.Equal(t, record, result)
		// Should be a copy, not the same map
		record["id"] = 2
		assert.Equal(t, 1, result["id"])
	})

	t.Run("filters to selected columns", func(t *testing.T) {
		s, _ := New("users", WithColumns([]string{"id", "name"}))
		record := map[string]any{"id": 1, "name": "Alice", "email": "alice@example.com", "age": 30}
		result := s.FilterColumns(record)
		assert.Len(t, result, 2)
		assert.Equal(t, 1, result["id"])
		assert.Equal(t, "Alice", result["name"])
		assert.NotContains(t, result, "email")
		assert.NotContains(t, result, "age")
	})

	t.Run("handles missing columns in record", func(t *testing.T) {
		s, _ := New("users", WithColumns([]string{"id", "name", "missing"}))
		record := map[string]any{"id": 1, "name": "Alice"}
		result := s.FilterColumns(record)
		assert.Len(t, result, 2)
		assert.Equal(t, 1, result["id"])
		assert.Equal(t, "Alice", result["name"])
		assert.NotContains(t, result, "missing")
	})

	t.Run("handles empty record", func(t *testing.T) {
		s, _ := New("users", WithColumns([]string{"id", "name"}))
		record := map[string]any{}
		result := s.FilterColumns(record)
		assert.Len(t, result, 0)
	})

	t.Run("preserves NULL values", func(t *testing.T) {
		s, _ := New("users", WithColumns([]string{"id", "name"}))
		record := map[string]any{"id": 1, "name": nil}
		result := s.FilterColumns(record)
		assert.Len(t, result, 2)
		assert.Nil(t, result["name"])
	})
}

// TestTableRef tests the TableRef method
func TestTableRef(t *testing.T) {
	tests := []struct {
		schema   string
		table    string
		expected string
	}{
		{"public", "users", `"public"."users"`},
		{"my_schema", "my_table", `"my_schema"."my_table"`},
		{"Public", "Users", `"Public"."Users"`},
		{"schema", "table", `"schema"."table"`},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			s, err := New(tt.table, WithSchema(tt.schema))
			require.NoError(t, err)
			assert.Equal(t, tt.expected, s.TableRef())
		})
	}
}

// TestRelation tests the Relation method
func TestRelation(t *testing.T) {
	s, _ := New("users", WithSchema("myschema"))
	schema, table := s.Relation()
	assert.Equal(t, "myschema", schema)
	assert.Equal(t, "users", table)
}

// TestHelperMethods tests helper methods like HasWhere, HasColumnSelection, etc.
func TestHelperMethods(t *testing.T) {
	t.Run("HasWhere", func(t *testing.T) {
		s1, _ := New("users")
		assert.False(t, s1.HasWhere())

		s2, _ := New("users", WithWhere("id = 1"))
		assert.True(t, s2.HasWhere())
	})

	t.Run("HasColumnSelection", func(t *testing.T) {
		s1, _ := New("users")
		assert.False(t, s1.HasColumnSelection())

		s2, _ := New("users", WithColumns([]string{"id", "name"}))
		assert.True(t, s2.HasColumnSelection())
	})

	t.Run("AllColumns", func(t *testing.T) {
		s1, _ := New("users")
		assert.True(t, s1.AllColumns())

		s2, _ := New("users", WithColumns([]string{"id", "name"}))
		assert.False(t, s2.AllColumns())
	})

	t.Run("GetColumns", func(t *testing.T) {
		s1, _ := New("users")
		assert.Nil(t, s1.GetColumns())

		s2, _ := New("users", WithColumns([]string{"id", "name"}))
		cols := s2.GetColumns()
		assert.Equal(t, []string{"id", "name"}, cols)
		// Should be a copy
		cols[0] = "modified"
		assert.Equal(t, "id", s2.Columns[0])
	})

	t.Run("WhereSQL", func(t *testing.T) {
		s1, _ := New("users")
		assert.Equal(t, "", s1.WhereSQL())

		s2, _ := New("users", WithWhere("id > 0"))
		assert.NotEmpty(t, s2.WhereSQL())
	})
}

// TestString tests the String method
func TestString(t *testing.T) {
	t.Run("basic table", func(t *testing.T) {
		s, _ := New("users")
		str := s.String()
		assert.Contains(t, str, `"public"."users"`)
	})

	t.Run("with columns", func(t *testing.T) {
		s, _ := New("users", WithColumns([]string{"id", "name"}))
		str := s.String()
		assert.Contains(t, str, "[id, name]")
	})

	t.Run("with WHERE", func(t *testing.T) {
		s, _ := New("users", WithWhere("id > 0"))
		str := s.String()
		assert.Contains(t, str, "WHERE")
	})

	t.Run("with replica full", func(t *testing.T) {
		s, _ := New("users", WithReplica(ReplicaFull))
		str := s.String()
		assert.Contains(t, str, "(replica=full)")
	})

	t.Run("replica default not shown", func(t *testing.T) {
		s, _ := New("users", WithReplica(ReplicaDefault))
		str := s.String()
		assert.NotContains(t, str, "replica")
	})
}

// TestEqual tests the Equal method
func TestEqual(t *testing.T) {
	t.Run("identical shapes are equal", func(t *testing.T) {
		s1, _ := New("users", WithSchema("public"), WithWhere("id > 0"))
		s2, _ := New("users", WithSchema("public"), WithWhere("id > 0"))
		assert.True(t, s1.Equal(s2))
	})

	t.Run("different tables are not equal", func(t *testing.T) {
		s1, _ := New("users")
		s2, _ := New("orders")
		assert.False(t, s1.Equal(s2))
	})

	t.Run("different schemas are not equal", func(t *testing.T) {
		s1, _ := New("users", WithSchema("public"))
		s2, _ := New("users", WithSchema("private"))
		assert.False(t, s1.Equal(s2))
	})

	t.Run("different WHERE are not equal", func(t *testing.T) {
		s1, _ := New("users", WithWhere("id = 1"))
		s2, _ := New("users", WithWhere("id = 2"))
		assert.False(t, s1.Equal(s2))
	})

	t.Run("WHERE vs no WHERE are not equal", func(t *testing.T) {
		s1, _ := New("users")
		s2, _ := New("users", WithWhere("id = 1"))
		assert.False(t, s1.Equal(s2))
	})

	t.Run("different columns are not equal", func(t *testing.T) {
		s1, _ := New("users", WithColumns([]string{"id", "name"}))
		s2, _ := New("users", WithColumns([]string{"id", "email"}))
		assert.False(t, s1.Equal(s2))
	})

	t.Run("different replica modes are not equal", func(t *testing.T) {
		s1, _ := New("users", WithReplica(ReplicaDefault))
		s2, _ := New("users", WithReplica(ReplicaFull))
		assert.False(t, s1.Equal(s2))
	})

	t.Run("nil shapes", func(t *testing.T) {
		s, _ := New("users")
		assert.True(t, (*Shape)(nil).Equal(nil))
		assert.False(t, s.Equal(nil))
		assert.False(t, (*Shape)(nil).Equal(s))
	})
}

// TestValidate tests the Validate method
func TestValidate(t *testing.T) {
	t.Run("valid shape passes", func(t *testing.T) {
		s := &Shape{
			Schema:    "public",
			TableName: "users",
			Replica:   ReplicaDefault,
		}
		assert.NoError(t, s.Validate())
	})

	t.Run("empty table name fails", func(t *testing.T) {
		s := &Shape{
			Schema:  "public",
			Replica: ReplicaDefault,
		}
		err := s.Validate()
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "table name is required")
	})

	t.Run("empty schema defaults to public", func(t *testing.T) {
		s := &Shape{
			TableName: "users",
			Replica:   ReplicaDefault,
		}
		assert.NoError(t, s.Validate())
		assert.Equal(t, "public", s.Schema)
	})

	t.Run("invalid replica mode fails", func(t *testing.T) {
		s := &Shape{
			Schema:    "public",
			TableName: "users",
			Replica:   "invalid",
		}
		err := s.Validate()
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid replica mode")
	})

	t.Run("empty column name fails", func(t *testing.T) {
		s := &Shape{
			Schema:    "public",
			TableName: "users",
			Columns:   []string{"id", "", "name"},
			Replica:   ReplicaDefault,
		}
		err := s.Validate()
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "column name cannot be empty")
	})
}

// TestNormalizeColumns tests the column normalization logic
func TestNormalizeColumns(t *testing.T) {
	t.Run("sorts columns", func(t *testing.T) {
		cols := normalizeColumns([]string{"z", "a", "m"})
		assert.Equal(t, []string{"a", "m", "z"}, cols)
	})

	t.Run("removes duplicates", func(t *testing.T) {
		cols := normalizeColumns([]string{"a", "b", "a", "c", "b"})
		assert.Equal(t, []string{"a", "b", "c"}, cols)
	})

	t.Run("empty returns nil", func(t *testing.T) {
		cols := normalizeColumns([]string{})
		assert.Nil(t, cols)
	})

	t.Run("nil returns nil", func(t *testing.T) {
		cols := normalizeColumns(nil)
		assert.Nil(t, cols)
	})

	t.Run("single column", func(t *testing.T) {
		cols := normalizeColumns([]string{"id"})
		assert.Equal(t, []string{"id"}, cols)
	})
}

// TestHashConsistency tests that hash is consistent across different construction methods
func TestHashConsistency(t *testing.T) {
	t.Run("same definition different construction order", func(t *testing.T) {
		s1, _ := New("users",
			WithSchema("public"),
			WithColumns([]string{"id", "name"}),
			WithWhere("active = true"),
			WithReplica(ReplicaFull),
		)

		s2, _ := New("users",
			WithReplica(ReplicaFull),
			WithWhere("active = true"),
			WithColumns([]string{"name", "id"}), // different order
			WithSchema("public"),
		)

		assert.Equal(t, s1.Hash(), s2.Hash())
	})
}

// TestComplexWhereClauses tests shapes with complex WHERE clauses
func TestComplexWhereClauses(t *testing.T) {
	t.Run("complex nested conditions", func(t *testing.T) {
		s, err := New("users", WithWhere("(status = 'active' OR status = 'pending') AND age >= 18"))
		require.NoError(t, err)

		matches, _ := s.Matches(map[string]any{"status": "active", "age": int64(25)})
		assert.True(t, matches)

		matches, _ = s.Matches(map[string]any{"status": "pending", "age": int64(18)})
		assert.True(t, matches)

		matches, _ = s.Matches(map[string]any{"status": "active", "age": int64(17)})
		assert.False(t, matches)

		matches, _ = s.Matches(map[string]any{"status": "inactive", "age": int64(25)})
		assert.False(t, matches)
	})

	t.Run("NOT operator", func(t *testing.T) {
		s, err := New("users", WithWhere("NOT (status = 'deleted')"))
		require.NoError(t, err)

		matches, _ := s.Matches(map[string]any{"status": "active"})
		assert.True(t, matches)

		matches, _ = s.Matches(map[string]any{"status": "deleted"})
		assert.False(t, matches)
	})

	t.Run("multiple conditions with all operators", func(t *testing.T) {
		s, err := New("products", WithWhere("price > 10 AND price < 100 AND category IN ('electronics', 'books') AND name LIKE 'Pro%'"))
		require.NoError(t, err)

		matches, _ := s.Matches(map[string]any{
			"price":    float64(50),
			"category": "electronics",
			"name":     "ProMax",
		})
		assert.True(t, matches)

		matches, _ = s.Matches(map[string]any{
			"price":    float64(50),
			"category": "electronics",
			"name":     "Standard",
		})
		assert.False(t, matches)
	})
}

// TestEdgeCases tests edge cases and boundary conditions
func TestEdgeCases(t *testing.T) {
	t.Run("unicode in table and schema names", func(t *testing.T) {
		s, err := New("utilisateurs", WithSchema("monschema"))
		require.NoError(t, err)
		assert.Equal(t, `"monschema"."utilisateurs"`, s.TableRef())
	})

	t.Run("very long table name", func(t *testing.T) {
		longName := strings.Repeat("a", 100)
		s, err := New(longName)
		require.NoError(t, err)
		assert.Equal(t, longName, s.TableName)
	})

	t.Run("many columns", func(t *testing.T) {
		cols := make([]string, 100)
		for i := 0; i < 100; i++ {
			cols[i] = "col" + string(rune('a'+i%26)) + string(rune('0'+i%10))
		}
		s, err := New("wide_table", WithColumns(cols))
		require.NoError(t, err)
		assert.Len(t, s.Columns, 100)
	})

	t.Run("special characters in column filter record", func(t *testing.T) {
		s, _ := New("users", WithColumns([]string{"id", "name"}))
		record := map[string]any{
			"id":    1,
			"name":  "O'Brien",
			"email": "test@example.com",
		}
		result := s.FilterColumns(record)
		assert.Equal(t, "O'Brien", result["name"])
	})

	t.Run("numeric string values in matching", func(t *testing.T) {
		s, _ := New("users", WithWhere("id = 42"))
		// String "42" should match number 42
		matches, _ := s.Matches(map[string]any{"id": "42"})
		assert.True(t, matches)
	})
}
