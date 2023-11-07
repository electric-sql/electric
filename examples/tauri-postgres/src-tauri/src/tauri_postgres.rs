//!
//! This file should contain the entire integration with Postgres (through pg-embed),
//! leaving main.rs to do tauri stuff and utils.rs to do Rust stuff.
//!

// For displaying postgres logs in the console
use env_logger::Env;

use pg_embed::pg_enums::PgAuthMethod;
use pg_embed::pg_errors::{PgEmbedError, PgEmbedErrorType};
use pg_embed::pg_fetch::{PgFetchSettings, PG_V15};
use pg_embed::postgres::{PgEmbed, PgSettings};
use sqlx::postgres::PgRow;
use sqlx::{Column, Row, ValueRef};
use sqlx::{Connection, PgConnection};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

pub async fn tauri_pg_setup(
    port: u16,
    database_dir: PathBuf,
    persistent: bool,
    migration_dir: Option<PathBuf>,
) -> Result<PgEmbed, PgEmbedError> {
    let _ = env_logger::Builder::from_env(Env::default().default_filter_or("info"))
        .is_test(true)
        .try_init();
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
        version: PG_V15,
        // custom_cache_dir: Some(PathBuf::from("./resources/pg-embed/")),
        // custom_cache_dir: None,
        ..Default::default()
    };
    let mut pg = PgEmbed::new(pg_settings, fetch_settings).await?;
    pg.setup().await?;
    Ok(pg)
}

pub async fn tauri_pg_init_database(database_dir: &str) -> PgEmbed {
    // let database_dir = PathBuf::from("../resources/data_test/db");
    let database_dir = PathBuf::from(database_dir);
    let mut pg: PgEmbed = tauri_pg_setup(33333, database_dir, true, None)
        .await
        .unwrap();

    pg.start_db().await.expect("start_db should not fail here");
    let db_name = "test";
    if !pg.database_exists(db_name).await.unwrap() {
        pg.create_database(db_name)
            .await
            .expect("create_database should not fail here");
    };

    let mut conn = tauri_pg_connect(&pg, "test").await;

    // TODO: When
    let _ = sqlx::query("ALTER SCHEMA public RENAME TO main;")
        .execute(&mut conn)
        .await
        .unwrap();
    let _ = sqlx::query("ALTER DATABASE test SET search_path TO main;")
        .execute(&mut conn)
        .await
        .unwrap();

    pg.migrate(db_name).await.unwrap();

    pg
}

pub async fn tauri_pg_connect(pg: &PgEmbed, db_name: &str) -> PgConnection {
    PgConnection::connect(pg.full_db_uri(db_name).as_str())
        .await
        .unwrap()
}

// https://stackoverflow.com/a/72904564
pub fn row_to_json(row: PgRow) -> HashMap<String, String> {
    let mut result = HashMap::new();
    for col in row.columns() {
        let value = row.try_get_raw(col.ordinal()).unwrap();
        let value = match value.is_null() {
            true => "NULL".to_string(),
            false => value.as_str().unwrap().to_string(),
        };
        result.insert(col.name().to_string(), value);
    }

    result
}

pub async fn tauri_pg_query(conn: &mut PgConnection, line: &str) -> String {
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
