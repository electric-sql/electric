import { sqliteTypeEncoder, sqliteTypeDecoder } from './sqliteEncoders'
import { pgTypeEncoder, pgTypeDecoder } from './pgEncoders'

export type TypeEncoder = typeof sqliteTypeEncoder | typeof pgTypeEncoder
export type TypeDecoder = typeof sqliteTypeDecoder | typeof pgTypeDecoder
