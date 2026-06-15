use std::sync::Arc;

use tauri::State;

use crate::services::transfer_cancel::TransferCancelRegistry;

#[tauri::command]
pub fn transfer_cancel(
    registry: State<'_, Arc<TransferCancelRegistry>>,
    transfer_id: String,
) {
    registry.cancel(&transfer_id);
}

#[tauri::command]
pub fn transfer_cancel_all(
    registry: State<'_, Arc<TransferCancelRegistry>>,
    connection_id: String,
) {
    registry.cancel_all(&connection_id);
}
