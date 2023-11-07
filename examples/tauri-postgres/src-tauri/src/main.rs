// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use futures::stream::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Number;
use sqlx::{postgres::PgArguments, Arguments};
use sqlx::{Either, PgConnection};

mod tauri_postgres;
use crate::tauri_postgres::row_to_json;
mod utils;

// General
use pg_embed::postgres::PgEmbed;

// Tauri
use tauri::async_runtime::block_on;
use tauri::Manager;
use tauri::{State, WindowEvent};

// Tauri plug-ins
use tauri_plugin_log::LogTarget;

// This package
use tauri_postgres::{tauri_pg_connect, tauri_pg_init_database, tauri_pg_query};

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
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
enum SqlValue {
    Num(Number),
    Null,
    Uint8Array(Vec<u8>),
    Str(String),
}

/// This is the equivalent of BindParams. Both the electric-sql `sqlx` driver and the `postgres` driver use this abstraction.
#[derive(Debug, Serialize, Deserialize, Clone)]
struct BindParams {
    keys: Vec<String>,
    values: Vec<SqlValue>,
}

/// This is made to resemble the Result from the `embedded-postgres` driver.
#[derive(Debug, Serialize, Deserialize)]
struct QueryResult {
    rows_modified: u64,
    result: String,
}

/*****************
 * Tauri globals *
 *****************/
/// This is the global connection to Postgres
struct DbConnection {
    db: Mutex<Option<PgEmbed>>,
    conn: Mutex<Option<PgConnection>>,
}

/// App state for the terminal window. TODO: rename to something more sensible
struct AppState {
    pty_pair: Arc<AsyncMutex<PtyPair>>,
    writer: Arc<AsyncMutex<Box<dyn Write + Send>>>,
}

/******************
 * Tauri commands *
 ******************/
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

#[tauri::command(rename_all = "snake_case")]
fn tauri_exec_command(
    connection: State<DbConnection>,
    sql: &str,
    bind_params: BindParams,
) -> QueryResult {
    block_on(async {
        if let Some(pg) = connection.db.lock().unwrap().as_mut() {
            if let Some(conn) = connection.conn.lock().unwrap().as_mut() {
                tauri_exec(pg, conn, sql, bind_params).await
            } else {
                println!("tauri_exec_command: Connection unsuccessful");
                QueryResult {
                    rows_modified: 0,
                    result: "".to_string(),
                }
            }
        } else {
            QueryResult {
                rows_modified: 0,
                result: "".to_string(),
            }
        }
    })
}

#[tauri::command]
fn send_recv_postgres_terminal(connection: State<DbConnection>, data: &str) -> String {
    println!("From the terminal, {}", data);

    block_on(async {
        match connection.conn.lock().unwrap().as_mut() {
            Some(conn) => {
                // let conn = tauri_pg_connect(pg, "test").await;

                tauri_pg_query(conn, data).await
            }
            _ => "".to_string(),
        }
    })
}

