// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use tokio::runtime::Runtime;
use tokio::task;
use std::fs::File;
use std::fs::OpenOptions;
use serde_json::Number;

mod tauri_postgres;
use crate::tauri_postgres::{tauri_pg_setup, row_to_json};
mod utils;

// General
use log::debug;
use pg_embed::postgres::PgEmbed;
use pg_embed::pg_errors::{PgEmbedError, PgEmbedErrorType};
use sqlx::PgConnection;
use std::{path::PathBuf, str::FromStr};



// Tauri
use tauri::{Manager, State};
use tauri::async_runtime::block_on;

// Tauri plug-ins
use tauri_plugin_log::{
    fern::colors::{Color, ColoredLevelConfig},
    LogTarget,
};

// This package
use tauri_postgres::{
    tauri_pg_connect, tauri_pg_fill_example_data_sync, tauri_pg_init_database, tauri_pg_query,
};

// Postgres console
use portable_pty::{native_pty_system, CommandBuilder, PtyPair, PtySize};
use std::{
    io::{BufRead, BufReader, Write},
    sync::{Arc, Mutex},
    thread::{self, sleep},
    time::Duration,
};
use tauri::async_runtime::Mutex as AsyncMutex;

/**
 * Structures
 */
/// This is the equivalent of the electric-sql `SqlValue`, used in the drivers.
#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum SqlValue {
  Num(Number),
  Null,
  Uint8Array(Vec<u8>),
  Str(String),
}

/// This is the equivalent of BindParams. Both the electric-sql `sqlx` driver and the `postgres` driver use this abstraction.
#[derive(Debug, Serialize, Deserialize)]
struct bindParams {
  keys: Vec<String>,
  values: Vec<SqlValue>
}

/**
 * Tauri globals
 */
 /// This is the global connection to Postgres
struct GlobalPG(PgEmbed);

struct DbConnection {
  db: Mutex<Option<PgEmbed>>,
}

/// App state for the terminal window. TODO: rename to something more sensible
struct AppState {
  pty_pair: Arc<AsyncMutex<PtyPair>>,
  writer: Arc<AsyncMutex<Box<dyn Write + Send>>>,
}

/**
 * Tauri commands
 */

// Terminal commands
#[tauri::command]
async fn async_write_to_pty(data: &str, state: State<'_, AppState>) -> Result<(), ()> {
    write!(state.writer.lock().await, "{}", data).map_err(|_| ())
}

#[tauri::command]
async fn async_resize_pty(rows: u16, cols: u16, state: State<'_, AppState>) -> Result<(), ()> {
    state
        .pty_pair
        .lock()
        .await
        .master
        .resize(PtySize {
            rows,
            cols,
            ..Default::default()
        })
        .map_err(|_| ())
}

// Postgres commands
#[tokio::main]
#[tauri::command]
async fn send_recv_postgres(state: State<GlobalPG>, data: &str) -> String {
    // debug!("{}", data);

    // let pg = &state.inner().0;
    // let conn = tauri_pg_connect(pg, "test").await;

    // tauri_pg_query(conn, data).await
    "".to_string()
}

/// TODO: A special method to test sending to the terminal. This should use the normal method.
#[tokio::main]
#[tauri::command]
async fn send_recv_postgres_terminal(state: State<GlobalPG>, data: &str) -> String {
    debug!("From the terminal, {}", data);

    // let pg = &state.inner().0;
    // let conn = tauri_pg_connect(pg, "test").await;

    // let result = tauri_pg_query(conn, data).await;

    // result.into()
    "".to_string()
}

#[tokio::main]
pub async fn tauri_pg_init_database_sync() -> PgEmbed {
    return tauri_pg_init_database("/home/iib/db/data").await;
}

// #[tokio::main]
// pub async fn tauri_pg_connect_sync(pg: &PgEmbed, db_name: &str) -> PgConnection {
    // return tauri_pg_connect(pg, db_name).await;
