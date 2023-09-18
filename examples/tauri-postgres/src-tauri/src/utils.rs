//!
//! Common Rust util functions
//!

use std::path::PathBuf;

pub fn app_root() -> PathBuf {
    tauri::api::path::home_dir().unwrap().join(".tauri-pg")
}
