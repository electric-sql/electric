/* eslint-disable */
import Long from "long";
import _m0 from "protobufjs/minimal.js";
import { messageTypeRegistry } from "../typeRegistry.js";

export const protobufPackage = "Electric.Satellite.v1_3";

/**
 * This file defines protobuf protocol for Satellite <> Electric replication
 * Messages are sent over the wire in the following format:
 *
 * Size:32, MsgType:8, Msg/binary
 *
 * In this document there is a notation of the Client/Server and
 * Producer/Consumer which are used to annotate messages.
 *
 * Server is expected to be one of the Electric instances, while Client is a
 * client application that talks to Electric via Satellite library, or any other
 * entity that implements this protocol.
 *
 * Producer and Consumer are the corresponding roles Client and Server play in
 * replication process. Consumer requests replication from the Producer, and
 * periodically answer Ping requests form the Producer to acknowledge
 * successful replication. Consumer may also send such Ping requests, if the
 * bidirectional replication is enabled. If one of the parties is not involved
 * in the replication lsn field may be left empty.
 */

export enum SatAuthHeader {
  /** UNSPECIFIED - protobuff required to have this by default */
  UNSPECIFIED = 0,
  /**
   * PROTO_VERSION - required header
   * protobuf protocol version, this version is picked from
   * the package statement of this protobuf file, for example "Electric.Satellite.v10_13"
   */
  PROTO_VERSION = 1,
  /**
   * SCHEMA_VERSION - required header
   * last schema version applied on the client. Is prepended with the hash
   * algorithm type, for example: "sha256:71c9f..."
   */
  SCHEMA_VERSION = 2,
  UNRECOGNIZED = -1,
}

/** Ping request. Can be send by any party */
export interface SatPingReq {
  $type: "Electric.Satellite.v1_3.SatPingReq";
}

/** Ping response. */
export interface SatPingResp {
  $type: "Electric.Satellite.v1_3.SatPingResp";
  /**
   * If LSN is present, it conveys to producer the latest LSN position that
   * was applied on the consumer side. If there is no active replication
   * ongoing the field should be left 0
   */
  lsn?: Uint8Array | undefined;
}

export interface SatAuthHeaderPair {
  $type: "Electric.Satellite.v1_3.SatAuthHeaderPair";
  key: SatAuthHeader;
  value: string;
}

/**
 * (Client) Auth request
 *
 * Client request is the first request that the client should send before
 * executing any other request
 */
export interface SatAuthReq {
  $type: "Electric.Satellite.v1_3.SatAuthReq";
  /**
   * Identity of the Satellite application. Is expected to be something like
   * UUID. Required field
   */
  id: string;
  /** Authentication token, auth method specific, required */
  token: string;
  /** Headers, required */
  headers: SatAuthHeaderPair[];
}

/** (Server) Auth response */
export interface SatAuthResp {
  $type: "Electric.Satellite.v1_3.SatAuthResp";
  /** Identity of the Server */
  id: string;
  /** Headers optional */
  headers: SatAuthHeaderPair[];
}

/**
 * General purpose error message, that could be sent to any request from any
 * sides. FIXME: We might want to separate that into Client/Server parts
 */
export interface SatErrorResp {
  $type: "Electric.Satellite.v1_3.SatErrorResp";
  errorType: SatErrorResp_ErrorCode;
}

export enum SatErrorResp_ErrorCode {
  INTERNAL = 0,
  AUTH_REQUIRED = 1,
  AUTH_FAILED = 2,
  REPLICATION_FAILED = 3,
  INVALID_REQUEST = 4,
  PROTO_VSN_MISSMATCH = 5,
  SCHEMA_VSN_MISSMATCH = 6,
  UNRECOGNIZED = -1,
}

/** (Consumer) Starts replication stream from producer to consumer */
export interface SatInStartReplicationReq {
  $type: "Electric.Satellite.v1_3.SatInStartReplicationReq";
  /** LSN position of the log on the producer side */
  lsn: Uint8Array;
  options: SatInStartReplicationReq_Option[];
  /**
   * Amount of message after which SatPingResp message is expected to be
   * delivered when SYNC_MODE is used
   */
  syncBatchSize: number;
  /** the subscriptions identifiers the client wants to resume subscription */
  subscriptionIds: string[];
}

export enum SatInStartReplicationReq_Option {
  NONE = 0,
  /**
   * LAST_ACKNOWLEDGED - Flag that indicates to Producer, to start replication from the latest
   * position that has been acknowledged by this Consumer. In such a case
   * provided lsn will be ignored
   */
  LAST_ACKNOWLEDGED = 1,
  /**
   * SYNC_MODE - In sync mode consumer of the stream is expected to send SatPingResp
   * message for every committed batch of SatOpLog messages
   */
  SYNC_MODE = 2,
  /**
   * FIRST_LSN - Asks receiver to start replication from the first transaction in the log
   * without necessity to know about the actual internal format of the LSN
   */
  FIRST_LSN = 3,
  /**
   * LAST_LSN - Asks receiver to start replication from the last position in the log,
   * whatever this position is. Used for tests only.
   */
  LAST_LSN = 4,
  UNRECOGNIZED = -1,
}

/** (Producer) The result of the start replication requests */
export interface SatInStartReplicationResp {
  $type: "Electric.Satellite.v1_3.SatInStartReplicationResp";
  /** returned in case replication fails to start */
  error?: SatInStartReplicationResp_SatInStartReplicationError | undefined;
}

/** Error returned by the Producer when replication fails to start */
export interface SatInStartReplicationResp_SatInStartReplicationError {
  $type: "Electric.Satellite.v1_3.SatInStartReplicationResp.SatInStartReplicationError";
  /** error code */
  code: SatInStartReplicationResp_SatInStartReplicationError_Code;
  /** a human-readable description of the error */
  message: string;
}

/** error code enum */
export enum SatInStartReplicationResp_SatInStartReplicationError_Code {
  /** CODE_UNSPECIFIED - Required to satisfy linter */
  CODE_UNSPECIFIED = 0,
  /** BEHIND_WINDOW - requested LSN is behind the current replication window */
  BEHIND_WINDOW = 1,
  /** INVALID_POSITION - e.g. jumping ahead of the subscriptions cursor */
  INVALID_POSITION = 2,
  /** SUBSCRIPTION_NOT_FOUND - requested subscription not found */
  SUBSCRIPTION_NOT_FOUND = 3,
  UNRECOGNIZED = -1,
}

/** (Consumer) Request to stop replication */
export interface SatInStopReplicationReq {
  $type: "Electric.Satellite.v1_3.SatInStopReplicationReq";
}

/** (Producer) Acknowledgement that replication has been stopped */
export interface SatInStopReplicationResp {
  $type: "Electric.Satellite.v1_3.SatInStopReplicationResp";
}

export interface SatRelationColumn {
  $type: "Electric.Satellite.v1_3.SatRelationColumn";
  name: string;
  type: string;
  primaryKey: boolean;
}

export interface SatRelation {
  $type: "Electric.Satellite.v1_3.SatRelation";
  schemaName: string;
  tableType: SatRelation_RelationType;
  tableName: string;
  /**
   * Volatile identity defined at the start of the replication protocol may or
   * may not be persisted is used in SatTransOp operations, to indicate
   * relation the operation is working on.
   */
  relationId: number;
  columns: SatRelationColumn[];
}

export enum SatRelation_RelationType {
  TABLE = 0,
  INDEX = 1,
  VIEW = 2,
  TRIGGER = 3,
  UNRECOGNIZED = -1,
}

/**
 * (Producer) Type defines replication messages, that flow from Producer once
 * the replication is established. Message contains operations log. Operations
 * should go in the LSN order. Begin and Commit operations corresponds to
 * transaction boundaries.
 * Transactions are guranteed not to be mixed, and will follow one by one.
 */
export interface SatOpLog {
  $type: "Electric.Satellite.v1_3.SatOpLog";
  ops: SatTransOp[];
}

/**
 * (Producer) Single operation, should be only send as part of the SatOplog
 * message
 */
export interface SatTransOp {
  $type: "Electric.Satellite.v1_3.SatTransOp";
  begin?: SatOpBegin | undefined;
  commit?: SatOpCommit | undefined;
  update?: SatOpUpdate | undefined;
  insert?: SatOpInsert | undefined;
  delete?: SatOpDelete | undefined;
  migrate?: SatOpMigrate | undefined;
}

/**
 * (Producer) Replication message that indicates transaction boundaries
 * should be only send as payload in the SatTransOp message
 */
export interface SatOpBegin {
  $type: "Electric.Satellite.v1_3.SatOpBegin";
  commitTimestamp: Long;
  transId: string;
  /**
   * Lsn position that points to first data segment of transaction in the
   * WAL
   */
  lsn: Uint8Array;
  /**
   * Globally unique id of the source that transaction originated from. For
   * data coming from Satellite this field is ignored. For data coming from
   * Electric this field can be used to deduce if the incoming transaction
   * originated on this Satellite instance or not.
   */
  origin?:
    | string
    | undefined;
  /** does this transaction contain ddl statements? */
  isMigration: boolean;
}

