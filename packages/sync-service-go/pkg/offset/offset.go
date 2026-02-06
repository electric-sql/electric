// Package offset provides the LogOffset type that uniquely identifies a position
// in a shape's operation log. The offset combines a transaction ID (derived from
// PostgreSQL LSN) with an operation ID (position within the transaction).
//
// Ported from: lib/electric/replication/log_offset.ex
package offset

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// LogOffset uniquely identifies an operation inside the shape log.
// It combines a transaction ID with an operation ID.
//
// Format: "{TxOffset}_{OpOffset}"
type LogOffset struct {
	// TxOffset is the transaction offset, derived from PostgreSQL LSN.
	// A value of -1 indicates "before all" (used for initial sync requests).
	TxOffset int64

	// OpOffset is the position within the transaction.
	// For special value LastBeforeReal, this is math.MaxInt64.
	OpOffset int64
}

// Special LogOffset values
var (
	// BeforeAll is an offset that is smaller than all offsets in the log.
	// Used to indicate a request for the initial sync (all data from the beginning).
	BeforeAll = LogOffset{TxOffset: -1, OpOffset: 0}

	// InitialOffset (also known as First) is the first possible offset in the log.
	InitialOffset = LogOffset{TxOffset: 0, OpOffset: 0}

	// LastBeforeReal is the last possible offset for the "virtual" part of the log
	// (i.e., snapshots). This is used internally and not serialized to clients.
	LastBeforeReal = LogOffset{TxOffset: 0, OpOffset: math.MaxInt64}
)

// New creates a new LogOffset with the given transaction and operation offsets.
// It returns an error if the values are invalid.
func New(txOffset int64, opOffset int64) (LogOffset, error) {
	// BeforeAll is the only valid case where txOffset is negative
	if txOffset == -1 && opOffset == 0 {
		return BeforeAll, nil
	}

	// All other cases require non-negative values
	if txOffset < 0 {
		return LogOffset{}, fmt.Errorf("invalid tx_offset: %d (must be >= 0 or -1 for BeforeAll)", txOffset)
	}
	if opOffset < 0 {
		return LogOffset{}, fmt.Errorf("invalid op_offset: %d (must be >= 0)", opOffset)
	}

	return LogOffset{TxOffset: txOffset, OpOffset: opOffset}, nil
}

// MustNew creates a new LogOffset and panics if the values are invalid.
// Use this only for known-good values in initialization.
func MustNew(txOffset int64, opOffset int64) LogOffset {
	offset, err := New(txOffset, opOffset)
	if err != nil {
		panic(err)
	}
	return offset
}

// Parse parses a string representation of a LogOffset.
//
// Valid formats:
//   - "-1" → BeforeAll
//   - "{tx}_{op}" → LogOffset{TxOffset: tx, OpOffset: op}
//
// Returns an error for invalid formats.
func Parse(s string) (LogOffset, error) {
	if s == "" {
		return LogOffset{}, fmt.Errorf("empty offset string")
	}

	// Special case: BeforeAll
	if s == "-1" {
		return BeforeAll, nil
	}

	// Parse "{tx}_{op}" format
	parts := strings.Split(s, "_")
	if len(parts) != 2 {
		return LogOffset{}, fmt.Errorf("invalid offset format: %q (expected tx_op)", s)
	}

	txOffset, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return LogOffset{}, fmt.Errorf("invalid tx_offset in %q: %w", s, err)
	}

	// Handle special "inf" value for op_offset (used internally)
	var opOffset int64
	if parts[1] == "inf" {
		opOffset = math.MaxInt64
	} else {
		opOffset, err = strconv.ParseInt(parts[1], 10, 64)
		if err != nil {
			return LogOffset{}, fmt.Errorf("invalid op_offset in %q: %w", s, err)
		}
	}

	return New(txOffset, opOffset)
}

// String returns the string representation of the LogOffset.
//
// Format:
//   - BeforeAll → "-1"
//   - Regular → "{tx}_{op}"
//   - LastBeforeReal (op_offset=MaxInt64) → "{tx}_inf"
func (o LogOffset) String() string {
	if o.TxOffset == -1 {
		return "-1"
	}
	if o.OpOffset == math.MaxInt64 {
		return fmt.Sprintf("%d_inf", o.TxOffset)
	}
	return fmt.Sprintf("%d_%d", o.TxOffset, o.OpOffset)
}

// Compare compares two LogOffsets lexicographically.
// Returns:
//
//	-1 if o < other
//	 0 if o == other
//	 1 if o > other
func (o LogOffset) Compare(other LogOffset) int {
	if o.TxOffset < other.TxOffset {
		return -1
	}
	if o.TxOffset > other.TxOffset {
		return 1
	}

	// TxOffset is equal, compare OpOffset
	if o.OpOffset < other.OpOffset {
		return -1
	}
	if o.OpOffset > other.OpOffset {
		return 1
	}

	return 0
}

// Before returns true if o is strictly before other.
func (o LogOffset) Before(other LogOffset) bool {
	return o.Compare(other) < 0
}

// After returns true if o is strictly after other.
func (o LogOffset) After(other LogOffset) bool {
	return o.Compare(other) > 0
}

// Equal returns true if o equals other.
func (o LogOffset) Equal(other LogOffset) bool {
	return o.Compare(other) == 0
}

// BeforeOrEqual returns true if o is before or equal to other.
func (o LogOffset) BeforeOrEqual(other LogOffset) bool {
	return o.Compare(other) <= 0
}

// AfterOrEqual returns true if o is after or equal to other.
func (o LogOffset) AfterOrEqual(other LogOffset) bool {
	return o.Compare(other) >= 0
}

// IsBeforeAll returns true if this is the BeforeAll offset.
func (o LogOffset) IsBeforeAll() bool {
	return o.TxOffset == -1
}

// IsVirtual returns true if this offset is in the "virtual" part of the log
// (i.e., snapshot data with TxOffset == 0).
func (o LogOffset) IsVirtual() bool {
	return o.TxOffset == 0
}

// IsReal returns true if this offset is in the "real" part of the log
// (i.e., WAL data with TxOffset > 0).
func (o LogOffset) IsReal() bool {
	return o.TxOffset > 0
}

// IsLastBeforeReal returns true if this is the LastBeforeReal offset.
func (o LogOffset) IsLastBeforeReal() bool {
	return o.TxOffset == 0 && o.OpOffset == math.MaxInt64
}

// Increment returns a new LogOffset with the OpOffset incremented by 1.
// This is used when a PK change occurs to give the insert a different offset
// than the delete within the same transaction.
func (o LogOffset) Increment() LogOffset {
	return o.IncrementBy(1)
}

// IncrementBy returns a new LogOffset with the OpOffset incremented by n.
func (o LogOffset) IncrementBy(n int64) LogOffset {
	// Special case: incrementing from LastBeforeReal moves to real offsets
	if o.OpOffset == math.MaxInt64 {
		return LogOffset{TxOffset: 1, OpOffset: n - 1}
	}
	return LogOffset{TxOffset: o.TxOffset, OpOffset: o.OpOffset + n}
}

// Min returns the smaller of two LogOffsets.
func Min(a, b LogOffset) LogOffset {
	if a.Compare(b) < 0 {
		return a
	}
	return b
}

// Max returns the larger of two LogOffsets.
func Max(a, b LogOffset) LogOffset {
	if a.Compare(b) > 0 {
		return a
	}
	return b
}
