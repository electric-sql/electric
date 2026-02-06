// Package wal tests
// Ported from: packages/sync-service/lib/electric/postgres/logical_replication/decoder.ex
package wal

import (
	"testing"
	"time"

	"github.com/jackc/pglogrepl"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewParser(t *testing.T) {
	p := NewParser()
	assert.NotNil(t, p)
	assert.Equal(t, 0, p.RelationCount())
}

func TestMessageTypeString(t *testing.T) {
	tests := []struct {
		msgType  MessageType
		expected string
	}{
		{MessageRelation, "Relation"},
		{MessageBegin, "Begin"},
		{MessageCommit, "Commit"},
		{MessageInsert, "Insert"},
		{MessageUpdate, "Update"},
		{MessageDelete, "Delete"},
		{MessageTruncate, "Truncate"},
		{MessageOrigin, "Origin"},
		{MessageType_, "Type"},
		{MessageType(99), "Unknown"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			assert.Equal(t, tt.expected, tt.msgType.String())
		})
	}
}

func TestReplicaIdentityString(t *testing.T) {
	tests := []struct {
		ri       ReplicaIdentity
		expected string
	}{
		{ReplicaIdentityDefault, "default"},
		{ReplicaIdentityNothing, "nothing"},
		{ReplicaIdentityFull, "full"},
		{ReplicaIdentityIndex, "index"},
		{ReplicaIdentity('x'), "unknown(x)"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			assert.Equal(t, tt.expected, tt.ri.String())
		})
	}
}

func TestParseRelationMessage(t *testing.T) {
	p := NewParser()

	relMsg := &pglogrepl.RelationMessage{
		RelationID:      16396,
		Namespace:       "public",
		RelationName:    "entries",
		ReplicaIdentity: 'f', // all_columns
		Columns: []*pglogrepl.RelationMessageColumn{
			{
				Flags:        1, // key
				Name:         "id",
				DataType:     2950, // UUID
				TypeModifier: -1,
			},
			{
				Flags:        1, // key
				Name:         "content",
				DataType:     1043, // varchar
				TypeModifier: 68,
			},
		},
	}

	msg, err := p.Parse(relMsg)
	require.NoError(t, err)

	assert.Equal(t, MessageRelation, msg.Type)
	assert.NotNil(t, msg.Relation)

	rel := msg.Relation
	assert.Equal(t, uint32(16396), rel.ID)
	assert.Equal(t, "public", rel.Namespace)
	assert.Equal(t, "entries", rel.Name)
	assert.Equal(t, ReplicaIdentityFull, rel.ReplicaIdentity)
	assert.Len(t, rel.Columns, 2)

	// Check first column
	assert.Equal(t, "id", rel.Columns[0].Name)
	assert.Equal(t, uint32(2950), rel.Columns[0].TypeOID)
	assert.Equal(t, int32(-1), rel.Columns[0].TypeMod)
	assert.True(t, rel.Columns[0].IsKey)

	// Check second column
	assert.Equal(t, "content", rel.Columns[1].Name)
	assert.Equal(t, uint32(1043), rel.Columns[1].TypeOID)
	assert.Equal(t, int32(68), rel.Columns[1].TypeMod)
	assert.True(t, rel.Columns[1].IsKey)

	// Verify relation is cached
	cachedRel, ok := p.GetRelation(16396)
	assert.True(t, ok)
	assert.Equal(t, rel, cachedRel)
	assert.Equal(t, 1, p.RelationCount())
}

func TestParseRelationMessageQualifiedName(t *testing.T) {
	p := NewParser()

	relMsg := &pglogrepl.RelationMessage{
		RelationID:      12345,
		Namespace:       "my_schema",
		RelationName:    "users",
		ReplicaIdentity: 'd',
		Columns:         []*pglogrepl.RelationMessageColumn{},
	}

	msg, err := p.Parse(relMsg)
	require.NoError(t, err)

	assert.Equal(t, `"my_schema"."users"`, msg.Relation.QualifiedName())
}

func TestParseBeginMessage(t *testing.T) {
	p := NewParser()

	commitTime := time.Date(2019, 7, 18, 17, 2, 35, 726322000, time.UTC)
	beginMsg := &pglogrepl.BeginMessage{
		FinalLSN:   pglogrepl.LSN(0x2A7F4A880),
		CommitTime: commitTime,
		Xid:        619,
	}

	msg, err := p.Parse(beginMsg)
	require.NoError(t, err)

	assert.Equal(t, MessageBegin, msg.Type)
	assert.Equal(t, pglogrepl.LSN(0x2A7F4A880), msg.LSN)
	assert.Equal(t, uint32(619), msg.Xid)
	assert.Equal(t, commitTime, msg.CommitTime)
}