// }


// struct Database(SqlitePool);

// struct Database{
  // pool: SqlitePool
// }

// impl Database {
//   // pub fn new(&mut self) {
//     pub async fn new(database_url: &str) -> Result<Self, sqlx::Error> {
//       let pool = SqlitePool::connect(database_url).await.unwrap();
//       Ok(Self { pool })
//   }
// }

#[tauri::command]
fn greet(name: &str) -> String {
   format!("Hello, {}!", name)
}

// #[tokio::main]
// async fn tauri_create_sqlite(name: &str) -> &SqliteConnection {
  // let conn = SqliteConnection::connect("sqlite://myAwesomeDatabase.db?mode=rwc").await;
// }

#[tauri::command(rename_all = "snake_case")]
// #[tokio::main]
async fn test_tauri(
  // state: State<Database>,
  name: SqlValue) -> Result<(), String> {
  println!("RSTrace: test_tauri");
  match name {
    Num => {println!("We got a Num");}
    SqlValue::Null => {println!("We got Null");}
    Uint8Array => {println!("We got an array");}
    Str => {println!("We got a String");}
  };

  // let pool = &state.inner().0;

  Ok(())
}

#[tauri::command(rename_all = "snake_case")]
fn tauri_exec(connection: State<DbConnection>, sql: &str, bind_params: bindParams) -> String {
  println!("RSTrace: tauri_exec");

  let mut file = OpenOptions::new().create(true).append(true).open("../../tauri_exec.txt").unwrap();
  file.write_all(sql.as_bytes()).unwrap();
  file.write_all("\n".as_bytes()).unwrap();
  for key in &bind_params.keys {
    file.write_all(format!("Keys: {}", key).as_bytes()).unwrap();
    file.write_all("\n".as_bytes()).unwrap();
  }
  // file.write_all(bindParams.keys.as_bytes()).unwrap();
  file.write_all("\n".as_bytes()).unwrap();
  for value in &bind_params.values {
    file.write_all(format!("Values: {:?}", value).as_bytes()).unwrap();
    file.write_all("\n".as_bytes()).unwrap();
  }
  // file.write_all(bindParams.values.as_bytes()).unwrap();
  file.write_all("\n".as_bytes()).unwrap();
  file.flush().unwrap();

  // let pool = &state.inner().0;

  // let rt  = Runtime::new().unwrap();


  // let result = tokio::task::block_in_place(|| {
  //   rt.block_on(async {
  //     pool.acquire().await.unwrap();

  //     sqlx::query(
  //       r#"
  //       CREATE TABLE IF NOT EXISTS test (
  //         id INTEGER PRIMARY KEY,
  //         description TEXT NOT NULL
  //       )
  //       "#
  //     ).execute(pool).await

  //   }).unwrap()

// });


  format!("Hello, {}!", sql)
}

#[tauri::command(rename_all = "snake_case")]
fn my_tauri_init(connection: State<DbConnection>, dbName: &str, sqlite_dist_path: &str) -> Result<(), String> {
  println!("RSTrace: my_tauri_init");

  // let mut file = OpenOptions::new().create(true).append(true).open("../../tauri_init.txt").unwrap();
  // file.write_all(name.as_bytes()).unwrap();
  // file.write_all("\n".as_bytes()).unwrap();
  // file.flush().unwrap();

  // Start the postgres when we receive this call
  block_on(async {
    *connection.db.lock().unwrap() = Some(tauri_pg_init_database(format!("/home/iib/db/{}", dbName).as_str()).await);
  });

  Ok(())
}


