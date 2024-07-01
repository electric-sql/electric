import anyTest, { ExecutionContext, TestFn } from 'ava'
import keyBy from 'lodash.keyby'
import {
  KeyedTables,
  createDbDescription,
  createRelationsFromAllTables,
  createRelationsFromTable,
} from '../../../src/client/util/relations'
import {
  SatOpMigrate_Column,
  SatOpMigrate_ForeignKey,
  SatOpMigrate_Table,
} from '../../../src/_generated/protocol/satellite'
import { Relation } from '../../../src/client/model'

type Tables = {
  otherTable: SatOpMigrate_Table
  fooTable: SatOpMigrate_Table
  itemsTable: SatOpMigrate_Table
  tables: SatOpMigrate_Table[]
}

type Ctx = ExecutionContext<Tables>

const test = anyTest as TestFn<Tables>

test.beforeEach(async (t) => {
  const otherTable: SatOpMigrate_Table = {
    $type: 'Electric.Satellite.SatOpMigrate.Table',
    name: 'other',
    columns: [
      {
        $type: 'Electric.Satellite.SatOpMigrate.Column',
        name: 'other_id',
        sqliteType: 'TEXT',
        pgType: {
          $type: 'Electric.Satellite.SatOpMigrate.PgColumnType',
          name: 'text',
          array: [],
          size: [],
        },
      },
    ],
    fks: [],
    pks: ['other_id'],
  }

  const fooTable: SatOpMigrate_Table = {
    $type: 'Electric.Satellite.SatOpMigrate.Table',
    name: 'foo',
    columns: [
      {
        $type: 'Electric.Satellite.SatOpMigrate.Column',
        name: 'foo_id',
        sqliteType: 'TEXT',
        pgType: {
          $type: 'Electric.Satellite.SatOpMigrate.PgColumnType',
          name: 'text',
          array: [],
          size: [],
        },
      },
      {
        $type: 'Electric.Satellite.SatOpMigrate.Column',
        name: 'otherr',
        sqliteType: 'TEXT',
        pgType: {
          $type: 'Electric.Satellite.SatOpMigrate.PgColumnType',
          name: 'text',
          array: [],
          size: [],
        },
      },
    ],
    fks: [
      {
        $type: 'Electric.Satellite.SatOpMigrate.ForeignKey',
        fkCols: ['otherr'],
        pkTable: 'other',
        pkCols: ['other_id'],
      },
    ],
    pks: ['foo_id'],
  }

  const itemsTable: SatOpMigrate_Table = {
    $type: 'Electric.Satellite.SatOpMigrate.Table',
    name: 'items',
    columns: [
      {
        $type: 'Electric.Satellite.SatOpMigrate.Column',
        name: 'items_id',
        sqliteType: 'TEXT',
        pgType: {
          $type: 'Electric.Satellite.SatOpMigrate.PgColumnType',
          name: 'text',
          array: [],
          size: [],
        },
      },
      {
        $type: 'Electric.Satellite.SatOpMigrate.Column',
        name: 'other_id1',
        sqliteType: 'TEXT',
        pgType: {
          $type: 'Electric.Satellite.SatOpMigrate.PgColumnType',
          name: 'text',
          array: [],
          size: [],
        },
      },
      {
        $type: 'Electric.Satellite.SatOpMigrate.Column',
        name: 'other_id2',
        sqliteType: 'TEXT',
        pgType: {
          $type: 'Electric.Satellite.SatOpMigrate.PgColumnType',
          name: 'text',
          array: [],
          size: [],
        },
      },
    ],
    fks: [
      {
        $type: 'Electric.Satellite.SatOpMigrate.ForeignKey',
        fkCols: ['other_id1'],
        pkTable: 'other',
        pkCols: ['other_id'],
      },
      {
        $type: 'Electric.Satellite.SatOpMigrate.ForeignKey',
        fkCols: ['other_id2'],
        pkTable: 'other',
        pkCols: ['other_id'],
      },
    ],
    pks: ['items_id'],
  }

  const tables = [otherTable, fooTable, itemsTable]

  t.context = { otherTable, fooTable, itemsTable, tables }
})

