fn main() {
    let icon_dir = std::path::Path::new("icons");
    let icon_path = icon_dir.join("icon.ico");
    if !icon_path.exists() {
        std::fs::create_dir_all(icon_dir).expect("failed to create icons directory");
        std::fs::write(icon_path, placeholder_icon()).expect("failed to write placeholder icon");
    }
    tauri_build::build();
}

fn placeholder_icon() -> &'static [u8] {
    &[
        0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 32, 0, 48, 0, 0, 0, 22, 0, 0, 0, 40, 0, 0,
        0, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 32, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 166, 184, 20, 255, 0, 0, 0, 0,
    ]
}
