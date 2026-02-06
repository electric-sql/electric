// Package storage defines the Storage interface and related types for shape data persistence.
// Ported from: lib/electric/shape_cache/storage.ex
package storage

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"
)

// SchemaInfo contains metadata about a table's schema.
type SchemaInfo struct {
	TableName string       `json:"table_name"`
	Schema    string       `json:"schema"`
	Columns   []ColumnInfo `json:"columns"`
}

// ColumnInfo describes a single column in a table schema.
type ColumnInfo struct {
	Name      string `json:"name"`
	Type      string `json:"type"`
	PKIndex   int    `json:"pk_index,omitempty"` // -1 if not PK
	NotNull   bool   `json:"not_null,omitempty"`
	Dims      int    `json:"dims,omitempty"`       // array dimensions, 0 if not array
	MaxLength int    `json:"max_length,omitempty"` // varchar limit, 0 if none
	Length    int    `json:"length,omitempty"`     // char/bit fixed length, 0 if none
	Precision int    `json:"precision,omitempty"`  // numeric/time precision, 0 if none
	Scale     int    `json:"scale,omitempty"`      // numeric scale, 0 if none
	Fields    string `json:"fields,omitempty"`     // interval field restriction, "" if none
	TypeMod   int    `json:"type_mod,omitempty"`   // raw type modifier, 0 if none
}

// Operation represents the type of operation in a log item.
type Operation string

const (
	OpInsert Operation = "insert"
	OpUpdate Operation = "update"
	OpDelete Operation = "delete"
)

// LogItem represents a single entry in the shape log.
type LogItem struct {
	Offset string    `json:"offset"` // Format: "{tx}_{op}"
	Key    string    `json:"key"`    // Record key
	Op     Operation `json:"op"`     // Operation type
	JSON   []byte    `json:"json"`   // Pre-serialized JSON data
}

// PgSnapshot represents a PostgreSQL snapshot for visibility checks.
type PgSnapshot struct {
	Xmin       int64   `json:"xmin"`
	Xmax       int64   `json:"xmax"`
	XipList    []int64 `json:"xip_list"`
	FilterTxns bool    `json:"filter_txns"`
}

// Storage defines the interface for shape data persistence.
type Storage interface {
	// Shape lifecycle
	MakeNewShapeID() string
	ShapeExists(shapeID string) bool
	ListShapes() []string
	DeleteShape(shapeID string) error

	// Snapshot
	SetSnapshot(shapeID string, schema SchemaInfo, items []LogItem, snapshotXmin int64) error
	GetSnapshot(shapeID string) ([]LogItem, int64, error)
	SnapshotExists(shapeID string) bool

	// Log operations
	AppendToLog(shapeID string, items []LogItem) error
	GetLogSince(shapeID string, offset string) ([]LogItem, error)
	GetLogChunk(shapeID string, chunkOffset string) ([]LogItem, string, error)

	// Chunk management
	GetChunkEnd(shapeID string, offset string) (string, bool)
	SetChunkEnd(shapeID string, startOffset string, endOffset string) error

	// Latest offset
	GetLatestOffset(shapeID string) (string, error)
}

// GenerateShapeID generates a new shape ID with format: random-hash + timestamp suffix.
// Format: {8-char-hex}-{microsecond-timestamp}
func GenerateShapeID() string {
	// Generate 4 random bytes (8 hex characters)
	randomBytes := make([]byte, 4)
	if _, err := rand.Read(randomBytes); err != nil {
		// Fallback to timestamp-based randomness if crypto/rand fails
		randomBytes = []byte{
			byte(time.Now().UnixNano() >> 24),
			byte(time.Now().UnixNano() >> 16),
			byte(time.Now().UnixNano() >> 8),
			byte(time.Now().UnixNano()),
		}
	}
	hash := hex.EncodeToString(randomBytes)
	timestamp := time.Now().UnixMicro()
	return fmt.Sprintf("%s-%d", hash, timestamp)
}

// CompareOffsets compares two offset strings.
// Returns -1 if a < b, 0 if a == b, 1 if a > b.
// Offset format: "{tx}_{op}" where tx and op are integers.
func CompareOffsets(a, b string) int {
	aTx, aOp := parseOffset(a)
	bTx, bOp := parseOffset(b)

	if aTx < bTx {
		return -1
	}
	if aTx > bTx {
		return 1
	}
	if aOp < bOp {
		return -1
	}
	if aOp > bOp {
		return 1
	}
	return 0
}

// parseOffset parses an offset string into tx and op components.
// Returns (-1, 0) for "-1" (BeforeAll), (0, 0) for invalid offsets.
func parseOffset(offset string) (tx int64, op int) {
	if offset == "-1" {
		return -1, 0
	}
	if offset == "" {
		return 0, 0
	}
	_, err := fmt.Sscanf(offset, "%d_%d", &tx, &op)
	if err != nil {
		return 0, 0
	}
	return tx, op
}

// FormatOffset formats tx and op values into an offset string.
func FormatOffset(tx int64, op int) string {
	if tx == -1 && op == 0 {
		return "-1"
	}
	return fmt.Sprintf("%d_%d", tx, op)
}

// IsBeforeAll returns true if the offset represents the "before all" position.
func IsBeforeAll(offset string) bool {
	return offset == "-1"
}
