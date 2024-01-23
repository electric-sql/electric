fn main() {
    // if cfg!(target_os = "macos") {
    //     println!("cargo:rustc-link-lib=onnxruntime");
    //     println!("cargo:rustc-link-lib=dylib=libonnxruntime.dylib");
    // }
    tauri_build::build()
}
