use std::collections::HashMap;
use std::sync::Arc;

use portable_pty::MasterPty;
use tauri::AppHandle;
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

use crate::error::{IpcError, IpcResult};
use crate::events::emit_connection_status;
use crate::models::sftp::{RecursiveFileEntry, SftpEntry};
use crate::models::SessionConfig;
use crate::services::ftp::{self, SharedFtpClient};
use crate::services::local_shell::LocalShellSession;
use crate::services::sftp::SftpSessionCache;
use crate::services::sftp_transfer_pool::{
    SftpTransferPool, DEFAULT_MAX_CONCURRENT_TRANSFERS,
};
use crate::services::ssh::{run_shell_session, ChannelCommand, SharedSshHandle};

pub enum ConnectionKind {
    Ssh {
        ssh_handle: SharedSshHandle,
        input_tx: mpsc::UnboundedSender<ChannelCommand>,
        shell_task: tokio::task::JoinHandle<()>,
        sftp: SftpSessionCache,
        transfer_pool: SftpTransferPool,
    },
    Ftp {
        client: SharedFtpClient,
    },
    Local {
        master: Box<dyn MasterPty + Send>,
        child: Box<dyn portable_pty::Child + Send + Sync>,
        input_tx: mpsc::UnboundedSender<Vec<u8>>,
        reader_task: tokio::task::JoinHandle<()>,
        writer_task: tokio::task::JoinHandle<()>,
    },
}

pub enum TransferContext {
    Ssh {
        ssh_handle: SharedSshHandle,
        browse_sftp: SftpSessionCache,
        transfer_pool: SftpTransferPool,
    },
    Ftp {
        client: SharedFtpClient,
    },
}

pub enum BrowseContext {
    Ssh {
        ssh_handle: SharedSshHandle,
        sftp: SftpSessionCache,
    },
    Ftp {
        client: SharedFtpClient,
    },
}

pub struct ConnectionHandle {
    pub session_id: String,
    pub kind: ConnectionKind,
}

pub struct ConnectionPool {
    connections: HashMap<String, ConnectionHandle>,
}

impl ConnectionPool {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    pub fn register_ssh(
        &mut self,
        app: AppHandle,
        connection_id: String,
        session: SessionConfig,
        ssh_handle: SharedSshHandle,
    ) {
        let sftp = SftpSessionCache::new();
        let transfer_pool =
            SftpTransferPool::new(ssh_handle.clone(), DEFAULT_MAX_CONCURRENT_TRANSFERS);
        let (input_tx, input_rx) = mpsc::unbounded_channel();

        let app_clone = app.clone();
        let conn_id = connection_id.clone();
        let handle_clone = ssh_handle.clone();

        let shell_task = tokio::spawn(async move {
            run_shell_session(app_clone, conn_id, handle_clone, input_rx).await;
        });

        self.connections.insert(
            connection_id,
            ConnectionHandle {
                session_id: session.id,
                kind: ConnectionKind::Ssh {
                    ssh_handle,
                    input_tx,
                    shell_task,
                    sftp,
                    transfer_pool,
                },
            },
        );
    }

    pub fn register_local(
        &mut self,
        connection_id: String,
        shell_id: String,
        session: LocalShellSession,
    ) {
        self.connections.insert(
            connection_id,
            ConnectionHandle {
                session_id: format!("local:{shell_id}"),
                kind: ConnectionKind::Local {
                    master: session.master,
                    child: session.child,
                    input_tx: session.input_tx,
                    reader_task: session.reader_task,
                    writer_task: session.writer_task,
                },
            },
        );
    }

    pub async fn connect_ftp(
        &mut self,
        app: AppHandle,
        session: SessionConfig,
        password: Option<String>,
    ) -> IpcResult<String> {
        let connection_id = Uuid::new_v4().to_string();
        tracing::info!(connection_id = %connection_id, session_id = %session.id, "FTP connect started");
        emit_connection_status(&app, &connection_id, "connecting", None);

        let ftp = match ftp::connect(&session, password).await {
            Ok(client) => client,
            Err(err) => {
                emit_connection_status(&app, &connection_id, "error", Some(err.clone()));
                return Err(err);
            }
        };
        let client: SharedFtpClient = Arc::new(Mutex::new(ftp));

        emit_connection_status(&app, &connection_id, "connected", None);

        self.connections.insert(
            connection_id.clone(),
            ConnectionHandle {
                session_id: session.id,
                kind: ConnectionKind::Ftp { client },
            },
        );

        Ok(connection_id)
    }

