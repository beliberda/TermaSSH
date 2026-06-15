use tauri::AppHandle;

use crate::error::{IpcError, IpcResult};
use crate::events::emit_transfer_progress;
use crate::services::transfer_cancel::TransferCancelRegistry;

pub struct TransferProgress<'a> {
    app: &'a AppHandle,
    transfer_id: &'a str,
    connection_id: &'a str,
    file_name: &'a str,
    direction: &'a str,
    bytes_total: u64,
    cancel: Option<&'a TransferCancelRegistry>,
}

impl<'a> TransferProgress<'a> {
    pub fn new(
        app: &'a AppHandle,
        transfer_id: &'a str,
        connection_id: &'a str,
        file_name: &'a str,
        direction: &'a str,
        bytes_total: u64,
        cancel: Option<&'a TransferCancelRegistry>,
    ) -> Self {
        if let Some(registry) = cancel {
            registry.register(transfer_id, connection_id);
        }
        emit_transfer_progress(
            app,
            transfer_id,
            connection_id,
            file_name,
            direction,
            0,
            bytes_total,
            "running",
        );
        Self {
            app,
            transfer_id,
            connection_id,
            file_name,
            direction,
            bytes_total,
            cancel,
        }
    }

    pub fn check_cancelled(&self) -> IpcResult<()> {
        if let Some(registry) = self.cancel {
            if registry.is_cancelled(self.transfer_id) {
                self.cancelled();
                return Err(IpcError::new("transfer.cancelled"));
            }
        }
        Ok(())
    }

    pub fn update(&self, bytes_done: u64) {
        emit_transfer_progress(
            self.app,
            self.transfer_id,
            self.connection_id,
            self.file_name,
            self.direction,
            bytes_done.min(self.bytes_total),
            self.bytes_total,
            "running",
        );
    }

    pub fn done(&self) {
        emit_transfer_progress(
            self.app,
            self.transfer_id,
            self.connection_id,
            self.file_name,
            self.direction,
            self.bytes_total,
            self.bytes_total,
            "done",
        );
    }

    pub fn error(&self) {
        emit_transfer_progress(
            self.app,
            self.transfer_id,
            self.connection_id,
            self.file_name,
            self.direction,
            0,
            self.bytes_total,
            "error",
        );
    }

    pub fn cancelled(&self) {
        emit_transfer_progress(
            self.app,
            self.transfer_id,
            self.connection_id,
            self.file_name,
            self.direction,
            0,
            self.bytes_total,
            "cancelled",
        );
    }
}

impl Drop for TransferProgress<'_> {
    fn drop(&mut self) {
        if let Some(registry) = self.cancel {
            registry.unregister(self.transfer_id);
        }
    }
}
