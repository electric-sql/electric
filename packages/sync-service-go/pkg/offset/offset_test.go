// Package offset tests
// Ported from: test/electric/replication/log_offset_test.exs
package offset

import (
	"math"
	"sort"
	"testing"
)

// TestLogOffsetInitialization tests that LogOffset initializes correctly
// Ported from: "LogOffset initializes as 0,0"
func TestLogOffsetInitialization(t *testing.T) {
	t.Run("zero value equals InitialOffset", func(t *testing.T) {
		var zero LogOffset
		if !zero.Equal(InitialOffset) {
			t.Errorf("zero value %v != InitialOffset %v", zero, InitialOffset)
		}
	})

	t.Run("zero value has tx_offset 0", func(t *testing.T) {
		var zero LogOffset
		if zero.TxOffset != 0 {
			t.Errorf("expected TxOffset 0, got %d", zero.TxOffset)
		}
	})

	t.Run("zero value has op_offset 0", func(t *testing.T) {
		var zero LogOffset
		if zero.OpOffset != 0 {
			t.Errorf("expected OpOffset 0, got %d", zero.OpOffset)
		}
	})
}

// TestLogOffsetString tests string representation (String.Chars protocol)
// Ported from: "LogOffset implements `String.Chars` protocol"
func TestLogOffsetString(t *testing.T) {
	tests := []struct {
		name     string
		offset   LogOffset
		expected string
	}{
		{
			name:     "first offset",
			offset:   InitialOffset,
			expected: "0_0",
		},
		{
			name:     "regular offset",
			offset:   MustNew(10, 2),
			expected: "10_2",
		},
		{
			name:     "before all",
			offset:   BeforeAll,
			expected: "-1",
		},
		{
			name:     "last before real (infinity)",
			offset:   LastBeforeReal,
			expected: "0_inf",
		},
		{
			name:     "large tx_offset",
			offset:   MustNew(123456789012345, 42),
			expected: "123456789012345_42",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.offset.String()
			if result != tt.expected {
				t.Errorf("String() = %q, want %q", result, tt.expected)
			}
		})
	}
}

// TestLogOffsetParse tests parsing from string
// Ported from doctests in from_string/1
func TestLogOffsetParse(t *testing.T) {
	t.Run("valid offsets", func(t *testing.T) {
		tests := []struct {
			input    string
			expected LogOffset
		}{
			{"-1", BeforeAll},
			{"-1_0", BeforeAll}, // alternate format for BeforeAll
			{"0_0", InitialOffset},
			{"11_13", MustNew(11, 13)},
			{"0_02", MustNew(0, 2)}, // leading zero in op_offset
			{"0_inf", LastBeforeReal},
			{"123_456", MustNew(123, 456)},
			{"9223372036854775807_0", MustNew(math.MaxInt64, 0)}, // max int64 tx_offset
			{"0_9223372036854775806", MustNew(0, math.MaxInt64-1)},
		}

		for _, tt := range tests {
			t.Run(tt.input, func(t *testing.T) {
				result, err := Parse(tt.input)
				if err != nil {
					t.Fatalf("Parse(%q) error: %v", tt.input, err)
				}
				if !result.Equal(tt.expected) {
					t.Errorf("Parse(%q) = %v, want %v", tt.input, result, tt.expected)
				}
			})
		}
	})

	t.Run("invalid offsets", func(t *testing.T) {
		invalidInputs := []string{
			"",         // empty string
			"abc",      // non-numeric
			"1_",       // missing op_offset
			"_1",       // missing tx_offset
			"1_2_3",    // too many parts
			"1_2 ",     // trailing whitespace
			"10",       // missing underscore and op_offset
			"10_32.1",  // decimal op_offset
			"1.5_2",    // decimal tx_offset
			"-2",       // negative tx_offset other than -1
			"-1_1",     // BeforeAll must have op_offset 0
			"1_-2",     // negative op_offset
			"hello_42", // non-numeric tx_offset
			"42_world", // non-numeric op_offset
		}

		for _, input := range invalidInputs {
			t.Run(input, func(t *testing.T) {
				_, err := Parse(input)
				if err == nil {
					t.Errorf("Parse(%q) expected error, got nil", input)
				}
			})
		}
	})
}

