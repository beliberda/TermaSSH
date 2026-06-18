use std::sync::Arc;

use serde::Serialize;
use tauri::AppHandle;
use tauri::State;
use tokio::sync::Mutex as AsyncMutex;

use crate::connection_pool::{BrowseContext, ConnectionPool, TransferContext};
use crate::error::IpcResult;
use crate::models::sftp::{ListDirResponse, RecursiveFileEntry};
use crate::services::transfer_cancel::TransferCancelRegistry;

type PoolState = Arc<AsyncMutex<ConnectionPool>>;

#[tauri::command]
pub async fn sftp_list_dir(
    pool: State<'_, PoolState>,
    connection_id: String,
    path: String,
) -> IpcResult<ListDirResponse> {
    let ctx = {
        let pool = pool.lock().await;
        pool.browse_context(&connection_id)?
    };

    match ctx {
        BrowseContext::Ssh { ssh_handle, sftp } => {
            let (entries, resolved_path) =
                crate::services::sftp::list_dir(&ssh_handle, &sftp, &path).await?;
            Ok(ListDirResponse {
                entries,
                resolved_path,
            })
        }
        BrowseContext::Ftp { client } => {
            let entries = crate::services::ftp::list_dir(&client, &path).await?;
            let resolved_path =
                crate::utils::sftp_paths::normalize_remote_path(&path);
            Ok(ListDirResponse {
                entries,
                resolved_path,
            })
        }
    }
}

#[tauri::command]
pub async fn sftp_exists(
    pool: State<'_, PoolState>,
    connection_id: String,
    path: String,
) -> IpcResult<bool> {
    let ctx = {
        let pool = pool.lock().await;
        pool.browse_context(&connection_id)?
    };

    match ctx {
        BrowseContext::Ssh { ssh_handle, sftp } => {
            crate::services::sftp::path_exists(&ssh_handle, &sftp, &path).await
        }
        BrowseContext::Ftp { client } => {
            crate::services::ftp::path_exists(&client, &path).await
        }
    }
}

#[tauri::command]
pub async fn sftp_upload(
    app: AppHandle,
    pool: State<'_, PoolState>,
    cancel_registry: State<'_, Arc<TransferCancelRegistry>>,
    connection_id: String,
    local_path: String,
    remote_path: String,
    transfer_id: Option<String>,
) -> IpcResult<()> {
    let cancel: Option<&TransferCancelRegistry> = transfer_id
        .as_deref()
        .map(|_| cancel_registry.as_ref());
    let ctx = {
        let pool = pool.lock().await;
        pool.transfer_context(&connection_id)?
    };

    match ctx {
        TransferContext::Ssh { transfer_pool, .. } => {
            crate::services::sftp::upload_file_via_pool(
                &transfer_pool,
                &local_path,
                &remote_path,
                Some(&app),
                Some(&connection_id),
                transfer_id.as_deref(),
                cancel,
            )
            .await
        }
        TransferContext::Ftp { client } => {
            crate::services::ftp::upload_file(
                &client,
                &local_path,
                &remote_path,
                Some(&app),
                Some(&connection_id),
                transfer_id.as_deref(),
                cancel,
            )
            .await
        }
    }
}

#[tauri::command]
pub async fn sftp_download(
    app: AppHandle,
    pool: State<'_, PoolState>,
    cancel_registry: State<'_, Arc<TransferCancelRegistry>>,
    connection_id: String,
    remote_path: String,
    local_path: String,
    is_directory: bool,
    transfer_id: Option<String>,
) -> IpcResult<()> {
    let cancel: Option<&TransferCancelRegistry> = transfer_id
        .as_deref()
        .map(|_| cancel_registry.as_ref());
    let ctx = {
        let pool = pool.lock().await;
        pool.transfer_context(&connection_id)?
    };

    match ctx {
        TransferContext::Ssh {
            ssh_handle,
            browse_sftp,
            transfer_pool,
        } => {
            if is_directory {
                crate::services::sftp::download_dir(
                    &ssh_handle,
                    &browse_sftp,
                    &remote_path,
                    &local_path,
                    Some(&app),
                    Some(&connection_id),
                    transfer_id.as_deref(),
                    cancel,
                )
                .await
            } else {
                crate::services::sftp::download_file_via_pool(
                    &transfer_pool,
                    &remote_path,
                    &local_path,
                    Some(&app),
                    Some(&connection_id),
                    transfer_id.as_deref(),
                    cancel,
                )
                .await
            }
        }
        TransferContext::Ftp { client } => {
            if is_directory {
                crate::services::ftp::download_dir(
                    &client,
                    &remote_path,
                    &local_path,
                    Some(&app),
                    Some(&connection_id),
                    transfer_id.as_deref(),
                    cancel,
                )
                .await
            } else {
                crate::services::ftp::download_file(
                    &client,
                    &remote_path,
                    &local_path,
                    Some(&app),
                    Some(&connection_id),
                    transfer_id.as_deref(),
                    cancel,
                )
                .await
            }
        }
    }
}

