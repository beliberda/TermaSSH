use std::sync::{Arc, RwLock};

use russh_sftp::client::SftpSession;
use tokio::sync::OwnedSemaphorePermit;

use crate::error::{IpcError, IpcResult};
use crate::services::sftp::open_sftp_session;
use crate::services::ssh::SharedSshHandle;

pub const DEFAULT_MAX_CONCURRENT_TRANSFERS: usize = 3;

#[derive(Clone)]
pub struct SftpTransferPool {
    ssh_handle: SharedSshHandle,
    semaphore: Arc<RwLock<Arc<tokio::sync::Semaphore>>>,
}

pub struct SftpTransferGuard {
    pub session: SftpSession,
    _permit: OwnedSemaphorePermit,
}

impl SftpTransferPool {
    pub fn new(ssh_handle: SharedSshHandle, max_concurrent: usize) -> Self {
        let max = max_concurrent.clamp(1, 8);
        Self {
            ssh_handle,
            semaphore: Arc::new(RwLock::new(Arc::new(tokio::sync::Semaphore::new(max)))),
        }
    }

    pub fn set_max_concurrent(&self, max_concurrent: usize) {
        let max = max_concurrent.clamp(1, 8);
        if let Ok(mut guard) = self.semaphore.write() {
            *guard = Arc::new(tokio::sync::Semaphore::new(max));
        }
    }

    pub async fn acquire(&self) -> IpcResult<SftpTransferGuard> {
        let sem = self
            .semaphore
            .read()
            .map_err(|_| IpcError::new("sftp.transferPoolClosed"))?
            .clone();

        let permit = sem
            .acquire_owned()
            .await
            .map_err(|_| IpcError::new("sftp.transferPoolClosed"))?;

        let session = open_sftp_session(&self.ssh_handle).await?;

        Ok(SftpTransferGuard {
            session,
            _permit: permit,
        })
    }
}