//TODO: This has to be removed after the elixir has been migrated to postgres as well
fn replace_question_marks(input: &str) -> String {
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

async fn tauri_exec(
    _pg: &mut PgEmbed,
    conn: &mut PgConnection,
    sql: &str,
    bind_params: BindParams,
) -> QueryResult {
    let sql2 = replace_question_marks(sql);
    println!("tauri_exec input\n{}\n{:?}", sql2, bind_params);

    let mut args = PgArguments::default();

    for value in &bind_params.values {
        if let SqlValue::Num(num) = value {
            let num = num.as_i64();
            args.add(num);
        } else if let SqlValue::Null = value {
            args.add(None::<String>);
        } else if let SqlValue::Uint8Array(_) = value {
            todo!();
        } else if let SqlValue::Str(string) = value {
            args.add(string);
        }
    }

    let mut accumulate_rows = Vec::new();
    let mut accumulate_rows_modified: u64 = 0;
    let mut err = false;

    // This block is here so we can reuse the connection
    // after results goes out of scope
    {
        let mut results;

        let conn2 = &mut *conn;
        results = sqlx::query_with(sql2.as_str(), args).fetch_many(conn2);

        while let Some(result) = results.next().await {
            let either = match result {
                Ok(either) => either,
                Err(_) => {
                    err = true;
                    break;
                }
            };
            match either {
                Either::Left(res) => {
                    accumulate_rows_modified += res.rows_affected();
                }
                Either::Right(row) => {
                    accumulate_rows_modified += 1;
                    accumulate_rows.push(row);
                }
            }
        }
    }

    if err {
        let result = QueryResult {
            rows_modified: 0,
            result: String::new(),
        };

        println!(
            "tauri_exec output error\n{}\n{:?}",
            result.result, result.rows_modified
        );

        return result;
    }

    let mut result = String::new();
    let mut array_rows = Vec::new();

    for row in accumulate_rows {
        array_rows.push(row_to_json(row));
    }
    result.push_str(serde_json::to_string(&array_rows).unwrap().as_str());

    println!(
        "tauri_exec output\n{}\n{:?}",
        result, accumulate_rows_modified
    );

    QueryResult {
        rows_modified: accumulate_rows_modified,
        result,
    }
}

#[tauri::command(rename_all = "snake_case")]
fn tauri_init_command(connection: State<DbConnection>, name: &str) -> Result<(), String> {
    // Start the postgres when we receive this call
    block_on(async {
        let pg = tauri_pg_init_database(format!("/home/iib/db/{}", name).as_str()).await;
        let conn = tauri_pg_connect(&pg, "test").await;

        *connection.db.lock().unwrap() = Some(pg);
        *connection.conn.lock().unwrap() = Some(conn);
    });

    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
fn tauri_stop_postgres(connection: State<DbConnection>) {
    block_on(async {
        if let Some(pg) = connection.db.lock().unwrap().as_mut() {
            pg.stop_db().await.unwrap()
        }
    });
}

fn main() {
    let _log = tauri_plugin_log::Builder::default()
        .targets([
            LogTarget::Folder(utils::app_root()),
            LogTarget::Stdout,
            LogTarget::Webview,
        ])
        .level(log::LevelFilter::Debug);

    // Setup the postgres terminal
    let pty_system = native_pty_system();
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();

    #[cfg(target_os = "windows")]
    let cmd = CommandBuilder::new("powershell.exe");
    #[cfg(not(target_os = "windows"))]
    let cmd = CommandBuilder::new("bash");

    let mut child = pty_pair.slave.spawn_command(cmd).unwrap();

    thread::spawn(move || {
        child.wait().unwrap();
    });

    let reader = pty_pair.master.try_clone_reader().unwrap();
    let _writer = pty_pair.master.take_writer().unwrap();

    let reader = Arc::new(Mutex::new(Some(BufReader::new(reader))));

    tauri::Builder::default()
        .on_page_load(move |window, _| {
            let window = window.clone();
            let reader = reader.clone();

            thread::spawn(move || {
                let reader = reader.lock().unwrap().take();
                if let Some(mut reader) = reader {
                    loop {
                        sleep(Duration::from_millis(1));
                        let data = reader.fill_buf().unwrap().to_vec();
                        reader.consume(data.len());
                        if !data.is_empty() {
                            window.emit("data", data).unwrap();
                        }
                    }
                }
            });
        })
        .manage(DbConnection {
            db: Default::default(),
            conn: Default::default(),
        })
        .setup(|app| {
            // terminal
            tauri::WindowBuilder::new(
                app,
                "postgresterminal", /* must be unique */
                tauri::WindowUrl::App("debug.html".into()),
            )
            .build()?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tauri_init_command,
            tauri_exec_command,
            tauri_stop_postgres,
            async_write_to_pty,
            async_resize_pty,
            send_recv_postgres_terminal
        ])
        .on_window_event(move |event| match event.event() {
            WindowEvent::Destroyed => {
                let db_connection: State<DbConnection> = event.window().state();
                let mut db = db_connection.db.lock().unwrap();
                if let Some(mut connection) = db.take() {
                    block_on(async {
                        connection.stop_db().await.unwrap();
                    })
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use pg_embed::pg_errors::{PgEmbedError, PgEmbedErrorType};
    use sqlx::Connection;
    use std::collections::HashMap;

    #[tokio::test]
    /// Sanity test for postgres. Launch it, give some commands and stop it.
    async fn test_postgres() {
        let mut pg = tauri_pg_init_database("/home/iib/db/data").await; // TODO: this should use tauri_pg_setup
        let _conn = tauri_pg_connect(&pg, "test").await;

        pg.stop_db().await.unwrap();

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

        let _ =
            sqlx::query("INSERT INTO testing(description) VALUES('this is a textual description')")
                .execute(&mut conn)
                .await
                .map_err(|_| PgEmbedError {
                    error_type: PgEmbedErrorType::SqlQueryError,
                    source: None,
                    message: None,
                })
                .unwrap();

        let _ = sqlx::query("INSERT INTO testing(description) VALUES($1)")
            .bind("This is the textual description")
            .execute(&mut conn)
            .await
            .map_err(|_| PgEmbedError {
                error_type: PgEmbedErrorType::SqlQueryError,
                source: None,
                message: None,
            })
            .unwrap();

        let rows = sqlx::query("SELECT * FROM testing")
            .fetch_all(&mut conn)
            .await
            .map_err(|_| PgEmbedError {
                error_type: PgEmbedErrorType::SqlQueryError,
                source: None,
                message: None,
            })
            .unwrap();

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
            SqlValue::Num(Number::from(42)),
        ];
        let keys3 = vec!["column1".to_string(), "column2".to_string()];
        let values3 = vec![
            SqlValue::Str("Hello, New World!".to_string()),
            SqlValue::Num(Number::from(46)),
        ];
        let keys4 = vec![];
        let values4 = vec![];
        let keys5 = vec![];
        let values5 = vec![];

        tauri_exec(
            &mut pg,
            &mut conn,
            "DROP TABLE IF EXISTS testing2",
            BindParams {
                keys: keys0,
                values: values0,
            },
        )
        .await;
        tauri_exec(&mut pg, &mut conn, "CREATE TABLE IF NOT EXISTS testing2 (id BIGSERIAL PRIMARY KEY, description TEXT NOT NULL, number INTEGER)", BindParams{keys: keys1, values: values1}).await;
        let rows_affected = tauri_exec(
            &mut pg,
            &mut conn,
            "INSERT INTO testing2(description, number) VALUES($1, $2)",
            BindParams {
                keys: keys2,
                values: values2,
            },
        )
        .await
        .rows_modified;
        assert_eq!(rows_affected, 1);
        let rows_affected = tauri_exec(
            &mut pg,
            &mut conn,
            "INSERT INTO testing2(description, number) VALUES($1, $2)",
            BindParams {
                keys: keys3,
                values: values3,
            },
        )
        .await
        .rows_modified;
        assert_eq!(rows_affected, 1);
        let rows_affected = tauri_exec(
            &mut pg,
            &mut conn,
            "SELECT * FROM testing2",
            BindParams {
                keys: keys4,
                values: values4,
            },
        )
        .await
        .rows_modified;
        assert_eq!(rows_affected, 2);

        tauri_exec(
            &mut pg,
            &mut conn,
            "SELECT 1 FROM \ninformation_schema.tables",
            BindParams {
                keys: keys5,
                values: values5,
            },
        )
        .await;

        let stop = pg.stop_db().await;
        stop.unwrap();
    }

    #[tokio::test]
    /// Postgres test database creation, querying and destructuring
    async fn test_get_modified_rows() {
        let mut pg = tauri_pg_init_database("/home/iib/db/data").await; // TODO: this should use tauri_pg_setup
        let mut conn = tauri_pg_connect(&pg, "test").await;
        let empty_bind_params = BindParams {
            keys: vec![],
            values: vec![],
        };

        // Setup
        tauri_exec(
            &mut pg,
            &mut conn,
            "DROP TABLE IF EXISTS testing3",
            empty_bind_params.clone(),
        )
        .await;
        tauri_exec(
            &mut pg,
            &mut conn,
            "CREATE TABLE testing3 (description text, number integer)",
            empty_bind_params.clone(),
        )
        .await;
        tauri_exec(
            &mut pg,
            &mut conn,
            "INSERT INTO testing3(description, number) VALUES('desc1', 1)",
            empty_bind_params.clone(),
        )
        .await;
        tauri_exec(
            &mut pg,
            &mut conn,
            "INSERT INTO testing3(description, number) VALUES('desc2', 2)",
            empty_bind_params.clone(),
        )
        .await;

        // Test
        let sql = "SELECT * FROM testing3;";
        let rows_affected = sqlx::query_with(sql, PgArguments::default())
            .execute(&mut conn)
            .await
            .map_err(|_| PgEmbedError {
                error_type: PgEmbedErrorType::SqlQueryError,
                source: None,
                message: None,
            })
            .unwrap()
            .rows_affected();

        assert_eq!(rows_affected, 2);

        // let rows_affected = get_rows_modified(
        //     &mut conn,
        //     "INSERT INTO testing3(description, number) VALUES('desc3', 3)",
        //     PgArguments::default(),
        // )
        // .await;

        // assert_eq!(rows_affected, 1);

        let sql = "SELECT * FROM testing3;";
        let rows_affected = sqlx::query_with(sql, PgArguments::default())
            .execute(&mut conn)
            .await
            .map_err(|_| PgEmbedError {
                error_type: PgEmbedErrorType::SqlQueryError,
                source: None,
                message: None,
            })
            .unwrap()
            .rows_affected();

        assert_eq!(rows_affected, 2);
    }

    #[tokio::test]
    /// This test is a playground for all the things. After something matures, it can become its own test and a new fresh playground should be created
    /// Run with `cargo test playground`
    async fn playground() {
        use serde::{Deserialize, Serialize};
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
                field3: [1., 2., 3., 4.],
            };

            Ok(serde_wasm_bindgen::to_value(&example)?)
        }

        #[wasm_bindgen]
        pub fn receive_example_from_js(val: JsValue) -> Result<(), JsValue> {
            let example: Example = serde_wasm_bindgen::from_value(val)?;
            Ok(())
        }

        ()
    }

    #[tokio::test]
    /// Postgres test database creation, querying and destructuring
    async fn test_transactions() {
        let empty_bind_params = BindParams {
            keys: vec![],
            values: vec![],
        };

        let mut pg = tauri_pg_init_database("/home/iib/db/data").await; // TODO: this should use tauri_pg_setup
        let mut conn = tauri_pg_connect(&pg, "test").await;

        let mut tx = conn.begin().await.unwrap();

        tauri_exec(&mut pg, &mut tx, "SELECT 1", empty_bind_params.clone()).await;
        tauri_exec(&mut pg, &mut tx, "BEGIN", empty_bind_params.clone()).await;

        tx.commit().await.unwrap();

        let stop = pg.stop_db().await;
        stop.unwrap();

        assert!(true);
    }
}
