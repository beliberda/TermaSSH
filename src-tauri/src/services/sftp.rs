use std::path::Path;
use std::sync::Arc;

use russh_sftp::client::SftpSession;
use serde_json::json;
use tauri::AppHandle;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

use crate::error::{IpcError, IpcResult};
use crate::models::sftp::{RecursiveFileEntry, SftpEntry};
use crate::services::sftp_transfer_pool::SftpTransferPool;
use crate::services::ssh::SharedSshHandle;
use crate::services::transfer_cancel::TransferCancelRegistry;
use crate::utils::cache_paths::open_cache_path;
use crate::utils::sftp_paths::{normalize_remote_path, remote_parent_path};
use crate::utils::transfer::TransferProgress;

#[derive(Clone)]
pub struct SftpSessionCache {
    session: Arc<Mutex<Option<SftpSession>>>,
    browse_lock: Arc<Mutex<()>>,
}

impl SftpSessionCache {
    pub fn new() -> Self {
        Self {
            session: Arc::new(Mutex::new(None)),
            browse_lock: Arc::new(Mutex::new(())),
        }
    }
}

async fn ensure_sftp(ssh_handle: &SharedSshHandle, cache: &SftpSessionCache) -> IpcResult<()> {
    {
        let guard = cache.session.lock().await;
        if guard.is_some() {
            return Ok(());
        }
    }

    let sftp = open_sftp_session(ssh_handle).await?;

    let mut guard = cache.session.lock().await;
    if guard.is_none() {
        *guard = Some(sftp);
    }
    Ok(())
}

async fn reset_sftp_session(cache: &SftpSessionCache) {
    let mut guard = cache.session.lock().await;
    *guard = None;
}

pub async fn open_sftp_session(ssh_handle: &SharedSshHandle) -> IpcResult<SftpSession> {
    let channel = {
        let handle = ssh_handle.lock().await;
        let channel = handle
            .channel_open_session()
            .await
            .map_err(|e| IpcError::with_str_detail("sftp.channelOpenFailed", "raw", e.to_string()))?;

        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| IpcError::with_str_detail("sftp.subsystemFailed", "raw", e.to_string()))?;

        channel
    };

    SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| IpcError::with_str_detail("sftp.initFailed", "raw", e.to_string()))
}

fn mtime_to_iso(mtime: Option<u32>) -> Option<String> {
    mtime.map(|secs| {
        chrono::DateTime::from_timestamp(secs as i64, 0)
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_else(|| secs.to_string())
    })
}

pub async fn list_dir(
    ssh_handle: &SharedSshHandle,
    cache: &SftpSessionCache,
    path: &str,
) -> IpcResult<(Vec<SftpEntry>, String)> {
    let _browse = cache.browse_lock.lock().await;
    match list_dir_unlocked(ssh_handle, cache, path).await {
        Ok(result) => Ok(result),
        Err(err) => {
            reset_sftp_session(cache).await;
            list_dir_unlocked(ssh_handle, cache, path).await.map_err(|retry_err| {
                IpcError::with_str_detail(
                    "sftp.listRetryFailed",
                    "raw",
                    format!("{err}; retry failed: {retry_err}"),
                )
            })
        }
    }
}

async fn resolve_browse_dir(sftp: &SftpSession, path: &str) -> IpcResult<String> {
    if sftp.try_exists(path).await.unwrap_or(false) {
        let metadata = sftp
            .metadata(path)
            .await
            .map_err(|e| IpcError::with_str_detail("sftp.statFailed", "raw", e.to_string()))?;
        if metadata.is_dir() {
            return Ok(path.to_string());
        }
        return Err(IpcError::with_str_detail(
            "sftp.notADirectory",
            "path",
            path,
        ));
    }

    if path.starts_with('~') || path == "." || !path.starts_with('/') {
        if let Ok(resolved) = sftp.canonicalize(path).await {
            return Ok(resolved);
        }
    }

    if path.contains('~') {
        if let Ok(resolved) = sftp.canonicalize("~").await {
            return Ok(resolved);
        }
    }

    if path.starts_with('/') {
        return Err(IpcError::with_str_detail(
            "sftp.dirNotFound",
            "path",
            path,
        ));
    }

    Err(IpcError::with_str_detail("sftp.dirNotFound", "path", path))
}

