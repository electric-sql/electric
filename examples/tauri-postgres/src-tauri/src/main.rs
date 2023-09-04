// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use sqlx::{Connection, SqlitePool};
use tokio::runtime::Runtime;
use tokio::task;
use std::fs::File;
use std::io::Write;
use std::fs::OpenOptions;
use serde_json::Number;

use tauri::{Manager, State};

struct Database(SqlitePool);

// struct Database{
//   pool: SqlitePool
// }

// impl Database {
//   // pub fn new(&mut self) {
//     pub async fn new(database_url: &str) -> Result<Self, sqlx::Error> {
//       let pool = SqlitePool::connect(database_url).await.unwrap();
//       Ok(Self { pool })
//   }
// }

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum SqlValue {
  Num(Number),
  Null,
  Uint8Array(Vec<u8>),
  Str(String),
}
#[derive(Debug, Serialize, Deserialize)]
struct bindParams {
  keys: Vec<String>,
  values: Vec<SqlValue>
}

#[tauri::command]
fn greet(name: &str) -> String {
   format!("Hello, {}!", name)
}

// #[tokio::main]
// async fn tauri_create_sqlite(name: &str) -> &SqliteConnection {
  // let conn = SqliteConnection::connect("sqlite://myAwesomeDatabase.db?mode=rwc").await;
// }

#[tauri::command(rename_all = "snake_case")]
#[tokio::main]
async fn test_tauri(state: State<Database>, name: SqlValue) -> Result<(), String> {
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
fn tauri_exec(state: State<Database>, sql: &str, bind_params: bindParams) -> String {
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

use sqlx::sqlite::SqliteConnection;

#[tauri::command(rename_all = "snake_case")]
fn my_tauri_init(state: State<Database>, name: &str, sqlite_dist_path: &str) -> Result<(), String> {
  println!("RSTrace: my_tauri_init");

  let mut file = OpenOptions::new().create(true).append(true).open("../../tauri_init.txt").unwrap();
  file.write_all(name.as_bytes()).unwrap();
  file.write_all("\n".as_bytes()).unwrap();
  file.flush().unwrap();

  let mut file = OpenOptions::new().create(true).append(true).open("../../myAwesomeDatabase.db").unwrap();
  file.write_all(name.as_bytes()).unwrap();
  file.write_all("\n".as_bytes()).unwrap();
  file.flush().unwrap();


  let database_url = format!("sqlite://{}?mode=rwc", name);
  // let _ = SqliteConnection::connect(&database_url).await;

  let database_url = "sqlite://myAwesomeDatabase.db?mode=rwc".to_string();
  // let _ = SqliteConnection::connect(&database_url).await;

  // let pool = &state.inner().0;

  Ok(())
}


#[tauri::command(rename_all = "snake_case")]
fn tauri_getRowsModified(state: State<Database>) -> i64 {
  println!("RSTrace: tauri_getRowsModified");

  // let pool = &state.inner().0;

  0
}


#[tokio::main]
async fn main() {
  let pool = SqlitePool::connect("sqlite:///home/iib/test.db?mode=rwc").await.unwrap();
  // sqlite:///home/iib/test.db?mode=rwc

  tauri::Builder::default()
    .setup(|app| {
      app.manage(Database(pool));

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![greet, test_tauri, my_tauri_init, tauri_exec, tauri_getRowsModified])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
