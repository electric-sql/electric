// Package columns provides parsing and validation for column selection parameters.
// Ported from: lib/electric/plug/utils.ex (parse_columns_param)
// and lib/electric/postgres/identifiers.ex (parse)
package columns

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode"
)

// MaxIdentifierLength is the maximum length of a PostgreSQL identifier (NAMEDATALEN - 1)
const MaxIdentifierLength = 63

var (
	// ErrEmptyIdentifier is returned when an identifier has zero length
	ErrEmptyIdentifier = errors.New("invalid zero-length delimited identifier")

	// ErrIdentifierTooLong is returned when an identifier exceeds MaxIdentifierLength
	ErrIdentifierTooLong = fmt.Errorf("identifier is too long (max length is %d)", MaxIdentifierLength)

	// validUnquotedIdentifierRegex matches valid unquoted PostgreSQL identifiers
	// Must start with letter or underscore, followed by letters, digits, underscores, or $
	validUnquotedIdentifierRegex = regexp.MustCompile(`^[\p{L}_][\p{L}\p{M}_0-9$]*$`)
)

// ParseColumns parses a comma-separated list of column names from a query parameter.
// Returns a slice of parsed column names (not sorted, preserving order).
//
// Rules:
//   - Unquoted names are lowercased (FoO -> foo)
//   - Quoted names preserve case ("FoO" -> FoO)
//   - Double quotes are escaped by doubling ("has""q" -> has"q)
//   - Commas inside quotes are part of the name
//   - Empty identifiers are invalid
//
// Examples:
//
//	ParseColumns("id") -> ["id"], nil
//	ParseColumns("id,name") -> ["id", "name"], nil
//	ParseColumns("PoTaTo") -> ["potato"], nil
//	ParseColumns(`"PoT@To",PoTaTo`) -> ["PoT@To", "potato"], nil
//	ParseColumns(`"PoTaTo,sunday",foo`) -> ["PoTaTo,sunday", "foo"], nil
//	ParseColumns(`"fo""o",bar`) -> ["fo\"o", "bar"], nil
//	ParseColumns("") -> nil, error (empty identifier)
//	ParseColumns("foo,") -> nil, error (trailing comma = empty identifier)
func ParseColumns(input string) ([]string, error) {
	if input == "" {
		return nil, ErrEmptyIdentifier
	}

	// Split by commas that are not inside quotes
	parts := splitByCommaOutsideQuotes(input)

	result := make([]string, 0, len(parts))
	for _, part := range parts {
		parsed, err := parseIdentifier(part)
		if err != nil {
			return nil, err
		}
		result = append(result, parsed)
	}

	return result, nil
}

// ValidateColumns validates requested columns against available columns and ensures
// primary key columns are included.
//
// Rules:
//   - Empty/nil requested means "all columns" - returns all available columns
//   - Duplicates in requested are removed
//   - Primary key columns are always included (added if missing)
//   - Returns error if a requested column doesn't exist in available
//
// The returned slice contains the validated columns with PKs first (if they were added),
// followed by the requested columns in their original order.
func ValidateColumns(requested []string, available []string, pkColumns []string) ([]string, error) {
	// Empty requested means "all columns"
	if len(requested) == 0 {
		return available, nil
	}

	// Build a set of available columns for O(1) lookup
	availableSet := make(map[string]struct{}, len(available))
	for _, col := range available {
		availableSet[col] = struct{}{}
	}

	// Build a set of requested columns to remove duplicates
	requestedSet := make(map[string]struct{}, len(requested))
	for _, col := range requested {
		requestedSet[col] = struct{}{}
	}

	// Validate that all requested columns exist
	for col := range requestedSet {
		if _, exists := availableSet[col]; !exists {
			return nil, fmt.Errorf("column %q does not exist", col)
		}
	}

	// Build result: start with PKs that are not already requested
	result := make([]string, 0, len(requestedSet)+len(pkColumns))

	// Add PK columns first (if not already in requested)
	for _, pk := range pkColumns {
		if _, inRequested := requestedSet[pk]; !inRequested {
			result = append(result, pk)
		}
	}

	// Add requested columns in order, skipping duplicates
	seen := make(map[string]struct{}, len(requested))
	for _, col := range requested {
		if _, already := seen[col]; !already {
			seen[col] = struct{}{}
			result = append(result, col)
		}
	}

	return result, nil
}

