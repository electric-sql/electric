// Package wal provides parsing of PostgreSQL logical replication messages (pgoutput v1 protocol).
// It converts low-level pglogrepl message types into a unified Message structure that can be
// processed by the replication client.
//
// Reference: packages/sync-service/lib/electric/postgres/logical_replication/decoder.ex
package wal

import (
	"fmt"
	"time"

	"github.com/jackc/pglogrepl"
)

// MessageType represents the type of a WAL message.
type MessageType int

const (
	// MessageRelation contains table metadata (schema, name, columns).
	MessageRelation MessageType = iota
	// MessageBegin marks the start of a transaction.
	MessageBegin
	// MessageCommit marks the end of a transaction.
	MessageCommit
	// MessageInsert contains a new row.
	MessageInsert
	// MessageUpdate contains row modifications.
	MessageUpdate
	// MessageDelete contains row deletion.
	MessageDelete
	// MessageTruncate indicates a table truncation.
	MessageTruncate
	// MessageOrigin contains replication origin information.
	MessageOrigin
	// MessageType_ contains custom type information.
	MessageType_
)

// String returns a string representation of the MessageType.
func (mt MessageType) String() string {
	switch mt {
	case MessageRelation:
		return "Relation"
	case MessageBegin:
		return "Begin"
	case MessageCommit:
		return "Commit"
	case MessageInsert:
		return "Insert"
	case MessageUpdate:
		return "Update"
	case MessageDelete:
		return "Delete"
	case MessageTruncate:
		return "Truncate"
	case MessageOrigin:
		return "Origin"
	case MessageType_:
		return "Type"
	default:
		return "Unknown"
	}
}

// ReplicaIdentity specifies which columns are included in old tuple data.
type ReplicaIdentity byte

const (
	// ReplicaIdentityDefault uses the primary key for old tuple data.
	ReplicaIdentityDefault ReplicaIdentity = 'd'
	// ReplicaIdentityNothing includes no old tuple data.
	ReplicaIdentityNothing ReplicaIdentity = 'n'
	// ReplicaIdentityFull includes all columns in old tuple data.
	ReplicaIdentityFull ReplicaIdentity = 'f'
	// ReplicaIdentityIndex uses a unique index for old tuple data.
	ReplicaIdentityIndex ReplicaIdentity = 'i'
)

// String returns a string representation of the ReplicaIdentity.
func (ri ReplicaIdentity) String() string {
	switch ri {
	case ReplicaIdentityDefault:
		return "default"
	case ReplicaIdentityNothing:
		return "nothing"
	case ReplicaIdentityFull:
		return "full"
	case ReplicaIdentityIndex:
		return "index"
	default:
		return fmt.Sprintf("unknown(%c)", ri)
	}
}

// Message represents a parsed WAL message.
type Message struct {
	// Type indicates the kind of WAL message.
	Type MessageType

	// LSN is the log sequence number for this message.
	LSN pglogrepl.LSN

	// For Begin messages: transaction ID.
	Xid uint32

	// For Begin/Commit messages: commit timestamp.
	CommitTime time.Time

	// For Commit messages: the LSN at commit.
	CommitLSN pglogrepl.LSN

	// For Relation messages: table metadata.
	Relation *RelationMessage

	// For data messages (Insert/Update/Delete): row data.
	Data *DataMessage

	// For Truncate messages: affected relation IDs.
	TruncateRelationIDs []uint32

	// For Truncate messages: truncate options (cascade, restart identity).
	TruncateCascade         bool
	TruncateRestartIdentity bool

	// For Origin messages: origin name.
	OriginName string

	// For Type messages: type definition.
	TypeInfo *TypeMessage
}

// RelationMessage describes a table structure.
type RelationMessage struct {
	// ID is the PostgreSQL relation OID.
	ID uint32

	// Namespace is the schema name.
	Namespace string

	// Name is the table name.
	Name string

	// Columns describes the table columns.
	Columns []ColumnInfo

	// ReplicaIdentity indicates which columns are included in old tuple data.
	// 'd' = default (PK), 'f' = full, 'n' = nothing, 'i' = index
	ReplicaIdentity ReplicaIdentity
}

// QualifiedName returns the fully qualified table name as "schema"."table".
func (r *RelationMessage) QualifiedName() string {
	return fmt.Sprintf(`"%s"."%s"`, r.Namespace, r.Name)
}

// ColumnInfo describes a column in a relation.
type ColumnInfo struct {
	// Name is the column name.
	Name string

	// TypeOID is the PostgreSQL type OID.
	TypeOID uint32

	// TypeMod is the type modifier (e.g., varchar length).
	TypeMod int32

	// IsKey indicates whether this column is part of the replica identity.
	IsKey bool
}