async fn list_dir_unlocked(
    ssh_handle: &SharedSshHandle,
    cache: &SftpSessionCache,
    path: &str,
) -> IpcResult<(Vec<SftpEntry>, String)> {
    ensure_sftp(ssh_handle, cache).await?;
    let path = normalize_remote_path(path);
    let guard = cache.session.lock().await;
    let sftp = guard
        .as_ref()
        .ok_or_else(|| IpcError::new("sftp.notInitialized"))?;

    let browse_path = resolve_browse_dir(sftp, &path).await?;

    let read_dir = sftp
        .read_dir(&browse_path)
        .await
        .map_err(|e| IpcError::with_str_detail("sftp.listFailed", "raw", e.to_string()))?;

    let mut entries: Vec<SftpEntry> = read_dir
        .map(|entry| {
            let metadata = entry.metadata();
            SftpEntry {
                name: entry.file_name(),
                path: entry.path(),
                is_directory: metadata.is_dir(),
                size: metadata.len(),
                modified_at: mtime_to_iso(metadata.mtime),
            }
        })
        .collect();

    entries.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok((entries, browse_path))
}

pub async fn upload_file_via_pool(
    pool: &SftpTransferPool,
    local_path: &str,
    remote_path: &str,
    app: Option<&AppHandle>,
    connection_id: Option<&str>,
    transfer_id: Option<&str>,
    cancel: Option<&TransferCancelRegistry>,
) -> IpcResult<()> {
    let guard = pool.acquire().await?;
    upload_file_with_session(
        &guard.session,
        local_path,
        remote_path,
        app,
        connection_id,
        transfer_id,
        cancel,
    )
    .await
}

async fn ensure_remote_dir_all(sftp: &SftpSession, dir: &str) -> IpcResult<()> {
    let dir = normalize_remote_path(dir);
    if dir == "/" {
        return Ok(());
    }

    if sftp.try_exists(&dir).await.unwrap_or(false) {
        let metadata = sftp
            .metadata(&dir)
            .await
            .map_err(|e| IpcError::with_str_detail("sftp.statFailed", "raw", e.to_string()))?;
        if !metadata.is_dir() {
            return Err(IpcError::with_str_detail(
                "sftp.notADirectory",
                "path",
                &dir,
            ));
        }
        return Ok(());
    }

    if let Some(parent) = remote_parent_path(&dir) {
        Box::pin(ensure_remote_dir_all(sftp, &parent)).await?;
    }

    match sftp.create_dir(&dir).await {
        Ok(()) => Ok(()),
        Err(e) => {
            if sftp.try_exists(&dir).await.unwrap_or(false) {
                Ok(())
            } else {
                Err(IpcError::with_str_detail("sftp.mkdirFailed", "raw", e.to_string()))
            }
        }
    }
}

