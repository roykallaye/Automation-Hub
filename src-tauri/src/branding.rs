use crate::{config, preflight};
use serde::Deserialize;
use std::{fs, path::Path};
use tauri::AppHandle;

/// Branding fields the frontend can update. Everything stays in the local
/// config.json — the logo itself is never copied or uploaded, only its path.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClientBrandingDraft {
    pub(crate) display_name: String,
    pub(crate) palette: String,
    #[serde(default)]
    pub(crate) logo_path: String,
    #[serde(default)]
    pub(crate) primary_color: String,
    #[serde(default)]
    pub(crate) accent_color: String,
    #[serde(default)]
    pub(crate) background_style: String,
    pub(crate) watermark_enabled: bool,
    pub(crate) watermark_opacity: u8,
}

pub(crate) fn save_client_branding(
    app: &AppHandle,
    draft: ClientBrandingDraft,
) -> Result<preflight::AppConfigStatus, String> {
    let (mut hub_config, _) = config::ensure_config_with_path(app)?;

    let display_name = draft.display_name.trim();
    if !display_name.is_empty() {
        hub_config.client.display_name = display_name.to_string();
    }
    hub_config.client.branding = config::BrandingConfig {
        palette: draft.palette,
        logo_path: draft.logo_path,
        primary_color: draft.primary_color,
        accent_color: draft.accent_color,
        background_style: draft.background_style,
        watermark_enabled: draft.watermark_enabled,
        watermark_opacity: draft.watermark_opacity,
    }
    .sanitized();

    let config_path = config::save_config_for_app(app, &hub_config)?;
    Ok(preflight::AppConfigStatus::new(
        config_path.to_string_lossy().to_string(),
        hub_config,
    ))
}

const MAX_LOGO_BYTES: u64 = 4 * 1024 * 1024;

/// Returns the configured hotel logo as a data URL, or None when no logo is
/// configured. Only the path saved in branding config is ever read.
pub(crate) fn read_branding_logo(app: &AppHandle) -> Result<Option<String>, String> {
    let hub_config = config::ensure_config(app)?;
    let logo_path = hub_config.client.branding.logo_path.trim().to_string();
    if logo_path.is_empty() {
        return Ok(None);
    }
    read_logo_data_url(Path::new(&logo_path)).map(Some)
}

fn read_logo_data_url(path: &Path) -> Result<String, String> {
    let mime = logo_mime_type(path)
        .ok_or_else(|| "The logo file must be a PNG, JPG, GIF, WEBP, or SVG image.".to_string())?;
    let metadata = fs::metadata(path)
        .map_err(|_| "The logo file could not be found. Choose the logo again.".to_string())?;
    if !metadata.is_file() {
        return Err("The logo path is not a file. Choose the logo again.".to_string());
    }
    if metadata.len() > MAX_LOGO_BYTES {
        return Err("The logo file is too large. Choose an image under 4 MB.".to_string());
    }
    let bytes =
        fs::read(path).map_err(|_| "The logo file could not be read right now.".to_string())?;
    Ok(format!("data:{mime};base64,{}", base64_encode(&bytes)))
}

fn logo_mime_type(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_string_lossy().to_lowercase();
    match extension.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        _ => None,
    }
}

const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Minimal standard base64 with padding; avoids adding a crate dependency
/// for a single local-logo read path.
fn base64_encode(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        output.push(BASE64_ALPHABET[(triple >> 18) as usize & 63] as char);
        output.push(BASE64_ALPHABET[(triple >> 12) as usize & 63] as char);
        output.push(if chunk.len() > 1 {
            BASE64_ALPHABET[(triple >> 6) as usize & 63] as char
        } else {
            '='
        });
        output.push(if chunk.len() > 2 {
            BASE64_ALPHABET[triple as usize & 63] as char
        } else {
            '='
        });
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_encodes_known_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn logo_mime_type_accepts_images_only() {
        assert_eq!(
            logo_mime_type(Path::new(r"C:\hotel\logo.PNG")),
            Some("image/png")
        );
        assert_eq!(
            logo_mime_type(Path::new(r"C:\hotel\logo.jpeg")),
            Some("image/jpeg")
        );
        assert_eq!(logo_mime_type(Path::new(r"C:\hotel\logo.exe")), None);
        assert_eq!(logo_mime_type(Path::new(r"C:\hotel\logo")), None);
    }

    #[test]
    fn read_logo_data_url_round_trips_a_png_file() {
        let dir = std::env::temp_dir().join("innpilot_branding_logo_test");
        fs::create_dir_all(&dir).unwrap();
        let logo = dir.join("logo.png");
        fs::write(&logo, [0x89, b'P', b'N', b'G']).unwrap();

        let data_url = read_logo_data_url(&logo).unwrap();

        assert!(data_url.starts_with("data:image/png;base64,"));
        assert_eq!(data_url, "data:image/png;base64,iVBORw==");
    }

    #[test]
    fn read_logo_data_url_rejects_non_image_extension() {
        let dir = std::env::temp_dir().join("innpilot_branding_logo_test_bad");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("logo.txt");
        fs::write(&file, b"not an image").unwrap();

        assert!(read_logo_data_url(&file).is_err());
    }
}