func TestParseCommitMessage(t *testing.T) {
	p := NewParser()

	commitTime := time.Date(2022, 6, 9, 9, 45, 11, 642218000, time.UTC)
	commitMsg := &pglogrepl.CommitMessage{
		CommitLSN:         pglogrepl.LSN(0x1735A68),
		TransactionEndLSN: pglogrepl.LSN(0x1735A98),
		CommitTime:        commitTime,
	}

	msg, err := p.Parse(commitMsg)
	require.NoError(t, err)

	assert.Equal(t, MessageCommit, msg.Type)
	assert.Equal(t, pglogrepl.LSN(0x1735A98), msg.LSN)
	assert.Equal(t, pglogrepl.LSN(0x1735A68), msg.CommitLSN)
	assert.Equal(t, commitTime, msg.CommitTime)
}

func TestParseInsertMessage(t *testing.T) {
	p := NewParser()

	// First, add the relation
	relMsg := &pglogrepl.RelationMessage{
		RelationID:      16396,
		Namespace:       "public",
		RelationName:    "entries",
		ReplicaIdentity: 'f',
		Columns: []*pglogrepl.RelationMessageColumn{
			{Flags: 1, Name: "id", DataType: 2950, TypeModifier: -1},
			{Flags: 0, Name: "content", DataType: 1043, TypeModifier: 68},
		},
	}
	_, err := p.Parse(relMsg)
	require.NoError(t, err)

	// Now parse an insert
	insertMsg := &pglogrepl.InsertMessage{
		RelationID: 16396,
		Tuple: &pglogrepl.TupleData{
			Columns: []*pglogrepl.TupleDataColumn{
				{DataType: 't', Data: []byte("06ac9e9a-f31c-4ef4-a57f-c4776b139201")},
				{DataType: 't', Data: []byte("ok")},
			},
		},
	}

	msg, err := p.Parse(insertMsg)
	require.NoError(t, err)

	assert.Equal(t, MessageInsert, msg.Type)
	assert.NotNil(t, msg.Data)
	assert.Equal(t, uint32(16396), msg.Data.RelationID)
	assert.Nil(t, msg.Data.OldValues)
	assert.NotNil(t, msg.Data.NewValues)

	assert.Equal(t, "06ac9e9a-f31c-4ef4-a57f-c4776b139201", msg.Data.NewValues["id"])
	assert.Equal(t, "ok", msg.Data.NewValues["content"])
	assert.Equal(t, 38, msg.Data.ByteSize)
}

func TestParseInsertMessageMissingRelation(t *testing.T) {
	p := NewParser()

	insertMsg := &pglogrepl.InsertMessage{
		RelationID: 99999,
		Tuple: &pglogrepl.TupleData{
			Columns: []*pglogrepl.TupleDataColumn{
				{DataType: 't', Data: []byte("test")},
			},
		},
	}

	_, err := p.Parse(insertMsg)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown relation ID")
}

func TestParseUpdateMessageNewTupleOnly(t *testing.T) {
	p := NewParser()

	// Add relation first
	relMsg := &pglogrepl.RelationMessage{
		RelationID:      16396,
		Namespace:       "public",
		RelationName:    "entries",
		ReplicaIdentity: 'd', // default - no old tuple
		Columns: []*pglogrepl.RelationMessageColumn{
			{Flags: 1, Name: "id", DataType: 2950, TypeModifier: -1},
			{Flags: 0, Name: "content", DataType: 1043, TypeModifier: 68},
		},
	}
	_, err := p.Parse(relMsg)
	require.NoError(t, err)

	// Parse update with only new tuple
	updateMsg := &pglogrepl.UpdateMessage{
		RelationID: 16396,
		NewTuple: &pglogrepl.TupleData{
			Columns: []*pglogrepl.TupleDataColumn{
				{DataType: 't', Data: []byte("c0d731ca-0e72-4950-9499-8db83badb051")},
				{DataType: 't', Data: []byte("updated")},
			},
		},
	}

	msg, err := p.Parse(updateMsg)
	require.NoError(t, err)

	assert.Equal(t, MessageUpdate, msg.Type)
	assert.NotNil(t, msg.Data)
	assert.Nil(t, msg.Data.OldValues)
	assert.Nil(t, msg.Data.ChangedKeyOldValues)
	assert.NotNil(t, msg.Data.NewValues)

	assert.Equal(t, "c0d731ca-0e72-4950-9499-8db83badb051", msg.Data.NewValues["id"])
	assert.Equal(t, "updated", msg.Data.NewValues["content"])
}

