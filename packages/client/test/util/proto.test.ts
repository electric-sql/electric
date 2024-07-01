import test from 'ava'
import * as proto from '../../src/util/proto'
import { ShapeRequest } from '../../src/satellite/shapes/types'

test('shapeRequestToSatShapeReq: correctly converts a nested request', (t) => {
  const shapeReq: ShapeRequest = {
    requestId: 'fake_id',
    definition: {
      tablename: 'fake',
      include: [
        { foreignKey: ['fake_table_id'], select: { tablename: 'other' } },
      ],
    },
  }

  const req = proto.shapeRequestToSatShapeReq([shapeReq])

  t.is(req.length, 1)
  t.is(req[0].requestId, 'fake_id')
  t.assert(req[0].shapeDefinition !== undefined)
  const { selects } = req[0].shapeDefinition!

  t.is(selects.length, 1)
  t.like(selects[0], {
    tablename: 'fake',
    include: [
      {
        $type: 'Electric.Satellite.SatShapeDef.Relation',
        foreignKey: ['fake_table_id'],
        select: {
          $type: 'Electric.Satellite.SatShapeDef.Select',
          include: [],
          tablename: 'other',
          where: '',
        },
      },
    ],
  })
})
