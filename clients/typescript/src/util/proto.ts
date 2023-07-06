import * as Pb from '../_generated/protocol/satellite'
import * as _m0 from 'protobufjs/minimal'
import { SatelliteError, SatelliteErrorCode } from './types'
import { ShapeRequest } from '../satellite/shapes/types'

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
