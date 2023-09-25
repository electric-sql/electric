// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_wasm_bindgen::Serializer;
use serde_wasm_bindgen::Deserializer;
use sqlx::Column;
use sqlx::Row;
use tokio::runtime::Runtime;
use tokio::task;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use std::fs::File;
use std::fs::OpenOptions;
use serde_json::Number;

use sqlx::{
  postgres::{PgArguments},
  Arguments
};

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
 *
 * These structures are the equivalent of what we have in the sqlx driver.
 *
 * `SqlValue` is _almost_ the same as `SqlValue` from TypeScript, except for the `bigint` type.
 * `BindParams` is the same abstraction that we use on the TypeScript part, a structure with two arrays,
 * one for keys, which can be empty, and one for `SqlValue`s.
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
struct BindParams {
  keys: Vec<String>,
  values: Vec<SqlValue>
}

/// This is made to resemble the Result from the `embedded-postgres` driver.
#[derive(Debug, Serialize, Deserialize)]
struct QueryResult {
  row_count: u64,
  rows: Vec<SqlValue>,
  columns: Vec<String>
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

#[tauri::command]
fn greet(name: &str) -> String {
   format!("Hello, {}!", name)
}

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

  Ok(())
}

#[tauri::command(rename_all = "snake_case")]
fn tauri_exec_command(connection: State<DbConnection>, sql: &str, bind_params: BindParams) -> String {
  println!("RSTrace: tauri_exec");

  for key in &bind_params.keys {

  }
  for value in &bind_params.values {
    block_on(async {
      if let Some(mut pg) = connection.db.lock().unwrap().as_mut() {
        let mut conn = tauri_pg_connect(&pg, "test").await;

        let _ = sqlx::query(sql)
        .execute(&mut conn)
        .await
        .map_err(|_| PgEmbedError {
            error_type: PgEmbedErrorType::SqlQueryError,
            source: None,
            message: None,
        }).unwrap();

      }
    });
  }

  format!("Hello, {}!", sql)
}

async fn tauri_exec(pg: &PgEmbed, sql: &str, bind_params: BindParams) -> u64 {
  println!("RSTrace: tauri_exec");
    let mut conn = tauri_pg_connect(&pg, "test").await;
    let mut args = PgArguments::default();

    for value in &bind_params.values {
      if let SqlValue::Num(num) = value {
        let num = num.as_i64();
        args.add(num);
      } else if let SqlValue::Null = value {
        args.add(None::<String>);
      } else if let SqlValue::Uint8Array(array) = value {
        todo!();
      } else if let SqlValue::Str(string) = value {
        args.add(string);
      }
    }

    let rows = sqlx::query_with(sql, args)
    .fetch_all(&mut conn)
    .await
    .map_err(|_| PgEmbedError {
      error_type: PgEmbedErrorType::SqlQueryError,
      source: None,
      message: None,
  }).unwrap();

  let mut columns: Vec<String> = Vec::new();
  let rows_modified: u64 = rows.len().try_into().unwrap();
  // for row in rows {
  //   for col in row.columns() {
  //     columns.push(col.name().to_string());
  //   }
  //   break;
  // }

  // for row in rows {

  //   break;
  // }

  rows_modified
}


#[tauri::command(rename_all = "snake_case")]
fn my_tauri_init(connection: State<DbConnection>, name: &str) -> Result<(), String> {
  println!("RSTrace: my_tauri_init");

  // Start the postgres when we receive this call
  block_on(async {
    *connection.db.lock().unwrap() = Some(tauri_pg_init_database(format!("/home/iib/db/{}", name).as_str()).await);
  });

  Ok(())
}

#[wasm_bindgen]
pub struct iib {
  actions: JsValue
}

impl Serialize for iib {
  fn serialize<S>(&self, serializer: S) -> JsValue {
    let serializer = Serializer::new()
      .serialize_large_number_types_as_bigints(true)
      .serialize_bytes_as_arrays(false);

    self.serialize(&serializer)?
  }
}

impl Deserialize<'_> for iib {
  fn deserialize(data: &[u8]) -> Self {
      let s = str::from_utf8(data).unwrap();
      let parts: Vec<&str> = s.split(',').collect();
      let name = parts[0];
      let age = parts[1].parse().unwrap();

      iib {
          actions: String::from(name),
      }
  }
}


