// Package shape provides types and utilities for working with Electric shapes.
package shape

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const (
	// HashLength is the length of the hash portion of a handle (16 hex chars).
	HashLength = 16
)

var (
	// ErrInvalidHandleFormat indicates the handle string format is invalid.
	ErrInvalidHandleFormat = errors.New("invalid handle format")
	// ErrInvalidHashLength indicates the hash portion is not exactly 16 hex characters.
	ErrInvalidHashLength = errors.New("hash must be exactly 16 hex characters")
	// ErrInvalidHashChars indicates the hash contains non-hex characters.
	ErrInvalidHashChars = errors.New("hash must contain only hex characters")
	// ErrInvalidTimestamp indicates the timestamp is not a valid positive integer.
	ErrInvalidTimestamp = errors.New("timestamp must be a positive integer")
)

// Handle is an opaque identifier for a shape instance.
// Format: "{hash}-{timestamp}" where:
// - hash: first 16 chars of SHA256 of shape definition
// - timestamp: Unix microseconds when shape was created
type Handle struct {
	Hash      string // shape definition hash (16 hex chars)
	Timestamp int64  // Unix microseconds
}

// NewHandle creates a new handle from a shape hash.
// The hash should be the first 16 characters of the SHA256 hash of the shape definition.
func NewHandle(hash string) Handle {
	return Handle{
		Hash:      hash,
		Timestamp: time.Now().UnixMicro(),
	}
}

// NewHandleWithTimestamp creates a new handle with a specific timestamp.
// This is useful for testing or recreating handles from storage.
func NewHandleWithTimestamp(hash string, timestamp int64) Handle {
	return Handle{
		Hash:      hash,
		Timestamp: timestamp,
	}
}

// GenerateHash generates a 16-character hash from a shape definition string.
// It computes the SHA256 hash and returns the first 16 hex characters.
func GenerateHash(definition string) string {
	hash := sha256.Sum256([]byte(definition))
	fullHex := hex.EncodeToString(hash[:])
	return fullHex[:HashLength]
}

// ParseHandle parses a handle string in the format "{hash}-{timestamp}".
// Returns error if format is invalid.
func ParseHandle(s string) (Handle, error) {
	if s == "" {
		return Handle{}, ErrInvalidHandleFormat
	}

	// Find the last dash to split hash and timestamp
	// We use LastIndex because the hash portion might not contain dashes,
	// but we want to handle any edge cases correctly.
	dashIdx := strings.LastIndex(s, "-")
	if dashIdx == -1 {
		return Handle{}, ErrInvalidHandleFormat
	}

	hashPart := s[:dashIdx]
	timestampPart := s[dashIdx+1:]

	// Validate hash length
	if len(hashPart) != HashLength {
		return Handle{}, ErrInvalidHashLength
	}

	// Validate hash contains only hex characters
	if !isValidHex(hashPart) {
		return Handle{}, ErrInvalidHashChars
	}

	// Parse timestamp
	timestamp, err := strconv.ParseInt(timestampPart, 10, 64)
	if err != nil {
		return Handle{}, ErrInvalidTimestamp
	}

	// Validate timestamp is positive
	if timestamp <= 0 {
		return Handle{}, ErrInvalidTimestamp
	}

	return Handle{
		Hash:      hashPart,
		Timestamp: timestamp,
	}, nil
}

// String returns the handle in wire format: "{hash}-{timestamp}".
func (h Handle) String() string {
	return fmt.Sprintf("%s-%d", h.Hash, h.Timestamp)
}

// IsValid checks if the handle has valid format.
// A valid handle must have:
// - Hash of exactly 16 hex characters
// - Positive timestamp
func (h Handle) IsValid() bool {
	if len(h.Hash) != HashLength {
		return false
	}
	if !isValidHex(h.Hash) {
		return false
	}
	if h.Timestamp <= 0 {
		return false
	}
	return true
}

// SameShape checks if two handles refer to the same shape definition.
// Two handles have the same shape if they have the same hash,
// regardless of their timestamps (which may differ if the shape was
// created at different times).
func (h Handle) SameShape(other Handle) bool {
	return h.Hash == other.Hash
}

// IsZero returns true if the handle is the zero value.
func (h Handle) IsZero() bool {
	return h.Hash == "" && h.Timestamp == 0
}

// isValidHex checks if a string contains only valid hexadecimal characters.
func isValidHex(s string) bool {
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}