/**
 * (Producer) Replication message that indicates transaction boundaries
 * should be only send as payload in the SatTransOp message
 */
export interface SatOpCommit {
  $type: "Electric.Satellite.v1_3.SatOpCommit";
  commitTimestamp: Long;
  transId: string;
  lsn: Uint8Array;
}

/**
 * (Producer) Data manipulation message, that only should be part of the
 * SatTransOp message
 */
export interface SatOpInsert {
  $type: "Electric.Satellite.v1_3.SatOpInsert";
  relationId: number;
  rowData:
    | SatOpRow
    | undefined;
  /** dependency information */
  tags: string[];
}

/**
 * (Producer) Data manipulation message, that only should be part of the
 * SatTransOp message
 */
export interface SatOpUpdate {
  $type: "Electric.Satellite.v1_3.SatOpUpdate";
  relationId: number;
  rowData: SatOpRow | undefined;
  oldRowData:
    | SatOpRow
    | undefined;
  /** dependency information */
  tags: string[];
}

/**
 * (Producer) Data manipulation message, that only should be part of the
 * SatTransOp message
 */
export interface SatOpDelete {
  $type: "Electric.Satellite.v1_3.SatOpDelete";
  relationId: number;
  oldRowData:
    | SatOpRow
    | undefined;
  /** dependency information */
  tags: string[];
}

/**
 * Message is sent when server is migrated while client is still connected It's
 * up to the client to immediately perform a migration or stop replication
 * stream if it's ongoing.
 */
export interface SatMigrationNotification {
  $type: "Electric.Satellite.v1_3.SatMigrationNotification";
  /** all fields are required */
  oldSchemaVersion: string;
  oldSchemaHash: string;
  newSchemaVersion: string;
  newSchemaHash: string;
}

/** Message that corresponds to the single row. */
export interface SatOpRow {
  $type: "Electric.Satellite.v1_3.SatOpRow";
  nullsBitmask: Uint8Array;
  /**
   * values may contain binaries with size 0 for NULLs and empty values
   * check nulls_bitmask to differentiate between the two
   */
  values: Uint8Array[];
}

/**
 * A migration message, originating in Postgres, captured via event triggers,
 * propagated to electric, converted from postgres to the equivalent sqlite
 * statement and inserted into the replication stream
 *
 * Each migration message includes the sql strings to execute on the satellite
 * client as well as metadata information about the resulting structure of the
 * changed tables.
 */
export interface SatOpMigrate {
  $type: "Electric.Satellite.v1_3.SatOpMigrate";
  /**
   * the migration version as specified by the developer and put into
   * the postgresql migration as an electric function call
   */
  version: string;
  /**
   * a list of sql ddl statements to apply, converted from the pg originals
   * The migration machinery converts an `ALTER TABLE action1, action2, action3;`
   * query into a set of 3: `ALTER TABLE action1; ALTER TABLE action2,` etc
   * so we need to support 1+ statements for every migration event.
   */
  stmts: SatOpMigrate_Stmt[];
  /**
   * The resulting table definition after applying these migrations
   * (a DDL statement can only affect one table at a time).
   */
  table?: SatOpMigrate_Table | undefined;
}

export enum SatOpMigrate_Type {
  CREATE_TABLE = 0,
  CREATE_INDEX = 1,
  ALTER_ADD_COLUMN = 6,
  UNRECOGNIZED = -1,
}

export interface SatOpMigrate_Stmt {
  $type: "Electric.Satellite.v1_3.SatOpMigrate.Stmt";
  type: SatOpMigrate_Type;
  sql: string;
}

export interface SatOpMigrate_PgColumnType {
  $type: "Electric.Satellite.v1_3.SatOpMigrate.PgColumnType";
  /** the pg type name, e.g. int4, char */
  name: string;
  /**
   * array dimensions, or [] for scalar types
   * e.g. for a column declared as int4[][3], size = [-1, 3]
   */
  array: number[];
  /** any size information, e.g. for varchar(SIZE) or [] for no size */
  size: number[];
}

export interface SatOpMigrate_Column {
  $type: "Electric.Satellite.v1_3.SatOpMigrate.Column";
  name: string;
  sqliteType: string;
  pgType: SatOpMigrate_PgColumnType | undefined;
}

export interface SatOpMigrate_ForeignKey {
  $type: "Electric.Satellite.v1_3.SatOpMigrate.ForeignKey";
  /** the columns in the child table that point to the parent */
  fkCols: string[];
  /** the parent table */
  pkTable: string;
  /** the cols in the parent table */
  pkCols: string[];
}

export interface SatOpMigrate_Table {
  $type: "Electric.Satellite.v1_3.SatOpMigrate.Table";
  name: string;
  columns: SatOpMigrate_Column[];
  fks: SatOpMigrate_ForeignKey[];
  pks: string[];
}

/** (Consumer) Request for a new subscriptions */
export interface SatSubscribeReq {
  $type: "Electric.Satellite.v1_3.SatSubscribeReq";
  /** Shape subscription requests */
  shapeRequest: SatShapeSubReq[];
}

/** (Producer) Acknowledgment that subscription was accepted */
export interface SatSubscribeResp {
  $type: "Electric.Satellite.v1_3.SatSubscribeResp";
  /** Identifier of the request for further reference */
  subscriptionId: string;
}

/** Shape subscription request */
export interface SatShapeSubReq {
  $type: "Electric.Satellite.v1_3.SatShapeSubReq";
  /** Identifier of the request */
  requestId: string;
  /** The shape definition */
  shapeDefinition: SatShapeDef | undefined;
}

/** Top-level structure of a shape definition */
export interface SatShapeDef {
  $type: "Electric.Satellite.v1_3.SatShapeDef";
  /** Selects for the Shape definition */
  selects: SatShapeDef_Select[];
}

/** Select structure */
export interface SatShapeDef_Select {
  $type: "Electric.Satellite.v1_3.SatShapeDef.Select";
  /** table name for this select */
  tablename: string;
}

/**
 * Error message returned by the Producer when it encounters
 * an error handling a subscription
 */
export interface SatSubscriptionError {
  $type: "Electric.Satellite.v1_3.SatSubscriptionError";
  /** error code */
  code: SatSubscriptionError_Code;
  /** A human-readable description of the error */
  message: string;
  /** Subscription identifier this error refers to */
  subscriptionId: string;
  /** Details of the shape subscription error */
  shapeSubscriptionError: SatSubscriptionError_ShapeSubError[];
}

/** error code enum */
export enum SatSubscriptionError_Code {
  /** CODE_UNSPECIFIED - Required code */
  CODE_UNSPECIFIED = 0,
  /** SHAPE_SUBSCRIPTION_ERROR - A shape subscription request error */
  SHAPE_SUBSCRIPTION_ERROR = 1,
  UNRECOGNIZED = -1,
}

/** Shape subscription error */
export interface SatSubscriptionError_ShapeSubError {
  $type: "Electric.Satellite.v1_3.SatSubscriptionError.ShapeSubError";
  /** error code */
  code: SatSubscriptionError_ShapeSubError_Code;
  /** a human-readable description of the error */
  message: string;
  /** the shape request identifier that this error refers to */
  requestId: string;
}

/** error code enum */
export enum SatSubscriptionError_ShapeSubError_Code {
  /** CODE_UNSPECIFIED - Required code */
  CODE_UNSPECIFIED = 0,
  /** TABLE_NOT_FOUND - Table not found error */
  TABLE_NOT_FOUND = 1,
  UNRECOGNIZED = -1,
}

/** Start delimiter for the incoming subscription data */
export interface SatSubscriptionDataBegin {
  $type: "Electric.Satellite.v1_3.SatSubscriptionDataBegin";
  /** Identifier of the subscription */
  subscriptionId: string;
}

/** End delimiter for the incoming subscription data */
export interface SatSubscriptionDataEnd {
  $type: "Electric.Satellite.v1_3.SatSubscriptionDataEnd";
}

/** Start delimiter for the initial shape data */
export interface SatShapeDataBegin {
  $type: "Electric.Satellite.v1_3.SatShapeDataBegin";
  /** Identifier of the request */
  requestId: string;
  /** The UUID of the shape on the Producer */
  shapeUuid: string;
}

/** End delimiter for the initial shape data */
export interface SatShapeDataEnd {
  $type: "Electric.Satellite.v1_3.SatShapeDataEnd";
}

function createBaseSatPingReq(): SatPingReq {
  return { $type: "Electric.Satellite.v1_3.SatPingReq" };
}