async fn upload_file_with_session(
    sftp: &SftpSession,
    local_path: &str,
    remote_path: &str,
    app: Option<&AppHandle>,
    connection_id: Option<&str>,
    transfer_id: Option<&str>,
    cancel: Option<&TransferCancelRegistry>,
) -> IpcResult<()> {
    let local = Path::new(local_path);
    if !local.exists() {
        return Err(IpcError::with_str_detail(
            "fs.localFileNotFound",
            "path",
            local_path,
        ));
    }
    if !local.is_file() {
        return Err(IpcError::with_str_detail(
            "fs.localNotAFile",
            "path",
            local_path,
        ));
    }

    let file_size = std::fs::metadata(local)
        .map_err(|e| IpcError::with_str_detail("fs.statLocalFailed", "raw", e.to_string()))?
        .len();

    let file_name = local
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| local_path.to_string());

    let progress = match (app, connection_id, transfer_id) {
        (Some(app), Some(conn_id), Some(tid)) => Some(TransferProgress::new(
            app, tid, conn_id, &file_name, "upload", file_size, cancel,
        )),
        _ => None,
    };

    const CHUNK: usize = 64 * 1024;
    let mut data = Vec::with_capacity(file_size as usize);
    let mut file = std::fs::File::open(local)
        .map_err(|e| IpcError::with_str_detail("fs.openLocalFailed", "raw", e.to_string()))?;
    use std::io::Read;
    let mut buf = [0u8; CHUNK];
    let mut total_read = 0u64;
    loop {
        if let Some(ref p) = progress {
            p.check_cancelled()?;
        } else if let Some(registry) = cancel {
            registry.check_not_cancelled(transfer_id)?;
        }

        let n = file
            .read(&mut buf)
            .map_err(|e| IpcError::with_str_detail("fs.readLocalFailed", "raw", e.to_string()))?;
        if n == 0 {
            break;
        }
        data.extend_from_slice(&buf[..n]);
        total_read += n as u64;
        if let Some(ref p) = progress {
            p.update(total_read);
        }
    }

    let remote_path = normalize_remote_path(remote_path);
    if let Some(parent) = remote_parent_path(&remote_path) {
        ensure_remote_dir_all(sftp, &parent).await?;
    }

    let result = async {
        let mut file = sftp
            .create(&remote_path)
            .await
            .map_err(|e| {
                IpcError::with_details(
                    "sftp.uploadFailed",
                    json!({ "raw": e.to_string(), "remotePath": remote_path.clone() }),
                )
            })?;
        file.write_all(&data).await.map_err(|e| {
            IpcError::with_details(
                "sftp.uploadFailed",
                json!({ "raw": e.to_string(), "remotePath": remote_path.clone() }),
            )
        })?;
        file.shutdown().await.map_err(|e| {
            IpcError::with_details(
                "sftp.uploadFailed",
                json!({ "raw": e.to_string(), "remotePath": remote_path.clone() }),
            )
        })
    }
    .await;

    match (&result, &progress) {
        (Ok(()), Some(p)) => p.done(),
        (Err(_), Some(p)) => p.error(),
        _ => {}
    }

    result
}

pub async fn download_file_via_pool(
    pool: &SftpTransferPool,
    remote_path: &str,
    local_path: &str,
    app: Option<&AppHandle>,
    connection_id: Option<&str>,
    transfer_id: Option<&str>,
    cancel: Option<&TransferCancelRegistry>,
) -> IpcResult<()> {
    let guard = pool.acquire().await?;
    download_file_with_session(
        &guard.session,
        remote_path,
        local_path,
        app,
        connection_id,
        transfer_id,
        cancel,
    )
    .await
}

pub async fn download_file(
    ssh_handle: &SharedSshHandle,
    cache: &SftpSessionCache,
    remote_path: &str,
    local_path: &str,
    app: Option<&AppHandle>,
    connection_id: Option<&str>,
    transfer_id: Option<&str>,
    cancel: Option<&TransferCancelRegistry>,
) -> IpcResult<()> {
    ensure_sftp(ssh_handle, cache).await?;
    let guard = cache.session.lock().await;
    let sftp = guard
        .as_ref()
        .ok_or_else(|| IpcError::new("sftp.notInitialized"))?;
    download_file_with_session(
        sftp,
        remote_path,
        local_path,
        app,
        connection_id,
        transfer_id,
        cancel,
    )
    .await
}

async fn download_file_with_session(
    sftp: &SftpSession,
    remote_path: &str,
    local_path: &str,
    app: Option<&AppHandle>,
    connection_id: Option<&str>,
    transfer_id: Option<&str>,
    cancel: Option<&TransferCancelRegistry>,
) -> IpcResult<()> {
    let remote_path = normalize_remote_path(remote_path);
    let file_name = Path::new(&remote_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| remote_path.to_string());

    let file_size = {
        let metadata = sftp
            .metadata(&remote_path)
            .await
            .map_err(|e| IpcError::with_str_detail("sftp.statFailed", "raw", e.to_string()))?;
        metadata.len()
    };

    let progress = match (app, connection_id, transfer_id) {
        (Some(app), Some(conn_id), Some(tid)) => Some(TransferProgress::new(
            app, tid, conn_id, &file_name, "download", file_size, cancel,
        )),
        _ => None,
    };

    if let Some(ref p) = progress {
        p.check_cancelled()?;
    } else if let Some(registry) = cancel {
        registry.check_not_cancelled(transfer_id)?;
    }

    let data = sftp.read(&remote_path).await.map_err(|e| {
        if let Some(ref p) = progress {
            p.error();
        }
        IpcError::with_str_detail("sftp.readFailed", "raw", e.to_string())
    })?;

    if let Some(ref p) = progress {
        p.update(file_size);
    }

    if let Some(parent) = Path::new(local_path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| {
                IpcError::with_str_detail("fs.createLocalDirFailed", "raw", e.to_string())
            })?;
        }
    }

    let result = std::fs::write(local_path, data)
        .map_err(|e| IpcError::with_str_detail("fs.writeLocalFailed", "raw", e.to_string()));

    match (&result, &progress) {
        (Ok(()), Some(p)) => p.done(),
        (Err(_), Some(p)) => p.error(),
        _ => {}
    }

    result
}

