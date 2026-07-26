use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signer, SigningKey};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};
use zeroize::Zeroize;

const IDENTITY_FORMAT: &[u8] = b"INNPILOT-DPAPI-V1\n";
const IDENTITY_FILE: &str = "device-key.dpapi";

pub(crate) struct DeviceIdentity {
    signing_key: SigningKey,
}

impl DeviceIdentity {
    pub(crate) fn load_or_create(app: &AppHandle) -> Result<Self, String> {
        let path = identity_path(app)?;
        if path.exists() {
            let interrupted_write = path.with_extension("dpapi.new");
            if interrupted_write.exists() {
                let identity = Self::load(&interrupted_write)?;
                fs::rename(&interrupted_write, &path).map_err(|error| {
                    format!("Could not recover the protected device identity: {error}")
                })?;
                return Ok(identity);
            }

            return Self::load(&path);
        }

        let mut seed = [0_u8; 32];
        getrandom::fill(&mut seed)
            .map_err(|error| format!("Could not generate the device identity: {error}"))?;
        let signing_key = SigningKey::from_bytes(&seed);
        let protected_result = protect_for_current_user(&seed);
        seed.zeroize();
        let protected = protected_result?;
        write_new_identity(&path, &protected)?;
        Ok(Self { signing_key })
    }

    fn load(path: &Path) -> Result<Self, String> {
        let contents = fs::read(path)
            .map_err(|error| format!("Could not read the protected device identity: {error}"))?;
        let encoded = contents
            .strip_prefix(IDENTITY_FORMAT)
            .ok_or_else(|| "The protected device identity has an unknown format.".to_string())?;
        let protected = URL_SAFE_NO_PAD
            .decode(encoded)
            .map_err(|_| "The protected device identity is damaged.".to_string())?;
        let mut seed = unprotect_for_current_user(&protected)?;
        if seed.len() != 32 {
            seed.zeroize();
            return Err("The protected device identity has an invalid length.".to_string());
        }
        let mut key_bytes = [0_u8; 32];
        key_bytes.copy_from_slice(&seed);
        seed.zeroize();
        let signing_key = SigningKey::from_bytes(&key_bytes);
        key_bytes.zeroize();
        Ok(Self { signing_key })
    }

    pub(crate) fn public_key_base64(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.signing_key.verifying_key().as_bytes())
    }

    pub(crate) fn fingerprint(&self) -> String {
        hex_digest(self.signing_key.verifying_key().as_bytes())
    }

    pub(crate) fn sign_base64(&self, value: &[u8]) -> String {
        URL_SAFE_NO_PAD.encode(self.signing_key.sign(value).to_bytes())
    }
}

pub(crate) fn hex_digest(value: &[u8]) -> String {
    Sha256::digest(value)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn identity_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("runner").join(IDENTITY_FILE))
        .map_err(|error| format!("Could not locate InnPilot's private data folder: {error}"))
}

fn write_new_identity(path: &Path, protected: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "The device identity location is invalid.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create the private runner folder: {error}"))?;

    let temporary = path.with_extension("dpapi.new");
    let encoded = URL_SAFE_NO_PAD.encode(protected);
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|error| format!("Could not prepare the protected device identity: {error}"))?;
    file.write_all(IDENTITY_FORMAT)
        .and_then(|_| file.write_all(encoded.as_bytes()))
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Could not safely store the device identity: {error}"))?;
    fs::rename(&temporary, path)
        .map_err(|error| format!("Could not activate the protected device identity: {error}"))
}

#[cfg(windows)]
fn protect_for_current_user(value: &[u8]) -> Result<Vec<u8>, String> {
    use std::{ptr, slice};
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB},
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: value.len() as u32,
        pbData: value.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };
    let result = unsafe {
        CryptProtectData(
            &input,
            ptr::null(),
            ptr::null(),
            ptr::null_mut(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if result == 0 {
        return Err(format!(
            "Windows could not protect the device identity: {}",
            std::io::Error::last_os_error()
        ));
    }

    let protected =
        unsafe { slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe {
        LocalFree(output.pbData as *mut core::ffi::c_void);
    }
    Ok(protected)
}

#[cfg(windows)]
fn unprotect_for_current_user(value: &[u8]) -> Result<Vec<u8>, String> {
    use std::{ptr, slice};
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: value.len() as u32,
        pbData: value.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };
    let result = unsafe {
        CryptUnprotectData(
            &input,
            ptr::null_mut(),
            ptr::null(),
            ptr::null_mut(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if result == 0 {
        return Err(
            "This device identity cannot be unlocked by the current Windows user.".to_string(),
        );
    }

    let plain = unsafe { slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe {
        LocalFree(output.pbData as *mut core::ffi::c_void);
    }
    Ok(plain)
}

#[cfg(not(windows))]
fn protect_for_current_user(_value: &[u8]) -> Result<Vec<u8>, String> {
    Err("InnPilot device identity protection is available only on Windows.".to_string())
}

#[cfg(not(windows))]
fn unprotect_for_current_user(_value: &[u8]) -> Result<Vec<u8>, String> {
    Err("InnPilot device identity protection is available only on Windows.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_is_lowercase_hex() {
        assert_eq!(
            hex_digest(b"innpilot"),
            "339ec825054a3cc6b2014d68a3f0c61437fd7c035d9b16b4c0ae35af9632e88c"
        );
    }

    #[cfg(windows)]
    #[test]
    fn dpapi_round_trip_is_scoped_to_the_windows_user() {
        let secret = b"synthetic-device-key";
        let protected = protect_for_current_user(secret).unwrap();
        assert_ne!(protected, secret);
        assert_eq!(unprotect_for_current_user(&protected).unwrap(), secret);
    }
}