// DataMessage contains row data for insert/update/delete operations.
type DataMessage struct {
	// RelationID is the OID of the table this data belongs to.
	RelationID uint32

	// OldValues contains the old row values (for update/delete with replica identity).
	// Keys are column names, values are the column values.
	// nil values indicate SQL NULL.
	OldValues map[string]any

	// NewValues contains the new row values (for insert/update).
	// Keys are column names, values are the column values.
	// nil values indicate SQL NULL.
	NewValues map[string]any

	// ChangedKeyOldValues contains old values when the key changed (update only).
	// This is separate from OldValues and contains the old key column values.
	ChangedKeyOldValues map[string]any

	// ByteSize is the size of the tuple data in bytes.
	ByteSize int
}

// TypeMessage describes a custom PostgreSQL type.
type TypeMessage struct {
	// ID is the PostgreSQL type OID.
	ID uint32

	// Namespace is the schema name.
	Namespace string

	// Name is the type name.
	Name string
}

// Parser parses WAL messages and maintains relation metadata.
type Parser struct {
	// relations caches relation messages by their ID.
	relations map[uint32]*RelationMessage
}

// NewParser creates a new WAL parser.
func NewParser() *Parser {
	return &Parser{
		relations: make(map[uint32]*RelationMessage),
	}
}

// Parse converts a pglogrepl.Message into our Message type.
// It returns an error if the message type is unknown or malformed.
func (p *Parser) Parse(msg pglogrepl.Message) (*Message, error) {
	switch m := msg.(type) {
	case *pglogrepl.RelationMessage:
		return p.parseRelation(m), nil

	case *pglogrepl.BeginMessage:
		return p.parseBegin(m), nil

	case *pglogrepl.CommitMessage:
		return p.parseCommit(m), nil

	case *pglogrepl.InsertMessage:
		return p.parseInsert(m)

	case *pglogrepl.UpdateMessage:
		return p.parseUpdate(m)

	case *pglogrepl.DeleteMessage:
		return p.parseDelete(m)

	case *pglogrepl.TruncateMessage:
		return p.parseTruncate(m), nil

	case *pglogrepl.OriginMessage:
		return p.parseOrigin(m), nil

	case *pglogrepl.TypeMessage:
		return p.parseType(m), nil

	default:
		return nil, fmt.Errorf("unknown message type: %T", msg)
	}
}

// GetRelation returns the relation for a given ID.
// Returns the relation and true if found, nil and false otherwise.
func (p *Parser) GetRelation(id uint32) (*RelationMessage, bool) {
	rel, ok := p.relations[id]
	return rel, ok
}

// ClearRelations clears the relation cache.
// This should be called when the replication stream is reset.
func (p *Parser) ClearRelations() {
	p.relations = make(map[uint32]*RelationMessage)
}

// parseRelation parses a Relation message and caches it.
func (p *Parser) parseRelation(m *pglogrepl.RelationMessage) *Message {
	columns := make([]ColumnInfo, len(m.Columns))
	for i, col := range m.Columns {
		columns[i] = ColumnInfo{
			Name:    col.Name,
			TypeOID: col.DataType,
			TypeMod: col.TypeModifier,
			IsKey:   col.Flags == 1, // Flag 1 means part of key
		}
	}

	rel := &RelationMessage{
		ID:              m.RelationID,
		Namespace:       m.Namespace,
		Name:            m.RelationName,
		Columns:         columns,
		ReplicaIdentity: ReplicaIdentity(m.ReplicaIdentity),
	}

	// Cache the relation for later use when parsing data messages
	p.relations[m.RelationID] = rel

	return &Message{
		Type:     MessageRelation,
		Relation: rel,
	}
}

// parseBegin parses a Begin message.
func (p *Parser) parseBegin(m *pglogrepl.BeginMessage) *Message {
	return &Message{
		Type:       MessageBegin,
		LSN:        m.FinalLSN,
		Xid:        m.Xid,
		CommitTime: m.CommitTime,
	}
}

// parseCommit parses a Commit message.
func (p *Parser) parseCommit(m *pglogrepl.CommitMessage) *Message {
	return &Message{
		Type:       MessageCommit,
		LSN:        m.TransactionEndLSN,
		CommitLSN:  m.CommitLSN,
		CommitTime: m.CommitTime,
	}
}

// parseInsert parses an Insert message.
func (p *Parser) parseInsert(m *pglogrepl.InsertMessage) (*Message, error) {
	rel, ok := p.relations[m.RelationID]
	if !ok {
		return nil, fmt.Errorf("unknown relation ID: %d (missing Relation message)", m.RelationID)
	}

	newValues, byteSize := p.decodeTupleData(m.Tuple, rel.Columns)

	return &Message{
		Type: MessageInsert,
		Data: &DataMessage{
			RelationID: m.RelationID,
			NewValues:  newValues,
			ByteSize:   byteSize,
		},
	}, nil
}

