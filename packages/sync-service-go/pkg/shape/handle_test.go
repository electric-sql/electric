package shape

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Ported from: packages/sync-service/lib/electric/shapes/shape.ex (generate_id function)

func TestNewHandle(t *testing.T) {
	hash := "3e84f2a1b9c0d567"
	before := time.Now().UnixMicro()
	handle := NewHandle(hash)
	after := time.Now().UnixMicro()

	assert.Equal(t, hash, handle.Hash)
	assert.GreaterOrEqual(t, handle.Timestamp, before)
	assert.LessOrEqual(t, handle.Timestamp, after)
}

func TestNewHandleWithTimestamp(t *testing.T) {
	hash := "3e84f2a1b9c0d567"
	timestamp := int64(1699123456789012)
	handle := NewHandleWithTimestamp(hash, timestamp)

	assert.Equal(t, hash, handle.Hash)
	assert.Equal(t, timestamp, handle.Timestamp)
}

func TestGenerateHash(t *testing.T) {
	tests := []struct {
		name       string
		definition string
	}{
		{
			name:       "simple definition",
			definition: "public.users",
		},
		{
			name:       "definition with where clause",
			definition: "public.users:id > 10",
		},
		{
			name:       "empty definition",
			definition: "",
		},
		{
			name:       "unicode definition",
			definition: "public.usuarios_espanoles",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			hash := GenerateHash(tt.definition)

			// Hash should be exactly 16 characters
			assert.Len(t, hash, HashLength)

			// Hash should be valid hex
			assert.True(t, isValidHex(hash), "hash should be valid hex: %s", hash)

			// Same input should produce same hash
			hash2 := GenerateHash(tt.definition)
			assert.Equal(t, hash, hash2)
		})
	}

	// Different definitions should produce different hashes
	hash1 := GenerateHash("public.users")
	hash2 := GenerateHash("public.orders")
	assert.NotEqual(t, hash1, hash2)
}

func TestParseHandle(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantHash    string
		wantTS      int64
		wantErr     error
		errContains string
	}{
		{
			name:     "valid handle",
			input:    "3e84f2a1b9c0d567-1699123456789012",
			wantHash: "3e84f2a1b9c0d567",
			wantTS:   1699123456789012,
			wantErr:  nil,
		},
		{
			name:     "valid handle with lowercase hash",
			input:    "abcdef0123456789-1699123456789012",
			wantHash: "abcdef0123456789",
			wantTS:   1699123456789012,
			wantErr:  nil,
		},
		{
			name:     "valid handle with uppercase hash",
			input:    "ABCDEF0123456789-1699123456789012",
			wantHash: "ABCDEF0123456789",
			wantTS:   1699123456789012,
			wantErr:  nil,
		},
		{
			name:     "valid handle with mixed case hash",
			input:    "AbCdEf0123456789-1699123456789012",
			wantHash: "AbCdEf0123456789",
			wantTS:   1699123456789012,
			wantErr:  nil,
		},
		{
			name:     "valid handle with small timestamp",
			input:    "3e84f2a1b9c0d567-1",
			wantHash: "3e84f2a1b9c0d567",
			wantTS:   1,
			wantErr:  nil,
		},
		{
			name:    "empty string",
			input:   "",
			wantErr: ErrInvalidHandleFormat,
		},
		{
			name:    "no dash",
			input:   "invalid",
			wantErr: ErrInvalidHandleFormat,
		},
		{
			name:    "hash too short",
			input:   "abc-123",
			wantErr: ErrInvalidHashLength,
		},
		{
			name:    "hash too long",
			input:   "3e84f2a1b9c0d5678-123",
			wantErr: ErrInvalidHashLength,
		},
		{
			name:    "hash with non-hex characters",
			input:   "3e84f2a1b9c0d56g-123",
			wantErr: ErrInvalidHashChars,
		},
		{
			name:    "hash with special characters",
			input:   "3e84f2a1b9c0d56!-123",
			wantErr: ErrInvalidHashChars,
		},
		{
			name:    "timestamp not a number",
			input:   "3e84f2a1b9c0d567-abc",
			wantErr: ErrInvalidTimestamp,
		},
		{
			name:    "timestamp is zero",
			input:   "3e84f2a1b9c0d567-0",
			wantErr: ErrInvalidTimestamp,
		},
		{
			name:    "timestamp is negative - appears as hash too long",
			input:   "3e84f2a1b9c0d567--1",
			wantErr: ErrInvalidHashLength, // Hash becomes "3e84f2a1b9c0d567-" (17 chars)
		},
		{
			name:    "empty timestamp",
			input:   "3e84f2a1b9c0d567-",
			wantErr: ErrInvalidTimestamp,
		},
		{
			name:    "only dash",
			input:   "-",
			wantErr: ErrInvalidHashLength,
		},
		{
			name:     "duplicate test entry - valid handle",
			input:    "3e84f2a1b9c0d567-1699123456789012",
			wantHash: "3e84f2a1b9c0d567",
			wantTS:   1699123456789012,
			wantErr:  nil,
		},
		{
			name:    "timestamp with leading zeros",
			input:   "3e84f2a1b9c0d567-0001699123456789",
			wantErr: nil,
			wantHash: "3e84f2a1b9c0d567",
			wantTS:   1699123456789,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handle, err := ParseHandle(tt.input)

			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				return
			}

			require.NoError(t, err)
			assert.Equal(t, tt.wantHash, handle.Hash)
			assert.Equal(t, tt.wantTS, handle.Timestamp)
		})
	}
}

