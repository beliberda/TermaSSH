use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

use crate::connection_pool::ConnectionPool;
use crate::error::IpcResult;
use crate::services::local_shell::{self, ShellInfo};

type PoolState = Arc<AsyncMutex<ConnectionPool>>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectResponse {
    pub connection_id: String,
}

#[tauri::command]
pub fn local_shell_list() -> Vec<ShellInfo> {
    local_shell::list_available_shells()
}

#[tauri::command]
pub async fn local_shell_connect(
    app: AppHandle,
    pool: State<'_, PoolState>,
    shell_id: String,
) -> IpcResult<ConnectResponse> {
    let connection_id = Uuid::new_v4().to_string();
    tracing::info!(
        connection_id = %connection_id,
        shell_id = %shell_id,
        "local shell spawn started"
    );

    let session = local_shell::spawn_local_shell(app, connection_id.clone(), &shell_id)?;

    {
        let mut pool = pool.lock().await;
        pool.register_local(connection_id.clone(), shell_id, session);
    }

    Ok(ConnectResponse { connection_id })
}