func TestParseUpdateMessageWithOldTuple(t *testing.T) {
	p := NewParser()

	// Add relation with full replica identity
	relMsg := &pglogrepl.RelationMessage{
		RelationID:      16396,
		Namespace:       "public",
		RelationName:    "entries",
		ReplicaIdentity: 'f', // full
		Columns: []*pglogrepl.RelationMessageColumn{
			{Flags: 1, Name: "id", DataType: 2950, TypeModifier: -1},
			{Flags: 0, Name: "content", DataType: 1043, TypeModifier: 68},
		},
	}
	_, err := p.Parse(relMsg)
	require.NoError(t, err)

	// Parse update with old and new tuple ('O' type)
	updateMsg := &pglogrepl.UpdateMessage{
		RelationID:   16396,
		OldTupleType: pglogrepl.UpdateMessageTupleTypeOld,
		OldTuple: &pglogrepl.TupleData{
			Columns: []*pglogrepl.TupleDataColumn{
				{DataType: 't', Data: []byte("c0d731ca-0e72-4950-9499-8db83badb051")},
				{DataType: 't', Data: []byte("ok")},
			},
		},
		NewTuple: &pglogrepl.TupleData{
			Columns: []*pglogrepl.TupleDataColumn{
				{DataType: 't', Data: []byte("c0d731ca-0e72-4950-9499-8db83badb051")},
				{DataType: 't', Data: []byte("yes")},
			},
		},
	}

	msg, err := p.Parse(updateMsg)
	require.NoError(t, err)

	assert.Equal(t, MessageUpdate, msg.Type)
	assert.NotNil(t, msg.Data.OldValues)
	assert.NotNil(t, msg.Data.NewValues)
	assert.Nil(t, msg.Data.ChangedKeyOldValues)

	assert.Equal(t, "c0d731ca-0e72-4950-9499-8db83badb051", msg.Data.OldValues["id"])
	assert.Equal(t, "ok", msg.Data.OldValues["content"])
	assert.Equal(t, "c0d731ca-0e72-4950-9499-8db83badb051", msg.Data.NewValues["id"])
	assert.Equal(t, "yes", msg.Data.NewValues["content"])

	// Verify byte size includes both tuples
	assert.Equal(t, 77, msg.Data.ByteSize)
}

func TestParseUpdateMessageWithChangedKey(t *testing.T) {
	p := NewParser()

	// Add relation
	relMsg := &pglogrepl.RelationMessage{
		RelationID:      16396,
		Namespace:       "public",
		RelationName:    "entries",
		ReplicaIdentity: 'd',
		Columns: []*pglogrepl.RelationMessageColumn{
			{Flags: 1, Name: "id", DataType: 2950, TypeModifier: -1},
			{Flags: 0, Name: "content", DataType: 1043, TypeModifier: 68},
		},
	}
	_, err := p.Parse(relMsg)
	require.NoError(t, err)

	// Parse update with key change ('K' type)
	updateMsg := &pglogrepl.UpdateMessage{
		RelationID:   16396,
		OldTupleType: pglogrepl.UpdateMessageTupleTypeKey,
		OldTuple: &pglogrepl.TupleData{
			Columns: []*pglogrepl.TupleDataColumn{
				{DataType: 't', Data: []byte("old-id")},
				{DataType: 'n'}, // NULL for non-key column
			},
		},
		NewTuple: &pglogrepl.TupleData{
			Columns: []*pglogrepl.TupleDataColumn{
				{DataType: 't', Data: []byte("new-id")},
				{DataType: 't', Data: []byte("content")},
			},
		},
	}

	msg, err := p.Parse(updateMsg)
	require.NoError(t, err)

	assert.Equal(t, MessageUpdate, msg.Type)
	assert.Nil(t, msg.Data.OldValues)
	assert.NotNil(t, msg.Data.ChangedKeyOldValues)
	assert.NotNil(t, msg.Data.NewValues)

	assert.Equal(t, "old-id", msg.Data.ChangedKeyOldValues["id"])
	assert.Nil(t, msg.Data.ChangedKeyOldValues["content"]) // NULL
	assert.Equal(t, "new-id", msg.Data.NewValues["id"])
	assert.Equal(t, "content", msg.Data.NewValues["content"])
}