func TestHandle_String(t *testing.T) {
	tests := []struct {
		name   string
		handle Handle
		want   string
	}{
		{
			name: "typical handle",
			handle: Handle{
				Hash:      "3e84f2a1b9c0d567",
				Timestamp: 1699123456789012,
			},
			want: "3e84f2a1b9c0d567-1699123456789012",
		},
		{
			name: "handle with small timestamp",
			handle: Handle{
				Hash:      "abcdef0123456789",
				Timestamp: 1,
			},
			want: "abcdef0123456789-1",
		},
		{
			name: "zero handle",
			handle: Handle{
				Hash:      "",
				Timestamp: 0,
			},
			want: "-0",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.handle.String()
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestHandle_StringRoundtrip(t *testing.T) {
	// Test that parsing a stringified handle gives back the same handle
	tests := []struct {
		name string
		hash string
		ts   int64
	}{
		{"typical", "3e84f2a1b9c0d567", 1699123456789012},
		{"small timestamp", "abcdef0123456789", 1},
		{"large timestamp", "0123456789abcdef", 9223372036854775807}, // max int64
		{"uppercase hash", "ABCDEF0123456789", 1000000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			original := Handle{Hash: tt.hash, Timestamp: tt.ts}
			str := original.String()
			parsed, err := ParseHandle(str)

			require.NoError(t, err)
			assert.Equal(t, original.Hash, parsed.Hash)
			assert.Equal(t, original.Timestamp, parsed.Timestamp)
		})
	}
}

func TestHandle_IsValid(t *testing.T) {
	tests := []struct {
		name   string
		handle Handle
		want   bool
	}{
		{
			name: "valid handle",
			handle: Handle{
				Hash:      "3e84f2a1b9c0d567",
				Timestamp: 1699123456789012,
			},
			want: true,
		},
		{
			name: "valid handle with uppercase",
			handle: Handle{
				Hash:      "ABCDEF0123456789",
				Timestamp: 1,
			},
			want: true,
		},
		{
			name: "valid handle with mixed case",
			handle: Handle{
				Hash:      "AbCdEf0123456789",
				Timestamp: 100,
			},
			want: true,
		},
		{
			name: "hash too short",
			handle: Handle{
				Hash:      "abc",
				Timestamp: 1699123456789012,
			},
			want: false,
		},
		{
			name: "hash too long",
			handle: Handle{
				Hash:      "3e84f2a1b9c0d5678",
				Timestamp: 1699123456789012,
			},
			want: false,
		},
		{
			name: "hash with invalid chars",
			handle: Handle{
				Hash:      "3e84f2a1b9c0d56g",
				Timestamp: 1699123456789012,
			},
			want: false,
		},
		{
			name: "empty hash",
			handle: Handle{
				Hash:      "",
				Timestamp: 1699123456789012,
			},
			want: false,
		},
		{
			name: "zero timestamp",
			handle: Handle{
				Hash:      "3e84f2a1b9c0d567",
				Timestamp: 0,
			},
			want: false,
		},
		{
			name: "negative timestamp",
			handle: Handle{
				Hash:      "3e84f2a1b9c0d567",
				Timestamp: -1,
			},
			want: false,
		},
		{
			name: "zero handle",
			handle: Handle{
				Hash:      "",
				Timestamp: 0,
			},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.handle.IsValid()
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestHandle_SameShape(t *testing.T) {
	tests := []struct {
		name   string
		h1     Handle
		h2     Handle
		want   bool
	}{
		{
			name: "same hash different timestamps",
			h1: Handle{
				Hash:      "3e84f2a1b9c0d567",
				Timestamp: 1699123456789012,
			},
			h2: Handle{
				Hash:      "3e84f2a1b9c0d567",
				Timestamp: 1699123456789099,
			},
			want: true,
		},
		{
			name: "same hash same timestamps",
			h1: Handle{
				Hash:      "3e84f2a1b9c0d567",
				Timestamp: 1699123456789012,
			},
			h2: Handle{
				Hash:      "3e84f2a1b9c0d567",
				Timestamp: 1699123456789012,
			},
			want: true,
		},
		{
			name: "different hashes same timestamps",
			h1: Handle{
				Hash:      "3e84f2a1b9c0d567",
				Timestamp: 1699123456789012,
			},
			h2: Handle{
				Hash:      "abcdef0123456789",
				Timestamp: 1699123456789012,
			},
			want: false,
		},
		{
			name: "different hashes different timestamps",
			h1: Handle{
				Hash:      "3e84f2a1b9c0d567",
				Timestamp: 1699123456789012,
			},
			h2: Handle{
				Hash:      "abcdef0123456789",
				Timestamp: 1699123456789099,
			},
			want: false,
		},
		{
			name: "empty hashes",
			h1: Handle{
				Hash:      "",
				Timestamp: 1699123456789012,
			},
			h2: Handle{
				Hash:      "",
				Timestamp: 1699123456789099,
			},
			want: true, // Both have empty hash, so technically same "shape"
		},
		{
			name: "case sensitive hash comparison",
			h1: Handle{
				Hash:      "ABCDEF0123456789",
				Timestamp: 1,
			},
			h2: Handle{
				Hash:      "abcdef0123456789",
				Timestamp: 1,
			},
			want: false, // Case-sensitive comparison
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.h1.SameShape(tt.h2)
			assert.Equal(t, tt.want, got)

			// SameShape should be symmetric
			got2 := tt.h2.SameShape(tt.h1)
			assert.Equal(t, tt.want, got2)
		})
	}
}

func TestHandle_IsZero(t *testing.T) {
	tests := []struct {
		name   string
		handle Handle
		want   bool
	}{
		{
			name:   "zero handle",
			handle: Handle{},
			want:   true,
		},
		{
			name: "only hash set",
			handle: Handle{
				Hash:      "3e84f2a1b9c0d567",
				Timestamp: 0,
			},
			want: false,
		},
		{
			name: "only timestamp set",
			handle: Handle{
				Hash:      "",
				Timestamp: 1699123456789012,
			},
			want: false,
		},
		{
			name: "both set",
			handle: Handle{
				Hash:      "3e84f2a1b9c0d567",
				Timestamp: 1699123456789012,
			},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.handle.IsZero()
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestIsValidHex(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  bool
	}{
		{"lowercase hex", "abcdef", true},
		{"uppercase hex", "ABCDEF", true},
		{"mixed case hex", "AbCdEf", true},
		{"digits only", "0123456789", true},
		{"mixed digits and letters", "0a1b2c3d4e5f", true},
		{"16 char valid hex", "3e84f2a1b9c0d567", true},
		{"empty string", "", true},
		{"contains g", "abcdefg", false},
		{"contains space", "abc def", false},
		{"contains dash", "abc-def", false},
		{"contains underscore", "abc_def", false},
		{"contains special char", "abc!def", false},
		{"unicode character", "abc\u00e9def", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isValidHex(tt.input)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestGenerateHash_Deterministic(t *testing.T) {
	// The same definition should always produce the same hash
	definition := "public.users:status='active'"

	hashes := make([]string, 100)
	for i := 0; i < 100; i++ {
		hashes[i] = GenerateHash(definition)
	}

	for i := 1; i < 100; i++ {
		assert.Equal(t, hashes[0], hashes[i], "hash should be deterministic")
	}
}

func TestGenerateHash_Distribution(t *testing.T) {
	// Different definitions should produce different hashes (high probability)
	definitions := []string{
		"public.users",
		"public.orders",
		"public.products",
		"private.users",
		"public.users:id > 0",
		"public.users:id > 1",
		"public.users:status = 'active'",
		"public.users:status = 'inactive'",
	}

	hashes := make(map[string]string)
	for _, def := range definitions {
		hash := GenerateHash(def)
		if existing, ok := hashes[hash]; ok {
			t.Errorf("hash collision: %q and %q both produce hash %s", existing, def, hash)
		}
		hashes[hash] = def
	}
}

func TestNewHandle_UniqueTimestamps(t *testing.T) {
	// Creating handles in quick succession should have different or increasing timestamps
	hash := "3e84f2a1b9c0d567"
	var handles []Handle

	for i := 0; i < 10; i++ {
		handles = append(handles, NewHandle(hash))
	}

	// Timestamps should be monotonically non-decreasing
	for i := 1; i < len(handles); i++ {
		assert.GreaterOrEqual(t, handles[i].Timestamp, handles[i-1].Timestamp,
			"timestamps should be monotonically non-decreasing")
	}
}

func TestParseHandle_EdgeCases(t *testing.T) {
	t.Run("max int64 timestamp", func(t *testing.T) {
		input := "3e84f2a1b9c0d567-9223372036854775807"
		handle, err := ParseHandle(input)
		require.NoError(t, err)
		assert.Equal(t, int64(9223372036854775807), handle.Timestamp)
	})

	t.Run("timestamp overflow", func(t *testing.T) {
		input := "3e84f2a1b9c0d567-9223372036854775808" // max int64 + 1
		_, err := ParseHandle(input)
		assert.ErrorIs(t, err, ErrInvalidTimestamp)
	})

	t.Run("very long timestamp string", func(t *testing.T) {
		input := "3e84f2a1b9c0d567-" + strings.Repeat("9", 100)
		_, err := ParseHandle(input)
		assert.ErrorIs(t, err, ErrInvalidTimestamp)
	})

	t.Run("whitespace in hash", func(t *testing.T) {
		input := "3e84f2a1b9c0d56 -1699123456789012"
		_, err := ParseHandle(input)
		assert.ErrorIs(t, err, ErrInvalidHashChars)
	})

	t.Run("whitespace in timestamp", func(t *testing.T) {
		input := "3e84f2a1b9c0d567- 1699123456789012"
		_, err := ParseHandle(input)
		assert.ErrorIs(t, err, ErrInvalidTimestamp)
	})
}

func BenchmarkGenerateHash(b *testing.B) {
	definition := "public.users:status='active' AND created_at > '2024-01-01'"
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		GenerateHash(definition)
	}
}

func BenchmarkParseHandle(b *testing.B) {
	input := "3e84f2a1b9c0d567-1699123456789012"
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = ParseHandle(input)
	}
}

func BenchmarkHandle_String(b *testing.B) {
	handle := Handle{
		Hash:      "3e84f2a1b9c0d567",
		Timestamp: 1699123456789012,
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = handle.String()
	}
}

func BenchmarkHandle_IsValid(b *testing.B) {
	handle := Handle{
		Hash:      "3e84f2a1b9c0d567",
		Timestamp: 1699123456789012,
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = handle.IsValid()
	}
}
