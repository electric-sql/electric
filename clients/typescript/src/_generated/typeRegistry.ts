/* eslint-disable */
import Long from "long";
import _m0 from "protobufjs/minimal.js";

export interface MessageType<Message extends UnknownMessage = UnknownMessage> {
  $type: Message["$type"];
  encode(message: Message, writer?: _m0.Writer): _m0.Writer;
  decode(input: _m0.Reader | Uint8Array, length?: number): Message;
  fromPartial(object: DeepPartial<Message>): Message;
}

export type UnknownMessage = { $type: string };

export const messageTypeRegistry = new Map<string, MessageType>();

type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined;
export type DeepPartial<T> = T extends Builtin ? T
  : T extends Long ? string | number | Long : T extends Array<infer U> ? Array<DeepPartial<U>>
  : T extends ReadonlyArray<infer U> ? ReadonlyArray<DeepPartial<U>>
  : T extends {} ? { [K in Exclude<keyof T, "$type">]?: DeepPartial<T[K]> }
  : Partial<T>;
