use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

struct SidecarState {
    child: Option<Child>,
    port: u16,
}

static SIDECAR_STATE: OnceLock<Mutex<SidecarState>> = OnceLock::new();

fn sidecar_state() -> &'static Mutex<SidecarState> {
    SIDECAR_STATE.get_or_init(|| {
        Mutex::new(SidecarState {
            child: None,
            port: 4317,
        })
    })
}

/// Ensure the Node-based AI sidecar is running and reachable.
#[tauri::command]
pub async fn ai_sidecar_ensure_running() -> Result<serde_json::Value, String> {
    let port = {
        let state = sidecar_state()
            .lock()
            .map_err(|_| "Failed to lock sidecar state".to_string())?;
        state.port
    };

    if health_check(port).await {
        return Ok(serde_json::json!({
            "baseUrl": format!("http://127.0.0.1:{}", port)
        }));
    }

    {
        let mut state = sidecar_state()
            .lock()
            .map_err(|_| "Failed to lock sidecar state".to_string())?;

        if !child_running(&mut state.child) {
            state.child = Some(spawn_sidecar(state.port)?);
        }
    }

    for _ in 0..20 {
        if health_check(port).await {
            return Ok(serde_json::json!({
                "baseUrl": format!("http://127.0.0.1:{}", port)
            }));
        }

        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    Err("AI sidecar 启动失败".to_string())
}

fn child_running(child: &mut Option<Child>) -> bool {
    let Some(process) = child.as_mut() else {
        return false;
    };

    match process.try_wait() {
        Ok(None) => true,
        Ok(Some(_)) | Err(_) => {
            *child = None;
            false
        }
    }
}

fn spawn_sidecar(port: u16) -> Result<Child, String> {
    let repo_root = repo_root()?;
    let tsx_path = repo_root.join("node_modules").join("tsx").join("dist").join("cli.mjs");
    let server_path = repo_root.join("packages").join("ai-sidecar").join("src").join("server.ts");

    if !tsx_path.exists() {
        return Err(format!("未找到 tsx 启动器: {}", tsx_path.display()));
    }

    if !server_path.exists() {
        return Err(format!("未找到 AI sidecar 入口: {}", server_path.display()));
    }

    Command::new("node")
        .arg(tsx_path)
        .arg(server_path)
        .current_dir(&repo_root)
        .env("FLOW_DESK_AI_SIDECAR_PORT", port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("启动 AI sidecar 失败: {}", error))
}

fn repo_root() -> Result<PathBuf, String> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|path| path.to_path_buf())
        .ok_or_else(|| "无法定位仓库根目录".to_string())
}

async fn health_check(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{}/health", port);
    let client = reqwest::Client::new();

    client
        .get(url)
        .timeout(Duration::from_secs(2))
        .send()
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}