test('createRelationsFromTable creates no relations on table without FKs', (t: Ctx) => {
  const { tables, otherTable } = t.context
  const keyedTables: KeyedTables = keyBy(tables, 'name')
  const relations = createRelationsFromTable(otherTable, keyedTables)
  t.assert(relations.size === 0, 'Expected no relations on table without FKs')
})

/*
 * When a child table has a FK to a parent table
 * we create a relation from the child table to the parent table
 * and we also create the reserve relation from the parent table to the child table.
 * The reverse relation is needed to be able to
 * follow the relation in both directions.
 *
 * If there is only a single relation from the child table to the parent table
 * then that relation is named after the parent table (except if there is already a column with that name).
 * Similarly, if there is only a single relation from the parent table to the child table
 * then that relation is named after the child table (except if there is already a column with that name).
 */
test('createRelationsFromTable creates two relations on table with one FK', (t: Ctx) => {
  const { tables, fooTable } = t.context
  const keyedTables: KeyedTables = keyBy(tables, 'name')
  const relations = createRelationsFromTable(fooTable, keyedTables)

  // Expect two relations
  // one for forward direction
  // and one for backward direction
  t.assert(relations.size === 2, 'Expected two relations on table with one FK')

  // Check forward relation
  const relation = relations.get('foo')
  t.assert(
    relation && relation.length === 1,
    'Expected one relation on table with one outgoing FK'
  )

  const [rel] = relation!
  t.deepEqual(
    rel,
    new Relation('other', 'otherr', 'other_id', 'other', 'foo_otherrToother'),
    'Expected relation to be created correctly'
  )

  // Check backward relation
  const backwardRelation = relations.get('other')
  t.assert(
    backwardRelation && backwardRelation.length === 1,
    'Expected one relation for table with an incoming FK'
  )

  const [backRel] = backwardRelation!
  t.deepEqual(
    backRel,
    new Relation('foo', '', '', 'foo', 'foo_otherrToother'),
    'Expected relation to be created correctly'
  )
})

/*
 * This test checks that if there is a single relation from the child table to the parent table
 * but the child table has a column named after the parent table, than a unique relation field name is used.
 */
test('createRelationsFromTable makes long relation field name if child column is named after parent table', (t: Ctx) => {
  const { tables, fooTable } = t.context

  // Name the child column after the parent table
  fooTable.columns[1].name = 'other'
  fooTable.fks[0].fkCols[0] = 'other'

  const keyedTables: KeyedTables = keyBy(tables, 'name')
  const relations = createRelationsFromTable(fooTable, keyedTables)

  // Expect two relations
  // one for forward direction
  // and one for backward direction
  t.assert(relations.size === 2, 'Expected two relations on table with one FK')

  // Check forward relation
  const relation = relations.get('foo')
  t.assert(
    relation && relation.length === 1,
    'Expected one relation on table with one outgoing FK'
  )

  const [rel] = relation!
  t.deepEqual(
    rel,
    new Relation(
      'other_foo_otherToother',
      'other',
      'other_id',
      'other',
      'foo_otherToother'
    ),
    'Expected relation to be created correctly'
  )

  // Check backward relation
  const backwardRelation = relations.get('other')
  t.assert(
    backwardRelation && backwardRelation.length === 1,
    'Expected one relation for table with an incoming FK'
  )

  const [backRel] = backwardRelation!
  t.deepEqual(
    backRel,
    new Relation('foo', '', '', 'foo', 'foo_otherToother'),
    'Expected relation to be created correctly'
  )
})

/*
 * This test checks that if there is a single relation from the child table to the parent table
 * and no relation from the parent table to the child table
 * but the parent table has a column named after the child table,
 * than a unique relation field name is used for the reverse relation.
 */
