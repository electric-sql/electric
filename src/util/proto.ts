import * as Pb from '../_generated/proto/satellite'
import * as _m0 from 'protobufjs/minimal'

type GetName<T extends { $type: string }> =
  T['$type'] extends `Electric.Satellite.v0_2.${infer K}` ? K : never
type MappingTuples = {
  [k in SatPbMsg as GetName<k>]: [number, SatPbMsgObj<k['$type']>]
}

// NOTE: This mapping should be kept in sync with Electric message mapping.
// Take into account that this mapping is dependent on the protobuf
// protocol version.
let msgtypetuples: MappingTuples = {
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
}

let msgtypemapping = Object.fromEntries(
  Object.entries(msgtypetuples).map((e) => [getFullTypeName(e[0]), e[1]])
)

let codemapping = Object.fromEntries(
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

export type SatPbMsgObj<Type extends string = string> = {
  $type: Type
  encode(message: SatPbMsg, writer: _m0.Writer): _m0.Writer
  decode(input: _m0.Reader | Uint8Array, length?: number): SatPbMsg
  fromPartial<I extends Pb.Exact<Pb.DeepPartial<SatPbMsg>, I>>(
    object: I
  ): SatPbMsg
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

export function getTypeFromString(string_type: string): number {
  return msgtypemapping[string_type]![0] ?? ''
}

export function getObjFromString(string_type: string) {
  return msgtypemapping[string_type]?.[1]
}

export function getSizeBuf(msg_type: SatPbMsg) {
  const msgtype = getMsgType(msg_type)

  var buf = new Uint8Array(1)
  buf.set([msgtype], 0)
  return buf
}

export function getProtocolVersion(): string {
  return Pb.protobufPackage
}

export function getFullTypeName(message: string): string {
  return getProtocolVersion() + '.' + message
}