func TestParseDeleteMessage(t *testing.T) {
	p := NewParser()

	// Add relation with full replica identity
	relMsg := &pglogrepl.RelationMessage{
		RelationID:      16396,
		Namespace:       "public",
		RelationName:    "entries",
		ReplicaIdentity: 'f',
		Columns: []*pglogrepl.RelationMessageColumn{
			{Flags: 1, Name: "id", DataType: 2950, TypeModifier: -1},
			{Flags: 0, Name: "content", DataType: 1043, TypeModifier: 68},
		},
	}
	_, err := p.Parse(relMsg)
	require.NoError(t, err)

	// Parse delete with full old tuple ('O' type)
	deleteMsg := &pglogrepl.DeleteMessage{
		RelationID:   16396,
		OldTupleType: pglogrepl.DeleteMessageTupleTypeOld,
		OldTuple: &pglogrepl.TupleData{
			Columns: []*pglogrepl.TupleDataColumn{
				{DataType: 't', Data: []byte("c0d731ca-0e72-4950-9499-8db83badb051")},
				{DataType: 't', Data: []byte("yes")},
			},
		},
	}

	msg, err := p.Parse(deleteMsg)
	require.NoError(t, err)

	assert.Equal(t, MessageDelete, msg.Type)
	assert.NotNil(t, msg.Data)
	assert.NotNil(t, msg.Data.OldValues)
	assert.Nil(t, msg.Data.NewValues)
	assert.Nil(t, msg.Data.ChangedKeyOldValues)

	assert.Equal(t, "c0d731ca-0e72-4950-9499-8db83badb051", msg.Data.OldValues["id"])
	assert.Equal(t, "yes", msg.Data.OldValues["content"])
	assert.Equal(t, 39, msg.Data.ByteSize)
}

func TestParseDeleteMessageKeyOnly(t *testing.T) {
	p := NewParser()

	// Add relation with default replica identity
	relMsg := &pglogrepl.RelationMessage{
		RelationID:      16396,
		Namespace:       "public",
		RelationName:    "entries",
		ReplicaIdentity: 'd',
		Columns: []*pglogrepl.RelationMessageColumn{
			{Flags: 1, Name: "id", DataType: 2950, TypeModifier: -1},
			{Flags: 0, Name: "content", DataType: 1043, TypeModifier: 68},
		},
	}
	_, err := p.Parse(relMsg)
	require.NoError(t, err)

	// Parse delete with key only ('K' type)
	deleteMsg := &pglogrepl.DeleteMessage{
		RelationID:   16396,
		OldTupleType: pglogrepl.DeleteMessageTupleTypeKey,
		OldTuple: &pglogrepl.TupleData{
			Columns: []*pglogrepl.TupleDataColumn{
				{DataType: 't', Data: []byte("c0d731ca-0e72-4950-9499-8db83badb051")},
				{DataType: 'n'}, // NULL for non-key columns
			},
		},
	}

	msg, err := p.Parse(deleteMsg)
	require.NoError(t, err)

	assert.Equal(t, MessageDelete, msg.Type)
	assert.Nil(t, msg.Data.OldValues)
	assert.NotNil(t, msg.Data.ChangedKeyOldValues)

	assert.Equal(t, "c0d731ca-0e72-4950-9499-8db83badb051", msg.Data.ChangedKeyOldValues["id"])
	assert.Nil(t, msg.Data.ChangedKeyOldValues["content"])
}

func TestParseTruncateMessage(t *testing.T) {
	p := NewParser()

	truncateMsg := &pglogrepl.TruncateMessage{
		RelationNum: 2,
		Option:      3, // CASCADE | RESTART IDENTITY
		RelationIDs: []uint32{16396, 16400},
	}

	msg, err := p.Parse(truncateMsg)
	require.NoError(t, err)

	assert.Equal(t, MessageTruncate, msg.Type)
	assert.Equal(t, []uint32{16396, 16400}, msg.TruncateRelationIDs)
	assert.True(t, msg.TruncateCascade)
	assert.True(t, msg.TruncateRestartIdentity)
}

