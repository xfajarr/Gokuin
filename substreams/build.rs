// Compiles proto/sandwich.proto into Rust structs at build time.
//
// We vendor protoc via `protoc-bin-vendored` so `cargo build` works without
// requiring a system protoc install (no `substreams protogen` CLI step
// needed either -- this is a plain prost-build codegen step).
fn main() {
    println!("cargo:rerun-if-changed=proto/sandwich.proto");

    let protoc_path = protoc_bin_vendored::protoc_bin_path().expect("failed to locate vendored protoc binary");
    std::env::set_var("PROTOC", protoc_path);

    prost_build::compile_protos(&["proto/sandwich.proto"], &["proto/"]).expect("failed to compile proto/sandwich.proto");
}
