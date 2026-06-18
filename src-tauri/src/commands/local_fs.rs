use crate::error::IpcResult;
use crate::models::sftp::{RecursiveFileEntry, SftpEntry};
use crate::services::local_fs::{self, LocalStat};

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
