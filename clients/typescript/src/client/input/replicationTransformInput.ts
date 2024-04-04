export interface ReplicationTransformInput<Row> {
  transformInbound: (row: Readonly<Row>) => Row
  transformOutbound: (row: Readonly<Row>) => Row
}