#[tauri::command(rename_all = "snake_case")]
fn tauri_getRowsModified(connection: State<DbConnection>) -> i64 {
  println!("RSTrace: tauri_getRowsModified");

  // let pool = &state.inner().0;

  // let rows = block_on( async {
  //   let mut pg = tauri_pg_init_database("/home/iib/db/data").await;
  //   let mut conn = tauri_pg_connect(&pg, "test").await;

  //   let _ = sqlx::query("CREATE TABLE IF NOT EXISTS testing (id BIGSERIAL PRIMARY KEY, description TEXT NOT NULL, done BOOLEAN NOT NULL DEFAULT FALSE)")
  //   .execute(&mut conn)
  //   .await
  //   .map_err(|_| PgEmbedError {
  //       error_type: PgEmbedErrorType::SqlQueryError,
  //       source: None,
  //       message: None,
  //   }).unwrap();

  //   let rows = sqlx::query("SELECT * FROM testing;")
  //   .fetch_all(&mut conn)
  //   .await
  //   .map_err(|_| PgEmbedError {
  //       error_type: PgEmbedErrorType::SqlQueryError,
  //       source: None,
  //       message: None,
  //   }).unwrap();

  //   let stop = pg.stop_db().await;
  //   stop.unwrap();

  //   rows
  // });

  // let mut result = String::new();
  // for row in rows {
  //   let row_column = row_to_json(row);
  //   result.push_str(serde_json::to_string(&row_column).unwrap().as_str());
  // }
  // println!("{}", result);

  0
}

#[tauri::command(rename_all = "snake_case")]
fn tauri_start_postgres(connection: State<DbConnection>) -> i64 {
  println!("RSTrace: tauri_start_postgres");
  block_on(async {
    *connection.db.lock().unwrap() = Some(tauri_pg_init_database("/home/iib/db/data").await);
  });

  0
}

#[tauri::command(rename_all = "snake_case")]
fn tauri_stop_postgres(connection: State<DbConnection>) -> i64 {
  println!("RSTrace: tauri_stop_postgres");
  block_on(async {
    // (*connection.db.lock().unwrap()).as_ref().expect("REASON").stop_db().await;

    if let Some(mut inner_value) = connection.db.lock().unwrap().as_mut() {
      inner_value.stop_db().await;
    }
  });

  0
}

#[tauri::command(rename_all = "snake_case")]
fn tauri_test_postgres(connection: State<DbConnection>) -> i64 {
  println!("RSTrace: tauri_test_postgres");
  block_on(async {
    // (*connection.db.lock().unwrap()).as_ref().expect("REASON").stop_db().await;

    if let Some(mut pg) = connection.db.lock().unwrap().as_mut() {
      let mut conn = tauri_pg_connect(&pg, "test").await;

      let _ = sqlx::query("CREATE TABLE IF NOT EXISTS testing (id BIGSERIAL PRIMARY KEY, description TEXT NOT NULL, done BOOLEAN NOT NULL DEFAULT FALSE)")
      .execute(&mut conn)
      .await
      .map_err(|_| PgEmbedError {
          error_type: PgEmbedErrorType::SqlQueryError,
          source: None,
          message: None,
      }).unwrap();

      let _ = sqlx::query("CREATE TABLE IF NOT EXISTS testing (id BIGSERIAL PRIMARY KEY, description TEXT NOT NULL, done BOOLEAN NOT NULL DEFAULT FALSE)")
      .execute(&mut conn)
      .await
      .map_err(|_| PgEmbedError {
          error_type: PgEmbedErrorType::SqlQueryError,
          source: None,
          message: None,
      }).unwrap();

      let _ = sqlx::query("INSERT INTO testing(description) VALUES('this is a textual description')")
      .execute(&mut conn)
      .await
      .map_err(|_| PgEmbedError {
          error_type: PgEmbedErrorType::SqlQueryError,
          source: None,
          message: None,
      }).unwrap();

      let _ = sqlx::query("INSERT INTO testing(description) VALUES($1)")
      .bind("This is the textual description")
      .execute(&mut conn)
      .await
      .map_err(|_| PgEmbedError {
          error_type: PgEmbedErrorType::SqlQueryError,
          source: None,
          message: None,
      }).unwrap();

      let rows = sqlx::query("SELECT * FROM testing")
      .fetch_all(&mut conn)
      .await
      .map_err(|_| PgEmbedError {
          error_type: PgEmbedErrorType::SqlQueryError,
          source: None,
          message: None,
      }).unwrap();

      let mut result = String::new();
      for row in rows {
          let row_column = row_to_json(row);
          result.push_str(serde_json::to_string(&row_column).unwrap().as_str());
      }
      println!("{}", result);
    }
  });
  println!("RSTrace: tauri_test_postgres ended");

  0
}

