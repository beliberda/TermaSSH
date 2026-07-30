use tauri::AppHandle;

use crate::error::{IpcError, IpcResult};
use crate::models::sftp::{RecursiveFileEntry, SftpEntry};
use crate::services::local_fs::{self, LocalStat};
use crate::utils::cache_paths::open_upload_staging_path;

#[tauri::command]
pub async fn local_list_dir(path: String) -> IpcResult<Vec<SftpEntry>> {
    local_fs::list_dir(&path)
}

#[tauri::command]
pub async fn local_stat(path: String) -> IpcResult<LocalStat> {
    local_fs::stat(&path)
}

#[tauri::command]
pub async fn local_exists(path: String) -> IpcResult<bool> {
    local_fs::exists(&path)
}

#[tauri::command]
pub async fn local_mkdir(path: String) -> IpcResult<()> {
    local_fs::mkdir(&path)
}

#[tauri::command]
pub async fn local_rename(old_path: String, new_path: String) -> IpcResult<()> {
    local_fs::rename(&old_path, &new_path)
}

#[tauri::command]
pub async fn local_delete(path: String, is_directory: bool) -> IpcResult<()> {
    local_fs::delete(&path, is_directory)
}

#[tauri::command]
pub async fn local_home_dir() -> IpcResult<Option<String>> {
    Ok(local_fs::default_home_dir())
}

#[tauri::command]
pub async fn local_list_recursive(path: String) -> IpcResult<Vec<RecursiveFileEntry>> {
    local_fs::list_files_recursive(&path)
}

#[tauri::command]
pub async fn local_reveal_in_explorer(path: String) -> IpcResult<()> {
    local_fs::reveal_in_explorer(&path)
}

/// Spools a file dragged in from outside the app (e.g. Windows Explorer) to
/// disk so it can be uploaded through the normal path-based transfer
/// pipeline. `data_base64` is the whole file content; the frontend reads it
/// via the browser File API since HTML5 drag-and-drop never exposes a real
/// filesystem path for externally dropped files.
#[tauri::command]
pub async fn local_stage_upload(
    app: AppHandle,
    file_name: String,
    data_base64: String,
) -> IpcResult<String> {
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &data_base64)
        .map_err(|e| {
            let err = IpcError::with_str_detail("fs.stageUploadFailed", "raw", e.to_string());
            tracing::error!(file_name = %file_name, error = %err, "OS drag-drop upload: base64 decode failed");
            err
        })?;

    let path = open_upload_staging_path(&app, &file_name)?;
    std::fs::write(&path, bytes).map_err(|e| {
        let err = IpcError::with_str_detail("fs.stageUploadFailed", "raw", e.to_string());
        tracing::error!(file_name = %file_name, path = %path.display(), error = %err, "OS drag-drop upload: staging write failed");
        err
    })?;

    Ok(path.to_string_lossy().to_string())
}