func TestParseTruncateMessageNoOptions(t *testing.T) {
	p := NewParser()

	truncateMsg := &pglogrepl.TruncateMessage{
		RelationNum: 1,
		Option:      0,
		RelationIDs: []uint32{16396},
	}

	msg, err := p.Parse(truncateMsg)
	require.NoError(t, err)

	assert.Equal(t, MessageTruncate, msg.Type)
	assert.Equal(t, []uint32{16396}, msg.TruncateRelationIDs)
	assert.False(t, msg.TruncateCascade)
	assert.False(t, msg.TruncateRestartIdentity)
}

func TestParseOriginMessage(t *testing.T) {
	p := NewParser()

	originMsg := &pglogrepl.OriginMessage{
		CommitLSN: pglogrepl.LSN(0x1735A68),
		Name:      "origin_name",
	}

	msg, err := p.Parse(originMsg)
	require.NoError(t, err)

	assert.Equal(t, MessageOrigin, msg.Type)
	assert.Equal(t, pglogrepl.LSN(0x1735A68), msg.LSN)
	assert.Equal(t, "origin_name", msg.OriginName)
}

func TestParseTypeMessage(t *testing.T) {
	p := NewParser()

	typeMsg := &pglogrepl.TypeMessage{
		DataType:  12345,
		Namespace: "public",
		Name:      "custom_type",
	}

	msg, err := p.Parse(typeMsg)
	require.NoError(t, err)

	assert.Equal(t, MessageType_, msg.Type)
	assert.NotNil(t, msg.TypeInfo)
	assert.Equal(t, uint32(12345), msg.TypeInfo.ID)
	assert.Equal(t, "public", msg.TypeInfo.Namespace)
	assert.Equal(t, "custom_type", msg.TypeInfo.Name)
}

func TestTupleDataWithNullValues(t *testing.T) {
	p := NewParser()

	// Add relation
	relMsg := &pglogrepl.RelationMessage{
		RelationID:      1,
		Namespace:       "public",
		RelationName:    "test",
		ReplicaIdentity: 'f',
		Columns: []*pglogrepl.RelationMessageColumn{
			{Flags: 1, Name: "id", DataType: 23, TypeModifier: -1},
			{Flags: 0, Name: "name", DataType: 25, TypeModifier: -1},
			{Flags: 0, Name: "value", DataType: 25, TypeModifier: -1},
		},
	}
	_, err := p.Parse(relMsg)
	require.NoError(t, err)

	// Insert with NULL values
	insertMsg := &pglogrepl.InsertMessage{
		RelationID: 1,
		Tuple: &pglogrepl.TupleData{
			Columns: []*pglogrepl.TupleDataColumn{
				{DataType: 't', Data: []byte("1")},
				{DataType: 'n'}, // NULL
				{DataType: 't', Data: []byte("test")},
			},
		},
	}

	msg, err := p.Parse(insertMsg)
	require.NoError(t, err)

	assert.Equal(t, "1", msg.Data.NewValues["id"])
	assert.Nil(t, msg.Data.NewValues["name"])
	assert.Equal(t, "test", msg.Data.NewValues["value"])
}

func TestTupleDataWithUnchangedTOAST(t *testing.T) {
	p := NewParser()

	// Add relation
	relMsg := &pglogrepl.RelationMessage{
		RelationID:      1,
		Namespace:       "public",
		RelationName:    "test",
		ReplicaIdentity: 'f',
		Columns: []*pglogrepl.RelationMessageColumn{
			{Flags: 1, Name: "id", DataType: 23, TypeModifier: -1},
			{Flags: 0, Name: "large_text", DataType: 25, TypeModifier: -1},
		},
	}
	_, err := p.Parse(relMsg)
	require.NoError(t, err)

	// Update with unchanged TOAST value
	updateMsg := &pglogrepl.UpdateMessage{
		RelationID: 1,
		NewTuple: &pglogrepl.TupleData{
			Columns: []*pglogrepl.TupleDataColumn{
				{DataType: 't', Data: []byte("1")},
				{DataType: 'u'}, // unchanged TOAST
			},
		},
	}

	msg, err := p.Parse(updateMsg)
	require.NoError(t, err)

	assert.Equal(t, "1", msg.Data.NewValues["id"])
	assert.True(t, IsUnchangedTOAST(msg.Data.NewValues["large_text"]))
}

