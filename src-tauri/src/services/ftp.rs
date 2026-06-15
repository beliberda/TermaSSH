use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use suppaftp::list::ListParser;
use suppaftp::tokio::AsyncFtpStream;
use tauri::AppHandle;
use tokio::io::AsyncReadExt;
use tokio::sync::Mutex;

use crate::error::{IpcError, IpcResult};
use crate::models::sftp::{RecursiveFileEntry, SftpEntry};
use crate::models::SessionConfig;
use crate::services::transfer_cancel::TransferCancelRegistry;
use crate::services::ssh::CONNECT_TIMEOUT_SECS;
use crate::utils::cache_paths::open_cache_path;
use crate::utils::sftp_paths::normalize_remote_path;
use crate::utils::transfer::TransferProgress;

pub type SharedFtpClient = Arc<Mutex<AsyncFtpStream>>;

pub async fn connect(
    session: &SessionConfig,
    password: Option<String>,
) -> IpcResult<AsyncFtpStream> {
    let pwd = password.ok_or_else(|| IpcError::new("ftp.passwordRequired"))?;
    let addr = format!("{}:{}", session.host, session.port);

    let ftp = tokio::time::timeout(
        Duration::from_secs(CONNECT_TIMEOUT_SECS),
        AsyncFtpStream::connect(&addr),
    )
    .await
    .map_err(|_| IpcError::new("connection.timeout"))?
    .map_err(|e| IpcError::with_str_detail("ftp.connectFailed", "raw", e.to_string()))?;

    let mut ftp = ftp;
    ftp.login(&session.username, &pwd)
        .await
        .map_err(|e| IpcError::with_str_detail("ftp.loginFailed", "raw", e.to_string()))?;

    Ok(ftp)
}

fn join_entry_path(parent: &str, name: &str) -> String {
    let parent = normalize_remote_path(parent);
    if parent == "/" {
        format!("/{name}")
    } else {
        format!("{parent}/{name}")
    }
}

fn system_time_to_iso(time: std::time::SystemTime) -> Option<String> {
    let secs = time.duration_since(UNIX_EPOCH).ok()?.as_secs();
    chrono::DateTime::from_timestamp(secs as i64, 0)
        .map(|dt| dt.to_rfc3339())
}

fn parse_list_line(line: &str) -> Option<suppaftp::list::File> {
    ListParser::parse_posix(line)
        .ok()
        .or_else(|| ListParser::parse_dos(line).ok())
}