// TestLogOffsetRoundTrip tests that parse and string are inverses
func TestLogOffsetRoundTrip(t *testing.T) {
	offsets := []LogOffset{
		BeforeAll,
		InitialOffset,
		MustNew(0, 1),
		MustNew(1, 0),
		MustNew(10, 2),
		MustNew(123456, 789),
		MustNew(math.MaxInt64, 0),
		MustNew(0, math.MaxInt64-1),
		LastBeforeReal,
	}

	for _, offset := range offsets {
		t.Run(offset.String(), func(t *testing.T) {
			str := offset.String()
			parsed, err := Parse(str)
			if err != nil {
				t.Fatalf("Parse(%q) error: %v", str, err)
			}
			if !parsed.Equal(offset) {
				t.Errorf("roundtrip failed: %v -> %q -> %v", offset, str, parsed)
			}
		})
	}
}

// TestLogOffsetCompare tests comparison operations
// Ported from doctests in compare/2
func TestLogOffsetCompare(t *testing.T) {
	t.Run("compare returns correct result", func(t *testing.T) {
		tests := []struct {
			a        LogOffset
			b        LogOffset
			expected int
		}{
			{MustNew(10, 0), MustNew(10, 1), -1}, // same tx, a.op < b.op
			{MustNew(9, 1), MustNew(10, 1), -1},  // a.tx < b.tx
			{MustNew(10, 1), MustNew(10, 0), 1},  // same tx, a.op > b.op
			{MustNew(11, 1), MustNew(10, 1), 1},  // a.tx > b.tx
			{MustNew(0, 0), BeforeAll, 1},        // anything > BeforeAll
			{MustNew(10, 0), MustNew(10, 0), 0},  // equal
			{BeforeAll, BeforeAll, 0},            // equal BeforeAll
			{InitialOffset, InitialOffset, 0},    // equal First
			{MustNew(10, 5), LastBeforeReal, 1},  // real > virtual infinity
			{MustNew(0, 5), LastBeforeReal, -1},  // virtual < virtual infinity
			{LastBeforeReal, LastBeforeReal, 0},  // equal infinity
		}

		for _, tt := range tests {
			name := tt.a.String() + " vs " + tt.b.String()
			t.Run(name, func(t *testing.T) {
				result := tt.a.Compare(tt.b)
				if result != tt.expected {
					t.Errorf("Compare(%v, %v) = %d, want %d", tt.a, tt.b, result, tt.expected)
				}
			})
		}
	})
}

// TestLogOffsetBefore tests Before method
func TestLogOffsetBefore(t *testing.T) {
	tests := []struct {
		a        LogOffset
		b        LogOffset
		expected bool
	}{
		{MustNew(10, 0), MustNew(10, 1), true},
		{MustNew(9, 5), MustNew(10, 1), true},
		{MustNew(10, 1), MustNew(10, 0), false},
		{MustNew(10, 0), MustNew(10, 0), false},
		{BeforeAll, InitialOffset, true},
		{BeforeAll, MustNew(10, 0), true},
		{InitialOffset, BeforeAll, false},
		{MustNew(10, 5), LastBeforeReal, false}, // real > virtual
		{MustNew(0, 5), LastBeforeReal, true},
		{LastBeforeReal, MustNew(10, 5), true}, // virtual infinity < real
	}

	for _, tt := range tests {
		name := tt.a.String() + " before " + tt.b.String()
		t.Run(name, func(t *testing.T) {
			result := tt.a.Before(tt.b)
			if result != tt.expected {
				t.Errorf("Before(%v, %v) = %v, want %v", tt.a, tt.b, result, tt.expected)
			}
		})
	}
}

// TestLogOffsetAfter tests After method
func TestLogOffsetAfter(t *testing.T) {
	tests := []struct {
		a        LogOffset
		b        LogOffset
		expected bool
	}{
		{MustNew(10, 1), MustNew(10, 0), true},
		{MustNew(11, 1), MustNew(10, 5), true},
		{MustNew(10, 0), MustNew(10, 1), false},
		{MustNew(10, 0), MustNew(10, 0), false},
		{InitialOffset, BeforeAll, true},
		{MustNew(10, 0), BeforeAll, true},
		{BeforeAll, InitialOffset, false},
	}

	for _, tt := range tests {
		name := tt.a.String() + " after " + tt.b.String()
		t.Run(name, func(t *testing.T) {
			result := tt.a.After(tt.b)
			if result != tt.expected {
				t.Errorf("After(%v, %v) = %v, want %v", tt.a, tt.b, result, tt.expected)
			}
		})
	}
}