func TestUnchangedTOASTString(t *testing.T) {
	toast := UnchangedTOAST{}
	assert.Equal(t, "<unchanged TOAST>", toast.String())
}

func TestClearRelations(t *testing.T) {
	p := NewParser()

	// Add a relation
	relMsg := &pglogrepl.RelationMessage{
		RelationID:      1,
		Namespace:       "public",
		RelationName:    "test",
		ReplicaIdentity: 'd',
		Columns:         []*pglogrepl.RelationMessageColumn{},
	}
	_, err := p.Parse(relMsg)
	require.NoError(t, err)
	assert.Equal(t, 1, p.RelationCount())

	// Clear relations
	p.ClearRelations()
	assert.Equal(t, 0, p.RelationCount())

	// Verify relation is gone
	_, ok := p.GetRelation(1)
	assert.False(t, ok)
}

func TestGetRelationNotFound(t *testing.T) {
	p := NewParser()

	rel, ok := p.GetRelation(12345)
	assert.False(t, ok)
	assert.Nil(t, rel)
}

func TestMultipleRelations(t *testing.T) {
	p := NewParser()

	// Add first relation
	rel1 := &pglogrepl.RelationMessage{
		RelationID:      1,
		Namespace:       "public",
		RelationName:    "users",
		ReplicaIdentity: 'd',
		Columns: []*pglogrepl.RelationMessageColumn{
			{Flags: 1, Name: "id", DataType: 23, TypeModifier: -1},
		},
	}
	_, err := p.Parse(rel1)
	require.NoError(t, err)

	// Add second relation
	rel2 := &pglogrepl.RelationMessage{
		RelationID:      2,
		Namespace:       "public",
		RelationName:    "posts",
		ReplicaIdentity: 'f',
		Columns: []*pglogrepl.RelationMessageColumn{
			{Flags: 1, Name: "id", DataType: 23, TypeModifier: -1},
			{Flags: 0, Name: "user_id", DataType: 23, TypeModifier: -1},
		},
	}
	_, err = p.Parse(rel2)
	require.NoError(t, err)

	assert.Equal(t, 2, p.RelationCount())

	// Verify both relations are accessible
	r1, ok := p.GetRelation(1)
	assert.True(t, ok)
	assert.Equal(t, "users", r1.Name)

	r2, ok := p.GetRelation(2)
	assert.True(t, ok)
	assert.Equal(t, "posts", r2.Name)
}

func TestReplicaIdentityTypes(t *testing.T) {
	p := NewParser()

	tests := []struct {
		identity byte
		expected ReplicaIdentity
	}{
		{'d', ReplicaIdentityDefault},
		{'n', ReplicaIdentityNothing},
		{'f', ReplicaIdentityFull},
		{'i', ReplicaIdentityIndex},
	}

	for i, tt := range tests {
		relMsg := &pglogrepl.RelationMessage{
			RelationID:      uint32(i + 100),
			Namespace:       "public",
			RelationName:    "test",
			ReplicaIdentity: tt.identity,
			Columns:         []*pglogrepl.RelationMessageColumn{},
		}

		msg, err := p.Parse(relMsg)
		require.NoError(t, err)
		assert.Equal(t, tt.expected, msg.Relation.ReplicaIdentity)
	}
}

func TestColumnKeyFlags(t *testing.T) {
	p := NewParser()

	relMsg := &pglogrepl.RelationMessage{
		RelationID:      1,
		Namespace:       "public",
		RelationName:    "test",
		ReplicaIdentity: 'd',
		Columns: []*pglogrepl.RelationMessageColumn{
			{Flags: 1, Name: "pk_col", DataType: 23, TypeModifier: -1},   // key
			{Flags: 0, Name: "data_col", DataType: 25, TypeModifier: -1}, // not key
			{Flags: 1, Name: "pk_col2", DataType: 23, TypeModifier: -1},  // key (composite PK)
		},
	}

	msg, err := p.Parse(relMsg)
	require.NoError(t, err)

	assert.True(t, msg.Relation.Columns[0].IsKey)
	assert.False(t, msg.Relation.Columns[1].IsKey)
	assert.True(t, msg.Relation.Columns[2].IsKey)
}