pub async fn list_dir(client: &SharedFtpClient, path: &str) -> IpcResult<Vec<SftpEntry>> {
    let path = normalize_remote_path(path);
    let mut ftp = client.lock().await;

    let list_path = if path == "/" { None } else { Some(path.as_str()) };
    let lines = ftp
        .list(list_path)
        .await
        .map_err(|e| IpcError::with_str_detail("ftp.listFailed", "raw", e.to_string()))?;

    let mut entries: Vec<SftpEntry> = lines
        .iter()
        .filter_map(|line| {
            let file = parse_list_line(line)?;
            let name = file.name().to_string();
            if name == "." || name == ".." {
                return None;
            }
            Some(SftpEntry {
                name: name.clone(),
                path: join_entry_path(&path, &name),
                is_directory: file.is_directory(),
                size: file.size() as u64,
                modified_at: system_time_to_iso(file.modified()),
            })
        })
        .collect();

    entries.sort_by(|a, b| {
        match (a.is_directory, b.is_directory) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

pub async fn upload_file(
    client: &SharedFtpClient,
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

    let file_size = tokio::fs::metadata(local)
        .await
        .map_err(|e| IpcError::with_str_detail("fs.statLocalFailed", "raw", e.to_string()))?
        .len();

    let file_name = local
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| local_path.to_string());

    let progress = match (app, connection_id, transfer_id) {
        (Some(app), Some(conn_id), Some(tid)) => Some(TransferProgress::new(
            app,
            tid,
            conn_id,
            &file_name,
            "upload",
            file_size,
            cancel,
        )),
        _ => None,
    };

    let remote_path = normalize_remote_path(remote_path);
    let mut file = tokio::fs::File::open(local)
        .await
        .map_err(|e| IpcError::with_str_detail("fs.openLocalFailed", "raw", e.to_string()))?;

    if let Some(ref p) = progress {
        p.check_cancelled()?;
    } else if let Some(registry) = cancel {
        registry.check_not_cancelled(transfer_id)?;
    }

    let mut ftp = client.lock().await;
    let result = ftp
        .put_file(&remote_path, &mut file)
        .await
        .map_err(|e| IpcError::with_str_detail("ftp.uploadFailed", "raw", e.to_string()));

    match (&result, &progress) {
        (Ok(_), Some(p)) => {
            p.update(file_size);
            p.done();
        }
        (Err(_), Some(p)) => p.error(),
        _ => {}
    }

    result.map(|_| ())
}

pub async fn download_file(
    client: &SharedFtpClient,
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
        .unwrap_or_else(|| remote_path.clone());

    let mut ftp = client.lock().await;

    let mut stream = ftp
        .retr_as_stream(&remote_path)
        .await
        .map_err(|e| IpcError::with_str_detail("ftp.downloadFailed", "raw", e.to_string()))?;

    let mut data = Vec::new();
    const CHUNK: usize = 64 * 1024;
    let mut buf = vec![0u8; CHUNK];
    let mut total_read = 0u64;

    let progress = match (app, connection_id, transfer_id) {
        (Some(app), Some(conn_id), Some(tid)) => Some(TransferProgress::new(
            app,
            tid,
            conn_id,
            &file_name,
            "download",
            0,
            cancel,
        )),
        _ => None,
    };

    loop {
        if let Some(ref p) = progress {
            p.check_cancelled()?;
        } else if let Some(registry) = cancel {
            registry.check_not_cancelled(transfer_id)?;
        }

        let n = stream
            .read(&mut buf)
            .await
            .map_err(|e| {
                if let Some(ref p) = progress {
                    p.error();
                }
                IpcError::with_str_detail("ftp.readStreamFailed", "raw", e.to_string())
            })?;
        if n == 0 {
            break;
        }
        data.extend_from_slice(&buf[..n]);
        total_read += n as u64;
        if let Some(ref p) = progress {
            p.update(total_read);
        }
    }

    ftp.finalize_retr_stream(stream)
        .await
        .map_err(|e| IpcError::with_str_detail("ftp.finalizeFailed", "raw", e.to_string()))?;

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
    client: &SharedFtpClient,
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

    let entries = list_dir(client, &remote_path).await?;

    for entry in entries {
        if let Some(registry) = cancel {
            registry.check_not_cancelled(transfer_id)?;
        }

        let local_path = local_base.join(&entry.name);
        let local_path_str = local_path.to_string_lossy().into_owned();
        if entry.is_directory {
            Box::pin(download_dir(
                client,
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
                client,
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

pub async fn mkdir(client: &SharedFtpClient, remote_path: &str) -> IpcResult<()> {
    let remote_path = normalize_remote_path(remote_path);
    let mut ftp = client.lock().await;
    ftp.mkdir(&remote_path)
        .await
        .map_err(|e| IpcError::with_str_detail("ftp.mkdirFailed", "raw", e.to_string()))
}

pub async fn rename(
    client: &SharedFtpClient,
    old_path: &str,
    new_path: &str,
) -> IpcResult<()> {
    let old_path = normalize_remote_path(old_path);
    let new_path = normalize_remote_path(new_path);
    let mut ftp = client.lock().await;
    ftp.rename(&old_path, &new_path)
        .await
        .map_err(|e| IpcError::with_str_detail("ftp.renameFailed", "raw", e.to_string()))
}

async fn delete_inner(
    client: &SharedFtpClient,
    remote_path: &str,
    is_directory: bool,
) -> IpcResult<()> {
    let remote_path = normalize_remote_path(remote_path);
    if is_directory {
        let entries = list_dir(client, &remote_path).await?;
        for entry in entries {
            Box::pin(delete_inner(client, &entry.path, entry.is_directory)).await?;
        }
        let mut ftp = client.lock().await;
        ftp.rmdir(&remote_path)
            .await
            .map_err(|e| IpcError::with_str_detail("ftp.removeDirFailed", "raw", e.to_string()))
    } else {
        let mut ftp = client.lock().await;
        ftp.rm(&remote_path)
            .await
            .map_err(|e| IpcError::with_str_detail("ftp.removeFileFailed", "raw", e.to_string()))
    }
}

pub async fn delete(
    client: &SharedFtpClient,
    remote_path: &str,
    is_directory: bool,
) -> IpcResult<()> {
    delete_inner(client, remote_path, is_directory).await
}

async fn count_files_inner(
    client: &SharedFtpClient,
    remote_path: &str,
) -> IpcResult<u64> {
    let remote_path = normalize_remote_path(remote_path);
    let entries = list_dir(client, &remote_path).await?;
    let mut total_files = 0u64;

    for entry in entries {
        if entry.is_directory {
            total_files += Box::pin(count_files_inner(client, &entry.path)).await?;
        } else {
            total_files += 1;
        }
    }

    Ok(total_files)
}

pub async fn count_files(
    client: &SharedFtpClient,
    remote_path: &str,
) -> IpcResult<u64> {
    count_files_inner(client, remote_path).await
}

pub async fn fetch_to_cache(
    app: &tauri::AppHandle,
    client: &SharedFtpClient,
    remote_path: &str,
) -> IpcResult<String> {
    let remote_path = normalize_remote_path(remote_path);
    let local_path = open_cache_path(app, &remote_path)?;
    let local_path_str = local_path.to_string_lossy().to_string();

    download_file(
        client,
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

async fn list_files_recursive_inner(
    client: &SharedFtpClient,
    remote_path: &str,
    relative_prefix: &str,
    out: &mut Vec<RecursiveFileEntry>,
) -> IpcResult<()> {
    let remote_path = normalize_remote_path(remote_path);
    let entries = list_dir(client, &remote_path).await?;

    for entry in entries {
        let relative_path = if relative_prefix.is_empty() {
            entry.name.clone()
        } else {
            format!("{relative_prefix}/{}", entry.name)
        };

        if entry.is_directory {
            Box::pin(list_files_recursive_inner(
                client,
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
    client: &SharedFtpClient,
    remote_path: &str,
) -> IpcResult<Vec<RecursiveFileEntry>> {
    let remote_path = normalize_remote_path(remote_path);

    let parent_path = if remote_path == "/" {
        "/".to_string()
    } else {
        let parent = Path::new(&remote_path)
            .parent()
            .unwrap_or(Path::new("/"));
        normalize_remote_path(parent.to_string_lossy().as_ref())
    };

    let parent_entries = list_dir(client, &parent_path).await?;
    if let Some(entry) = parent_entries.iter().find(|e| e.path == remote_path) {
        if !entry.is_directory {
            return Ok(vec![RecursiveFileEntry {
                path: entry.path.clone(),
                name: entry.name.clone(),
                relative_path: entry.name.clone(),
                size: entry.size,
                modified_at: entry.modified_at.clone(),
            }]);
        }
    }

    let mut out = Vec::new();
    list_files_recursive_inner(client, &remote_path, "", &mut out).await?;
    Ok(out)
}

pub async fn disconnect_client(client: &SharedFtpClient) {
    let mut ftp = client.lock().await;
    let _ = ftp.quit().await;
}