test('createRelationsFromTable makes long relation field name if parent column is named after child table', (t: Ctx) => {
  const { tables, fooTable, otherTable } = t.context
  // Name the parent column after the child table
  otherTable.columns[0].name = 'foo'
  otherTable.pks[0] = 'foo'
  fooTable.fks[0].pkCols[0] = 'foo'

  const keyedTables: KeyedTables = keyBy(tables, 'name')
  const relations = createRelationsFromTable(fooTable, keyedTables)

  // Expect two relations
  // one for forward direction
  // and one for backward direction
  t.assert(relations.size === 2, 'Expected two relations on table with one FK')

  // Check forward relation
  const relation = relations.get('foo')
  t.assert(
    relation && relation.length === 1,
    'Expected one relation on table with one outgoing FK'
  )

  const [rel] = relation!
  t.deepEqual(
    rel,
    new Relation('other', 'otherr', 'foo', 'other', 'foo_otherrToother'),
    'Expected relation to be created correctly'
  )

  // Check backward relation
  const backwardRelation = relations.get('other')
  t.assert(
    backwardRelation && backwardRelation.length === 1,
    'Expected one relation for table with an incoming FK'
  )

  const [backRel] = backwardRelation!
  t.deepEqual(
    backRel,
    new Relation('foo_foo_otherrToother', '', '', 'foo', 'foo_otherrToother'),
    'Expected relation to be created correctly'
  )
})

/*
 * If there are multiple relations from the child table to the parent table
 * than we need to create unique relation field names for each relation.
 */
test('createRelationsFromTable makes long relation field name if several FKs are pointing to same parent table', (t: Ctx) => {
  const { tables, itemsTable } = t.context
  const keyedTables: KeyedTables = keyBy(tables, 'name')
  const relations = createRelationsFromTable(itemsTable, keyedTables)

  // Check forward relations
  const relation = relations.get('items')
  t.assert(
    relation && relation.length === 2,
    'Expected two relations on table with two outgoing FKs'
  )

  const [rel1, rel2] = relation!
  t.deepEqual(
    rel1,
    new Relation(
      'other_items_other_id1Toother',
      'other_id1',
      'other_id',
      'other',
      'items_other_id1Toother'
    ),
    'Expected relation to be created correctly'
  )
  t.deepEqual(
    rel2,
    new Relation(
      'other_items_other_id2Toother',
      'other_id2',
      'other_id',
      'other',
      'items_other_id2Toother'
    ),
    'Expected relation to be created correctly'
  )

  // Check backward relations
  const backwardRelation = relations.get('other')
  t.assert(
    backwardRelation && backwardRelation.length === 2,
    'Expected two relations for table with an incoming FK'
  )

  const [backRel1, backRel2] = backwardRelation!
  t.deepEqual(
    backRel1,
    new Relation(
      'items_items_other_id1Toother',
      '',
      '',
      'items',
      'items_other_id1Toother'
    ),
    'Expected relation to be created correctly'
  )
  t.deepEqual(
    backRel2,
    new Relation(
      'items_items_other_id2Toother',
      '',
      '',
      'items',
      'items_other_id2Toother'
    ),
    'Expected relation to be created correctly'
  )
})

/*
 * If we are creating a relation for a FK pointing from child table to the parent table
 * and the parent table also has a FK from parent to child table
 * then there are 2 possible ways to go from parent to child table
 *   1. Follow the FK from parent to child table
 *   2. Follow the FK from child to parent table in reverse direction
 * To avoid this ambiguity, we introduce unique relation field names
 * This test checks that this case is detected and a unique name is constructed
 */
