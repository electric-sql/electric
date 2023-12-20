// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use dirs::home_dir;
use embeddings::embed_issue;
use futures::stream::StreamExt;
use ollama_rs::Ollama;
use serde::{Deserialize, Serialize};
use serde_json::Number;
use sqlx::{postgres::PgArguments, Arguments};
use sqlx::{Either, PgConnection};

mod tauri_postgres;
use crate::tauri_postgres::row_to_json;

mod embeddings;
mod chat;
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
use std::fs::create_dir;
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
    llama: Mutex<Option<Ollama>>,
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
        let pg = tauri_pg_init_database(
            format!(
                "{}/db/{}",
                home_dir().unwrap().into_os_string().into_string().unwrap(),
                name
            )
            .as_str(),
        )
        .await;
        let conn = tauri_pg_connect(&pg, "test").await;

        *connection.db.lock().unwrap() = Some(pg);
        *connection.conn.lock().unwrap() = Some(conn);
        *connection.llama.lock().unwrap() = Some(Ollama::default());
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

pub async fn vector_search_database(
    _pg: &mut PgEmbed,
    conn: &mut PgConnection,
    query: &str,
) -> String {
    use embeddings::{create_embedding_model, embed_query};

    let model = create_embedding_model();
    let embedded_query = embed_query(query, model);

    let results = sqlx::query(
        format!(
            "SELECT description FROM issue ORDER BY embeddings <=> '[{}]' LIMIT 1;",
            embedded_query
        )
        .as_str(),
    )
    .fetch_all(conn)
    .await
    .unwrap();

    let mut result = String::new();
    for row in results {
        let row_column = row_to_json(row);
        result.push_str(serde_json::to_string(&row_column).unwrap().as_str());
    }
    println!("{}", result);
    return result;
}

#[tauri::command(rename_all = "snake_case")]
fn tauri_embed_issue(text: &str) -> String {
    use embeddings::{create_embedding_model, format_embeddings};

    block_on(async {
        let model = create_embedding_model();

        format_embeddings(embed_issue(text, model))
    })
}

#[tauri::command(rename_all = "snake_case")]
fn tauri_vector_search(connection: State<DbConnection>, query: &str) -> String {
    let mut ret = "failed".to_string();
    block_on(async {
        if let Some(pg) = connection.db.lock().unwrap().as_mut() {
            if let Some(conn) = connection.conn.lock().unwrap().as_mut() {
                ret = vector_search_database(pg, conn, query).await;
            }
        }
    });

    return ret;
}


