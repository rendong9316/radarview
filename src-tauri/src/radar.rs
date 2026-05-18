use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;

use crate::track::Track;

const CONVERTER_TIMEOUT_SECS: u64 = 120;

/// Emit a progress event to the frontend. Failure is non-fatal.
fn emit_progress(app_handle: &AppHandle, stage: &str, percent: u32) {
    let _ = app_handle.emit(
        "convert-progress",
        serde_json::json!({ "stage": stage, "percent": percent }),
    );
}

fn kill_process(pid: u32) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/F", "/PID", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }
}

pub fn parse_mat_file(app_handle: &AppHandle, file_path: &str) -> Result<Vec<Track>, String> {
    parse_mat_file_with_source(app_handle, file_path, None)
}

pub fn parse_mat_file_with_source(
    app_handle: &AppHandle,
    file_path: &str,
    source_override: Option<&str>,
) -> Result<Vec<Track>, String> {
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("无法获取资源目录: {}", e))?;

    let exe_path = find_converter(&resource_dir)?;

    emit_progress(app_handle, "converting", 10);

    let mut cmd = Command::new(&exe_path);
    cmd.arg(file_path);
    if source_override.is_some() {
        cmd.arg("--mode").arg("raw");
    }
    let child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动转换器: {}", e))?;

    let pid = child.id();

    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let result = child.wait_with_output();
        let _ = tx.send(result);
    });

    match rx.recv_timeout(Duration::from_secs(CONVERTER_TIMEOUT_SECS)) {
        Ok(Ok(output)) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("数据转换失败: {}", stderr));
            }

            emit_progress(app_handle, "parsing", 80);

            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut tracks: Vec<Track> = serde_json::from_str(&stdout)
                .map_err(|e| format!("解析转换数据失败: {}", e))?;

            // Override source if specified
            if let Some(src) = source_override {
                for t in &mut tracks {
                    t.source = src.to_string();
                }
            }

            emit_progress(app_handle, "done", 90);
            Ok(tracks)
        }
        Ok(Err(e)) => Err(format!("转换器运行异常: {}", e)),
        Err(_timeout) => {
            kill_process(pid);
            Err("数据转换超时，请检查文件是否损坏或重新尝试。".to_string())
        }
    }
}

fn find_converter(resource_dir: &PathBuf) -> Result<PathBuf, String> {
    // 1. Production: NSIS/MSI puts convert_mat.exe directly in resource_dir root
    let prod_path = resource_dir.join("convert_mat.exe");
    if prod_path.exists() {
        return Ok(prod_path);
    }

    // 2. Dev mode: resource_dir is src-tauri/, file lives in resources/ subdir
    let dev_path = resource_dir.join("resources").join("convert_mat.exe");
    if dev_path.exists() {
        return Ok(dev_path);
    }

    // 3. Walk-up fallback from current directory (dev with non-standard layout)
    let mut dir = std::env::current_dir().unwrap_or_default();
    for _ in 0..5 {
        let path = dir.join("src-tauri/resources/convert_mat.exe");
        if path.exists() {
            return Ok(path);
        }
        if let Some(parent) = dir.parent() {
            dir = parent.to_path_buf();
        } else {
            break;
        }
    }

    Err("雷达数据转换组件未找到，请重新安装应用。".to_string())
}