// splitByCommaOutsideQuotes splits a string by commas that are not inside double quotes.
// A comma is "outside quotes" if there's an even number of (unescaped) quote characters
// after it in the string. This matches the PostgreSQL and Elixir behavior.
// Example: `"foo,bar",baz` -> [`"foo,bar"`, "baz"]
func splitByCommaOutsideQuotes(s string) []string {
	var parts []string
	var current strings.Builder

	// Count total quotes in the string (for determining parity)
	totalQuotes := strings.Count(s, `"`)
	quotesSeenSoFar := 0

	for i := 0; i < len(s); i++ {
		ch := s[i]

		if ch == '"' {
			quotesSeenSoFar++
			current.WriteByte(ch)
		} else if ch == ',' {
			// Comma is outside quotes if the number of quotes we've seen is even
			// (meaning we're not currently inside a quoted string)
			if quotesSeenSoFar%2 == 0 {
				parts = append(parts, current.String())
				current.Reset()
			} else {
				current.WriteByte(ch)
			}
		} else {
			current.WriteByte(ch)
		}
	}

	// Don't forget the last part
	parts = append(parts, current.String())

	// Handle edge case where totalQuotes is unused but needed for clarity
	_ = totalQuotes

	return parts
}

// parseIdentifier parses a single PostgreSQL identifier.
// Quoted identifiers preserve case; unquoted identifiers are lowercased.
func parseIdentifier(ident string) (string, error) {
	if ident == "" {
		return "", ErrEmptyIdentifier
	}

	// Check if it's a quoted identifier
	if strings.HasPrefix(ident, `"`) && strings.HasSuffix(ident, `"`) {
		return parseQuotedIdentifier(ident[1 : len(ident)-1])
	}

	return parseUnquotedIdentifier(ident)
}

// parseQuotedIdentifier parses a quoted PostgreSQL identifier (without the surrounding quotes).
// Validates that internal quotes are properly escaped (doubled).
func parseQuotedIdentifier(ident string) (string, error) {
	if ident == "" {
		return "", ErrEmptyIdentifier
	}

	// Check for unescaped quotes
	if containsUnescapedQuote(ident) {
		return "", fmt.Errorf("invalid identifier with unescaped quote: %s", ident)
	}

	// Unescape doubled quotes
	result := strings.ReplaceAll(ident, `""`, `"`)

	// Check length
	if len([]rune(result)) > MaxIdentifierLength {
		return "", ErrIdentifierTooLong
	}

	return result, nil
}

// parseUnquotedIdentifier parses an unquoted PostgreSQL identifier.
// Validates that it contains only valid characters and lowercases it.
func parseUnquotedIdentifier(ident string) (string, error) {
	if ident == "" {
		return "", ErrEmptyIdentifier
	}

	// Validate characters
	if !validUnquotedIdentifierRegex.MatchString(ident) {
		return "", fmt.Errorf("invalid unquoted identifier contains special characters: %s", ident)
	}

	// Downcase the identifier
	result := downcaseIdentifier(ident)

	// Check length
	if len([]rune(result)) > MaxIdentifierLength {
		return "", ErrIdentifierTooLong
	}

	return result, nil
}

// containsUnescapedQuote checks if a string contains unescaped quotes.
// A quote is unescaped if it's not part of a "" pair.
// Uses a simple state machine instead of regex (Go regexp doesn't support lookbehind).
func containsUnescapedQuote(s string) bool {
	i := 0
	for i < len(s) {
		if s[i] == '"' {
			// Check if this quote is followed by another quote (escaped)
			if i+1 < len(s) && s[i+1] == '"' {
				// Skip both quotes (they form an escaped pair)
				i += 2
			} else {
				// This is an unescaped quote
				return true
			}
		} else {
			i++
		}
	}
	return false
}

// downcaseIdentifier lowercases an identifier using PostgreSQL's algorithm.
// Only ASCII letters A-Z are lowercased; other characters are preserved.
func downcaseIdentifier(ident string) string {
	var result strings.Builder
	result.Grow(len(ident))

	for _, r := range ident {
		if r >= 'A' && r <= 'Z' {
			result.WriteRune(unicode.ToLower(r))
		} else {
			result.WriteRune(r)
		}
	}

	return result.String()
}
