export type AnyFunction = (...args: any[]) => any
export type BindParams = SqlValue[] | Row
export type DbName = string
export type DbNamespace = string
export type EmptyFunction = () => void
export type FunctionMap = {[key: string]: AnyFunction}
export type Query = string | object
export type Row = {[key: string]: SqlValue}
export type RowCallback = (row: Row) => void
export type RowId = number
export type SqlValue = string | number | null | Uint8Array
export type StatementId = string
export type Tablename = string
export type VoidOrPromise = void | Promise<void>

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