test('createRelationsFromTable makes long relation field name if parent table has a FK to the child table', (t: Ctx) => {
  const { tables, fooTable, otherTable } = t.context

  // Extend the parent table `other` with a FK to the child table `foo`
  const f_id_col_pointing_to_foo: SatOpMigrate_Column = {
    $type: 'Electric.Satellite.SatOpMigrate.Column',
    name: 'f_id',
    sqliteType: 'TEXT',
    pgType: {
      $type: 'Electric.Satellite.SatOpMigrate.PgColumnType',
      name: 'text',
      array: [],
      size: [],
    },
  }

  const fk: SatOpMigrate_ForeignKey = {
    $type: 'Electric.Satellite.SatOpMigrate.ForeignKey',
    fkCols: ['f_id'],
    pkTable: 'foo',
    pkCols: ['foo_id'],
  }

  otherTable.columns.push(f_id_col_pointing_to_foo)
  otherTable.fks.push(fk)

  // Generate relations from the FKs of the `foo` table
  const keyedTables: KeyedTables = keyBy(tables, 'name')
  const relations = createRelationsFromTable(fooTable, keyedTables)

  // Check forward relation
  const relation = relations.get('foo')
  t.assert(
    relation && relation.length === 1,
    'Expected one relation on table with one outgoing FK'
  )

  const [rel] = relation!
  t.deepEqual(
    rel,
    new Relation(
      'other_foo_otherrToother',
      'otherr',
      'other_id',
      'other',
      'foo_otherrToother'
    ),
    'Expected relation to be created correctly'
  )

  // Check backward relation
  const backwardRelation = relations.get('other')
  t.assert(
    backwardRelation && backwardRelation.length === 1,
    'Expected one relation for table with an incoming FK'
  )

  const [backRel] = backwardRelation!
  t.deepEqual(
    backRel,
    new Relation('foo_foo_otherrToother', '', '', 'foo', 'foo_otherrToother'),
    'Expected relation to be created correctly'
  )
})

test('createRelationsFromAllTables aggregates all relations', (t: Ctx) => {
  const { tables } = t.context
  const relations = createRelationsFromAllTables(tables)

  t.deepEqual(
    relations,
    new Map([
      [
        'foo',
        [
          new Relation(
            'other',
            'otherr',
            'other_id',
            'other',
            'foo_otherrToother'
          ),
        ],
      ],
      [
        'other',
        [
          new Relation('foo', '', '', 'foo', 'foo_otherrToother'),
          new Relation(
            'items_items_other_id1Toother',
            '',
            '',
            'items',
            'items_other_id1Toother'
          ),
          new Relation(
            'items_items_other_id2Toother',
            '',
            '',
            'items',
            'items_other_id2Toother'
          ),
        ],
      ],
      [
        'items',
        [
          new Relation(
            'other_items_other_id1Toother',
            'other_id1',
            'other_id',
            'other',
            'items_other_id1Toother'
          ),
          new Relation(
            'other_items_other_id2Toother',
            'other_id2',
            'other_id',
            'other',
            'items_other_id2Toother'
          ),
        ],
      ],
    ])
  )
})

test('createDbDescription creates a DbSchema from tables', (t: Ctx) => {
  const { tables } = t.context
  const dbDescription = createDbDescription(tables)
  t.deepEqual(dbDescription, {
    foo: {
      fields: {
        foo_id: 'TEXT',
        otherr: 'TEXT',
      },
      relations: [
        new Relation(
          'other',
          'otherr',
          'other_id',
          'other',
          'foo_otherrToother'
        ),
      ],
    },
    other: {
      fields: { other_id: 'TEXT' },
      relations: [
        new Relation('foo', '', '', 'foo', 'foo_otherrToother'),
        new Relation(
          'items_items_other_id1Toother',
          '',
          '',
          'items',
          'items_other_id1Toother'
        ),
        new Relation(
          'items_items_other_id2Toother',
          '',
          '',
          'items',
          'items_other_id2Toother'
        ),
      ],
    },
    items: {
      fields: {
        items_id: 'TEXT',
        other_id1: 'TEXT',
        other_id2: 'TEXT',
      },
      relations: [
        new Relation(
          'other_items_other_id1Toother',
          'other_id1',
          'other_id',
          'other',
          'items_other_id1Toother'
        ),
        new Relation(
          'other_items_other_id2Toother',
          'other_id2',
          'other_id',
          'other',
          'items_other_id2Toother'
        ),
      ],
    },
  })
})
