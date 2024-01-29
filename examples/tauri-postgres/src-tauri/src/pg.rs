//!
//! This file should contain the entire integration with Postgres (through pg-embed),
//! leaving main.rs to do tauri stuff.
//!

use pg_embed::pg_enums::PgAuthMethod;
use pg_embed::pg_errors::{PgEmbedError, PgEmbedErrorType};
use pg_embed::pg_fetch::{PgFetchSettings, PostgresVersion};
use pg_embed::postgres::{PgEmbed, PgSettings};
use pgvector::Vector;
use sqlx::postgres::PgRow;
use sqlx::{Column, Connection, PgConnection, Row, ValueRef};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

pub async fn pg_setup(
    port: u16,
    database_dir: PathBuf,
    persistent: bool,
    migration_dir: Option<PathBuf>,
    cache_dir: PathBuf,
) -> Result<PgEmbed, PgEmbedError> {
    let pg_settings = PgSettings {
        database_dir,
        port,
        // socket: Some(PathBuf::from("/tmp/")),
        // socket: None,
        user: "postgres".to_string(),
        password: "password".to_string(),
        auth_method: PgAuthMethod::MD5,
        persistent,
        timeout: Some(Duration::from_secs(10)),
        migration_dir,
    };
    let fetch_settings = PgFetchSettings {
        version: PostgresVersion("15.5.1"), // version: PG_V15,
        cache_dir: cache_dir,
        ..Default::default()
    };
    let mut pg = PgEmbed::new(pg_settings, fetch_settings).await?;
    pg.setup().await?;
    Ok(pg)
}

pub async fn pg_init(database_dir: &str, port: u16, cache_dir: PathBuf) -> PgEmbed {
    // let database_dir = PathBuf::from("../resources/data_test/db");
    let database_dir = PathBuf::from(database_dir);
    let mut pg: PgEmbed = pg_setup(port, database_dir, true, None, cache_dir)
        .await
        .unwrap();

    pg.start_db().await.expect("start_db should not fail here");
    let db_name = "test";
    if !pg.database_exists(db_name).await.unwrap() {
        pg.create_database(db_name)
            .await
            .expect("create_database should not fail here");
    };

    let mut conn = pg_connect(&pg, "test").await;
    let _ = sqlx::query(
        "
            -- Check if the main schema exists
            DO $$
            BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'main') THEN
                -- Create the main schema
                CREATE SCHEMA main;
            END IF;
            END $$;
        ",
    )
    .execute(&mut conn)
    .await
    .unwrap();

    let _ = sqlx::query(
        "
            -- Set the main schema as the default schema for all users
            ALTER DATABASE test SET search_path = main, pg_catalog;
        ",
    )
    .execute(&mut conn)
    .await
    .unwrap();
    pg.migrate(db_name).await.unwrap();

    pg
}

pub async fn pg_connect(pg: &PgEmbed, db_name: &str) -> PgConnection {
    PgConnection::connect(pg.full_db_uri(db_name).as_str())
        .await
        .unwrap()
}

pub async fn pg_query(conn: &mut PgConnection, line: &str) -> String {
    let rows = match sqlx::query(line)
        .fetch_all(&mut *conn)
        .await
        .map_err(|_| PgEmbedError {
            error_type: PgEmbedErrorType::SqlQueryError,
            source: None,
            message: None,
        }) {
        Ok(rows) => rows,
        Err(error) => {
            eprintln!("Problem with the statement: {:?}", error);
            return error.to_string();
        }
    };
    let mut result = String::new();
    for row in rows {
        let row_column = row_to_json(row);
        result.push_str(serde_json::to_string(&row_column).unwrap().as_str());
    }

    result
}

// https://stackoverflow.com/a/72904564
pub fn row_to_json(row: PgRow) -> HashMap<String, String> {
    let mut result = HashMap::new();
    for col in row.columns() {
        let col_type = col.type_info().oid().unwrap().0;
        let col_kind = col.type_info().kind();
        // 16434 == vector type, treat it separately
        if col_type == 16434 {
            let value: Vector = row.try_get(col.ordinal()).unwrap();
            let value = format!("{:?}", value.to_vec());
            result.insert(col.name().to_string(), value);
            continue;
        }

        // INT8, this is the only one that still appears to bug the string below
        // Note: INT8 in Postgres means i64 in Rust
        if col_type == 20 {
            let value: i64 = row.try_get(col.ordinal()).unwrap();
            let value = format!("{:?}", value);
            result.insert(col.name().to_string(), value);
            continue;
        }

        let value = row.try_get_raw(col.ordinal()).unwrap();
        let value = match value.is_null() {
            true => "NULL".to_string(),
            false => value.as_str().unwrap().to_string(),
        };
        result.insert(col.name().to_string(), value);
    }

    result
}

//TODO: This has to be removed after the elixir has been migrated to postgres as well
// Applies all the necessary patches so that the queries work with Postgres
pub fn patch(input: &str) -> String {
    // Replace the sqlite '?' placeholder with the '$n' expected by Postgres
    let mut output = String::new();
    let mut counter = 1;

    for c in input.chars() {
        if c == '?' {
            output.push('$');
            output.push_str(&counter.to_string());
            counter += 1;
        } else {
            output.push(c);
        }
    }

    output
}