// TestLogOffsetEqual tests Equal method
func TestLogOffsetEqual(t *testing.T) {
	tests := []struct {
		a        LogOffset
		b        LogOffset
		expected bool
	}{
		{MustNew(10, 0), MustNew(10, 0), true},
		{BeforeAll, BeforeAll, true},
		{InitialOffset, InitialOffset, true},
		{LastBeforeReal, LastBeforeReal, true},
		{MustNew(10, 0), MustNew(10, 1), false},
		{MustNew(10, 0), MustNew(11, 0), false},
		{BeforeAll, InitialOffset, false},
	}

	for _, tt := range tests {
		name := tt.a.String() + " equal " + tt.b.String()
		t.Run(name, func(t *testing.T) {
			result := tt.a.Equal(tt.b)
			if result != tt.expected {
				t.Errorf("Equal(%v, %v) = %v, want %v", tt.a, tt.b, result, tt.expected)
			}
		})
	}
}

// TestLogOffsetBeforeOrEqual tests BeforeOrEqual method
func TestLogOffsetBeforeOrEqual(t *testing.T) {
	tests := []struct {
		a        LogOffset
		b        LogOffset
		expected bool
	}{
		{MustNew(10, 0), MustNew(10, 1), true},
		{MustNew(10, 0), MustNew(10, 0), true},
		{MustNew(10, 1), MustNew(10, 0), false},
		{MustNew(0, 5), LastBeforeReal, true},
		{LastBeforeReal, LastBeforeReal, true},
		{LastBeforeReal, MustNew(0, 5), false},
	}

	for _, tt := range tests {
		name := tt.a.String() + " <= " + tt.b.String()
		t.Run(name, func(t *testing.T) {
			result := tt.a.BeforeOrEqual(tt.b)
			if result != tt.expected {
				t.Errorf("BeforeOrEqual(%v, %v) = %v, want %v", tt.a, tt.b, result, tt.expected)
			}
		})
	}
}

// TestLogOffsetIncrement tests increment operations
// Ported from doctests in increment/2
func TestLogOffsetIncrement(t *testing.T) {
	t.Run("basic increment", func(t *testing.T) {
		offset := MustNew(10, 5)
		result := offset.Increment()
		expected := MustNew(10, 6)
		if !result.Equal(expected) {
			t.Errorf("Increment(%v) = %v, want %v", offset, result, expected)
		}
	})

	t.Run("increment is greater", func(t *testing.T) {
		offset := MustNew(10, 5)
		result := offset.Increment()
		if !result.After(offset) {
			t.Errorf("expected Increment(%v) > %v", offset, offset)
		}
	})

	t.Run("increment by n", func(t *testing.T) {
		offset := MustNew(10, 5)
		result := offset.IncrementBy(5)
		expected := MustNew(10, 10)
		if !result.Equal(expected) {
			t.Errorf("IncrementBy(%v, 5) = %v, want %v", offset, result, expected)
		}
	})

	t.Run("increment by 4 equals offset with 4 more", func(t *testing.T) {
		offset := MustNew(10, 1)
		result := offset.IncrementBy(4)
		expected := MustNew(10, 5)
		if !result.Equal(expected) {
			t.Errorf("IncrementBy(%v, 4) = %v, want %v", offset, result, expected)
		}
	})

	t.Run("increment from infinity", func(t *testing.T) {
		// Incrementing from LastBeforeReal should move to real offsets
		result := LastBeforeReal.Increment()
		expected := MustNew(1, 0)
		if !result.Equal(expected) {
			t.Errorf("Increment(LastBeforeReal) = %v, want %v", result, expected)
		}
	})

	t.Run("increment from infinity by 5", func(t *testing.T) {
		result := LastBeforeReal.IncrementBy(5)
		expected := MustNew(1, 4)
		if !result.Equal(expected) {
			t.Errorf("IncrementBy(LastBeforeReal, 5) = %v, want %v", result, expected)
		}
	})
}

// TestLogOffsetNew tests New constructor validation
func TestLogOffsetNew(t *testing.T) {
	t.Run("valid offsets", func(t *testing.T) {
		tests := []struct {
			txOffset int64
			opOffset int64
		}{
			{0, 0},
			{10, 2},
			{-1, 0}, // BeforeAll
			{0, math.MaxInt64},
			{math.MaxInt64, 0},
		}

		for _, tt := range tests {
			_, err := New(tt.txOffset, tt.opOffset)
			if err != nil {
				t.Errorf("New(%d, %d) unexpected error: %v", tt.txOffset, tt.opOffset, err)
			}
		}
	})

	t.Run("invalid offsets", func(t *testing.T) {
		tests := []struct {
			txOffset int64
			opOffset int64
		}{
			{-1, 1},  // BeforeAll must have op_offset 0
			{-2, 0},  // negative tx_offset other than -1
			{0, -1},  // negative op_offset
			{-10, 5}, // negative tx_offset
		}

		for _, tt := range tests {
			_, err := New(tt.txOffset, tt.opOffset)
			if err == nil {
				t.Errorf("New(%d, %d) expected error, got nil", tt.txOffset, tt.opOffset)
			}
		}
	})
}