#[tauri::command(rename_all = "snake_case")]
fn tauri_getRowsModified(connection: State<DbConnection>, iib: iib) -> i64 {
  println!("RSTrace: tauri_getRowsModified");

  0
}


#[tauri::command(rename_all = "snake_case")]
fn tauri_stop_postgres(connection: State<DbConnection>) -> i64 {
  println!("RSTrace: tauri_stop_postgres");
  block_on(async {
    if let Some(mut pg) = connection.db.lock().unwrap().as_mut() {
      pg.stop_db().await;
    }
  });

  println!("");

  0
}

#[tauri::command(rename_all = "snake_case")]
fn tauri_test_postgres(connection: State<DbConnection>) -> i64 {
  println!("RSTrace: tauri_test_postgres");
  block_on(async {
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
    .manage(DbConnection { db: Default::default() })
    .invoke_handler(tauri::generate_handler![greet, test_tauri, my_tauri_init, tauri_exec_command, tauri_getRowsModified, tauri_stop_postgres, tauri_test_postgres])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}


#[cfg(test)]
mod tests {
    use std::collections::HashMap;

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

    #[tokio::test]
    /// Postgres test database creation, querying and destructuring
    async fn test_tauri_exec() {
      let mut pg = tauri_pg_init_database("/home/iib/db/data").await; // TODO: this should use tauri_pg_setup
      let mut conn = tauri_pg_connect(&pg, "test").await;

      let keys0 = vec![];
      let values0 = vec![];
      let keys1 = vec![];
      let values1 = vec![];
      let keys2 = vec!["column1".to_string(), "column2".to_string()];
      let values2 = vec![
          SqlValue::Str("Hello, World!".to_string()),
          SqlValue::Num(Number::from(42))
      ];
      let keys3 = vec!["column1".to_string(), "column2".to_string()];
      let values3 = vec![
          SqlValue::Str("Hello, New World!".to_string()),
          SqlValue::Num(Number::from(46))
      ];
      let keys4 = vec![];
      let values4 = vec![];

      tauri_exec(&pg, "DROP TABLE IF EXISTS testing2", BindParams{keys: keys0, values: values0}).await;
      tauri_exec(&pg, "CREATE TABLE IF NOT EXISTS testing2 (id BIGSERIAL PRIMARY KEY, description TEXT NOT NULL, number INTEGER)", BindParams{keys: keys1, values: values1}).await;
      let rows_affected = tauri_exec(&pg, "INSERT INTO testing2(description, number) VALUES($1, $2)", BindParams{keys: keys2, values: values2}).await;
      let rows_affected = tauri_exec(&pg, "INSERT INTO testing2(description, number) VALUES($1, $2)", BindParams{keys: keys3, values: values3}).await;
      let rows_affected = tauri_exec(&pg, "SELECT * FROM testing2", BindParams{keys: keys4, values: values4}).await;
      assert_eq!(rows_affected, 2);

      // let mut result = String::new();
      // for row in rows {
      //     let row_column = row_to_json(row);
      //     result.push_str(serde_json::to_string(&row_column).unwrap().as_str());
      // }
      // println!("{}", result);

      let stop = pg.stop_db().await;
      stop.unwrap();

      assert!(true);
    }

    #[tokio::test]
    /// This test is a playground for all the things. After something matures, it can become its own test and a new fresh playground should be created
    /// Run with `cargo test playground`
    async fn playground() {
      use serde::{Serialize, Deserialize};
      use serde_wasm_bindgen;
      use wasm_bindgen::prelude::*;


      #[derive(Serialize, Deserialize)]
      pub struct Example {
          pub field1: HashMap<u32, String>,
          pub field2: Vec<Vec<f32>>,
          pub field3: [f32; 4],
      }

      #[wasm_bindgen]
      pub fn send_example_to_js() -> Result<JsValue, JsValue> {
          let mut field1 = HashMap::new();
          field1.insert(0, String::from("ex"));

          let example = Example {
              field1,
              field2: vec![vec![1., 2.], vec![3., 4.]],
              field3: [1., 2., 3., 4.]
          };

          Ok(serde_wasm_bindgen::to_value(&example)?)
      }

      #[wasm_bindgen]
      pub fn receive_example_from_js(val: JsValue) -> Result<(), JsValue> {
          let example: Example = serde_wasm_bindgen::from_value(val)?;
          /* …do something with `example`… */
          Ok(())
      }

      ()
    }
}
