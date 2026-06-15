use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub schema_version: u32,
    pub theme: String,
    pub terminal_font_size: u16,
    pub terminal_font_family: String,
    pub default_ssh_port: u16,
    pub default_ftp_port: u16,
    #[serde(default)]
    pub default_editor_path: String,
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u16,
    #[serde(default = "default_locale")]
    pub locale: String,
    #[serde(default = "default_file_conflict_policy")]
    pub default_file_conflict_policy: String,
    #[serde(default = "default_max_concurrent_transfers")]
    pub max_concurrent_transfers: u16,
    #[serde(default = "default_shortcuts")]
    pub shortcuts: HashMap<String, String>,
}

fn default_shortcuts() -> HashMap<String, String> {
    HashMap::from([
        ("connectSession".to_string(), "Ctrl+T".to_string()),
        ("reconnectTab".to_string(), "Ctrl+R".to_string()),
        ("closeTab".to_string(), "Ctrl+W".to_string()),
        ("toggleSidebarTab".to_string(), "Ctrl+B".to_string()),
        ("fileRefresh".to_string(), "F5".to_string()),
        ("fileRename".to_string(), "F2".to_string()),
        ("fileUpload".to_string(), "Ctrl+U".to_string()),
        ("fileDownload".to_string(), "Ctrl+D".to_string()),
        ("focusLocalPane".to_string(), "Ctrl+1".to_string()),
        ("focusRemotePane".to_string(), "Ctrl+2".to_string()),
        ("fileSelectAll".to_string(), "Ctrl+A".to_string()),
        ("toggleWorkspaceView".to_string(), "Ctrl+Shift+T".to_string()),
    ])
}

fn default_file_conflict_policy() -> String {
    "ask".to_string()
}

fn default_max_concurrent_transfers() -> u16 {
    3
}

fn default_sidebar_width() -> u16 {
    240
}

fn default_locale() -> String {
    "ru".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            theme: "dark".to_string(),
            terminal_font_size: 14,
            terminal_font_family: "Consolas, \"Courier New\", monospace".to_string(),
            default_ssh_port: 22,
            default_ftp_port: 21,
            default_editor_path: String::new(),
            sidebar_width: default_sidebar_width(),
            locale: default_locale(),
            default_file_conflict_policy: default_file_conflict_policy(),
            max_concurrent_transfers: default_max_concurrent_transfers(),
            shortcuts: default_shortcuts(),
        }
    }
}
