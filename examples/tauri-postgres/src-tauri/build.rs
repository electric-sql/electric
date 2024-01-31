fn main() {
    // if cfg!(target_os = "macos") {
    //     println!("cargo:rustc-link-lib=onnxruntime");
    // }
    println!("cargo:rustc-link-arg=-Lliblzma.5.dylib");
    tauri_build::build()
}
