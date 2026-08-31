use std::io::{Read, Write};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::AppHandle;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::error::{IpcError, IpcResult};
use crate::events::{emit_connection_status, emit_terminal_output};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShellInfo {
    pub id: String,
    pub label: String,
}

pub struct LocalShellSession {
    pub master: Box<dyn MasterPty + Send>,
    pub child: Box<dyn Child + Send + Sync>,
    pub input_tx: mpsc::UnboundedSender<Vec<u8>>,
    pub reader_task: JoinHandle<()>,
    pub writer_task: JoinHandle<()>,
}

fn find_in_path(exe_name: &str) -> Option<String> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(exe_name);
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    None
}

#[cfg(windows)]
fn find_git_bash() -> Option<String> {
    let candidates = [
        std::env::var_os("ProgramFiles").map(|p| std::path::PathBuf::from(p).join("Git\\bin\\bash.exe")),
        std::env::var_os("ProgramFiles(x86)")
            .map(|p| std::path::PathBuf::from(p).join("Git\\bin\\bash.exe")),
        std::env::var_os("LocalAppData")
            .map(|p| std::path::PathBuf::from(p).join("Programs\\Git\\bin\\bash.exe")),
    ];

    for candidate in candidates.into_iter().flatten() {
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    None
}

#[cfg(windows)]
pub fn list_available_shells() -> Vec<ShellInfo> {
    let mut shells = Vec::new();

    let comspec = std::env::var("ComSpec").unwrap_or_else(|_| "C:\\Windows\\System32\\cmd.exe".into());
    if std::path::Path::new(&comspec).is_file() {
        shells.push(ShellInfo {
            id: "cmd".into(),
            label: "Command Prompt".into(),
        });
    }

    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    let powershell = format!("{system_root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    if std::path::Path::new(&powershell).is_file() {
        shells.push(ShellInfo {
            id: "powershell".into(),
            label: "Windows PowerShell".into(),
        });
    }

    if find_in_path("pwsh.exe").is_some() {
        shells.push(ShellInfo {
            id: "pwsh".into(),
            label: "PowerShell 7".into(),
        });
    }

    if find_git_bash().is_some() {
        shells.push(ShellInfo {
            id: "gitbash".into(),
            label: "Git Bash".into(),
        });
    }

    let wsl = format!("{system_root}\\System32\\wsl.exe");
    if std::path::Path::new(&wsl).is_file() {
        shells.push(ShellInfo {
            id: "wsl".into(),
            label: "WSL".into(),
        });
    }

    shells
}

#[cfg(not(windows))]
pub fn list_available_shells() -> Vec<ShellInfo> {
    let mut shells = Vec::new();

    if let Ok(shell) = std::env::var("SHELL") {
        if std::path::Path::new(&shell).is_file() {
            let id = if shell.ends_with("zsh") {
                "zsh"
            } else if shell.ends_with("bash") {
                "bash"
            } else if shell.ends_with("fish") {
                "fish"
            } else {
                "shell"
            };
            shells.push(ShellInfo {
                id: id.into(),
                label: shell.clone(),
            });
        }
    }

    let known: [(&str, &str, &str); 3] = [
        ("bash", "/bin/bash", "Bash"),
        ("zsh", "/bin/zsh", "Zsh"),
        ("sh", "/bin/sh", "Shell"),
    ];
    for (id, path, label) in known {
        if shells.iter().any(|s| s.id == id) {
            continue;
        }
        if std::path::Path::new(path).is_file() {
            shells.push(ShellInfo {
                id: id.into(),
                label: label.into(),
            });
        }
    }

    shells
}

fn resolve_command(shell_id: &str) -> IpcResult<CommandBuilder> {
    match shell_id {
        #[cfg(windows)]
        "cmd" => {
            let comspec =
                std::env::var("ComSpec").unwrap_or_else(|_| "C:\\Windows\\System32\\cmd.exe".into());
            Ok(CommandBuilder::new(comspec))
        }
        #[cfg(windows)]
        "powershell" => {
            let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
            Ok(CommandBuilder::new(format!(
                "{system_root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
            )))
        }
        #[cfg(windows)]
        "pwsh" => {
            let path = find_in_path("pwsh.exe")
                .ok_or_else(|| IpcError::new("localShell.notFound"))?;
            Ok(CommandBuilder::new(path))
        }
        #[cfg(windows)]
        "gitbash" => {
            let path = find_git_bash().ok_or_else(|| IpcError::new("localShell.notFound"))?;
            let mut cmd = CommandBuilder::new(path);
            cmd.arg("--login");
            cmd.arg("-i");
            Ok(cmd)
        }
        #[cfg(windows)]
        "wsl" => {
            let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
            Ok(CommandBuilder::new(format!(
                "{system_root}\\System32\\wsl.exe"
            )))
        }
        #[cfg(not(windows))]
        "bash" => Ok(CommandBuilder::new("/bin/bash")),
        #[cfg(not(windows))]
        "zsh" => Ok(CommandBuilder::new("/bin/zsh")),
        #[cfg(not(windows))]
        "sh" => Ok(CommandBuilder::new("/bin/sh")),
        #[cfg(not(windows))]
        "fish" => Ok(CommandBuilder::new("/usr/bin/fish")),
        other => Err(IpcError::with_str_detail(
            "localShell.unknownType",
            "shellId",
            other,
        )),
    }
}

pub fn spawn_local_shell(
    app: AppHandle,
    connection_id: String,
    shell_id: &str,
) -> IpcResult<LocalShellSession> {
    let mut cmd = resolve_command(shell_id)?;
    if let Some(home) = dirs::home_dir() {
        cmd.cwd(home);
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| IpcError::with_str_detail("localShell.ptyFailed", "raw", e.to_string()))?;

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| IpcError::with_str_detail("localShell.spawnFailed", "raw", e.to_string()))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| IpcError::with_str_detail("localShell.ptyFailed", "raw", e.to_string()))?;
    let mut writer = pair
        .master
        .take_writer()
        .map_err(|e| IpcError::with_str_detail("localShell.ptyFailed", "raw", e.to_string()))?;

    let (input_tx, mut input_rx) = mpsc::unbounded_channel::<Vec<u8>>();

    let app_reader = app.clone();
    let conn_id_reader = connection_id.clone();
    let reader_task = tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => emit_terminal_output(&app_reader, &conn_id_reader, &buf[..n]),
                Err(_) => break,
            }
        }
        emit_connection_status(&app_reader, &conn_id_reader, "disconnected", None);
    });

    let writer_task = tokio::task::spawn_blocking(move || {
        while let Some(data) = input_rx.blocking_recv() {
            if writer.write_all(&data).is_err() {
                break;
            }
            let _ = writer.flush();
        }
    });

    emit_connection_status(&app, &connection_id, "connected", None);

    Ok(LocalShellSession {
        master: pair.master,
        child,
        input_tx,
        reader_task,
        writer_task,
    })
}