func TestEmptyTupleData(t *testing.T) {
	p := NewParser()

	// Add relation
	relMsg := &pglogrepl.RelationMessage{
		RelationID:      1,
		Namespace:       "public",
		RelationName:    "empty_table",
		ReplicaIdentity: 'f',
		Columns:         []*pglogrepl.RelationMessageColumn{},
	}
	_, err := p.Parse(relMsg)
	require.NoError(t, err)

	// Insert with empty tuple
	insertMsg := &pglogrepl.InsertMessage{
		RelationID: 1,
		Tuple: &pglogrepl.TupleData{
			Columns: []*pglogrepl.TupleDataColumn{},
		},
	}

	msg, err := p.Parse(insertMsg)
	require.NoError(t, err)
	assert.Empty(t, msg.Data.NewValues)
}

func TestNilTupleData(t *testing.T) {
	p := NewParser()

	// Add relation
	relMsg := &pglogrepl.RelationMessage{
		RelationID:      1,
		Namespace:       "public",
		RelationName:    "test",
		ReplicaIdentity: 'd',
		Columns: []*pglogrepl.RelationMessageColumn{
			{Flags: 1, Name: "id", DataType: 23, TypeModifier: -1},
		},
	}
	_, err := p.Parse(relMsg)
	require.NoError(t, err)

	// Delete with nil old tuple (shouldn't happen in practice, but handle gracefully)
	deleteMsg := &pglogrepl.DeleteMessage{
		RelationID: 1,
		OldTuple:   nil,
	}

	msg, err := p.Parse(deleteMsg)
	require.NoError(t, err)
	assert.Nil(t, msg.Data.OldValues)
	assert.Nil(t, msg.Data.ChangedKeyOldValues)
}

func TestTransactionLifecycle(t *testing.T) {
	p := NewParser()

	// Simulate a complete transaction
	commitTime := time.Now().UTC()

	// Begin
	beginMsg := &pglogrepl.BeginMessage{
		FinalLSN:   pglogrepl.LSN(1000),
		CommitTime: commitTime,
		Xid:        100,
	}
	begin, err := p.Parse(beginMsg)
	require.NoError(t, err)
	assert.Equal(t, MessageBegin, begin.Type)
	assert.Equal(t, uint32(100), begin.Xid)

	// Relation
	relMsg := &pglogrepl.RelationMessage{
		RelationID:      1,
		Namespace:       "public",
		RelationName:    "test",
		ReplicaIdentity: 'f',
		Columns: []*pglogrepl.RelationMessageColumn{
			{Flags: 1, Name: "id", DataType: 23, TypeModifier: -1},
			{Flags: 0, Name: "value", DataType: 25, TypeModifier: -1},
		},
	}
	_, err = p.Parse(relMsg)
	require.NoError(t, err)

	// Insert
	insertMsg := &pglogrepl.InsertMessage{
		RelationID: 1,
		Tuple: &pglogrepl.TupleData{
			Columns: []*pglogrepl.TupleDataColumn{
				{DataType: 't', Data: []byte("1")},
				{DataType: 't', Data: []byte("hello")},
			},
		},
	}
	insert, err := p.Parse(insertMsg)
	require.NoError(t, err)
	assert.Equal(t, MessageInsert, insert.Type)

	// Commit
	commitMsg := &pglogrepl.CommitMessage{
		CommitLSN:         pglogrepl.LSN(1000),
		TransactionEndLSN: pglogrepl.LSN(1100),
		CommitTime:        commitTime,
	}
	commit, err := p.Parse(commitMsg)
	require.NoError(t, err)
	assert.Equal(t, MessageCommit, commit.Type)
}

func TestBinaryDataType(t *testing.T) {
	p := NewParser()

	// Add relation
	relMsg := &pglogrepl.RelationMessage{
		RelationID:      1,
		Namespace:       "public",
		RelationName:    "test",
		ReplicaIdentity: 'f',
		Columns: []*pglogrepl.RelationMessageColumn{
			{Flags: 1, Name: "id", DataType: 23, TypeModifier: -1},
			{Flags: 0, Name: "data", DataType: 17, TypeModifier: -1}, // bytea
		},
	}
	_, err := p.Parse(relMsg)
	require.NoError(t, err)

	// Insert with binary data ('b' type)
	insertMsg := &pglogrepl.InsertMessage{
		RelationID: 1,
		Tuple: &pglogrepl.TupleData{
			Columns: []*pglogrepl.TupleDataColumn{
				{DataType: 't', Data: []byte("1")},
				{DataType: 'b', Data: []byte{0x01, 0x02, 0x03, 0x04}},
			},
		},
	}

	msg, err := p.Parse(insertMsg)
	require.NoError(t, err)

	// Binary data is converted to string
	assert.Equal(t, string([]byte{0x01, 0x02, 0x03, 0x04}), msg.Data.NewValues["data"])
}