#[tauri::command(rename_all = "snake_case")]
fn tauri_chat(connection: State<DbConnection>, question: &str, context: &str) -> String {
    use chat::chat;
    block_on(async {
        if let Some(llama) = connection.llama.lock().unwrap().as_mut() {
            chat(llama, question.to_string(), context.to_string()).await
        } else {
            "Llama was not able to answer".to_string()
        }
    })
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
            llama: Default::default(),
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
            tauri_vector_search,
            tauri_embed_issue,
            tauri_chat,
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

    #[tokio::test]
    /// Postgres test database creation, querying and destructuring
    async fn test_ollama() {
        use ollama_rs::{
            generation::completion::{
                request::GenerationRequest, GenerationContext, GenerationResponseStream,
            },
            Ollama,
        };
        // By default it will connect to localhost:11434
        let ollama = Ollama::default();

        let model = "llama2:latest".to_string();
        let prompt = "Why is the sky blue?".to_string();

        let res = ollama
            .generate(GenerationRequest::new(model, prompt))
            .await
            .unwrap();
        println!("{}", res.response);
    }

    #[tokio::test]
    /// Test pg-embed version
    async fn test_pg_embed_version() {
        let mut pg = tauri_pg_init_database("/home/iib/db/data").await; // TODO: this should use tauri_pg_setup
        let mut conn = tauri_pg_connect(&pg, "test").await;

        let stop = pg.stop_db().await;
        stop.unwrap();

        assert!(true);
    }

    #[tokio::test]
    /// Test pg-embed version
    async fn test_onnx() {
        use fastembed::{EmbeddingBase, EmbeddingModel, FlagEmbedding, InitOptions};

        // With default InitOptions
        let model: FlagEmbedding = FlagEmbedding::try_new(Default::default()).unwrap();

        // With custom InitOptions
        let model: FlagEmbedding = FlagEmbedding::try_new(InitOptions {
            model_name: EmbeddingModel::BGEBaseEN,
            show_download_message: true,
            ..Default::default()
        })
        .unwrap();

        let documents = vec![
            "passage: Hello, World!",
            "query: Hello, World!",
            "passage: This is an example passage.",
            // You can leave out the prefix but it's recommended
            "fastembed-rs is licensed under MIT",
        ];

        // Generate embeddings with the default batch size, 256
        let embeddings = model.embed(documents, None).unwrap();

        println!("Embeddings length: {}", embeddings.len()); // -> Embeddings length: 4
        println!("Embedding dimension: {}", embeddings[0].len()); // -> Embedding dimension: 768

        // Generate embeddings for the passages
        // The texts are prefixed with "passage" for better results
        // The batch size is set to 1 for demonstration purposes
        let passages = vec![
            "This is the first passage. It contains provides more context for retrieval.",
            "Here's the second passage, which is longer than the first one. It includes additional information.",
            "And this is the third passage, the longest of all. It contains several sentences and is meant for more extensive testing."
            ];

        let embeddings = model.passage_embed(passages, Some(1)).unwrap();

        println!("Passage embeddings length: {}", embeddings.len()); // -> Embeddings length: 3
        println!("Passage embedding dimension: {}", embeddings[0].len()); // -> Passage embedding dimension: 768

        // Generate embeddings for the query
        // The text is prefixed with "query" for better retrieval
        let query = "What is the answer to this generic question?";

        let query_embedding = model.query_embed(query).unwrap();

        println!("Query embedding dimension: {}", query_embedding.len()); // -> Query embedding dimension: 768

        assert!(true);
    }

    #[tokio::test]
    /// Test vector_search. We need postgres with pgvector enabled here,
    /// so this is also a test for pgvector
    async fn test_vector_search() {
        let empty_bind_params = BindParams {
            keys: vec![],
            values: vec![],
        };

        let mut pg = tauri_pg_init_database("/Users/iib/db/data").await; // TODO: this should use tauri_pg_setup
        let mut conn = tauri_pg_connect(&pg, "test").await;

        tauri_exec(
            &mut pg,
            &mut conn,
            "CREATE EXTENSION vector;",
            empty_bind_params.clone(),
        )
        .await;
        tauri_exec(
            &mut pg,
            &mut conn,
            "CREATE TABLE items (id bigserial PRIMARY KEY, name TEXT, embedding vector(100));",
            empty_bind_params.clone(),
        )
        .await;

        tauri_exec(&mut pg, &mut conn, "INSERT INTO items VALUES (1, 'computer', '[-0.0051577436,-0.0066702785,-0.0077790986,0.008313146,-0.001982919,-0.006856959,-0.004155598,0.0051456233,-0.0028699716,-0.0037507515,0.0016218971,-0.002777102,-0.0015848217,0.0010748045,-0.0029788115,0.008521762,0.003912073,-0.0099617615,0.006261422,-0.00675622,0.00076965673,0.0044055167,-0.0051048603,-0.002111284,0.008097835,-0.004245028,-0.007638484,0.009260607,-0.0021561245,-0.004720806,0.008573295,0.0042845854,0.0043260953,0.009287216,-0.008455541,0.00525685,0.002039945,0.004189499,0.0016983944,0.0044654333,0.004487596,0.006106299,-0.0032030295,-0.0045770598,-0.00042664065,0.0025344712,-0.0032641168,0.006059481,0.0041553397,0.007766852,0.0025700203,0.008119046,-0.0013876136,0.008080279,0.003718098,-0.008049667,-0.0039347596,-0.0024725979,0.004894468,-0.0008724129,-0.0028317324,0.007835987,0.009325614,-0.0016153983,-0.0051607513,-0.0047031273,-0.0048474614,-0.009605621,0.0013724195,-0.0042261453,0.0025274444,0.0056161173,-0.004067089,-0.009599375,0.0015471478,-0.0067020725,0.0024959005,-0.0037817324,0.0070804814,0.000640407,0.0035619752,-0.002739931,-0.0017110452,0.0076550203,0.0014080878,-0.0058521517,-0.007836777,0.0012330461,0.0064565097,0.005557967,-0.008979663,0.008594665,0.004048156,0.0074717794,0.009749171,-0.0072917016,-0.009042594,0.0058376994,0.009393946,0.003507946]');", empty_bind_params.clone()).await;
        tauri_exec(&mut pg, &mut conn, "INSERT INTO items VALUES (2, 'system', '[-0.00053622725,0.00023643136,0.0051033497,0.009009273,-0.0093029495,-0.007116809,0.0064588725,0.008972988,-0.005015428,-0.0037633716,0.0073805046,-0.0015334714,-0.0045366134,0.006554052,-0.0048601604,-0.0018160177,0.0028765798,0.0009918738,-0.008285215,-0.009448818,0.007311766,0.005070262,0.0067576934,0.00076286553,0.0063508903,-0.0034053659,-0.0009464014,0.0057685734,-0.0075216377,-0.0039361035,-0.007511582,-0.00093004224,0.009538119,-0.007319167,-0.0023337686,-0.0019377411,0.008077437,-0.005930896,4.516244e-05,-0.004753734,-0.009603551,0.005007293,-0.008759585,-0.0043918253,-3.5099984e-05,-0.00029618145,-0.00766124,0.009614743,0.004982058,0.009233143,-0.008157917,0.004495798,-0.004137076,0.0008245361,0.00849862,-0.0044621765,0.0045175003,-0.00678696,-0.0035484887,0.009398508,-0.0015776526,0.00032137157,-0.00414063,-0.007682688,-0.0015080082,0.0024697948,-0.00088802696,0.0055336617,-0.002742977,0.0022600652,0.0054557943,0.008345953,-0.0014537406,-0.009208143,0.0043705525,0.00057178497,0.007441908,-0.00081328274,-0.0026384138,-0.008753009,-0.0008565569,0.002826563,0.005401429,0.0070526563,-0.0057031214,0.0018588197,0.0060888636,-0.004798051,-0.0031072604,0.0067976294,0.0016314756,0.00018991709,0.0034736372,0.00021777749,0.009618826,0.005060604,-0.00891739,-0.0070415605,0.0009014559,0.006392534]');", empty_bind_params.clone()).await;
        tauri_exec(&mut pg, &mut conn, "INSERT INTO items VALUES (3, 'user', '[-0.008243976,0.0092982175,-0.00019883178,-0.001966224,0.0046026125,-0.004098241,0.002741841,0.00694249,0.0060647577,-0.0075134244,0.009384548,0.004671078,0.0039670253,-0.006244334,0.008460378,-0.0021475316,0.008827321,-0.005365455,-0.008128209,0.006822414,0.001671247,-0.0021977755,0.009513901,0.009493717,-0.00977354,0.0025048363,0.006155136,0.0038749226,0.0020231074,0.0004297551,0.0006755149,-0.003819734,-0.0071387477,-0.0020857744,0.003922672,0.008821388,0.009260761,-0.0059755677,-0.009403811,0.009766435,0.0034311758,0.0051681376,0.006281367,-0.0028049033,0.007322583,0.0028303766,0.0028700498,-0.0023791513,-0.0031282043,-0.0023682013,0.0042768745,7.808367e-05,-0.009586265,-0.009664092,-0.0061474317,-0.00013067652,0.0019958965,0.0094319945,0.0055869417,-0.0042908685,0.0002766642,0.0049665086,0.007701729,-0.0011444706,0.0043214113,-0.0058156233,-0.000806561,0.008097469,-0.0023595393,-0.009665874,0.0057808654,-0.003927708,-0.0012244319,0.009979865,-0.0022559795,-0.0047581927,-0.0053285286,0.006979481,-0.0057078465,0.0021146915,-0.0052546123,0.006121486,0.004357949,0.0026095302,-0.001491907,-0.0027474174,0.008991138,0.0052170185,-0.0021602784,-0.009469213,-0.007428286,-0.0010614037,-0.0007941263,-0.0025604777,0.00968557,-0.0004605082,0.005872903,-0.0074473293,-0.0025033513,-0.005550342]');", empty_bind_params.clone()).await;

        tauri_exec(&mut pg, &mut conn, "SELECT name FROM items WHERE id != 1 ORDER BY embedding <-> (SELECT embedding FROM items WHERE id = 1) LIMIT 1;", empty_bind_params.clone()).await;

        let stop = pg.stop_db().await;
        stop.unwrap();

        assert!(true);
    }
}