export const SatPingReq = {
  $type: "Electric.Satellite.v1_3.SatPingReq" as const,

  encode(_: SatPingReq, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatPingReq {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatPingReq();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatPingReq>, I>>(base?: I): SatPingReq {
    return SatPingReq.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatPingReq>, I>>(_: I): SatPingReq {
    const message = createBaseSatPingReq();
    return message;
  },
};

messageTypeRegistry.set(SatPingReq.$type, SatPingReq);

function createBaseSatPingResp(): SatPingResp {
  return { $type: "Electric.Satellite.v1_3.SatPingResp", lsn: undefined };
}

export const SatPingResp = {
  $type: "Electric.Satellite.v1_3.SatPingResp" as const,

  encode(message: SatPingResp, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.lsn !== undefined) {
      writer.uint32(10).bytes(message.lsn);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatPingResp {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatPingResp();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.lsn = reader.bytes();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatPingResp>, I>>(base?: I): SatPingResp {
    return SatPingResp.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatPingResp>, I>>(object: I): SatPingResp {
    const message = createBaseSatPingResp();
    message.lsn = object.lsn ?? undefined;
    return message;
  },
};

messageTypeRegistry.set(SatPingResp.$type, SatPingResp);

function createBaseSatAuthHeaderPair(): SatAuthHeaderPair {
  return { $type: "Electric.Satellite.v1_3.SatAuthHeaderPair", key: 0, value: "" };
}

export const SatAuthHeaderPair = {
  $type: "Electric.Satellite.v1_3.SatAuthHeaderPair" as const,

  encode(message: SatAuthHeaderPair, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.key !== 0) {
      writer.uint32(8).int32(message.key);
    }
    if (message.value !== "") {
      writer.uint32(18).string(message.value);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatAuthHeaderPair {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatAuthHeaderPair();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break;
          }

          message.key = reader.int32() as any;
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.value = reader.string();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatAuthHeaderPair>, I>>(base?: I): SatAuthHeaderPair {
    return SatAuthHeaderPair.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatAuthHeaderPair>, I>>(object: I): SatAuthHeaderPair {
    const message = createBaseSatAuthHeaderPair();
    message.key = object.key ?? 0;
    message.value = object.value ?? "";
    return message;
  },
};

messageTypeRegistry.set(SatAuthHeaderPair.$type, SatAuthHeaderPair);

function createBaseSatAuthReq(): SatAuthReq {
  return { $type: "Electric.Satellite.v1_3.SatAuthReq", id: "", token: "", headers: [] };
}

export const SatAuthReq = {
  $type: "Electric.Satellite.v1_3.SatAuthReq" as const,

  encode(message: SatAuthReq, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.id !== "") {
      writer.uint32(10).string(message.id);
    }
    if (message.token !== "") {
      writer.uint32(18).string(message.token);
    }
    for (const v of message.headers) {
      SatAuthHeaderPair.encode(v!, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatAuthReq {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatAuthReq();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.id = reader.string();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.token = reader.string();
          continue;
        case 3:
          if (tag !== 26) {
            break;
          }

          message.headers.push(SatAuthHeaderPair.decode(reader, reader.uint32()));
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatAuthReq>, I>>(base?: I): SatAuthReq {
    return SatAuthReq.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatAuthReq>, I>>(object: I): SatAuthReq {
    const message = createBaseSatAuthReq();
    message.id = object.id ?? "";
    message.token = object.token ?? "";
    message.headers = object.headers?.map((e) => SatAuthHeaderPair.fromPartial(e)) || [];
    return message;
  },
};

messageTypeRegistry.set(SatAuthReq.$type, SatAuthReq);

function createBaseSatAuthResp(): SatAuthResp {
  return { $type: "Electric.Satellite.v1_3.SatAuthResp", id: "", headers: [] };
}

export const SatAuthResp = {
  $type: "Electric.Satellite.v1_3.SatAuthResp" as const,

  encode(message: SatAuthResp, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.id !== "") {
      writer.uint32(10).string(message.id);
    }
    for (const v of message.headers) {
      SatAuthHeaderPair.encode(v!, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatAuthResp {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatAuthResp();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.id = reader.string();
          continue;
        case 3:
          if (tag !== 26) {
            break;
          }

          message.headers.push(SatAuthHeaderPair.decode(reader, reader.uint32()));
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatAuthResp>, I>>(base?: I): SatAuthResp {
    return SatAuthResp.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatAuthResp>, I>>(object: I): SatAuthResp {
    const message = createBaseSatAuthResp();
    message.id = object.id ?? "";
    message.headers = object.headers?.map((e) => SatAuthHeaderPair.fromPartial(e)) || [];
    return message;
  },
};

messageTypeRegistry.set(SatAuthResp.$type, SatAuthResp);

function createBaseSatErrorResp(): SatErrorResp {
  return { $type: "Electric.Satellite.v1_3.SatErrorResp", errorType: 0 };
}

export const SatErrorResp = {
  $type: "Electric.Satellite.v1_3.SatErrorResp" as const,

  encode(message: SatErrorResp, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.errorType !== 0) {
      writer.uint32(8).int32(message.errorType);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatErrorResp {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatErrorResp();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break;
          }

          message.errorType = reader.int32() as any;
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatErrorResp>, I>>(base?: I): SatErrorResp {
    return SatErrorResp.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatErrorResp>, I>>(object: I): SatErrorResp {
    const message = createBaseSatErrorResp();
    message.errorType = object.errorType ?? 0;
    return message;
  },
};

messageTypeRegistry.set(SatErrorResp.$type, SatErrorResp);

function createBaseSatInStartReplicationReq(): SatInStartReplicationReq {
  return {
    $type: "Electric.Satellite.v1_3.SatInStartReplicationReq",
    lsn: new Uint8Array(),
    options: [],
    syncBatchSize: 0,
    subscriptionIds: [],
  };
}

export const SatInStartReplicationReq = {
  $type: "Electric.Satellite.v1_3.SatInStartReplicationReq" as const,

  encode(message: SatInStartReplicationReq, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.lsn.length !== 0) {
      writer.uint32(10).bytes(message.lsn);
    }
    writer.uint32(18).fork();
    for (const v of message.options) {
      writer.int32(v);
    }
    writer.ldelim();
    if (message.syncBatchSize !== 0) {
      writer.uint32(24).int32(message.syncBatchSize);
    }
    for (const v of message.subscriptionIds) {
      writer.uint32(34).string(v!);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatInStartReplicationReq {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatInStartReplicationReq();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.lsn = reader.bytes();
          continue;
        case 2:
          if (tag === 16) {
            message.options.push(reader.int32() as any);

            continue;
          }

          if (tag === 18) {
            const end2 = reader.uint32() + reader.pos;
            while (reader.pos < end2) {
              message.options.push(reader.int32() as any);
            }

            continue;
          }

          break;
        case 3:
          if (tag !== 24) {
            break;
          }

          message.syncBatchSize = reader.int32();
          continue;
        case 4:
          if (tag !== 34) {
            break;
          }

          message.subscriptionIds.push(reader.string());
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatInStartReplicationReq>, I>>(base?: I): SatInStartReplicationReq {
    return SatInStartReplicationReq.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatInStartReplicationReq>, I>>(object: I): SatInStartReplicationReq {
    const message = createBaseSatInStartReplicationReq();
    message.lsn = object.lsn ?? new Uint8Array();
    message.options = object.options?.map((e) => e) || [];
    message.syncBatchSize = object.syncBatchSize ?? 0;
    message.subscriptionIds = object.subscriptionIds?.map((e) => e) || [];
    return message;
  },
};

messageTypeRegistry.set(SatInStartReplicationReq.$type, SatInStartReplicationReq);

function createBaseSatInStartReplicationResp(): SatInStartReplicationResp {
  return { $type: "Electric.Satellite.v1_3.SatInStartReplicationResp", error: undefined };
}

export const SatInStartReplicationResp = {
  $type: "Electric.Satellite.v1_3.SatInStartReplicationResp" as const,

  encode(message: SatInStartReplicationResp, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.error !== undefined) {
      SatInStartReplicationResp_SatInStartReplicationError.encode(message.error, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatInStartReplicationResp {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatInStartReplicationResp();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.error = SatInStartReplicationResp_SatInStartReplicationError.decode(reader, reader.uint32());
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatInStartReplicationResp>, I>>(base?: I): SatInStartReplicationResp {
    return SatInStartReplicationResp.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatInStartReplicationResp>, I>>(object: I): SatInStartReplicationResp {
    const message = createBaseSatInStartReplicationResp();
    message.error = (object.error !== undefined && object.error !== null)
      ? SatInStartReplicationResp_SatInStartReplicationError.fromPartial(object.error)
      : undefined;
    return message;
  },
};

messageTypeRegistry.set(SatInStartReplicationResp.$type, SatInStartReplicationResp);

function createBaseSatInStartReplicationResp_SatInStartReplicationError(): SatInStartReplicationResp_SatInStartReplicationError {
  return {
    $type: "Electric.Satellite.v1_3.SatInStartReplicationResp.SatInStartReplicationError",
    code: 0,
    message: "",
  };
}

export const SatInStartReplicationResp_SatInStartReplicationError = {
  $type: "Electric.Satellite.v1_3.SatInStartReplicationResp.SatInStartReplicationError" as const,

  encode(
    message: SatInStartReplicationResp_SatInStartReplicationError,
    writer: _m0.Writer = _m0.Writer.create(),
  ): _m0.Writer {
    if (message.code !== 0) {
      writer.uint32(8).int32(message.code);
    }
    if (message.message !== "") {
      writer.uint32(18).string(message.message);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatInStartReplicationResp_SatInStartReplicationError {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatInStartReplicationResp_SatInStartReplicationError();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break;
          }

          message.code = reader.int32() as any;
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.message = reader.string();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatInStartReplicationResp_SatInStartReplicationError>, I>>(
    base?: I,
  ): SatInStartReplicationResp_SatInStartReplicationError {
    return SatInStartReplicationResp_SatInStartReplicationError.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatInStartReplicationResp_SatInStartReplicationError>, I>>(
    object: I,
  ): SatInStartReplicationResp_SatInStartReplicationError {
    const message = createBaseSatInStartReplicationResp_SatInStartReplicationError();
    message.code = object.code ?? 0;
    message.message = object.message ?? "";
    return message;
  },
};

messageTypeRegistry.set(
  SatInStartReplicationResp_SatInStartReplicationError.$type,
  SatInStartReplicationResp_SatInStartReplicationError,
);

function createBaseSatInStopReplicationReq(): SatInStopReplicationReq {
  return { $type: "Electric.Satellite.v1_3.SatInStopReplicationReq" };
}

export const SatInStopReplicationReq = {
  $type: "Electric.Satellite.v1_3.SatInStopReplicationReq" as const,

  encode(_: SatInStopReplicationReq, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatInStopReplicationReq {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatInStopReplicationReq();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatInStopReplicationReq>, I>>(base?: I): SatInStopReplicationReq {
    return SatInStopReplicationReq.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatInStopReplicationReq>, I>>(_: I): SatInStopReplicationReq {
    const message = createBaseSatInStopReplicationReq();
    return message;
  },
};

messageTypeRegistry.set(SatInStopReplicationReq.$type, SatInStopReplicationReq);

function createBaseSatInStopReplicationResp(): SatInStopReplicationResp {
  return { $type: "Electric.Satellite.v1_3.SatInStopReplicationResp" };
}

export const SatInStopReplicationResp = {
  $type: "Electric.Satellite.v1_3.SatInStopReplicationResp" as const,

  encode(_: SatInStopReplicationResp, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatInStopReplicationResp {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatInStopReplicationResp();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatInStopReplicationResp>, I>>(base?: I): SatInStopReplicationResp {
    return SatInStopReplicationResp.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatInStopReplicationResp>, I>>(_: I): SatInStopReplicationResp {
    const message = createBaseSatInStopReplicationResp();
    return message;
  },
};

messageTypeRegistry.set(SatInStopReplicationResp.$type, SatInStopReplicationResp);

function createBaseSatRelationColumn(): SatRelationColumn {
  return { $type: "Electric.Satellite.v1_3.SatRelationColumn", name: "", type: "", primaryKey: false };
}

export const SatRelationColumn = {
  $type: "Electric.Satellite.v1_3.SatRelationColumn" as const,

  encode(message: SatRelationColumn, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.name !== "") {
      writer.uint32(10).string(message.name);
    }
    if (message.type !== "") {
      writer.uint32(18).string(message.type);
    }
    if (message.primaryKey === true) {
      writer.uint32(24).bool(message.primaryKey);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatRelationColumn {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatRelationColumn();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.name = reader.string();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.type = reader.string();
          continue;
        case 3:
          if (tag !== 24) {
            break;
          }

          message.primaryKey = reader.bool();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatRelationColumn>, I>>(base?: I): SatRelationColumn {
    return SatRelationColumn.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatRelationColumn>, I>>(object: I): SatRelationColumn {
    const message = createBaseSatRelationColumn();
    message.name = object.name ?? "";
    message.type = object.type ?? "";
    message.primaryKey = object.primaryKey ?? false;
    return message;
  },
};

messageTypeRegistry.set(SatRelationColumn.$type, SatRelationColumn);

function createBaseSatRelation(): SatRelation {
  return {
    $type: "Electric.Satellite.v1_3.SatRelation",
    schemaName: "",
    tableType: 0,
    tableName: "",
    relationId: 0,
    columns: [],
  };
}

export const SatRelation = {
  $type: "Electric.Satellite.v1_3.SatRelation" as const,

  encode(message: SatRelation, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.schemaName !== "") {
      writer.uint32(10).string(message.schemaName);
    }
    if (message.tableType !== 0) {
      writer.uint32(16).int32(message.tableType);
    }
    if (message.tableName !== "") {
      writer.uint32(26).string(message.tableName);
    }
    if (message.relationId !== 0) {
      writer.uint32(32).uint32(message.relationId);
    }
    for (const v of message.columns) {
      SatRelationColumn.encode(v!, writer.uint32(42).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatRelation {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatRelation();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.schemaName = reader.string();
          continue;
        case 2:
          if (tag !== 16) {
            break;
          }

          message.tableType = reader.int32() as any;
          continue;
        case 3:
          if (tag !== 26) {
            break;
          }

          message.tableName = reader.string();
          continue;
        case 4:
          if (tag !== 32) {
            break;
          }

          message.relationId = reader.uint32();
          continue;
        case 5:
          if (tag !== 42) {
            break;
          }

          message.columns.push(SatRelationColumn.decode(reader, reader.uint32()));
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatRelation>, I>>(base?: I): SatRelation {
    return SatRelation.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatRelation>, I>>(object: I): SatRelation {
    const message = createBaseSatRelation();
    message.schemaName = object.schemaName ?? "";
    message.tableType = object.tableType ?? 0;
    message.tableName = object.tableName ?? "";
    message.relationId = object.relationId ?? 0;
    message.columns = object.columns?.map((e) => SatRelationColumn.fromPartial(e)) || [];
    return message;
  },
};

messageTypeRegistry.set(SatRelation.$type, SatRelation);

function createBaseSatOpLog(): SatOpLog {
  return { $type: "Electric.Satellite.v1_3.SatOpLog", ops: [] };
}

export const SatOpLog = {
  $type: "Electric.Satellite.v1_3.SatOpLog" as const,

  encode(message: SatOpLog, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    for (const v of message.ops) {
      SatTransOp.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatOpLog {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatOpLog();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.ops.push(SatTransOp.decode(reader, reader.uint32()));
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatOpLog>, I>>(base?: I): SatOpLog {
    return SatOpLog.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatOpLog>, I>>(object: I): SatOpLog {
    const message = createBaseSatOpLog();
    message.ops = object.ops?.map((e) => SatTransOp.fromPartial(e)) || [];
    return message;
  },
};

messageTypeRegistry.set(SatOpLog.$type, SatOpLog);

function createBaseSatTransOp(): SatTransOp {
  return {
    $type: "Electric.Satellite.v1_3.SatTransOp",
    begin: undefined,
    commit: undefined,
    update: undefined,
    insert: undefined,
    delete: undefined,
    migrate: undefined,
  };
}

export const SatTransOp = {
  $type: "Electric.Satellite.v1_3.SatTransOp" as const,

  encode(message: SatTransOp, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.begin !== undefined) {
      SatOpBegin.encode(message.begin, writer.uint32(10).fork()).ldelim();
    }
    if (message.commit !== undefined) {
      SatOpCommit.encode(message.commit, writer.uint32(18).fork()).ldelim();
    }
    if (message.update !== undefined) {
      SatOpUpdate.encode(message.update, writer.uint32(26).fork()).ldelim();
    }
    if (message.insert !== undefined) {
      SatOpInsert.encode(message.insert, writer.uint32(34).fork()).ldelim();
    }
    if (message.delete !== undefined) {
      SatOpDelete.encode(message.delete, writer.uint32(42).fork()).ldelim();
    }
    if (message.migrate !== undefined) {
      SatOpMigrate.encode(message.migrate, writer.uint32(50).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatTransOp {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatTransOp();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.begin = SatOpBegin.decode(reader, reader.uint32());
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.commit = SatOpCommit.decode(reader, reader.uint32());
          continue;
        case 3:
          if (tag !== 26) {
            break;
          }

          message.update = SatOpUpdate.decode(reader, reader.uint32());
          continue;
        case 4:
          if (tag !== 34) {
            break;
          }

          message.insert = SatOpInsert.decode(reader, reader.uint32());
          continue;
        case 5:
          if (tag !== 42) {
            break;
          }

          message.delete = SatOpDelete.decode(reader, reader.uint32());
          continue;
        case 6:
          if (tag !== 50) {
            break;
          }

          message.migrate = SatOpMigrate.decode(reader, reader.uint32());
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatTransOp>, I>>(base?: I): SatTransOp {
    return SatTransOp.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatTransOp>, I>>(object: I): SatTransOp {
    const message = createBaseSatTransOp();
    message.begin = (object.begin !== undefined && object.begin !== null)
      ? SatOpBegin.fromPartial(object.begin)
      : undefined;
    message.commit = (object.commit !== undefined && object.commit !== null)
      ? SatOpCommit.fromPartial(object.commit)
      : undefined;
    message.update = (object.update !== undefined && object.update !== null)
      ? SatOpUpdate.fromPartial(object.update)
      : undefined;
    message.insert = (object.insert !== undefined && object.insert !== null)
      ? SatOpInsert.fromPartial(object.insert)
      : undefined;
    message.delete = (object.delete !== undefined && object.delete !== null)
      ? SatOpDelete.fromPartial(object.delete)
      : undefined;
    message.migrate = (object.migrate !== undefined && object.migrate !== null)
      ? SatOpMigrate.fromPartial(object.migrate)
      : undefined;
    return message;
  },
};

messageTypeRegistry.set(SatTransOp.$type, SatTransOp);

function createBaseSatOpBegin(): SatOpBegin {
  return {
    $type: "Electric.Satellite.v1_3.SatOpBegin",
    commitTimestamp: Long.UZERO,
    transId: "",
    lsn: new Uint8Array(),
    origin: undefined,
    isMigration: false,
  };
}

export const SatOpBegin = {
  $type: "Electric.Satellite.v1_3.SatOpBegin" as const,

  encode(message: SatOpBegin, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (!message.commitTimestamp.isZero()) {
      writer.uint32(8).uint64(message.commitTimestamp);
    }
    if (message.transId !== "") {
      writer.uint32(18).string(message.transId);
    }
    if (message.lsn.length !== 0) {
      writer.uint32(26).bytes(message.lsn);
    }
    if (message.origin !== undefined) {
      writer.uint32(34).string(message.origin);
    }
    if (message.isMigration === true) {
      writer.uint32(40).bool(message.isMigration);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatOpBegin {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatOpBegin();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break;
          }

          message.commitTimestamp = reader.uint64() as Long;
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.transId = reader.string();
          continue;
        case 3:
          if (tag !== 26) {
            break;
          }

          message.lsn = reader.bytes();
          continue;
        case 4:
          if (tag !== 34) {
            break;
          }

          message.origin = reader.string();
          continue;
        case 5:
          if (tag !== 40) {
            break;
          }

          message.isMigration = reader.bool();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatOpBegin>, I>>(base?: I): SatOpBegin {
    return SatOpBegin.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatOpBegin>, I>>(object: I): SatOpBegin {
    const message = createBaseSatOpBegin();
    message.commitTimestamp = (object.commitTimestamp !== undefined && object.commitTimestamp !== null)
      ? Long.fromValue(object.commitTimestamp)
      : Long.UZERO;
    message.transId = object.transId ?? "";
    message.lsn = object.lsn ?? new Uint8Array();
    message.origin = object.origin ?? undefined;
    message.isMigration = object.isMigration ?? false;
    return message;
  },
};

messageTypeRegistry.set(SatOpBegin.$type, SatOpBegin);

function createBaseSatOpCommit(): SatOpCommit {
  return {
    $type: "Electric.Satellite.v1_3.SatOpCommit",
    commitTimestamp: Long.UZERO,
    transId: "",
    lsn: new Uint8Array(),
  };
}

export const SatOpCommit = {
  $type: "Electric.Satellite.v1_3.SatOpCommit" as const,

  encode(message: SatOpCommit, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (!message.commitTimestamp.isZero()) {
      writer.uint32(8).uint64(message.commitTimestamp);
    }
    if (message.transId !== "") {
      writer.uint32(18).string(message.transId);
    }
    if (message.lsn.length !== 0) {
      writer.uint32(26).bytes(message.lsn);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatOpCommit {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatOpCommit();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break;
          }

          message.commitTimestamp = reader.uint64() as Long;
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.transId = reader.string();
          continue;
        case 3:
          if (tag !== 26) {
            break;
          }

          message.lsn = reader.bytes();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatOpCommit>, I>>(base?: I): SatOpCommit {
    return SatOpCommit.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatOpCommit>, I>>(object: I): SatOpCommit {
    const message = createBaseSatOpCommit();
    message.commitTimestamp = (object.commitTimestamp !== undefined && object.commitTimestamp !== null)
      ? Long.fromValue(object.commitTimestamp)
      : Long.UZERO;
    message.transId = object.transId ?? "";
    message.lsn = object.lsn ?? new Uint8Array();
    return message;
  },
};

messageTypeRegistry.set(SatOpCommit.$type, SatOpCommit);

function createBaseSatOpInsert(): SatOpInsert {
  return { $type: "Electric.Satellite.v1_3.SatOpInsert", relationId: 0, rowData: undefined, tags: [] };
}

export const SatOpInsert = {
  $type: "Electric.Satellite.v1_3.SatOpInsert" as const,

  encode(message: SatOpInsert, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.relationId !== 0) {
      writer.uint32(8).uint32(message.relationId);
    }
    if (message.rowData !== undefined) {
      SatOpRow.encode(message.rowData, writer.uint32(18).fork()).ldelim();
    }
    for (const v of message.tags) {
      writer.uint32(26).string(v!);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatOpInsert {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatOpInsert();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break;
          }

          message.relationId = reader.uint32();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.rowData = SatOpRow.decode(reader, reader.uint32());
          continue;
        case 3:
          if (tag !== 26) {
            break;
          }

          message.tags.push(reader.string());
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatOpInsert>, I>>(base?: I): SatOpInsert {
    return SatOpInsert.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatOpInsert>, I>>(object: I): SatOpInsert {
    const message = createBaseSatOpInsert();
    message.relationId = object.relationId ?? 0;
    message.rowData = (object.rowData !== undefined && object.rowData !== null)
      ? SatOpRow.fromPartial(object.rowData)
      : undefined;
    message.tags = object.tags?.map((e) => e) || [];
    return message;
  },
};

messageTypeRegistry.set(SatOpInsert.$type, SatOpInsert);

function createBaseSatOpUpdate(): SatOpUpdate {
  return {
    $type: "Electric.Satellite.v1_3.SatOpUpdate",
    relationId: 0,
    rowData: undefined,
    oldRowData: undefined,
    tags: [],
  };
}

export const SatOpUpdate = {
  $type: "Electric.Satellite.v1_3.SatOpUpdate" as const,

  encode(message: SatOpUpdate, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.relationId !== 0) {
      writer.uint32(8).uint32(message.relationId);
    }
    if (message.rowData !== undefined) {
      SatOpRow.encode(message.rowData, writer.uint32(18).fork()).ldelim();
    }
    if (message.oldRowData !== undefined) {
      SatOpRow.encode(message.oldRowData, writer.uint32(26).fork()).ldelim();
    }
    for (const v of message.tags) {
      writer.uint32(34).string(v!);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatOpUpdate {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatOpUpdate();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break;
          }

          message.relationId = reader.uint32();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.rowData = SatOpRow.decode(reader, reader.uint32());
          continue;
        case 3:
          if (tag !== 26) {
            break;
          }

          message.oldRowData = SatOpRow.decode(reader, reader.uint32());
          continue;
        case 4:
          if (tag !== 34) {
            break;
          }

          message.tags.push(reader.string());
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatOpUpdate>, I>>(base?: I): SatOpUpdate {
    return SatOpUpdate.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatOpUpdate>, I>>(object: I): SatOpUpdate {
    const message = createBaseSatOpUpdate();
    message.relationId = object.relationId ?? 0;
    message.rowData = (object.rowData !== undefined && object.rowData !== null)
      ? SatOpRow.fromPartial(object.rowData)
      : undefined;
    message.oldRowData = (object.oldRowData !== undefined && object.oldRowData !== null)
      ? SatOpRow.fromPartial(object.oldRowData)
      : undefined;
    message.tags = object.tags?.map((e) => e) || [];
    return message;
  },
};

messageTypeRegistry.set(SatOpUpdate.$type, SatOpUpdate);

function createBaseSatOpDelete(): SatOpDelete {
  return { $type: "Electric.Satellite.v1_3.SatOpDelete", relationId: 0, oldRowData: undefined, tags: [] };
}

export const SatOpDelete = {
  $type: "Electric.Satellite.v1_3.SatOpDelete" as const,

  encode(message: SatOpDelete, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.relationId !== 0) {
      writer.uint32(8).uint32(message.relationId);
    }
    if (message.oldRowData !== undefined) {
      SatOpRow.encode(message.oldRowData, writer.uint32(18).fork()).ldelim();
    }
    for (const v of message.tags) {
      writer.uint32(26).string(v!);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatOpDelete {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatOpDelete();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break;
          }

          message.relationId = reader.uint32();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.oldRowData = SatOpRow.decode(reader, reader.uint32());
          continue;
        case 3:
          if (tag !== 26) {
            break;
          }

          message.tags.push(reader.string());
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatOpDelete>, I>>(base?: I): SatOpDelete {
    return SatOpDelete.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatOpDelete>, I>>(object: I): SatOpDelete {
    const message = createBaseSatOpDelete();
    message.relationId = object.relationId ?? 0;
    message.oldRowData = (object.oldRowData !== undefined && object.oldRowData !== null)
      ? SatOpRow.fromPartial(object.oldRowData)
      : undefined;
    message.tags = object.tags?.map((e) => e) || [];
    return message;
  },
};

messageTypeRegistry.set(SatOpDelete.$type, SatOpDelete);

function createBaseSatMigrationNotification(): SatMigrationNotification {
  return {
    $type: "Electric.Satellite.v1_3.SatMigrationNotification",
    oldSchemaVersion: "",
    oldSchemaHash: "",
    newSchemaVersion: "",
    newSchemaHash: "",
  };
}

export const SatMigrationNotification = {
  $type: "Electric.Satellite.v1_3.SatMigrationNotification" as const,

  encode(message: SatMigrationNotification, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.oldSchemaVersion !== "") {
      writer.uint32(10).string(message.oldSchemaVersion);
    }
    if (message.oldSchemaHash !== "") {
      writer.uint32(18).string(message.oldSchemaHash);
    }
    if (message.newSchemaVersion !== "") {
      writer.uint32(26).string(message.newSchemaVersion);
    }
    if (message.newSchemaHash !== "") {
      writer.uint32(34).string(message.newSchemaHash);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatMigrationNotification {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatMigrationNotification();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.oldSchemaVersion = reader.string();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.oldSchemaHash = reader.string();
          continue;
        case 3:
          if (tag !== 26) {
            break;
          }

          message.newSchemaVersion = reader.string();
          continue;
        case 4:
          if (tag !== 34) {
            break;
          }

          message.newSchemaHash = reader.string();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatMigrationNotification>, I>>(base?: I): SatMigrationNotification {
    return SatMigrationNotification.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatMigrationNotification>, I>>(object: I): SatMigrationNotification {
    const message = createBaseSatMigrationNotification();
    message.oldSchemaVersion = object.oldSchemaVersion ?? "";
    message.oldSchemaHash = object.oldSchemaHash ?? "";
    message.newSchemaVersion = object.newSchemaVersion ?? "";
    message.newSchemaHash = object.newSchemaHash ?? "";
    return message;
  },
};

messageTypeRegistry.set(SatMigrationNotification.$type, SatMigrationNotification);

function createBaseSatOpRow(): SatOpRow {
  return { $type: "Electric.Satellite.v1_3.SatOpRow", nullsBitmask: new Uint8Array(), values: [] };
}

export const SatOpRow = {
  $type: "Electric.Satellite.v1_3.SatOpRow" as const,

  encode(message: SatOpRow, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.nullsBitmask.length !== 0) {
      writer.uint32(10).bytes(message.nullsBitmask);
    }
    for (const v of message.values) {
      writer.uint32(18).bytes(v!);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatOpRow {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatOpRow();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.nullsBitmask = reader.bytes();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.values.push(reader.bytes());
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatOpRow>, I>>(base?: I): SatOpRow {
    return SatOpRow.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatOpRow>, I>>(object: I): SatOpRow {
    const message = createBaseSatOpRow();
    message.nullsBitmask = object.nullsBitmask ?? new Uint8Array();
    message.values = object.values?.map((e) => e) || [];
    return message;
  },
};

messageTypeRegistry.set(SatOpRow.$type, SatOpRow);

function createBaseSatOpMigrate(): SatOpMigrate {
  return { $type: "Electric.Satellite.v1_3.SatOpMigrate", version: "", stmts: [], table: undefined };
}

export const SatOpMigrate = {
  $type: "Electric.Satellite.v1_3.SatOpMigrate" as const,

  encode(message: SatOpMigrate, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.version !== "") {
      writer.uint32(10).string(message.version);
    }
    for (const v of message.stmts) {
      SatOpMigrate_Stmt.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    if (message.table !== undefined) {
      SatOpMigrate_Table.encode(message.table, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatOpMigrate {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatOpMigrate();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.version = reader.string();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.stmts.push(SatOpMigrate_Stmt.decode(reader, reader.uint32()));
          continue;
        case 3:
          if (tag !== 26) {
            break;
          }

          message.table = SatOpMigrate_Table.decode(reader, reader.uint32());
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatOpMigrate>, I>>(base?: I): SatOpMigrate {
    return SatOpMigrate.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatOpMigrate>, I>>(object: I): SatOpMigrate {
    const message = createBaseSatOpMigrate();
    message.version = object.version ?? "";
    message.stmts = object.stmts?.map((e) => SatOpMigrate_Stmt.fromPartial(e)) || [];
    message.table = (object.table !== undefined && object.table !== null)
      ? SatOpMigrate_Table.fromPartial(object.table)
      : undefined;
    return message;
  },
};

messageTypeRegistry.set(SatOpMigrate.$type, SatOpMigrate);

function createBaseSatOpMigrate_Stmt(): SatOpMigrate_Stmt {
  return { $type: "Electric.Satellite.v1_3.SatOpMigrate.Stmt", type: 0, sql: "" };
}

export const SatOpMigrate_Stmt = {
  $type: "Electric.Satellite.v1_3.SatOpMigrate.Stmt" as const,

  encode(message: SatOpMigrate_Stmt, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.type !== 0) {
      writer.uint32(8).int32(message.type);
    }
    if (message.sql !== "") {
      writer.uint32(18).string(message.sql);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatOpMigrate_Stmt {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatOpMigrate_Stmt();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break;
          }

          message.type = reader.int32() as any;
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.sql = reader.string();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatOpMigrate_Stmt>, I>>(base?: I): SatOpMigrate_Stmt {
    return SatOpMigrate_Stmt.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatOpMigrate_Stmt>, I>>(object: I): SatOpMigrate_Stmt {
    const message = createBaseSatOpMigrate_Stmt();
    message.type = object.type ?? 0;
    message.sql = object.sql ?? "";
    return message;
  },
};

messageTypeRegistry.set(SatOpMigrate_Stmt.$type, SatOpMigrate_Stmt);

function createBaseSatOpMigrate_PgColumnType(): SatOpMigrate_PgColumnType {
  return { $type: "Electric.Satellite.v1_3.SatOpMigrate.PgColumnType", name: "", array: [], size: [] };
}

export const SatOpMigrate_PgColumnType = {
  $type: "Electric.Satellite.v1_3.SatOpMigrate.PgColumnType" as const,

  encode(message: SatOpMigrate_PgColumnType, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.name !== "") {
      writer.uint32(10).string(message.name);
    }
    writer.uint32(18).fork();
    for (const v of message.array) {
      writer.int32(v);
    }
    writer.ldelim();
    writer.uint32(26).fork();
    for (const v of message.size) {
      writer.int32(v);
    }
    writer.ldelim();
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatOpMigrate_PgColumnType {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatOpMigrate_PgColumnType();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.name = reader.string();
          continue;
        case 2:
          if (tag === 16) {
            message.array.push(reader.int32());

            continue;
          }

          if (tag === 18) {
            const end2 = reader.uint32() + reader.pos;
            while (reader.pos < end2) {
              message.array.push(reader.int32());
            }

            continue;
          }

          break;
        case 3:
          if (tag === 24) {
            message.size.push(reader.int32());

            continue;
          }

          if (tag === 26) {
            const end2 = reader.uint32() + reader.pos;
            while (reader.pos < end2) {
              message.size.push(reader.int32());
            }

            continue;
          }

          break;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatOpMigrate_PgColumnType>, I>>(base?: I): SatOpMigrate_PgColumnType {
    return SatOpMigrate_PgColumnType.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatOpMigrate_PgColumnType>, I>>(object: I): SatOpMigrate_PgColumnType {
    const message = createBaseSatOpMigrate_PgColumnType();
    message.name = object.name ?? "";
    message.array = object.array?.map((e) => e) || [];
    message.size = object.size?.map((e) => e) || [];
    return message;
  },
};

messageTypeRegistry.set(SatOpMigrate_PgColumnType.$type, SatOpMigrate_PgColumnType);

function createBaseSatOpMigrate_Column(): SatOpMigrate_Column {
  return { $type: "Electric.Satellite.v1_3.SatOpMigrate.Column", name: "", sqliteType: "", pgType: undefined };
}

export const SatOpMigrate_Column = {
  $type: "Electric.Satellite.v1_3.SatOpMigrate.Column" as const,

  encode(message: SatOpMigrate_Column, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.name !== "") {
      writer.uint32(10).string(message.name);
    }
    if (message.sqliteType !== "") {
      writer.uint32(18).string(message.sqliteType);
    }
    if (message.pgType !== undefined) {
      SatOpMigrate_PgColumnType.encode(message.pgType, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatOpMigrate_Column {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatOpMigrate_Column();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.name = reader.string();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.sqliteType = reader.string();
          continue;
        case 3:
          if (tag !== 26) {
            break;
          }

          message.pgType = SatOpMigrate_PgColumnType.decode(reader, reader.uint32());
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatOpMigrate_Column>, I>>(base?: I): SatOpMigrate_Column {
    return SatOpMigrate_Column.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatOpMigrate_Column>, I>>(object: I): SatOpMigrate_Column {
    const message = createBaseSatOpMigrate_Column();
    message.name = object.name ?? "";
    message.sqliteType = object.sqliteType ?? "";
    message.pgType = (object.pgType !== undefined && object.pgType !== null)
      ? SatOpMigrate_PgColumnType.fromPartial(object.pgType)
      : undefined;
    return message;
  },
};

messageTypeRegistry.set(SatOpMigrate_Column.$type, SatOpMigrate_Column);

function createBaseSatOpMigrate_ForeignKey(): SatOpMigrate_ForeignKey {
  return { $type: "Electric.Satellite.v1_3.SatOpMigrate.ForeignKey", fkCols: [], pkTable: "", pkCols: [] };
}

export const SatOpMigrate_ForeignKey = {
  $type: "Electric.Satellite.v1_3.SatOpMigrate.ForeignKey" as const,

  encode(message: SatOpMigrate_ForeignKey, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    for (const v of message.fkCols) {
      writer.uint32(10).string(v!);
    }
    if (message.pkTable !== "") {
      writer.uint32(18).string(message.pkTable);
    }
    for (const v of message.pkCols) {
      writer.uint32(26).string(v!);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatOpMigrate_ForeignKey {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatOpMigrate_ForeignKey();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.fkCols.push(reader.string());
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.pkTable = reader.string();
          continue;
        case 3:
          if (tag !== 26) {
            break;
          }

          message.pkCols.push(reader.string());
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatOpMigrate_ForeignKey>, I>>(base?: I): SatOpMigrate_ForeignKey {
    return SatOpMigrate_ForeignKey.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatOpMigrate_ForeignKey>, I>>(object: I): SatOpMigrate_ForeignKey {
    const message = createBaseSatOpMigrate_ForeignKey();
    message.fkCols = object.fkCols?.map((e) => e) || [];
    message.pkTable = object.pkTable ?? "";
    message.pkCols = object.pkCols?.map((e) => e) || [];
    return message;
  },
};

messageTypeRegistry.set(SatOpMigrate_ForeignKey.$type, SatOpMigrate_ForeignKey);

function createBaseSatOpMigrate_Table(): SatOpMigrate_Table {
  return { $type: "Electric.Satellite.v1_3.SatOpMigrate.Table", name: "", columns: [], fks: [], pks: [] };
}

export const SatOpMigrate_Table = {
  $type: "Electric.Satellite.v1_3.SatOpMigrate.Table" as const,

  encode(message: SatOpMigrate_Table, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.name !== "") {
      writer.uint32(10).string(message.name);
    }
    for (const v of message.columns) {
      SatOpMigrate_Column.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    for (const v of message.fks) {
      SatOpMigrate_ForeignKey.encode(v!, writer.uint32(26).fork()).ldelim();
    }
    for (const v of message.pks) {
      writer.uint32(34).string(v!);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatOpMigrate_Table {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatOpMigrate_Table();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.name = reader.string();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.columns.push(SatOpMigrate_Column.decode(reader, reader.uint32()));
          continue;
        case 3:
          if (tag !== 26) {
            break;
          }

          message.fks.push(SatOpMigrate_ForeignKey.decode(reader, reader.uint32()));
          continue;
        case 4:
          if (tag !== 34) {
            break;
          }

          message.pks.push(reader.string());
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatOpMigrate_Table>, I>>(base?: I): SatOpMigrate_Table {
    return SatOpMigrate_Table.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatOpMigrate_Table>, I>>(object: I): SatOpMigrate_Table {
    const message = createBaseSatOpMigrate_Table();
    message.name = object.name ?? "";
    message.columns = object.columns?.map((e) => SatOpMigrate_Column.fromPartial(e)) || [];
    message.fks = object.fks?.map((e) => SatOpMigrate_ForeignKey.fromPartial(e)) || [];
    message.pks = object.pks?.map((e) => e) || [];
    return message;
  },
};

messageTypeRegistry.set(SatOpMigrate_Table.$type, SatOpMigrate_Table);

function createBaseSatSubscribeReq(): SatSubscribeReq {
  return { $type: "Electric.Satellite.v1_3.SatSubscribeReq", shapeRequest: [] };
}

export const SatSubscribeReq = {
  $type: "Electric.Satellite.v1_3.SatSubscribeReq" as const,

  encode(message: SatSubscribeReq, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    for (const v of message.shapeRequest) {
      SatShapeSubReq.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatSubscribeReq {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatSubscribeReq();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 2:
          if (tag !== 18) {
            break;
          }

          message.shapeRequest.push(SatShapeSubReq.decode(reader, reader.uint32()));
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatSubscribeReq>, I>>(base?: I): SatSubscribeReq {
    return SatSubscribeReq.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatSubscribeReq>, I>>(object: I): SatSubscribeReq {
    const message = createBaseSatSubscribeReq();
    message.shapeRequest = object.shapeRequest?.map((e) => SatShapeSubReq.fromPartial(e)) || [];
    return message;
  },
};

messageTypeRegistry.set(SatSubscribeReq.$type, SatSubscribeReq);

function createBaseSatSubscribeResp(): SatSubscribeResp {
  return { $type: "Electric.Satellite.v1_3.SatSubscribeResp", subscriptionId: "" };
}

export const SatSubscribeResp = {
  $type: "Electric.Satellite.v1_3.SatSubscribeResp" as const,

  encode(message: SatSubscribeResp, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.subscriptionId !== "") {
      writer.uint32(10).string(message.subscriptionId);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatSubscribeResp {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatSubscribeResp();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.subscriptionId = reader.string();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatSubscribeResp>, I>>(base?: I): SatSubscribeResp {
    return SatSubscribeResp.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatSubscribeResp>, I>>(object: I): SatSubscribeResp {
    const message = createBaseSatSubscribeResp();
    message.subscriptionId = object.subscriptionId ?? "";
    return message;
  },
};

messageTypeRegistry.set(SatSubscribeResp.$type, SatSubscribeResp);

function createBaseSatShapeSubReq(): SatShapeSubReq {
  return { $type: "Electric.Satellite.v1_3.SatShapeSubReq", requestId: "", shapeDefinition: undefined };
}

export const SatShapeSubReq = {
  $type: "Electric.Satellite.v1_3.SatShapeSubReq" as const,

  encode(message: SatShapeSubReq, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.requestId !== "") {
      writer.uint32(10).string(message.requestId);
    }
    if (message.shapeDefinition !== undefined) {
      SatShapeDef.encode(message.shapeDefinition, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatShapeSubReq {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatShapeSubReq();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.requestId = reader.string();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.shapeDefinition = SatShapeDef.decode(reader, reader.uint32());
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatShapeSubReq>, I>>(base?: I): SatShapeSubReq {
    return SatShapeSubReq.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatShapeSubReq>, I>>(object: I): SatShapeSubReq {
    const message = createBaseSatShapeSubReq();
    message.requestId = object.requestId ?? "";
    message.shapeDefinition = (object.shapeDefinition !== undefined && object.shapeDefinition !== null)
      ? SatShapeDef.fromPartial(object.shapeDefinition)
      : undefined;
    return message;
  },
};

messageTypeRegistry.set(SatShapeSubReq.$type, SatShapeSubReq);

function createBaseSatShapeDef(): SatShapeDef {
  return { $type: "Electric.Satellite.v1_3.SatShapeDef", selects: [] };
}

export const SatShapeDef = {
  $type: "Electric.Satellite.v1_3.SatShapeDef" as const,

  encode(message: SatShapeDef, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    for (const v of message.selects) {
      SatShapeDef_Select.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatShapeDef {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatShapeDef();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.selects.push(SatShapeDef_Select.decode(reader, reader.uint32()));
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatShapeDef>, I>>(base?: I): SatShapeDef {
    return SatShapeDef.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatShapeDef>, I>>(object: I): SatShapeDef {
    const message = createBaseSatShapeDef();
    message.selects = object.selects?.map((e) => SatShapeDef_Select.fromPartial(e)) || [];
    return message;
  },
};

messageTypeRegistry.set(SatShapeDef.$type, SatShapeDef);

function createBaseSatShapeDef_Select(): SatShapeDef_Select {
  return { $type: "Electric.Satellite.v1_3.SatShapeDef.Select", tablename: "" };
}

export const SatShapeDef_Select = {
  $type: "Electric.Satellite.v1_3.SatShapeDef.Select" as const,

  encode(message: SatShapeDef_Select, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.tablename !== "") {
      writer.uint32(10).string(message.tablename);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatShapeDef_Select {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatShapeDef_Select();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.tablename = reader.string();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatShapeDef_Select>, I>>(base?: I): SatShapeDef_Select {
    return SatShapeDef_Select.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatShapeDef_Select>, I>>(object: I): SatShapeDef_Select {
    const message = createBaseSatShapeDef_Select();
    message.tablename = object.tablename ?? "";
    return message;
  },
};

messageTypeRegistry.set(SatShapeDef_Select.$type, SatShapeDef_Select);

function createBaseSatSubscriptionError(): SatSubscriptionError {
  return {
    $type: "Electric.Satellite.v1_3.SatSubscriptionError",
    code: 0,
    message: "",
    subscriptionId: "",
    shapeSubscriptionError: [],
  };
}

export const SatSubscriptionError = {
  $type: "Electric.Satellite.v1_3.SatSubscriptionError" as const,

  encode(message: SatSubscriptionError, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.code !== 0) {
      writer.uint32(8).int32(message.code);
    }
    if (message.message !== "") {
      writer.uint32(18).string(message.message);
    }
    if (message.subscriptionId !== "") {
      writer.uint32(26).string(message.subscriptionId);
    }
    for (const v of message.shapeSubscriptionError) {
      SatSubscriptionError_ShapeSubError.encode(v!, writer.uint32(34).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatSubscriptionError {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatSubscriptionError();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break;
          }

          message.code = reader.int32() as any;
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.message = reader.string();
          continue;
        case 3:
          if (tag !== 26) {
            break;
          }

          message.subscriptionId = reader.string();
          continue;
        case 4:
          if (tag !== 34) {
            break;
          }

          message.shapeSubscriptionError.push(SatSubscriptionError_ShapeSubError.decode(reader, reader.uint32()));
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatSubscriptionError>, I>>(base?: I): SatSubscriptionError {
    return SatSubscriptionError.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatSubscriptionError>, I>>(object: I): SatSubscriptionError {
    const message = createBaseSatSubscriptionError();
    message.code = object.code ?? 0;
    message.message = object.message ?? "";
    message.subscriptionId = object.subscriptionId ?? "";
    message.shapeSubscriptionError =
      object.shapeSubscriptionError?.map((e) => SatSubscriptionError_ShapeSubError.fromPartial(e)) || [];
    return message;
  },
};

messageTypeRegistry.set(SatSubscriptionError.$type, SatSubscriptionError);

function createBaseSatSubscriptionError_ShapeSubError(): SatSubscriptionError_ShapeSubError {
  return { $type: "Electric.Satellite.v1_3.SatSubscriptionError.ShapeSubError", code: 0, message: "", requestId: "" };
}

export const SatSubscriptionError_ShapeSubError = {
  $type: "Electric.Satellite.v1_3.SatSubscriptionError.ShapeSubError" as const,

  encode(message: SatSubscriptionError_ShapeSubError, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.code !== 0) {
      writer.uint32(8).int32(message.code);
    }
    if (message.message !== "") {
      writer.uint32(18).string(message.message);
    }
    if (message.requestId !== "") {
      writer.uint32(26).string(message.requestId);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatSubscriptionError_ShapeSubError {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatSubscriptionError_ShapeSubError();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break;
          }

          message.code = reader.int32() as any;
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.message = reader.string();
          continue;
        case 3:
          if (tag !== 26) {
            break;
          }

          message.requestId = reader.string();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatSubscriptionError_ShapeSubError>, I>>(
    base?: I,
  ): SatSubscriptionError_ShapeSubError {
    return SatSubscriptionError_ShapeSubError.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatSubscriptionError_ShapeSubError>, I>>(
    object: I,
  ): SatSubscriptionError_ShapeSubError {
    const message = createBaseSatSubscriptionError_ShapeSubError();
    message.code = object.code ?? 0;
    message.message = object.message ?? "";
    message.requestId = object.requestId ?? "";
    return message;
  },
};

messageTypeRegistry.set(SatSubscriptionError_ShapeSubError.$type, SatSubscriptionError_ShapeSubError);

function createBaseSatSubscriptionDataBegin(): SatSubscriptionDataBegin {
  return { $type: "Electric.Satellite.v1_3.SatSubscriptionDataBegin", subscriptionId: "" };
}

export const SatSubscriptionDataBegin = {
  $type: "Electric.Satellite.v1_3.SatSubscriptionDataBegin" as const,

  encode(message: SatSubscriptionDataBegin, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.subscriptionId !== "") {
      writer.uint32(10).string(message.subscriptionId);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatSubscriptionDataBegin {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatSubscriptionDataBegin();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.subscriptionId = reader.string();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatSubscriptionDataBegin>, I>>(base?: I): SatSubscriptionDataBegin {
    return SatSubscriptionDataBegin.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatSubscriptionDataBegin>, I>>(object: I): SatSubscriptionDataBegin {
    const message = createBaseSatSubscriptionDataBegin();
    message.subscriptionId = object.subscriptionId ?? "";
    return message;
  },
};

messageTypeRegistry.set(SatSubscriptionDataBegin.$type, SatSubscriptionDataBegin);

function createBaseSatSubscriptionDataEnd(): SatSubscriptionDataEnd {
  return { $type: "Electric.Satellite.v1_3.SatSubscriptionDataEnd" };
}

export const SatSubscriptionDataEnd = {
  $type: "Electric.Satellite.v1_3.SatSubscriptionDataEnd" as const,

  encode(_: SatSubscriptionDataEnd, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatSubscriptionDataEnd {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatSubscriptionDataEnd();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatSubscriptionDataEnd>, I>>(base?: I): SatSubscriptionDataEnd {
    return SatSubscriptionDataEnd.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatSubscriptionDataEnd>, I>>(_: I): SatSubscriptionDataEnd {
    const message = createBaseSatSubscriptionDataEnd();
    return message;
  },
};

messageTypeRegistry.set(SatSubscriptionDataEnd.$type, SatSubscriptionDataEnd);

function createBaseSatShapeDataBegin(): SatShapeDataBegin {
  return { $type: "Electric.Satellite.v1_3.SatShapeDataBegin", requestId: "", shapeUuid: "" };
}

export const SatShapeDataBegin = {
  $type: "Electric.Satellite.v1_3.SatShapeDataBegin" as const,

  encode(message: SatShapeDataBegin, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.requestId !== "") {
      writer.uint32(10).string(message.requestId);
    }
    if (message.shapeUuid !== "") {
      writer.uint32(18).string(message.shapeUuid);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatShapeDataBegin {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatShapeDataBegin();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.requestId = reader.string();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.shapeUuid = reader.string();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatShapeDataBegin>, I>>(base?: I): SatShapeDataBegin {
    return SatShapeDataBegin.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatShapeDataBegin>, I>>(object: I): SatShapeDataBegin {
    const message = createBaseSatShapeDataBegin();
    message.requestId = object.requestId ?? "";
    message.shapeUuid = object.shapeUuid ?? "";
    return message;
  },
};

messageTypeRegistry.set(SatShapeDataBegin.$type, SatShapeDataBegin);

function createBaseSatShapeDataEnd(): SatShapeDataEnd {
  return { $type: "Electric.Satellite.v1_3.SatShapeDataEnd" };
}

export const SatShapeDataEnd = {
  $type: "Electric.Satellite.v1_3.SatShapeDataEnd" as const,

  encode(_: SatShapeDataEnd, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SatShapeDataEnd {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSatShapeDataEnd();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  create<I extends Exact<DeepPartial<SatShapeDataEnd>, I>>(base?: I): SatShapeDataEnd {
    return SatShapeDataEnd.fromPartial(base ?? {});
  },

  fromPartial<I extends Exact<DeepPartial<SatShapeDataEnd>, I>>(_: I): SatShapeDataEnd {
    const message = createBaseSatShapeDataEnd();
    return message;
  },
};

messageTypeRegistry.set(SatShapeDataEnd.$type, SatShapeDataEnd);

type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined;

export type DeepPartial<T> = T extends Builtin ? T
  : T extends Long ? string | number | Long : T extends Array<infer U> ? Array<DeepPartial<U>>
  : T extends ReadonlyArray<infer U> ? ReadonlyArray<DeepPartial<U>>
  : T extends {} ? { [K in Exclude<keyof T, "$type">]?: DeepPartial<T[K]> }
  : Partial<T>;

type KeysOfUnion<T> = T extends T ? keyof T : never;
export type Exact<P, I extends P> = P extends Builtin ? P
  : P & { [K in keyof P]: Exact<P[K], I[K]> } & { [K in Exclude<keyof I, KeysOfUnion<P> | "$type">]: never };

if (_m0.util.Long !== Long) {
  _m0.util.Long = Long as any;
  _m0.configure();
}