pub async fn download_dir(
    ssh_handle: &SharedSshHandle,
    cache: &SftpSessionCache,
    remote_path: &str,
    local_dir: &str,
    app: Option<&AppHandle>,
    connection_id: Option<&str>,
    transfer_id: Option<&str>,
    cancel: Option<&TransferCancelRegistry>,
) -> IpcResult<()> {
    let _browse = cache.browse_lock.lock().await;
    download_dir_inner(
        ssh_handle,
        cache,
        remote_path,
        local_dir,
        app,
        connection_id,
        transfer_id,
        cancel,
    )
    .await
}

async fn download_dir_inner(
    ssh_handle: &SharedSshHandle,
    cache: &SftpSessionCache,
    remote_path: &str,
    local_dir: &str,
    app: Option<&AppHandle>,
    connection_id: Option<&str>,
    transfer_id: Option<&str>,
    cancel: Option<&TransferCancelRegistry>,
) -> IpcResult<()> {
    if let Some(registry) = cancel {
        registry.check_not_cancelled(transfer_id)?;
    }

    let remote_path = normalize_remote_path(remote_path);
    let local_base = Path::new(local_dir);

    std::fs::create_dir_all(local_base)
        .map_err(|e| IpcError::with_str_detail("fs.createLocalDirFailed", "raw", e.to_string()))?;

    let entries = list_dir_unlocked(ssh_handle, cache, &remote_path).await?.0;

    for entry in entries {
        if let Some(registry) = cancel {
            registry.check_not_cancelled(transfer_id)?;
        }

        let local_path = local_base.join(&entry.name);
        let local_path_str = local_path.to_string_lossy().into_owned();
        if entry.is_directory {
            Box::pin(download_dir_inner(
                ssh_handle,
                cache,
                &entry.path,
                &local_path_str,
                app,
                connection_id,
                transfer_id,
                cancel,
            ))
            .await?;
        } else {
            download_file(
                ssh_handle,
                cache,
                &entry.path,
                &local_path_str,
                app,
                connection_id,
                transfer_id,
                cancel,
            )
            .await?;
        }
    }

    Ok(())
}

pub async fn path_exists(
    ssh_handle: &SharedSshHandle,
    cache: &SftpSessionCache,
    path: &str,
) -> IpcResult<bool> {
    let _browse = cache.browse_lock.lock().await;
    let path = normalize_remote_path(path);

    ensure_sftp(ssh_handle, cache).await?;
    let guard = cache.session.lock().await;
    let sftp = guard
        .as_ref()
        .ok_or_else(|| IpcError::new("sftp.notInitialized"))?;

    Ok(sftp.try_exists(&path).await.unwrap_or(false))
}

pub async fn mkdir(
    ssh_handle: &SharedSshHandle,
    cache: &SftpSessionCache,
    remote_path: &str,
) -> IpcResult<()> {
    let _browse = cache.browse_lock.lock().await;
    let remote_path = normalize_remote_path(remote_path);

    ensure_sftp(ssh_handle, cache).await?;
    let guard = cache.session.lock().await;
    let sftp = guard
        .as_ref()
        .ok_or_else(|| IpcError::new("sftp.notInitialized"))?;

    sftp.create_dir(&remote_path)
        .await
        .map_err(|e| IpcError::with_str_detail("sftp.mkdirFailed", "raw", e.to_string()))
}

