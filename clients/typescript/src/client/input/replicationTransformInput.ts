export interface ReplicationTransformInput<Row> {
  transformInbound: (row: Row) => Row
  transformOutbound: (row: Row) => Row
}