#[tauri::command]
pub async fn sftp_list_recursive(
    pool: State<'_, PoolState>,
    connection_id: String,
    remote_path: String,
) -> IpcResult<Vec<RecursiveFileEntry>> {
    let ctx = {
        let pool = pool.lock().await;
        pool.browse_context(&connection_id)?
    };

    match ctx {
        BrowseContext::Ssh { ssh_handle, sftp } => {
            crate::services::sftp::list_files_recursive(&ssh_handle, &sftp, &remote_path).await
        }
        BrowseContext::Ftp { client } => {
            crate::services::ftp::list_files_recursive(&client, &remote_path).await
        }
    }
}

#[tauri::command]
pub async fn sftp_mkdir(
    pool: State<'_, PoolState>,
    connection_id: String,
    remote_path: String,
) -> IpcResult<()> {
    let ctx = {
        let pool = pool.lock().await;
        pool.browse_context(&connection_id)?
    };

    match ctx {
        BrowseContext::Ssh { ssh_handle, sftp } => {
            crate::services::sftp::mkdir(&ssh_handle, &sftp, &remote_path).await
        }
        BrowseContext::Ftp { client } => crate::services::ftp::mkdir(&client, &remote_path).await,
    }
}

#[tauri::command]
pub async fn sftp_delete(
    pool: State<'_, PoolState>,
    connection_id: String,
    remote_path: String,
    is_directory: bool,
) -> IpcResult<()> {
    let ctx = {
        let pool = pool.lock().await;
        pool.browse_context(&connection_id)?
    };

    match ctx {
        BrowseContext::Ssh { ssh_handle, sftp } => {
            crate::services::sftp::delete(&ssh_handle, &sftp, &remote_path, is_directory).await
        }
        BrowseContext::Ftp { client } => {
            crate::services::ftp::delete(&client, &remote_path, is_directory).await
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CountFilesResponse {
    pub count: u64,
}

#[tauri::command]
pub async fn sftp_count_files(
    pool: State<'_, PoolState>,
    connection_id: String,
    remote_path: String,
) -> IpcResult<CountFilesResponse> {
    let ctx = {
        let pool = pool.lock().await;
        pool.browse_context(&connection_id)?
    };

    let count = match ctx {
        BrowseContext::Ssh { ssh_handle, sftp } => {
            crate::services::sftp::count_files(&ssh_handle, &sftp, &remote_path).await?
        }
        BrowseContext::Ftp { client } => {
            crate::services::ftp::count_files(&client, &remote_path).await?
        }
    };

    Ok(CountFilesResponse { count })
}

#[tauri::command]
pub async fn sftp_rename(
    pool: State<'_, PoolState>,
    connection_id: String,
    old_path: String,
    new_path: String,
) -> IpcResult<()> {
    let ctx = {
        let pool = pool.lock().await;
        pool.browse_context(&connection_id)?
    };

    match ctx {
        BrowseContext::Ssh { ssh_handle, sftp } => {
            crate::services::sftp::rename(&ssh_handle, &sftp, &old_path, &new_path).await
        }
        BrowseContext::Ftp { client } => {
            crate::services::ftp::rename(&client, &old_path, &new_path).await
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchToCacheResponse {
    pub local_path: String,
}

#[tauri::command]
pub async fn sftp_fetch_to_cache(
    app: AppHandle,
    pool: State<'_, PoolState>,
    connection_id: String,
    remote_path: String,
) -> IpcResult<FetchToCacheResponse> {
    let ctx = {
        let pool = pool.lock().await;
        pool.browse_context(&connection_id)?
    };

    let local_path = match ctx {
        BrowseContext::Ssh { ssh_handle, sftp } => {
            crate::services::sftp::fetch_to_cache(&app, &ssh_handle, &sftp, &remote_path).await?
        }
        BrowseContext::Ftp { client } => {
            crate::services::ftp::fetch_to_cache(&app, &client, &remote_path).await?
        }
    };

    Ok(FetchToCacheResponse { local_path })
}