pub async fn rename(
    ssh_handle: &SharedSshHandle,
    cache: &SftpSessionCache,
    old_path: &str,
    new_path: &str,
) -> IpcResult<()> {
    let _browse = cache.browse_lock.lock().await;
    let old_path = normalize_remote_path(old_path);
    let new_path = normalize_remote_path(new_path);

    ensure_sftp(ssh_handle, cache).await?;
    let guard = cache.session.lock().await;
    let sftp = guard
        .as_ref()
        .ok_or_else(|| IpcError::new("sftp.notInitialized"))?;

    sftp.rename(old_path, new_path)
        .await
        .map_err(|e| IpcError::with_str_detail("sftp.renameFailed", "raw", e.to_string()))
}

async fn delete_inner(
    ssh_handle: &SharedSshHandle,
    cache: &SftpSessionCache,
    remote_path: &str,
    is_directory: bool,
) -> IpcResult<()> {
    let remote_path = normalize_remote_path(remote_path);

    if is_directory {
        let entries = list_dir_unlocked(ssh_handle, cache, &remote_path).await?.0;
        for entry in entries {
            Box::pin(delete_inner(
                ssh_handle,
                cache,
                &entry.path,
                entry.is_directory,
            ))
            .await?;
        }

        ensure_sftp(ssh_handle, cache).await?;
        let guard = cache.session.lock().await;
        let sftp = guard
            .as_ref()
            .ok_or_else(|| IpcError::new("sftp.notInitialized"))?;
        sftp.remove_dir(remote_path)
            .await
            .map_err(|e| IpcError::with_str_detail("sftp.removeDirFailed", "raw", e.to_string()))
    } else {
        ensure_sftp(ssh_handle, cache).await?;
        let guard = cache.session.lock().await;
        let sftp = guard
            .as_ref()
            .ok_or_else(|| IpcError::new("sftp.notInitialized"))?;
        sftp.remove_file(remote_path)
            .await
            .map_err(|e| IpcError::with_str_detail("sftp.removeFileFailed", "raw", e.to_string()))
    }
}

pub async fn delete(
    ssh_handle: &SharedSshHandle,
    cache: &SftpSessionCache,
    remote_path: &str,
    is_directory: bool,
) -> IpcResult<()> {
    let _browse = cache.browse_lock.lock().await;
    delete_inner(ssh_handle, cache, remote_path, is_directory).await
}

async fn count_files_inner(
    ssh_handle: &SharedSshHandle,
    cache: &SftpSessionCache,
    remote_path: &str,
) -> IpcResult<u64> {
    let remote_path = normalize_remote_path(remote_path);

    ensure_sftp(ssh_handle, cache).await?;

    let is_dir = {
        let guard = cache.session.lock().await;
        let sftp = guard
            .as_ref()
            .ok_or_else(|| IpcError::new("sftp.notInitialized"))?;

        let metadata = sftp
            .metadata(&remote_path)
            .await
            .map_err(|e| IpcError::with_str_detail("sftp.statFailed", "raw", e.to_string()))?;

        metadata.is_dir()
    };

    if !is_dir {
        return Ok(1);
    }

    let entries = list_dir_unlocked(ssh_handle, cache, &remote_path).await?.0;
    let mut total_files = 0u64;

    for entry in entries {
        if entry.is_directory {
            total_files += Box::pin(count_files_inner(ssh_handle, cache, &entry.path)).await?;
        } else {
            total_files += 1;
        }
    }

    Ok(total_files)
}

pub async fn count_files(
    ssh_handle: &SharedSshHandle,
    cache: &SftpSessionCache,
    remote_path: &str,
) -> IpcResult<u64> {
    let _browse = cache.browse_lock.lock().await;
    count_files_inner(ssh_handle, cache, remote_path).await
}

