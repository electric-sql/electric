import * as Pb from '../_generated/protocol/satellite'
import * as _m0 from 'protobufjs/minimal'
import { SatelliteError, SatelliteErrorCode } from './types'
import { ShapeRequest } from '../satellite/shapes/types'
import { base64, typeDecoder } from './common'
import { getMaskBit } from './bitmaskHelpers'

type GetName<T extends { $type: string }> =
  T['$type'] extends `Electric.Satellite.v1_4.${infer K}` ? K : never
type MappingTuples = {
  [k in SatPbMsg as GetName<k>]: [number, SatPbMsgObj<k>]
}

const startReplicationErrorToSatError: Record<
  Pb.SatInStartReplicationResp_ReplicationError_Code,
  SatelliteErrorCode
> = {
  [Pb.SatInStartReplicationResp_ReplicationError_Code.CODE_UNSPECIFIED]:
    SatelliteErrorCode.INTERNAL,
  [Pb.SatInStartReplicationResp_ReplicationError_Code.UNRECOGNIZED]:
    SatelliteErrorCode.INTERNAL,
  [Pb.SatInStartReplicationResp_ReplicationError_Code.BEHIND_WINDOW]:
    SatelliteErrorCode.BEHIND_WINDOW,
  [Pb.SatInStartReplicationResp_ReplicationError_Code.INVALID_POSITION]:
    SatelliteErrorCode.INVALID_POSITION,
  [Pb.SatInStartReplicationResp_ReplicationError_Code.SUBSCRIPTION_NOT_FOUND]:
    SatelliteErrorCode.SUBSCRIPTION_NOT_FOUND,
  [Pb.SatInStartReplicationResp_ReplicationError_Code.MALFORMED_LSN]:
    SatelliteErrorCode.MALFORMED_LSN,
  [Pb.SatInStartReplicationResp_ReplicationError_Code.UNKNOWN_SCHEMA_VSN]:
    SatelliteErrorCode.UNKNOWN_SCHEMA_VSN,
}

const subsErrorToSatError: Record<
  Pb.SatSubsResp_SatSubsError_Code,
  SatelliteErrorCode
> = {
  [Pb.SatSubsResp_SatSubsError_Code.CODE_UNSPECIFIED]:
    SatelliteErrorCode.INTERNAL,
  [Pb.SatSubsResp_SatSubsError_Code.UNRECOGNIZED]: SatelliteErrorCode.INTERNAL,
  [Pb.SatSubsResp_SatSubsError_Code.SHAPE_REQUEST_ERROR]:
    SatelliteErrorCode.SHAPE_REQUEST_ERROR,
  [Pb.SatSubsResp_SatSubsError_Code.SUBSCRIPTION_ID_ALREADY_EXISTS]:
    SatelliteErrorCode.SUBSCRIPTION_ID_ALREADY_EXISTS,
}

const subsErrorShapeReqErrorToSatError: Record<
  Pb.SatSubsResp_SatSubsError_ShapeReqError_Code,
  SatelliteErrorCode
> = {
  [Pb.SatSubsResp_SatSubsError_ShapeReqError_Code.CODE_UNSPECIFIED]:
    SatelliteErrorCode.INTERNAL,
  [Pb.SatSubsResp_SatSubsError_ShapeReqError_Code.UNRECOGNIZED]:
    SatelliteErrorCode.INTERNAL,
  [Pb.SatSubsResp_SatSubsError_ShapeReqError_Code.TABLE_NOT_FOUND]:
    SatelliteErrorCode.TABLE_NOT_FOUND,
  [Pb.SatSubsResp_SatSubsError_ShapeReqError_Code
    .REFERENTIAL_INTEGRITY_VIOLATION]:
    SatelliteErrorCode.REFERENTIAL_INTEGRITY_VIOLATION,
  [Pb.SatSubsResp_SatSubsError_ShapeReqError_Code.EMPTY_SHAPE_DEFINITION]:
    SatelliteErrorCode.EMPTY_SHAPE_DEFINITION,
  [Pb.SatSubsResp_SatSubsError_ShapeReqError_Code
    .DUPLICATE_TABLE_IN_SHAPE_DEFINITION]:
    SatelliteErrorCode.DUPLICATE_TABLE_IN_SHAPE_DEFINITION,
}

const subsDataErrorToSatError: Record<
  Pb.SatSubsDataError_Code,
  SatelliteErrorCode
> = {
  [Pb.SatSubsDataError_Code.CODE_UNSPECIFIED]: SatelliteErrorCode.INTERNAL,
  [Pb.SatSubsDataError_Code.UNRECOGNIZED]: SatelliteErrorCode.INTERNAL,
  [Pb.SatSubsDataError_Code.SHAPE_DELIVERY_ERROR]:
    SatelliteErrorCode.SHAPE_DELIVERY_ERROR,
}

