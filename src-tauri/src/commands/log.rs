#[tauri::command]
pub fn frontend_log_error(message: String, context: Option<String>) {
    match context {
        Some(context) => tracing::error!(context = %context, "[frontend] {message}"),
        None => tracing::error!("[frontend] {message}"),
    }
}