// #[tokio::main]
fn main() {
  tauri::Builder::default()
    // .setup(|app| {
      // app.manage(Database(pool));
      // app.manage(GlobalPG(tauri_pg_init_database_sync()));

      // Ok(())
    // })
    .manage(DbConnection { db: Default::default() })
    .invoke_handler(tauri::generate_handler![greet, test_tauri, my_tauri_init, tauri_exec, tauri_getRowsModified, tauri_start_postgres, tauri_stop_postgres, tauri_test_postgres])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    /// Sanity tests, to check that everything is alright
    fn test_greet() {
        assert_eq!(greet("Johnny"), "Hello, Johnny!");
    }

    #[test]
    #[should_panic]
    /// Sanity counter check, to check that bad tests fail
    fn test_greet_badly() {
        assert_eq!(greet("Johnny"), "Hello, Bonny! You've been greeted from Rust!");
    }

    #[tokio::test]
    /// Sanity test for postgres. Launch it, give some commands and stop it.
    async fn test_postgres() {
      let mut pg = tauri_pg_init_database("/home/iib/db/data").await; // TODO: this should use tauri_pg_setup
      let conn = tauri_pg_connect(&pg, "test").await;

      let stop = pg.stop_db().await;
      stop.unwrap();

      assert!(true);
    }

    #[tokio::test]
    /// Postgres test database creation, querying and destructuring
    async fn test_postgres_database_create() {
      let mut pg = tauri_pg_init_database("/home/iib/db/data").await; // TODO: this should use tauri_pg_setup
      // let mut pg = tauri_pg_setup(54321, PathBuf::from_str("/home/iib/db/data").unwrap(), false, None).await.unwrap();

      let mut conn = tauri_pg_connect(&pg, "test").await;

      let _ = sqlx::query("CREATE TABLE IF NOT EXISTS testing (id BIGSERIAL PRIMARY KEY, description TEXT NOT NULL, done BOOLEAN NOT NULL DEFAULT FALSE)")
      .execute(&mut conn)
      .await
      .map_err(|_| PgEmbedError {
          error_type: PgEmbedErrorType::SqlQueryError,
          source: None,
          message: None,
      }).unwrap();

      let _ = sqlx::query("INSERT INTO testing(description) VALUES('this is a textual description')")
      .execute(&mut conn)
      .await
      .map_err(|_| PgEmbedError {
          error_type: PgEmbedErrorType::SqlQueryError,
          source: None,
          message: None,
      }).unwrap();

      let _ = sqlx::query("INSERT INTO testing(description) VALUES($1)")
      .bind("This is the textual description")
      .execute(&mut conn)
      .await
      .map_err(|_| PgEmbedError {
          error_type: PgEmbedErrorType::SqlQueryError,
          source: None,
          message: None,
      }).unwrap();

      let rows = sqlx::query("SELECT * FROM testing")
      .fetch_all(&mut conn)
      .await
      .map_err(|_| PgEmbedError {
          error_type: PgEmbedErrorType::SqlQueryError,
          source: None,
          message: None,
      }).unwrap();

      let mut result = String::new();
      for row in rows {
          let row_column = row_to_json(row);
          result.push_str(serde_json::to_string(&row_column).unwrap().as_str());
      }
      println!("{}", result);
      let stop = pg.stop_db().await;
      stop.unwrap();

      assert!(true);
    }
}