async fn list_files_recursive_inner(
    ssh_handle: &SharedSshHandle,
    cache: &SftpSessionCache,
    remote_path: &str,
    relative_prefix: &str,
    out: &mut Vec<RecursiveFileEntry>,
) -> IpcResult<()> {
    let remote_path = normalize_remote_path(remote_path);
    let entries = list_dir_unlocked(ssh_handle, cache, &remote_path).await?.0;

    for entry in entries {
        let relative_path = if relative_prefix.is_empty() {
            entry.name.clone()
        } else {
            format!("{relative_prefix}/{}", entry.name)
        };

        if entry.is_directory {
            Box::pin(list_files_recursive_inner(
                ssh_handle,
                cache,
                &entry.path,
                &relative_path,
                out,
            ))
            .await?;
        } else {
            out.push(RecursiveFileEntry {
                path: entry.path,
                name: entry.name,
                relative_path,
                size: entry.size,
                modified_at: entry.modified_at,
            });
        }
    }

    Ok(())
}

pub async fn list_files_recursive(
    ssh_handle: &SharedSshHandle,
    cache: &SftpSessionCache,
    remote_path: &str,
) -> IpcResult<Vec<RecursiveFileEntry>> {
    let _browse = cache.browse_lock.lock().await;
    let remote_path = normalize_remote_path(remote_path);

    ensure_sftp(ssh_handle, cache).await?;

    let is_dir = {
        let guard = cache.session.lock().await;
        let sftp = guard
            .as_ref()
            .ok_or_else(|| IpcError::new("sftp.notInitialized"))?;
        let metadata = sftp
            .metadata(&remote_path)
            .await
            .map_err(|e| IpcError::with_str_detail("sftp.statFailed", "raw", e.to_string()))?;
        metadata.is_dir()
    };

    if !is_dir {
        let guard = cache.session.lock().await;
        let sftp = guard
            .as_ref()
            .ok_or_else(|| IpcError::new("sftp.notInitialized"))?;
        let metadata = sftp
            .metadata(&remote_path)
            .await
            .map_err(|e| IpcError::with_str_detail("sftp.statFailed", "raw", e.to_string()))?;
        let name = Path::new(&remote_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| remote_path.clone());
        return Ok(vec![RecursiveFileEntry {
            path: remote_path.clone(),
            name: name.clone(),
            relative_path: name,
            size: metadata.len(),
            modified_at: mtime_to_iso(metadata.mtime),
        }]);
    }

    let mut out = Vec::new();
    list_files_recursive_inner(ssh_handle, cache, &remote_path, "", &mut out).await?;
    Ok(out)
}

async fn fetch_to_cache_inner(
    app: &tauri::AppHandle,
    ssh_handle: &SharedSshHandle,
    cache: &SftpSessionCache,
    remote_path: &str,
) -> IpcResult<String> {
    let remote_path = normalize_remote_path(remote_path);
    let local_path = open_cache_path(app, &remote_path)?;
    let local_path_str = local_path.to_string_lossy().to_string();

    ensure_sftp(ssh_handle, cache).await?;

    {
        let guard = cache.session.lock().await;
        let sftp = guard
            .as_ref()
            .ok_or_else(|| IpcError::new("sftp.notInitialized"))?;

        let metadata = sftp
            .metadata(&remote_path)
            .await
            .map_err(|e| IpcError::with_str_detail("sftp.statFailed", "raw", e.to_string()))?;

        if metadata.is_dir() {
            return Err(IpcError::new("sftp.openDirAsFile"));
        }
    }

    download_file(
        ssh_handle,
        cache,
        &remote_path,
        &local_path_str,
        None,
        None,
        None,
        None,
    )
    .await?;
    Ok(local_path_str)
}

pub async fn fetch_to_cache(
    app: &tauri::AppHandle,
    ssh_handle: &SharedSshHandle,
    cache: &SftpSessionCache,
    remote_path: &str,
) -> IpcResult<String> {
    let _browse = cache.browse_lock.lock().await;
    match fetch_to_cache_inner(app, ssh_handle, cache, remote_path).await {
        Ok(path) => Ok(path),
        Err(err) => {
            reset_sftp_session(cache).await;
            fetch_to_cache_inner(app, ssh_handle, cache, remote_path)
                .await
                .map_err(|retry_err| {
                    IpcError::with_str_detail(
                        "sftp.fetchRetryFailed",
                        "raw",
                        format!("{err}; retry failed: {retry_err}"),
                    )
                })
        }
    }
}
