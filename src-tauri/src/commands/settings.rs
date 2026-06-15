use std::sync::{Arc, Mutex};

use tauri::State;
use tokio::sync::Mutex as AsyncMutex;

use crate::connection_pool::ConnectionPool;
use crate::error::{IpcError, IpcResult};
use crate::models::settings::AppSettings;
use crate::services::settings::SettingsService;

type SettingsState = Arc<Mutex<SettingsService>>;
type PoolState = Arc<AsyncMutex<ConnectionPool>>;

#[tauri::command]
pub async fn settings_load(
    state: State<'_, SettingsState>,
    pool: State<'_, PoolState>,
) -> IpcResult<AppSettings> {
    let settings = {
        let service = state
            .lock()
            .map_err(|e| IpcError::with_str_detail("unknown", "raw", e.to_string()))?;
        service.load()?
    };

    let pool = pool.lock().await;
    pool.set_max_concurrent_transfers(settings.max_concurrent_transfers as usize);

    Ok(settings)
}

#[tauri::command]
pub async fn settings_save(
    state: State<'_, SettingsState>,
    pool: State<'_, PoolState>,
    settings: AppSettings,
) -> IpcResult<()> {
    {
        let service = state
            .lock()
            .map_err(|e| IpcError::with_str_detail("unknown", "raw", e.to_string()))?;
        service.save(&settings)?;
    }

    let pool = pool.lock().await;
    pool.set_max_concurrent_transfers(settings.max_concurrent_transfers as usize);

    Ok(())
}
