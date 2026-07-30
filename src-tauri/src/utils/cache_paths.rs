use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;

use tauri::AppHandle;
use tauri::Manager;

use crate::error::{IpcError, IpcResult};

pub fn open_cache_path(app: &AppHandle, remote_path: &str) -> IpcResult<PathBuf> {
    let filename = remote_path
        .split('/')
        .filter(|p| !p.is_empty())
        .last()
        .ok_or_else(|| IpcError::new("fs.pathEmpty"))?;

    let mut hasher = DefaultHasher::new();
    remote_path.hash(&mut hasher);
    let safe_name = format!("{:016x}-{}", hasher.finish(), filename);

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| IpcError::with_str_detail("unknown", "raw", e.to_string()))?
        .join("termassh")
        .join("open");

    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| IpcError::with_str_detail("fs.createLocalDirFailed", "raw", e.to_string()))?;

    Ok(cache_dir.join(safe_name))
}

/// Staging path for a file dropped onto the app from outside (e.g. Windows
/// Explorer). The browser only hands us bytes, not a real filesystem path,
/// so we spool them here before feeding the existing path-based upload
/// pipeline. Keyed by a fresh uuid so dropping the same file name twice
/// never collides.
pub fn open_upload_staging_path(app: &AppHandle, file_name: &str) -> IpcResult<PathBuf> {
    let safe_name = file_name
        .rsplit(['/', '\\'])
        .next()
        .filter(|n| !n.is_empty())
        .unwrap_or("upload");

    let staging_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| IpcError::with_str_detail("unknown", "raw", e.to_string()))?
        .join("termassh")
        .join("upload");

    std::fs::create_dir_all(&staging_dir)
        .map_err(|e| IpcError::with_str_detail("fs.createLocalDirFailed", "raw", e.to_string()))?;

    Ok(staging_dir.join(format!("{}-{}", uuid::Uuid::new_v4(), safe_name)))
}