// TestLogOffsetMustNew tests MustNew panics on invalid input
func TestLogOffsetMustNew(t *testing.T) {
	t.Run("valid input does not panic", func(t *testing.T) {
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("MustNew(10, 5) panicked: %v", r)
			}
		}()
		_ = MustNew(10, 5)
	})

	t.Run("invalid input panics", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Error("MustNew(-2, 0) expected panic, got nil")
			}
		}()
		_ = MustNew(-2, 0)
	})
}

// TestLogOffsetSpecialValues tests special value predicates
func TestLogOffsetSpecialValues(t *testing.T) {
	t.Run("IsBeforeAll", func(t *testing.T) {
		if !BeforeAll.IsBeforeAll() {
			t.Error("BeforeAll.IsBeforeAll() = false, want true")
		}
		if InitialOffset.IsBeforeAll() {
			t.Error("InitialOffset.IsBeforeAll() = true, want false")
		}
		if MustNew(10, 5).IsBeforeAll() {
			t.Error("MustNew(10, 5).IsBeforeAll() = true, want false")
		}
	})

	t.Run("IsVirtual", func(t *testing.T) {
		if !InitialOffset.IsVirtual() {
			t.Error("InitialOffset.IsVirtual() = false, want true")
		}
		if !MustNew(0, 5).IsVirtual() {
			t.Error("MustNew(0, 5).IsVirtual() = false, want true")
		}
		if !LastBeforeReal.IsVirtual() {
			t.Error("LastBeforeReal.IsVirtual() = false, want true")
		}
		if MustNew(10, 5).IsVirtual() {
			t.Error("MustNew(10, 5).IsVirtual() = true, want false")
		}
		if BeforeAll.IsVirtual() {
			t.Error("BeforeAll.IsVirtual() = true, want false")
		}
	})

	t.Run("IsReal", func(t *testing.T) {
		if !MustNew(10, 5).IsReal() {
			t.Error("MustNew(10, 5).IsReal() = false, want true")
		}
		if !MustNew(1, 0).IsReal() {
			t.Error("MustNew(1, 0).IsReal() = false, want true")
		}
		if InitialOffset.IsReal() {
			t.Error("InitialOffset.IsReal() = true, want false")
		}
		if BeforeAll.IsReal() {
			t.Error("BeforeAll.IsReal() = true, want false")
		}
		if LastBeforeReal.IsReal() {
			t.Error("LastBeforeReal.IsReal() = true, want false")
		}
	})

	t.Run("IsLastBeforeReal", func(t *testing.T) {
		if !LastBeforeReal.IsLastBeforeReal() {
			t.Error("LastBeforeReal.IsLastBeforeReal() = false, want true")
		}
		if InitialOffset.IsLastBeforeReal() {
			t.Error("InitialOffset.IsLastBeforeReal() = true, want false")
		}
		if MustNew(0, 5).IsLastBeforeReal() {
			t.Error("MustNew(0, 5).IsLastBeforeReal() = true, want false")
		}
	})
}

// TestLogOffsetMinMax tests Min and Max functions
func TestLogOffsetMinMax(t *testing.T) {
	t.Run("Min", func(t *testing.T) {
		a := MustNew(10, 0)
		b := MustNew(10, 1)
		result := Min(a, b)
		if !result.Equal(a) {
			t.Errorf("Min(%v, %v) = %v, want %v", a, b, result, a)
		}

		// Test with reversed order
		result = Min(b, a)
		if !result.Equal(a) {
			t.Errorf("Min(%v, %v) = %v, want %v", b, a, result, a)
		}

		// Test with equal values
		result = Min(a, a)
		if !result.Equal(a) {
			t.Errorf("Min(%v, %v) = %v, want %v", a, a, result, a)
		}
	})

	t.Run("Max", func(t *testing.T) {
		a := MustNew(10, 0)
		b := MustNew(10, 1)
		result := Max(a, b)
		if !result.Equal(b) {
			t.Errorf("Max(%v, %v) = %v, want %v", a, b, result, b)
		}

		// Test with reversed order
		result = Max(b, a)
		if !result.Equal(b) {
			t.Errorf("Max(%v, %v) = %v, want %v", b, a, result, b)
		}

		// Test with equal values
		result = Max(a, a)
		if !result.Equal(a) {
			t.Errorf("Max(%v, %v) = %v, want %v", a, a, result, a)
		}
	})
}

