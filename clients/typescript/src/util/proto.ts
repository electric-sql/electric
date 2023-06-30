import * as Pb from '../_generated/protocol/satellite'
import * as _m0 from 'protobufjs/minimal'
import { SatelliteError, SatelliteErrorCode } from './types'
import { ShapeRequest } from '../satellite/shapes/types'

type GetName<T extends { $type: string }> =
  T['$type'] extends `Electric.Satellite.v1_4.${infer K}` ? K : never
type MappingTuples = {
  [k in SatPbMsg as GetName<k>]: [number, SatPbMsgObj<k>]
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
  SatSubsError: [14, Pb.SatSubsError],
  SatSubsDataBegin: [15, Pb.SatSubsDataBegin],
  SatSubsDataEnd: [16, Pb.SatSubsDataEnd],
  SatShapeDataBegin: [17, Pb.SatShapeDataBegin],
  SatShapeDataEnd: [18, Pb.SatShapeDataEnd],
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
  | Pb.SatSubsError
  | Pb.SatSubsDataBegin
  | Pb.SatSubsDataEnd
  | Pb.SatShapeDataBegin
  | Pb.SatShapeDataEnd

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
) {
  switch (error.code) {
    case Pb.SatInStartReplicationResp_ReplicationError_Code.BEHIND_WINDOW:
      return new SatelliteError(SatelliteErrorCode.BEHIND_WINDOW, error.message)
    default:
      return new SatelliteError(
        SatelliteErrorCode.INTERNAL,
        `unexpected mapping for error: ${error.message}`
      )
  }
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
