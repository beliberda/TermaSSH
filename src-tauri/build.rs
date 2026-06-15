fn main() {
    let icon_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("icons/icon.ico");

    println!("cargo:rerun-if-changed={}", icon_path.display());

    // MinGW ld exports all symbols from static libs into cdylib and hits PE ordinal limit.
    // See: https://github.com/tauri-apps/tauri/issues/10843
    let target = std::env::var("TARGET").unwrap_or_default();
    if target.contains("windows-gnu") {
        println!("cargo:rustc-link-arg=-Wl,--exclude-libs=ALL,--exclude-all-symbols");
    }

    tauri_build::try_build(
        tauri_build::Attributes::new().windows_attributes(
            tauri_build::WindowsAttributes::new().window_icon_path(&icon_path),
        ),
    )
    .expect("failed to run tauri build");
}