// TestLogOffsetSpecialValueComparisons tests comparisons between special values
// Additional test: BeforeAll < First < LastBeforeReal
func TestLogOffsetSpecialValueComparisons(t *testing.T) {
	if !BeforeAll.Before(InitialOffset) {
		t.Error("BeforeAll should be before InitialOffset")
	}
	if !InitialOffset.Before(LastBeforeReal) {
		t.Error("InitialOffset should be before LastBeforeReal")
	}
	if !BeforeAll.Before(LastBeforeReal) {
		t.Error("BeforeAll should be before LastBeforeReal")
	}

	// Real offsets are after virtual offsets
	realOffset := MustNew(1, 0)
	if !LastBeforeReal.Before(realOffset) {
		t.Error("LastBeforeReal should be before real offsets")
	}
	if !InitialOffset.Before(realOffset) {
		t.Error("InitialOffset should be before real offsets")
	}
}

// TestLogOffsetSort tests that offsets can be sorted correctly
// Additional test from implementation plan
func TestLogOffsetSort(t *testing.T) {
	offsets := []LogOffset{
		MustNew(10, 5),
		BeforeAll,
		MustNew(5, 10),
		InitialOffset,
		MustNew(10, 0),
		LastBeforeReal,
		MustNew(5, 5),
	}

	sort.Slice(offsets, func(i, j int) bool {
		return offsets[i].Before(offsets[j])
	})

	expected := []LogOffset{
		BeforeAll,
		InitialOffset,
		LastBeforeReal,
		MustNew(5, 5),
		MustNew(5, 10),
		MustNew(10, 0),
		MustNew(10, 5),
	}

	for i, offset := range offsets {
		if !offset.Equal(expected[i]) {
			t.Errorf("sorted[%d] = %v, want %v", i, offset, expected[i])
		}
	}
}

// TestLogOffsetBoundaryValues tests boundary conditions
// Additional test from implementation plan
func TestLogOffsetBoundaryValues(t *testing.T) {
	t.Run("max int64 tx_offset", func(t *testing.T) {
		offset := MustNew(math.MaxInt64, 0)
		str := offset.String()
		parsed, err := Parse(str)
		if err != nil {
			t.Fatalf("Parse(%q) error: %v", str, err)
		}
		if !parsed.Equal(offset) {
			t.Errorf("roundtrip failed for max tx_offset: %v -> %q -> %v", offset, str, parsed)
		}
	})

	t.Run("max int64 op_offset (not infinity)", func(t *testing.T) {
		// Note: MaxInt64 for op_offset is reserved for "infinity"
		// Test MaxInt64 - 1 as a valid regular op_offset
		offset := MustNew(0, math.MaxInt64-1)
		str := offset.String()
		if str == "0_inf" {
			t.Error("MaxInt64-1 should not serialize as inf")
		}
		parsed, err := Parse(str)
		if err != nil {
			t.Fatalf("Parse(%q) error: %v", str, err)
		}
		if !parsed.Equal(offset) {
			t.Errorf("roundtrip failed: %v -> %q -> %v", offset, str, parsed)
		}
	})

	t.Run("zero values", func(t *testing.T) {
		offset := MustNew(0, 0)
		if !offset.Equal(InitialOffset) {
			t.Errorf("MustNew(0, 0) != InitialOffset")
		}
	})
}

func TestLogOffsetLast(t *testing.T) {
	// Last should be greater than any practical offset
	practical := LogOffset{TxOffset: 1000000, OpOffset: 999}
	if Last.Compare(practical) != 1 {
		t.Error("Last should be greater than practical offsets")
	}

	// Last should be greater than LastBeforeReal
	if Last.Compare(LastBeforeReal) != 1 {
		t.Error("Last should be greater than LastBeforeReal")
	}

	// Last should equal itself
	if Last.Compare(Last) != 0 {
		t.Error("Last should equal itself")
	}
}

// TestLogOffsetJSONEncoding tests that the string representation is suitable for JSON
// Ported from: "LogOffset implements `Json.Encoder` protocol"
func TestLogOffsetJSONEncoding(t *testing.T) {
	// The String() method produces the value that would go inside JSON quotes
	tests := []struct {
		offset   LogOffset
		expected string
	}{
		{InitialOffset, "0_0"},
		{MustNew(10, 2), "10_2"},
		{BeforeAll, "-1"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			result := tt.offset.String()
			if result != tt.expected {
				t.Errorf("String() = %q, want %q for JSON encoding", result, tt.expected)
			}
		})
	}
}