    pub async fn disconnect(&mut self, connection_id: &str) -> IpcResult<()> {
        let Some(handle) = self.connections.remove(connection_id) else {
            return Ok(());
        };

        tracing::info!(
            connection_id = %connection_id,
            session_id = %handle.session_id,
            "disconnect"
        );

        match handle.kind {
            ConnectionKind::Ssh {
                input_tx,
                shell_task,
                ..
            } => {
                let _ = input_tx.send(ChannelCommand::Data(vec![]));
                shell_task.abort();
            }
            ConnectionKind::Ftp { client } => {
                ftp::disconnect_client(&client).await;
            }
            ConnectionKind::Local {
                mut child,
                input_tx,
                reader_task,
                writer_task,
                ..
            } => {
                drop(input_tx);
                reader_task.abort();
                writer_task.abort();
                let _ = child.kill();
            }
        }

        Ok(())
    }

    pub fn write(&self, connection_id: &str, data: Vec<u8>) -> IpcResult<()> {
        let handle = self.get(connection_id)?;
        match &handle.kind {
            ConnectionKind::Ssh { input_tx, .. } => {
                input_tx.send(ChannelCommand::Data(data)).map_err(|e| {
                    IpcError::with_str_detail("connection.sendDataFailed", "raw", e.to_string())
                })
            }
            ConnectionKind::Local { input_tx, .. } => input_tx.send(data).map_err(|e| {
                IpcError::with_str_detail("connection.sendDataFailed", "raw", e.to_string())
            }),
            ConnectionKind::Ftp { .. } => Err(IpcError::new("connection.writeNotSupported")),
        }
    }

