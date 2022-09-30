import * as Pb from '../_generated/proto/satellite'
import * as _m0 from 'protobufjs/minimal';

let msgtypemapping: { [k: string]: [number, any] } = {
    "Electric.Satellite.SatErrorResp": [0, Pb.SatErrorResp],
    "Electric.Satellite.SatAuthReq": [1, Pb.SatAuthReq],
    "Electric.Satellite.SatAuthResp": [2, Pb.SatAuthResp],
    "Electric.Satellite.SatGetServerInfoReq": [3, Pb.SatGetServerInfoReq],
    "Electric.Satellite.SatGetServerInfoResp": [4, Pb.SatGetServerInfoResp],
    "Electric.Satellite.SatPingReq": [5, Pb.SatPingReq],
    "Electric.Satellite.SatPingResp": [6, Pb.SatPingResp],
    "Electric.Satellite.SatInStartReplicationReq": [7, Pb.SatInStartReplicationReq],
    "Electric.Satellite.SatInStartReplicationResp": [8, Pb.SatInStartReplicationResp],
    "Electric.Satellite.SatInStopReplicationReq": [9, Pb.SatInStopReplicationReq],
    "Electric.Satellite.SatInStopReplicationResp": [10, Pb.SatInStopReplicationResp],
    "Electric.Satellite.SatOpLog": [11, Pb.SatOpLog],
    "Electric.Satellite.SatRelation": [12, Pb.SatRelation],
    "Electric.Satellite.SatMigrationNotification": [13, Pb.SatMigrationNotification]
};

let codemapping = Object.fromEntries(
    Object.entries(msgtypemapping).map(e => [e[1][0], e[0]]))

export type SatPbMsg =
    | Pb.SatErrorResp
    | Pb.SatAuthReq
    | Pb.SatAuthResp
    | Pb.SatGetServerInfoReq
    | Pb.SatGetServerInfoResp
    | Pb.SatPingReq
    | Pb.SatPingResp
    | Pb.SatInStartReplicationReq
    | Pb.SatInStartReplicationResp
    | Pb.SatInStopReplicationReq
    | Pb.SatInStopReplicationResp
    | Pb.SatOpLog
    | Pb.SatRelation
    | Pb.SatMigrationNotification

export type SatPbMsgObj = {
    $type: string;
    encode(message: SatPbMsg, writer: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): SatPbMsg;
    fromPartial<I extends Pb.Exact<Pb.DeepPartial<SatPbMsg>, I>>(object: I): SatPbMsg;
};

export function getMsgType(msg: SatPbMsg): number {
    const mapping = msgtypemapping[msg.$type];
    if (mapping) {
        return mapping[0]
    }
    return 0;
}

export function getTypeFromCode(code: number): string {
    return codemapping[code] ?? "";
}

export function getTypeFromString(string_type: string): number {
    return msgtypemapping[string_type]![0] ?? "";
}

export function getObjFromString(string_type: string) {
    return msgtypemapping[string_type]?.[1];
}

export function getSizeBuf(msg_type: SatPbMsg) {
    const msgtype = getMsgType(msg_type)

    var buf = Buffer.alloc(1);
    buf.writeUInt8(msgtype, 0);
    return buf
}