const subsDataErrorShapeReqToSatError: Record<
  Pb.SatSubsDataError_ShapeReqError_Code,
  SatelliteErrorCode
> = {
  [Pb.SatSubsDataError_ShapeReqError_Code.CODE_UNSPECIFIED]:
    SatelliteErrorCode.INTERNAL,
  [Pb.SatSubsDataError_ShapeReqError_Code.UNRECOGNIZED]:
    SatelliteErrorCode.INTERNAL,
  [Pb.SatSubsDataError_ShapeReqError_Code.SHAPE_SIZE_LIMIT_EXCEEDED]:
    SatelliteErrorCode.SHAPE_SIZE_LIMIT_EXCEEDED,
}

// NOTE: This mapping should be kept in sync with Electric message mapping.
// Take into account that this mapping is dependent on the protobuf
// protocol version.
const msgtypetuples: MappingTuples = {
  SatErrorResp: [0, Pb.SatErrorResp],
  SatAuthReq: [1, Pb.SatAuthReq],
  SatAuthResp: [2, Pb.SatAuthResp],
  SatPingReq: [3, Pb.SatPingReq],
  SatPingResp: [4, Pb.SatPingResp],
  SatInStartReplicationReq: [5, Pb.SatInStartReplicationReq],
  SatInStartReplicationResp: [6, Pb.SatInStartReplicationResp],
  SatInStopReplicationReq: [7, Pb.SatInStopReplicationReq],
  SatInStopReplicationResp: [8, Pb.SatInStopReplicationResp],
  SatOpLog: [9, Pb.SatOpLog],
  SatRelation: [10, Pb.SatRelation],
  SatMigrationNotification: [11, Pb.SatMigrationNotification],
  SatSubsReq: [12, Pb.SatSubsReq],
  SatSubsResp: [13, Pb.SatSubsResp],
  SatSubsDataError: [14, Pb.SatSubsDataError],
  SatSubsDataBegin: [15, Pb.SatSubsDataBegin],
  SatSubsDataEnd: [16, Pb.SatSubsDataEnd],
  SatShapeDataBegin: [17, Pb.SatShapeDataBegin],
  SatShapeDataEnd: [18, Pb.SatShapeDataEnd],
  SatUnsubsReq: [19, Pb.SatUnsubsReq],
  SatUnsubsResp: [20, Pb.SatUnsubsResp],
}

const msgtypemapping = Object.fromEntries(
  Object.entries(msgtypetuples).map((e) => [getFullTypeName(e[0]), e[1]])
)

const codemapping = Object.fromEntries(
  Object.entries(msgtypetuples).map((e) => [e[1][0], getFullTypeName(e[0])])
)

export type SatPbMsg =
  | Pb.SatErrorResp
  | Pb.SatAuthReq
  | Pb.SatAuthResp
  | Pb.SatPingReq
  | Pb.SatPingResp
  | Pb.SatInStartReplicationReq
  | Pb.SatInStartReplicationResp
  | Pb.SatInStopReplicationReq
  | Pb.SatInStopReplicationResp
  | Pb.SatOpLog
  | Pb.SatRelation
  | Pb.SatMigrationNotification
  | Pb.SatSubsReq
  | Pb.SatSubsResp
  | Pb.SatSubsDataError
  | Pb.SatSubsDataBegin
  | Pb.SatSubsDataEnd
  | Pb.SatShapeDataBegin
  | Pb.SatShapeDataEnd
  | Pb.SatUnsubsReq
  | Pb.SatUnsubsResp

export type SatPbMsgObj<Msg extends SatPbMsg, Part = Pb.DeepPartial<Msg>> = {
  $type: Msg['$type']
  encode(message: Msg, writer: _m0.Writer): _m0.Writer
  decode(input: _m0.Reader | Uint8Array, length?: number): Msg
  fromPartial<I extends Pb.Exact<Part, I>>(object: I): Msg
}

export function getMsgType(msg: SatPbMsg): number {
  const mapping = msgtypemapping[msg.$type]
  if (mapping) {
    return mapping[0]
  }
  return 0
}

export function getTypeFromCode(code: number): string {
  return codemapping[code] ?? ''
}

export function getTypeFromString(string_type: string): number | undefined {
  return msgtypemapping[string_type]?.[0]
}

export function getObjFromString<K extends SatPbMsg['$type']>(
  string_type: K
): SatPbMsgObj<Extract<SatPbMsg, { $type: K }>>
export function getObjFromString(
  string_type: string
): MappingTuples[keyof MappingTuples][1] | undefined
export function getObjFromString(string_type: string): any {
  return msgtypemapping[string_type]?.[1]
}

