use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, path::Path};

const MAX_WORKER_BYTES: u64 = 256 * 1024 * 1024;
const CHECKSUM_FILE: &str = "innpilot-worker.sha256";

pub(crate) fn is_innpilot_worker(executable: &str) -> bool {
    Path::new(executable)
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            name.eq_ignore_ascii_case("innpilot-worker.exe")
                || name.eq_ignore_ascii_case("innpilot-worker")
        })
}

pub(crate) fn verify_worker(executable: &str) -> Result<(), String> {
    if !is_innpilot_worker(executable) {
        return Ok(());
    }
    let worker = Path::new(executable);
    let checksum_path = worker
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(CHECKSUM_FILE);
    verify_worker_files(worker, &checksum_path)
}

fn verify_worker_files(worker: &Path, checksum_path: &Path) -> Result<(), String> {
    let metadata = worker
        .metadata()
        .map_err(|_| "The private automation engine is missing.".to_string())?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_WORKER_BYTES {
        return Err("The private automation engine has an invalid size.".to_string());
    }
    let expected = read_expected_checksum(checksum_path)?;
    let actual = sha256_file(worker)?;
    if actual != expected {
        return Err(
            "The private automation engine failed its integrity check. Reinstall InnPilot."
                .to_string(),
        );
    }
    Ok(())
}

fn read_expected_checksum(path: &Path) -> Result<String, String> {
    let contents = std::fs::read_to_string(path).map_err(|_| {
        "The automation engine checksum is missing. Reinstall InnPilot.".to_string()
    })?;
    let checksum = contents.split_whitespace().next().unwrap_or_default();
    if checksum.len() != 64 || !checksum.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("The automation engine checksum is invalid. Reinstall InnPilot.".to_string());
    }
    Ok(checksum.to_ascii_lowercase())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path)
        .map_err(|_| "The private automation engine could not be read.".to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "The private automation engine could not be verified.".to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn matching_worker_and_checksum_are_accepted() {
        let root = temp_root("matching");
        let worker = root.join("innpilot-worker.exe");
        let checksum = root.join(CHECKSUM_FILE);
        std::fs::write(&worker, b"synthetic worker fixture").unwrap();
        std::fs::write(
            &checksum,
            format!("{}  innpilot-worker.exe\n", sha256_file(&worker).unwrap()),
        )
        .unwrap();
        assert!(verify_worker_files(&worker, &checksum).is_ok());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn changed_worker_is_rejected() {
        let root = temp_root("changed");
        let worker = root.join("innpilot-worker.exe");
        let checksum = root.join(CHECKSUM_FILE);
        std::fs::write(&worker, b"original").unwrap();
        std::fs::write(
            &checksum,
            format!("{}  innpilot-worker.exe\n", sha256_file(&worker).unwrap()),
        )
        .unwrap();
        std::fs::write(&worker, b"modified").unwrap();
        assert!(verify_worker_files(&worker, &checksum)
            .unwrap_err()
            .contains("integrity check"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn external_python_is_not_subject_to_worker_checksum_format() {
        assert!(verify_worker(r"C:\Python314\python.exe").is_ok());
    }

    fn temp_root(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("innpilot_worker_{name}_{nonce}"));
        std::fs::create_dir_all(&root).unwrap();
        root
    }
}
