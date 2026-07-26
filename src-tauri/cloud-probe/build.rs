fn main() {
    #[cfg(windows)]
    {
        let mut resource = tauri_winres::WindowsResource::new();
        resource.set_manifest(include_str!("app.manifest"));
        resource
            .compile()
            .expect("failed to embed the Windows probe manifest");
    }
}
