import { SatRelation_RelationType } from "../_generated/proto/satellite"

export type AnyFunction = (...args: any[]) => any
export type BindParams = SqlValue[] | Row
export type DbName = string
export type DbNamespace = string
export type EmptyFunction = () => void
export type FunctionMap = {[key: string]: AnyFunction}
export type Query = string
export type Row = {[key: string]: SqlValue}
export type RowCallback = (row: Row) => void
export type RowId = number
export type SqlValue = string | number | null | Uint8Array
export type StatementId = string
export type Tablename = string
export type VoidOrPromise = void | Promise<void>
export type LSN = Uint8Array | Buffer
export type Statement = { sql: string, args?: BindParams }

export class SatelliteError extends Error {
    public code: SatelliteErrorCode;

    constructor(code: SatelliteErrorCode, message?: string) {
        super(message)
        this.code = code
    }
}

export enum SatelliteErrorCode {
    INTERNAL,
    TIMEOUT,
    REPLICATION_NOT_STARTED,
    REPLICATION_ALREADY_STARTED,
    UNEXPECTED_STATE,
    UNEXPECTED_MESSAGE_TYPE,
    PROTOCOL_VIOLATION,
    UNKNOWN_DATA_TYPE,
    AUTH_ERROR
}

export type AuthResponse = {
    serverId?: string,
    error?: Error
}

export type Transaction = {
    commit_timestamp: Long,
    lsn: LSN,
    changes: Change[],
};

export enum ChangeType {
    INSERT = 'INSERT',
    UPDATE = 'UPDATE',
    DELETE = 'DELETE'
}

export type Change = {
    relation: Relation,
    type: ChangeType,
    record?: Record,
    oldRecord?: Record
}

export type Record = { [key: string]: string | number }

export type Replication = {
    authenticated: boolean
    isReplicating: ReplicationStatus
    relations: Map<number, Relation>
    ack_lsn: LSN
    sent_lsn: LSN
    transactions: Transaction[]
}

export type Relation = {
    id: number
    schema: string
    table: string
    tableType: SatRelation_RelationType
    columns: RelationColumn[]
}

export type RelationColumn = { name: string, type: string, primaryKey?: boolean };

export type RelationsCache = { [k: string]: Relation }

export enum ReplicationStatus {
    STOPPED,
    STARTING,
    STOPPING,
    ACTIVE
}

export enum AckType {
    LOCAL_SEND,
    REMOTE_COMMIT
}

export type AckCallback = (lsn: LSN, type: AckType) => void