// parseUpdate parses an Update message.
func (p *Parser) parseUpdate(m *pglogrepl.UpdateMessage) (*Message, error) {
	rel, ok := p.relations[m.RelationID]
	if !ok {
		return nil, fmt.Errorf("unknown relation ID: %d (missing Relation message)", m.RelationID)
	}

	newValues, newByteSize := p.decodeTupleData(m.NewTuple, rel.Columns)
	totalByteSize := newByteSize

	var oldValues map[string]any
	var changedKeyOldValues map[string]any

	// OldTuple is present when replica identity is FULL or when it's KEY mode
	// and the key columns changed
	if m.OldTuple != nil {
		var oldByteSize int
		// Check the tuple type indicator
		if m.OldTupleType == pglogrepl.UpdateMessageTupleTypeKey {
			// 'K' - Contains the old values of the key columns
			changedKeyOldValues, oldByteSize = p.decodeTupleData(m.OldTuple, rel.Columns)
		} else {
			// 'O' - Contains the old values of all columns
			oldValues, oldByteSize = p.decodeTupleData(m.OldTuple, rel.Columns)
		}
		totalByteSize += oldByteSize
	}

	return &Message{
		Type: MessageUpdate,
		Data: &DataMessage{
			RelationID:          m.RelationID,
			OldValues:           oldValues,
			NewValues:           newValues,
			ChangedKeyOldValues: changedKeyOldValues,
			ByteSize:            totalByteSize,
		},
	}, nil
}

// parseDelete parses a Delete message.
func (p *Parser) parseDelete(m *pglogrepl.DeleteMessage) (*Message, error) {
	rel, ok := p.relations[m.RelationID]
	if !ok {
		return nil, fmt.Errorf("unknown relation ID: %d (missing Relation message)", m.RelationID)
	}

	var oldValues map[string]any
	var changedKeyOldValues map[string]any
	var byteSize int

	if m.OldTuple != nil {
		if m.OldTupleType == pglogrepl.DeleteMessageTupleTypeKey {
			// 'K' - Contains just the key columns
			changedKeyOldValues, byteSize = p.decodeTupleData(m.OldTuple, rel.Columns)
		} else {
			// 'O' - Contains all columns (REPLICA IDENTITY FULL)
			oldValues, byteSize = p.decodeTupleData(m.OldTuple, rel.Columns)
		}
	}

	return &Message{
		Type: MessageDelete,
		Data: &DataMessage{
			RelationID:          m.RelationID,
			OldValues:           oldValues,
			ChangedKeyOldValues: changedKeyOldValues,
			ByteSize:            byteSize,
		},
	}, nil
}

// parseTruncate parses a Truncate message.
func (p *Parser) parseTruncate(m *pglogrepl.TruncateMessage) *Message {
	return &Message{
		Type:                    MessageTruncate,
		TruncateRelationIDs:     m.RelationIDs,
		TruncateCascade:         m.Option&1 != 0,
		TruncateRestartIdentity: m.Option&2 != 0,
	}
}

// parseOrigin parses an Origin message.
func (p *Parser) parseOrigin(m *pglogrepl.OriginMessage) *Message {
	return &Message{
		Type:       MessageOrigin,
		LSN:        m.CommitLSN,
		OriginName: m.Name,
	}
}

// parseType parses a Type message.
func (p *Parser) parseType(m *pglogrepl.TypeMessage) *Message {
	return &Message{
		Type: MessageType_,
		TypeInfo: &TypeMessage{
			ID:        m.DataType,
			Namespace: m.Namespace,
			Name:      m.Name,
		},
	}
}

// decodeTupleData converts pglogrepl.TupleData to a map of column names to values.
// It returns the decoded values and the total byte size of the data.
func (p *Parser) decodeTupleData(tuple *pglogrepl.TupleData, columns []ColumnInfo) (map[string]any, int) {
	if tuple == nil || len(tuple.Columns) == 0 {
		return nil, 0
	}

	values := make(map[string]any, len(tuple.Columns))
	totalSize := 0

	for i, col := range tuple.Columns {
		if i >= len(columns) {
			// More columns in tuple than in relation metadata
			// This shouldn't happen, but let's be safe
			break
		}

		colName := columns[i].Name

		switch col.DataType {
		case 'n':
			// NULL value
			values[colName] = nil

		case 'u':
			// Unchanged TOAST value - we represent this as a special marker
			// In practice, the caller should use the old value
			values[colName] = UnchangedTOAST{}

		case 't':
			// Text format data - store as string
			values[colName] = string(col.Data)
			totalSize += len(col.Data)

		case 'b':
			// Binary format data - store as byte slice
			// For now, we also convert to string since Electric uses text format
			values[colName] = string(col.Data)
			totalSize += len(col.Data)
		}
	}

	return values, totalSize
}

// UnchangedTOAST is a marker type indicating that a TOAST value was not changed
// and should be retrieved from the old tuple data.
type UnchangedTOAST struct{}

// String returns a string representation of the UnchangedTOAST marker.
func (UnchangedTOAST) String() string {
	return "<unchanged TOAST>"
}

// IsUnchangedTOAST checks if a value is an UnchangedTOAST marker.
func IsUnchangedTOAST(v any) bool {
	_, ok := v.(UnchangedTOAST)
	return ok
}

// RelationCount returns the number of cached relations.
func (p *Parser) RelationCount() int {
	return len(p.relations)
}
