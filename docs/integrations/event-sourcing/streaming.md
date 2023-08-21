---
title: Streaming
description: >-
  Integrated advanced streaming data capture and processing systems.
sidebar_position: 30
---

For more advanced event sourcing, you can use a range of production-grade streaming database and change data capture systems.

These include:

- [Debezium](https://debezium.io)
- [Materialize](https://materialize.com)

## Materialize

For example, streaming an events table into Kafka with Materialize:

```sql
-- Consume PG logical replication.
CREATE SOURCE pg_events
  FROM POSTGRES CONNECTION pg_conn (PUBLICATION 'publication_name')
  FOR TABLES ('events');

-- Optionally aggregate, subset or transform.
CREATE MATERIALIZED VIEW items AS
  SELECT name, args FROM pg_events;

-- Put onto the Kafka topic.
CREATE SINK avro_sink FROM items
  INTO KAFKA CONNECTION kafka_conn (TOPIC 'topic_name');
```

See the [Materialize docs](https://materialize.com/docs/sql/create-source/postgres) for more information.
