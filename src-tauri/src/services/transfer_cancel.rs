use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use crate::error::{IpcError, IpcResult};

#[derive(Default)]
struct RegistryInner {
    cancelled: HashSet<String>,
    active: HashMap<String, String>,
}

pub struct TransferCancelRegistry {
    inner: Mutex<RegistryInner>,
}

impl Default for TransferCancelRegistry {
    fn default() -> Self {
        Self {
            inner: Mutex::new(RegistryInner::default()),
        }
    }
}

impl TransferCancelRegistry {
    pub fn register(&self, transfer_id: &str, connection_id: &str) {
        let mut guard = self.inner.lock().unwrap();
        guard
            .active
            .insert(transfer_id.to_string(), connection_id.to_string());
        guard.cancelled.remove(transfer_id);
    }

    pub fn unregister(&self, transfer_id: &str) {
        let mut guard = self.inner.lock().unwrap();
        guard.active.remove(transfer_id);
        guard.cancelled.remove(transfer_id);
    }

    pub fn cancel(&self, transfer_id: &str) {
        let mut guard = self.inner.lock().unwrap();
        guard.cancelled.insert(transfer_id.to_string());
    }

    pub fn cancel_all(&self, connection_id: &str) {
        let mut guard = self.inner.lock().unwrap();
        let to_cancel: Vec<String> = guard
            .active
            .iter()
            .filter(|(_, active_connection_id)| *active_connection_id == connection_id)
            .map(|(transfer_id, _)| transfer_id.clone())
            .collect();
        for transfer_id in to_cancel {
            guard.cancelled.insert(transfer_id);
        }
    }

    pub fn is_cancelled(&self, transfer_id: &str) -> bool {
        self.inner
            .lock()
            .unwrap()
            .cancelled
            .contains(transfer_id)
    }

    pub fn check_not_cancelled(
        &self,
        transfer_id: Option<&str>,
    ) -> IpcResult<()> {
        if let Some(tid) = transfer_id {
            if self.is_cancelled(tid) {
                return Err(IpcError::new("transfer.cancelled"));
            }
        }
        Ok(())
    }
}