    pub fn resize(&self, connection_id: &str, cols: u32, rows: u32) -> IpcResult<()> {
        let handle = self.get(connection_id)?;
        match &handle.kind {
            ConnectionKind::Ssh { input_tx, .. } => input_tx
                .send(ChannelCommand::Resize { cols, rows })
                .map_err(|e| {
                    IpcError::with_str_detail("connection.resizeFailed", "raw", e.to_string())
                }),
            ConnectionKind::Local { master, .. } => master
                .resize(portable_pty::PtySize {
                    rows: rows as u16,
                    cols: cols as u16,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| {
                    IpcError::with_str_detail("connection.resizeFailed", "raw", e.to_string())
                }),
            ConnectionKind::Ftp { .. } => Err(IpcError::new("connection.resizeNotSupported")),
        }
    }

    pub async fn list_dir(&self, connection_id: &str, path: &str) -> IpcResult<Vec<SftpEntry>> {
        let handle = self.get(connection_id)?;
        match &handle.kind {
            ConnectionKind::Ssh {
                ssh_handle, sftp, ..
            } => {
                let (entries, _) =
                    crate::services::sftp::list_dir(ssh_handle, sftp, path).await?;
                Ok(entries)
            }
            ConnectionKind::Ftp { client } => ftp::list_dir(client, path).await,
            ConnectionKind::Local { .. } => Err(IpcError::new("connection.notSupported")),
        }
    }

    pub async fn count_files(&self, connection_id: &str, remote_path: &str) -> IpcResult<u64> {
        let handle = self.get(connection_id)?;
        match &handle.kind {
            ConnectionKind::Ssh {
                ssh_handle, sftp, ..
            } => crate::services::sftp::count_files(ssh_handle, sftp, remote_path).await,
            ConnectionKind::Ftp { client } => ftp::count_files(client, remote_path).await,
            ConnectionKind::Local { .. } => Err(IpcError::new("connection.notSupported")),
        }
    }

    pub fn transfer_context(&self, connection_id: &str) -> IpcResult<TransferContext> {
        let handle = self.get(connection_id)?;
        match &handle.kind {
            ConnectionKind::Ssh {
                ssh_handle,
                sftp,
                transfer_pool,
                ..
            } => Ok(TransferContext::Ssh {
                ssh_handle: ssh_handle.clone(),
                browse_sftp: sftp.clone(),
                transfer_pool: transfer_pool.clone(),
            }),
            ConnectionKind::Ftp { client } => Ok(TransferContext::Ftp {
                client: client.clone(),
            }),
            ConnectionKind::Local { .. } => Err(IpcError::new("connection.notSupported")),
        }
    }

    pub fn browse_context(&self, connection_id: &str) -> IpcResult<BrowseContext> {
        let handle = self.get(connection_id)?;
        match &handle.kind {
            ConnectionKind::Ssh {
                ssh_handle,
                sftp,
                ..
            } => Ok(BrowseContext::Ssh {
                ssh_handle: ssh_handle.clone(),
                sftp: sftp.clone(),
            }),
            ConnectionKind::Ftp { client } => Ok(BrowseContext::Ftp {
                client: client.clone(),
            }),
            ConnectionKind::Local { .. } => Err(IpcError::new("connection.notSupported")),
        }
    }

    pub fn set_max_concurrent_transfers(&self, max: usize) {
        for handle in self.connections.values() {
            if let ConnectionKind::Ssh { transfer_pool, .. } = &handle.kind {
                transfer_pool.set_max_concurrent(max);
            }
        }
    }

    pub async fn list_files_recursive(
        &self,
        connection_id: &str,
        remote_path: &str,
    ) -> IpcResult<Vec<RecursiveFileEntry>> {
        let handle = self.get(connection_id)?;
        match &handle.kind {
            ConnectionKind::Ssh {
                ssh_handle, sftp, ..
            } => {
                crate::services::sftp::list_files_recursive(ssh_handle, sftp, remote_path).await
            }
            ConnectionKind::Ftp { client } => {
                ftp::list_files_recursive(client, remote_path).await
            }
            ConnectionKind::Local { .. } => Err(IpcError::new("connection.notSupported")),
        }
    }

    pub async fn mkdir(&self, connection_id: &str, remote_path: &str) -> IpcResult<()> {
        let handle = self.get(connection_id)?;
        match &handle.kind {
            ConnectionKind::Ssh {
                ssh_handle, sftp, ..
            } => crate::services::sftp::mkdir(ssh_handle, sftp, remote_path).await,
            ConnectionKind::Ftp { client } => ftp::mkdir(client, remote_path).await,
            ConnectionKind::Local { .. } => Err(IpcError::new("connection.notSupported")),
        }
    }

    pub async fn delete(
        &self,
        connection_id: &str,
        remote_path: &str,
        is_directory: bool,
    ) -> IpcResult<()> {
        let handle = self.get(connection_id)?;
        match &handle.kind {
            ConnectionKind::Ssh {
                ssh_handle, sftp, ..
            } => crate::services::sftp::delete(ssh_handle, sftp, remote_path, is_directory).await,
            ConnectionKind::Ftp { client } => ftp::delete(client, remote_path, is_directory).await,
            ConnectionKind::Local { .. } => Err(IpcError::new("connection.notSupported")),
        }
    }

    pub async fn rename(
        &self,
        connection_id: &str,
        old_path: &str,
        new_path: &str,
    ) -> IpcResult<()> {
        let handle = self.get(connection_id)?;
        match &handle.kind {
            ConnectionKind::Ssh {
                ssh_handle, sftp, ..
            } => crate::services::sftp::rename(ssh_handle, sftp, old_path, new_path).await,
            ConnectionKind::Ftp { client } => ftp::rename(client, old_path, new_path).await,
            ConnectionKind::Local { .. } => Err(IpcError::new("connection.notSupported")),
        }
    }

    pub async fn fetch_to_cache(
        &self,
        app: &tauri::AppHandle,
        connection_id: &str,
        remote_path: &str,
    ) -> IpcResult<String> {
        let handle = self.get(connection_id)?;
        match &handle.kind {
            ConnectionKind::Ssh {
                ssh_handle, sftp, ..
            } => crate::services::sftp::fetch_to_cache(app, ssh_handle, sftp, remote_path).await,
            ConnectionKind::Ftp { client } => ftp::fetch_to_cache(app, client, remote_path).await,
            ConnectionKind::Local { .. } => Err(IpcError::new("connection.notSupported")),
        }
    }

    fn get(&self, connection_id: &str) -> IpcResult<&ConnectionHandle> {
        self.connections.get(connection_id).ok_or_else(|| {
            IpcError::with_str_detail("connection.notFound", "connectionId", connection_id)
        })
    }
}
