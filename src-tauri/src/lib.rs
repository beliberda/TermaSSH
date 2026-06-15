mod commands;
mod connection_pool;
mod error;
mod events;
mod models;
mod services;
mod utils;

use std::sync::{Arc, Mutex};

use connection_pool::ConnectionPool;
use services::{
    transfer_cancel::TransferCancelRegistry, ConfigService, CredentialVaultService,
    SettingsService,
};
use tauri::Manager;
use tokio::sync::Mutex as AsyncMutex;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

fn init_tracing(app: &tauri::AppHandle) {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    if cfg!(debug_assertions) {
        if let Ok(dir) = app.path().app_data_dir() {
            let log_dir = dir.join("logs");
            let _ = std::fs::create_dir_all(&log_dir);
            let file_appender = tracing_appender::rolling::never(&log_dir, "termassh.log");
            let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);
            tracing_subscriber::registry()
                .with(filter)
                .with(tracing_subscriber::fmt::layer())
                .with(tracing_subscriber::fmt::layer().with_writer(non_blocking))
                .init();
            std::mem::forget(_guard);
            return;
        }
    }

    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer())
        .init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            init_tracing(&app.handle());

            let config = ConfigService::new(&app.handle())?;
            let settings = SettingsService::new(&app.handle())?;
            let vault = CredentialVaultService::new(&app.handle())?;
            app.manage(Arc::new(Mutex::new(config)));
            app.manage(Arc::new(Mutex::new(settings)));
            app.manage(Arc::new(Mutex::new(vault)));
            app.manage(Arc::new(AsyncMutex::new(ConnectionPool::new())));
            app.manage(Arc::new(TransferCancelRegistry::default()));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping::ping,
            commands::credentials::vault_exists,
            commands::credentials::vault_is_unlocked,
            commands::credentials::vault_setup,
            commands::credentials::vault_unlock,
            commands::credentials::vault_lock,
            commands::credentials::vault_change_master,
            commands::credentials::credentials_set,
            commands::credentials::credentials_delete,
            commands::credentials::credentials_has,
            commands::credentials::credentials_list,
            commands::config::sessions_list,
            commands::config::sessions_save,
            commands::config::sessions_export_to_path,
            commands::config::sessions_import_from_path,
            commands::config::sessions_write_example_at_path,
            commands::settings::settings_load,
            commands::settings::settings_save,
            commands::terminal::terminal_connect,
            commands::terminal::terminal_disconnect,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::test_ssh_connect,
            commands::ftp::ftp_connect,
            commands::ftp::ftp_disconnect,
            commands::sftp::sftp_list_dir,
            commands::sftp::sftp_upload,
            commands::sftp::sftp_download,
            commands::sftp::sftp_list_recursive,
            commands::sftp::sftp_mkdir,
            commands::sftp::sftp_delete,
            commands::sftp::sftp_count_files,
            commands::sftp::sftp_rename,
            commands::sftp::sftp_fetch_to_cache,
            commands::local_fs::local_list_dir,
            commands::local_fs::local_stat,
            commands::local_fs::local_exists,
            commands::local_fs::local_mkdir,
            commands::local_fs::local_rename,
            commands::local_fs::local_delete,
            commands::local_fs::local_home_dir,
            commands::local_fs::local_reveal_in_explorer,
            commands::open::open_in_editor,
            commands::transfer::transfer_cancel,
            commands::transfer::transfer_cancel_all,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