export function getSizeBuf(msg_type: SatPbMsg) {
  const msgtype = getMsgType(msg_type)

  const buf = new Uint8Array(1)
  buf.set([msgtype], 0)
  return buf
}

export function getProtocolVersion(): string {
  return Pb.protobufPackage
}

export function getFullTypeName(message: string): string {
  return getProtocolVersion() + '.' + message
}

export function startReplicationErrorToSatelliteError(
  error: Pb.SatInStartReplicationResp_ReplicationError
): SatelliteError {
  return new SatelliteError(
    startReplicationErrorToSatError[error.code],
    error.message
  )
}

export function subsErrorToSatelliteError({
  shapeRequestError,
  code,
  message,
}: Pb.SatSubsResp_SatSubsError): SatelliteError {
  if (shapeRequestError.length > 0) {
    const shapeErrorMsgs = shapeRequestError
      .map(subsShapeReqErrorToSatelliteError)
      .map((e) => e.message)
      .join('; ')
    const composed = `subscription error message: ${message}; shape error messages: ${shapeErrorMsgs}`
    return new SatelliteError(subsErrorToSatError[code], composed)
  }
  return new SatelliteError(subsErrorToSatError[code], message)
}

export function subsShapeReqErrorToSatelliteError(
  error: Pb.SatSubsResp_SatSubsError_ShapeReqError
): SatelliteError {
  return new SatelliteError(
    subsErrorShapeReqErrorToSatError[error.code],
    error.message
  )
}

export function subsDataErrorToSatelliteError({
  shapeRequestError,
  code,
  message,
}: Pb.SatSubsDataError): SatelliteError {
  if (shapeRequestError.length > 0) {
    const shapeErrorMsgs = shapeRequestError
      .map(subsDataShapeErrorToSatelliteError)
      .map((e) => e.message)
      .join('; ')
    const composed = `subscription data error message: ${message}; shape error messages: ${shapeErrorMsgs}`
    return new SatelliteError(subsDataErrorToSatError[code], composed)
  }
  return new SatelliteError(subsDataErrorToSatError[code], message)
}

export function subsDataShapeErrorToSatelliteError(
  error: Pb.SatSubsDataError_ShapeReqError
): SatelliteError {
  return new SatelliteError(
    subsDataErrorShapeReqToSatError[error.code],
    error.message
  )
}

export function shapeRequestToSatShapeReq(
  shapeRequests: ShapeRequest[]
): Pb.SatShapeReq[] {
  const shapeReqs: Pb.SatShapeReq[] = []
  for (const sr of shapeRequests) {
    const requestId = sr.requestId
    const selects = sr.definition.selects.map((s) => ({
      tablename: s.tablename,
    }))
    const shapeDefinition = { selects }

    const req = Pb.SatShapeReq.fromPartial({
      requestId,
      shapeDefinition,
    })
    shapeReqs.push(req)
  }
  return shapeReqs
}

