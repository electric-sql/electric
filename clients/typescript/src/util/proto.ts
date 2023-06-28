import * as Pb from '../_generated/protocol/satellite'
import * as _m0 from 'protobufjs/minimal'
import { SatelliteError, SatelliteErrorCode, ShapeRequest } from './types'

// FIXME
// type GetName<T extends { $type: string }> =
// T['$type'] extends `Electric.Satellite.v1_3.${infer K}` ? K : never

//  FIXME
//  type MappingTuples = {
//  [k in SatPbMsg as GetName<k>]: [number, SatPbMsgObj<k['$type']>]
//  }

// NOTE: This mapping should be kept in sync with Electric message mapping.
// Take into account that this mapping is dependent on the protobuf
// protocol version.
const msgtypetuples: any = {
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
  // FIXME
  // Object.entries(msgtypetuples).map((e) => [e[1][0], getFullTypeName(e[0])])
  Object.entries(msgtypetuples).map((e) => [
    (e as any)[1][0],
    getFullTypeName(e[0]),
  ])
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

export type SatPbMsgObj<Type extends string = string> = {
  $type: Type
  encode(message: SatPbMsg, writer: _m0.Writer): _m0.Writer
  decode(input: _m0.Reader | Uint8Array, length?: number): SatPbMsg
  // FIXME
  // fromPartial<I extends Pb.Exact<Pb.DeepPartial<SatPbMsg>, I>>(
  //  object: I
  // ): SatPbMsg
  fromPartial<SatPbMsg>(): SatPbMsg
}

export function getMsgType(msg: SatPbMsg): number {
  // FIXME
  // const mapping = msgtypemapping[msg.$type]
  const mapping = msgtypemapping[msg.$type] as any
  if (mapping) {
    return mapping[0]
  }
  return 0
}

export function getTypeFromCode(code: number): string {
  return codemapping[code] ?? ''
}

export function getTypeFromString(string_type: string): number {
  // FIXME
  // return (msgtypemapping)[string_type]![0] ?? ''
  return (msgtypemapping as any)[string_type]![0] ?? ''
}

export function getObjFromString(string_type: string) {
  // FIXME
  // return msgtypemapping[string_type]?.[1]
  return (msgtypemapping as any)[string_type]?.[1]
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