func TestLargeDataValues(t *testing.T) {
	p := NewParser()

	// Add relation
	relMsg := &pglogrepl.RelationMessage{
		RelationID:      1,
		Namespace:       "public",
		RelationName:    "test",
		ReplicaIdentity: 'f',
		Columns: []*pglogrepl.RelationMessageColumn{
			{Flags: 1, Name: "id", DataType: 23, TypeModifier: -1},
			{Flags: 0, Name: "content", DataType: 25, TypeModifier: -1},
		},
	}
	_, err := p.Parse(relMsg)
	require.NoError(t, err)

	// Create large content
	largeContent := make([]byte, 100000)
	for i := range largeContent {
		largeContent[i] = byte('a' + (i % 26))
	}

	insertMsg := &pglogrepl.InsertMessage{
		RelationID: 1,
		Tuple: &pglogrepl.TupleData{
			Columns: []*pglogrepl.TupleDataColumn{
				{DataType: 't', Data: []byte("1")},
				{DataType: 't', Data: largeContent},
			},
		},
	}

	msg, err := p.Parse(insertMsg)
	require.NoError(t, err)

	assert.Equal(t, string(largeContent), msg.Data.NewValues["content"])
	assert.Equal(t, 100001, msg.Data.ByteSize) // 1 byte for id + 100000 for content
}

func TestManyColumns(t *testing.T) {
	p := NewParser()

	// Create relation with many columns
	numColumns := 50
	columns := make([]*pglogrepl.RelationMessageColumn, numColumns)
	tupleColumns := make([]*pglogrepl.TupleDataColumn, numColumns)

	for i := 0; i < numColumns; i++ {
		columns[i] = &pglogrepl.RelationMessageColumn{
			Flags:        0,
			Name:         "col_" + string(rune('a'+i%26)) + string(rune('0'+i/26)),
			DataType:     25,
			TypeModifier: -1,
		}
		if i == 0 {
			columns[i].Flags = 1 // first column is key
		}
		tupleColumns[i] = &pglogrepl.TupleDataColumn{
			DataType: 't',
			Data:     []byte("value_" + string(rune('a'+i%26))),
		}
	}

	relMsg := &pglogrepl.RelationMessage{
		RelationID:      1,
		Namespace:       "public",
		RelationName:    "wide_table",
		ReplicaIdentity: 'f',
		Columns:         columns,
	}
	_, err := p.Parse(relMsg)
	require.NoError(t, err)

	insertMsg := &pglogrepl.InsertMessage{
		RelationID: 1,
		Tuple: &pglogrepl.TupleData{
			Columns: tupleColumns,
		},
	}

	msg, err := p.Parse(insertMsg)
	require.NoError(t, err)

	assert.Len(t, msg.Data.NewValues, numColumns)
}

// Test that parser handles more tuple columns than relation columns gracefully
func TestMoreTupleColumnsThanRelation(t *testing.T) {
	p := NewParser()

	// Add relation with 2 columns
	relMsg := &pglogrepl.RelationMessage{
		RelationID:      1,
		Namespace:       "public",
		RelationName:    "test",
		ReplicaIdentity: 'f',
		Columns: []*pglogrepl.RelationMessageColumn{
			{Flags: 1, Name: "id", DataType: 23, TypeModifier: -1},
			{Flags: 0, Name: "value", DataType: 25, TypeModifier: -1},
		},
	}
	_, err := p.Parse(relMsg)
	require.NoError(t, err)

	// Insert with 3 columns (more than relation defines)
	insertMsg := &pglogrepl.InsertMessage{
		RelationID: 1,
		Tuple: &pglogrepl.TupleData{
			Columns: []*pglogrepl.TupleDataColumn{
				{DataType: 't', Data: []byte("1")},
				{DataType: 't', Data: []byte("test")},
				{DataType: 't', Data: []byte("extra")}, // This should be ignored
			},
		},
	}

	msg, err := p.Parse(insertMsg)
	require.NoError(t, err)

	// Only 2 columns should be present
	assert.Len(t, msg.Data.NewValues, 2)
	assert.Equal(t, "1", msg.Data.NewValues["id"])
	assert.Equal(t, "test", msg.Data.NewValues["value"])
}