export function msgToString(message: SatPbMsg): string {
  switch (message.$type) {
    case 'Electric.Satellite.v1_4.SatAuthReq':
      return `#SatAuthReq{id: ${message.id}, token: ${message.token}}`
    case 'Electric.Satellite.v1_4.SatAuthResp':
      return `#SatAuthResp{id: ${message.id}}`
    case 'Electric.Satellite.v1_4.SatErrorResp':
      return `#SatErrorResp{type: ${
        Pb.SatErrorResp_ErrorCode[message.errorType]
      }}`
    case 'Electric.Satellite.v1_4.SatInStartReplicationReq': {
      const schemaVersion = message.schemaVersion
        ? ` schema: ${message.schemaVersion},`
        : ''
      return `#SatInStartReplicationReq{lsn: ${base64.fromBytes(
        message.lsn
      )},${schemaVersion} subscriptions: [${message.subscriptionIds}]}`
    }
    case 'Electric.Satellite.v1_4.SatInStartReplicationResp':
      return `#SatInStartReplicationResp{${
        message.err
          ? '`' + startReplicationErrorToSatelliteError(message.err) + '`'
          : ''
      }}`
    case 'Electric.Satellite.v1_4.SatInStopReplicationReq':
      return `#SatInStopReplicationReq{}`
    case 'Electric.Satellite.v1_4.SatInStopReplicationResp':
      return `#SatInStopReplicationResp{}`
    case 'Electric.Satellite.v1_4.SatMigrationNotification':
      return `#SatMigrationNotification{to: ${message.newSchemaVersion}, from: ${message.newSchemaVersion}}`
    case 'Electric.Satellite.v1_4.SatPingReq':
      return `#SatPingReq{}`
    case 'Electric.Satellite.v1_4.SatPingResp':
      return `#SatPingResp{lsn: ${
        message.lsn ? base64.fromBytes(message.lsn) : 'NULL'
      }}`
    case 'Electric.Satellite.v1_4.SatRelation': {
      const cols = message.columns
        .map((x) => `${x.name}: ${x.type}${x.primaryKey ? ' PK' : ''}`)
        .join(', ')
      return `#SatRelation{for: ${message.schemaName}.${message.tableName}, as: ${message.relationId}, cols: [${cols}]}`
    }
    case 'Electric.Satellite.v1_4.SatSubsDataBegin':
      return `#SatSubsDataBegin{id: ${
        message.subscriptionId
      }, lsn: ${base64.fromBytes(message.lsn)}}`
    case 'Electric.Satellite.v1_4.SatSubsDataEnd':
      return `#SatSubsDataEnd{}`
    case 'Electric.Satellite.v1_4.SatShapeDataBegin':
      return `#SatShapeDataBegin{id: ${message.requestId}}`
    case 'Electric.Satellite.v1_4.SatShapeDataEnd':
      return `#SatShapeDataEnd{}`
    case 'Electric.Satellite.v1_4.SatSubsDataError': {
      const shapeErrors = message.shapeRequestError.map(
        (x) =>
          `${x.requestId}: ${Pb.SatSubsDataError_ShapeReqError_Code[x.code]} (${
            x.message
          })`
      )
      const code = Pb.SatSubsDataError_Code[message.code]
      return `#SatSubsDataError{id: ${message.subscriptionId}, code: ${code}, msg: "${message.message}", errors: [${shapeErrors}]}`
    }
    case 'Electric.Satellite.v1_4.SatSubsReq':
      return `#SatSubsReq{id: ${
        message.subscriptionId
      }, shapes: ${JSON.stringify(message.shapeRequests)}}`
    case 'Electric.Satellite.v1_4.SatSubsResp': {
      if (message.err) {
        const shapeErrors = message.err.shapeRequestError.map(
          (x) =>
            `${x.requestId}: ${
              Pb.SatSubsResp_SatSubsError_ShapeReqError_Code[x.code]
            } (${x.message})`
        )
        return `#SatSubsReq{id: ${message.subscriptionId}, err: ${
          Pb.SatSubsResp_SatSubsError_Code[message.err.code]
        } (${message.err.message}), shapes: [${shapeErrors}]}`
      } else {
        return `#SatSubsReq{id: ${message.subscriptionId}}`
      }
    }
    case 'Electric.Satellite.v1_4.SatUnsubsReq':
      return `#SatUnsubsReq{ids: ${message.subscriptionIds}}`
    case 'Electric.Satellite.v1_4.SatUnsubsResp':
      return `#SatUnsubsResp{}`
    case 'Electric.Satellite.v1_4.SatOpLog':
      return `#SatOpLog{ops: [${message.ops.map(opToString).join(', ')}]}`
  }
}

function opToString(op: Pb.SatTransOp): string {
  if (op.begin)
    return `#Begin{lsn: ${base64.fromBytes(
      op.begin.lsn
    )}, ts: ${op.begin.commitTimestamp.toString()}, isMigration: ${
      op.begin.isMigration
    }}`
  if (op.commit) return `#Commit{lsn: ${base64.fromBytes(op.commit.lsn)}}`
  if (op.insert)
    return `#Insert{for: ${op.insert.relationId}, tags: [${
      op.insert.tags
    }], new: [${op.insert.rowData ? rowToString(op.insert.rowData) : ''}]}`
  if (op.update)
    return `#Update{for: ${op.update.relationId}, tags: [${
      op.update.tags
    }], new: [${
      op.update.rowData ? rowToString(op.update.rowData) : ''
    }], old: data: [${
      op.update.oldRowData ? rowToString(op.update.oldRowData) : ''
    }]}`
  if (op.delete)
    return `#Delete{for: ${op.delete.relationId}, tags: [${
      op.delete.tags
    }], old: [${
      op.delete.oldRowData ? rowToString(op.delete.oldRowData) : ''
    }]}`
  if (op.migrate)
    return `#Migrate{vsn: ${op.migrate.version}, for: ${
      op.migrate.table?.name
    }, stmts: [${op.migrate.stmts
      .map((x) => x.sql.replaceAll('\n', '\\n'))
      .join('; ')}]}`
  return ''
}

function rowToString(row: Pb.SatOpRow): string {
  return row.values
    .map((x, i) =>
      getMaskBit(row.nullsBitmask, i) == 0
        ? JSON.stringify(typeDecoder.text(x))
        : '∅'
    )
    .join(', ')
}
