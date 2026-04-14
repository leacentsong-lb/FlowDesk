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
    let server_path = resolve_sidecar_server_path(&repo_root)?;

    if !tsx_path.exists() {
        return Err(format!("未找到 tsx 启动器: {}", tsx_path.display()));
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

fn resolve_sidecar_server_path(repo_root: &std::path::Path) -> Result<PathBuf, String> {
    let root_server = repo_root.join("packages").join("ai-sidecar").join("src").join("server.ts");
    if root_server.exists() {
        return Ok(root_server);
    }

    let worktrees_root = repo_root.join(".worktrees");
    if worktrees_root.is_dir() {
        let mut candidates = std::fs::read_dir(&worktrees_root)
            .map_err(|error| format!("读取 worktrees 目录失败: {}", error))?
            .filter_map(Result::ok)
            .map(|entry| entry.path().join("packages").join("ai-sidecar").join("src").join("server.ts"))
            .filter(|path| path.exists())
            .collect::<Vec<_>>();

        candidates.sort();
        if let Some(path) = candidates.into_iter().next() {
            return Ok(path);
        }
    }

    Err(format!("未找到 AI sidecar 入口: {}", root_server.display()))
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

#[cfg(test)]
mod tests {
    use super::resolve_sidecar_server_path;
    use std::fs;
    use std::path::PathBuf;

    fn create_temp_repo(name: &str) -> PathBuf {
        let root = std::env::temp_dir()
            .join(format!("flow-desk-sidecar-test-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create temp repo root");
        root
    }

    #[test]
    fn prefers_root_packages_sidecar_when_present() {
        let repo_root = create_temp_repo("root");
        let root_server = repo_root.join("packages/ai-sidecar/src/server.ts");
        fs::create_dir_all(root_server.parent().expect("server parent")).expect("create root server dir");
        fs::write(&root_server, "console.log('root');").expect("write root server");

        let resolved = resolve_sidecar_server_path(&repo_root).expect("should resolve root sidecar");

        assert_eq!(resolved, root_server);
    }

    #[test]
    fn falls_back_to_worktree_sidecar_when_root_package_is_missing() {
        let repo_root = create_temp_repo("worktree");
        let worktree_server = repo_root.join(".worktrees/feature-a/packages/ai-sidecar/src/server.ts");
        fs::create_dir_all(worktree_server.parent().expect("server parent")).expect("create worktree server dir");
        fs::write(&worktree_server, "console.log('worktree');").expect("write worktree server");

        let resolved = resolve_sidecar_server_path(&repo_root).expect("should resolve worktree sidecar");

        assert_eq!(resolved, worktree_server);
    }
}
