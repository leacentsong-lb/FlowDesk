use std::process::{Command, Stdio};
use std::{fs, path::{Path, PathBuf}};
use std::thread;
use std::time::Duration;

/// Run a shell command in a specified directory.
/// Safety: blocks dangerous patterns and scopes execution to the current workspace.
#[tauri::command]
pub async fn agent_run_command(
    command: String,
    cwd: Option<String>,
    mode: Option<String>,
    workspace_path: Option<String>,
) -> Result<serde_json::Value, String> {
    if is_dangerous_command(&command) {
        return Ok(blocked_response("Blocked: dangerous command pattern detected".to_string()));
    }

    let command_scope = match resolve_command_scope(workspace_path.as_deref(), cwd.as_deref()) {
        Ok(scope) => scope,
        Err(error) => return Ok(blocked_response(error)),
    };
    let exec_mode = mode.unwrap_or_else(|| "wait".to_string());

    tauri::async_runtime::spawn_blocking(move || {
        if exec_mode == "background" {
            return run_background_command(&command, &command_scope.work_dir);
        }

        run_wait_command(&command, &command_scope.work_dir)
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

#[derive(Debug)]
struct CommandScope {
    work_dir: PathBuf,
}

fn resolve_command_scope(workspace_path: Option<&str>, cwd: Option<&str>) -> Result<CommandScope, String> {
    let workspace = workspace_path
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Blocked: workspacePath is required for shell execution".to_string())?;

    let workspace_root = fs::canonicalize(workspace)
        .map_err(|e| format!("Blocked: workspacePath is invalid: {} ({})", workspace, e))?;

    if !workspace_root.is_dir() {
        return Err(format!("Blocked: workspacePath is not a directory: {}", workspace));
    }

    let requested = match cwd.map(str::trim).filter(|s| !s.is_empty()) {
        Some(relative_or_absolute) => {
            let candidate = PathBuf::from(relative_or_absolute);
            if candidate.is_absolute() {
                candidate
            } else {
                workspace_root.join(candidate)
            }
        }
        None => workspace_root.clone(),
    };

    let work_dir = fs::canonicalize(&requested)
        .map_err(|e| format!("Blocked: cwd is not accessible: {} ({})", requested.to_string_lossy(), e))?;

    if !work_dir.starts_with(&workspace_root) {
        return Err(format!(
            "Blocked: cwd escapes workspace root: {}",
            workspace_root.to_string_lossy()
        ));
    }

    Ok(CommandScope { work_dir })
}

fn blocked_response(stderr: String) -> serde_json::Value {
    serde_json::json!({
        "ok": false,
        "stdout": "",
        "stderr": stderr,
        "exitCode": -1,
        "background": false,
        "started": false,
        "blocked": true,
        "summary": "命令已被安全策略拦截。"
    })
}

fn is_dangerous_command(command: &str) -> bool {
    let dangerous = ["rm -rf /", "sudo rm", "shutdown", "reboot", "> /dev/", "mkfs", "dd if="];
    dangerous.iter().any(|d| command.contains(d))
}

fn run_wait_command(command: &str, work_dir: &Path) -> Result<serde_json::Value, String> {
    let output = Command::new("sh")
        .args(["-c", command])
        .current_dir(work_dir)
        .output()
        .map_err(|e| format!("Failed to execute: {}", e))?;

    Ok(build_output_response(output, false, false, String::new()))
}

fn run_background_command(command: &str, work_dir: &Path) -> Result<serde_json::Value, String> {
    let mut child = Command::new("sh")
        .args(["-c", command])
        .current_dir(work_dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start background command: {}", e))?;

    let pid = child.id();
    thread::sleep(Duration::from_millis(800));

    match child.try_wait().map_err(|e| format!("Failed to inspect background command: {}", e))? {
        Some(status) => Ok(serde_json::json!({
            "ok": status.success(),
            "stdout": "",
            "stderr": if status.success() { "" } else { "后台命令启动后立即退出" },
            "exitCode": status.code().unwrap_or(-1),
            "background": true,
            "started": false,
            "pid": pid,
            "summary": if status.success() {
                "后台命令已执行完成。"
            } else {
                "后台命令启动失败。"
            }
        })),
        None => Ok(serde_json::json!({
            "ok": true,
            "stdout": "",
            "stderr": "",
            "exitCode": serde_json::Value::Null,
            "background": true,
            "started": true,
            "pid": pid,
            "summary": "已启动开发服务，服务正在后台运行。"
        }))
    }
}

fn build_output_response(
    output: std::process::Output,
    background: bool,
    started: bool,
    summary: String,
) -> serde_json::Value {
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let max = 50000;

    serde_json::json!({
        "ok": output.status.success(),
        "stdout": &stdout[..stdout.len().min(max)],
        "stderr": &stderr[..stderr.len().min(max)],
        "exitCode": output.status.code().unwrap_or(-1),
        "background": background,
        "started": started,
        "summary": if summary.is_empty() {
            serde_json::Value::Null
        } else {
            serde_json::Value::String(summary)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::{agent_run_command, is_dangerous_command, resolve_command_scope, run_background_command, run_wait_command};
    use serde_json::Value;
    use std::fs;
    use std::path::PathBuf;

    fn create_workspace() -> PathBuf {
        let root = std::env::temp_dir().join(format!("agent-workspace-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("repo-a")).expect("create repo-a");
        fs::create_dir_all(root.join("nested/repo-b")).expect("create repo-b");
        root
    }

    #[test]
    fn background_mode_returns_running_for_long_lived_command() {
        let result = run_background_command("sleep 1", &std::env::current_dir().unwrap())
            .expect("background command should start");

        assert_eq!(result["ok"].as_bool(), Some(true));
        assert_eq!(result["background"].as_bool(), Some(true));
        assert_eq!(result["started"].as_bool(), Some(true));
    }

    #[test]
    fn wait_mode_returns_exit_code_for_short_command() {
        let result = run_wait_command("printf ready", &std::env::current_dir().unwrap())
            .expect("wait command should finish");

        assert_eq!(result["ok"].as_bool(), Some(true));
        assert_eq!(result["stdout"].as_str(), Some("ready"));
        assert_eq!(result["background"].as_bool(), Some(false));
    }

    #[test]
    fn agent_run_command_allows_commands_inside_workspace() {
        let workspace = create_workspace();
        let runtime = tokio::runtime::Runtime::new().expect("create tokio runtime");

        let result = runtime
            .block_on(agent_run_command(
                "printf ready".to_string(),
                Some("repo-a".to_string()),
                Some("wait".to_string()),
                Some(workspace.to_string_lossy().into_owned()),
            ))
            .expect("command should execute");

        assert_eq!(result["ok"].as_bool(), Some(true));
        assert_eq!(result["stdout"].as_str(), Some("ready"));
        assert_eq!(result["blocked"], Value::Null);
    }

    #[test]
    fn resolves_relative_cwd_inside_workspace() {
        let workspace = create_workspace();
        let scope = resolve_command_scope(
            Some(workspace.to_string_lossy().as_ref()),
            Some("repo-a"),
        )
        .expect("scope should resolve");

        assert!(scope.work_dir.starts_with(&workspace));
    }

    #[test]
    fn rejects_cwd_escape_outside_workspace() {
        let workspace = create_workspace();
        let error = resolve_command_scope(
            Some(workspace.to_string_lossy().as_ref()),
            Some("../"),
        )
        .expect_err("scope should be rejected");

        assert!(error.contains("escapes workspace root"));
    }

    #[test]
    fn rejects_missing_workspace_path() {
        let error = resolve_command_scope(None, Some("repo-a"))
            .expect_err("scope should be rejected");

        assert!(error.contains("workspacePath is required"));
    }

    #[test]
    fn detects_dangerous_commands() {
        assert!(is_dangerous_command("rm -rf /"));
        assert!(is_dangerous_command("sudo rm -rf /tmp/demo"));
        assert!(!is_dangerous_command("pnpm dev"));
    }

    #[test]
    fn agent_run_command_blocks_missing_workspace_path() {
        let runtime = tokio::runtime::Runtime::new().expect("create tokio runtime");

        let result = runtime
            .block_on(agent_run_command(
                "printf blocked".to_string(),
                Some("repo-a".to_string()),
                Some("wait".to_string()),
                None,
            ))
            .expect("command should return blocked response");

        assert_eq!(result["ok"].as_bool(), Some(false));
        assert_eq!(result["blocked"].as_bool(), Some(true));
        assert!(result["stderr"]
            .as_str()
            .unwrap_or_default()
            .contains("workspacePath is required"));
    }

    #[test]
    fn agent_run_command_blocks_dangerous_commands_with_stable_shape() {
        let workspace = create_workspace();
        let runtime = tokio::runtime::Runtime::new().expect("create tokio runtime");

        let result = runtime
            .block_on(agent_run_command(
                "rm -rf /".to_string(),
                Some("repo-a".to_string()),
                Some("wait".to_string()),
                Some(workspace.to_string_lossy().into_owned()),
            ))
            .expect("command should return blocked response");

        assert_eq!(result["ok"].as_bool(), Some(false));
        assert_eq!(result["blocked"].as_bool(), Some(true));
        assert_eq!(result["exitCode"].as_i64(), Some(-1));
        assert_eq!(result["summary"].as_str(), Some("命令已被安全策略拦截。"));
        assert!(result["stderr"]
            .as_str()
            .unwrap_or_default()
            .contains("dangerous command pattern"));
    }
}

/// Read a file's contents. Returns text content truncated to 50KB.
#[tauri::command]
pub async fn agent_read_file(
    path: String,
    limit: Option<usize>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read {}: {}", path, e))?;

        let lines: Vec<&str> = content.lines().collect();
        let total = lines.len();

        let output = if let Some(lim) = limit {
            if lim < total {
                let mut out = lines[..lim].join("\n");
                out.push_str(&format!("\n... ({} more lines)", total - lim));
                out
            } else {
                content.clone()
            }
        } else {
            content.clone()
        };

        let max = 50000;
        Ok(serde_json::json!({
            "ok": true,
            "content": &output[..output.len().min(max)],
            "lines": total,
            "path": path
        }))
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

/// List files in a directory. Returns names, types, and sizes.
#[tauri::command]
pub async fn agent_list_dir(
    path: String,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let entries = std::fs::read_dir(&path)
            .map_err(|e| format!("Failed to list {}: {}", path, e))?;

        let mut items: Vec<serde_json::Value> = Vec::new();
        for entry in entries {
            if let Ok(entry) = entry {
                let meta = entry.metadata().ok();
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') { continue; }
                items.push(serde_json::json!({
                    "name": name,
                    "isDir": meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
                    "size": meta.as_ref().map(|m| m.len()).unwrap_or(0),
                }));
            }
        }

        items.sort_by(|a, b| {
            let a_dir = a["isDir"].as_bool().unwrap_or(false);
            let b_dir = b["isDir"].as_bool().unwrap_or(false);
            b_dir.cmp(&a_dir).then_with(|| {
                a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or(""))
            })
        });

        Ok(serde_json::json!({
            "ok": true,
            "path": path,
            "items": items,
            "count": items.len()
        }))
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

/// Scan a workspace recursively and return detected git repositories.
#[tauri::command]
pub async fn agent_scan_workspace_repos(
    path: String,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(&path);
        if !root.exists() {
            return Err(format!("Workspace does not exist: {}", path));
        }
        if !root.is_dir() {
            return Err(format!("Workspace is not a directory: {}", path));
        }

        let mut repos: Vec<PathBuf> = Vec::new();
        collect_git_repos(&root, &root, &mut repos)?;
        repos.sort();
        repos.dedup();

        let items: Vec<serde_json::Value> = repos.iter().map(|repo_path| {
            let relative = repo_path
                .strip_prefix(&root)
                .ok()
                .and_then(|p| if p.as_os_str().is_empty() { Some(".".to_string()) } else { Some(p.to_string_lossy().to_string()) })
                .unwrap_or_else(|| repo_path.to_string_lossy().to_string());
            let name = repo_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| root.to_string_lossy().to_string());

            serde_json::json!({
                "name": name,
                "path": repo_path.to_string_lossy().to_string(),
                "relativePath": relative
            })
        }).collect();

        Ok(serde_json::json!({
            "ok": true,
            "path": path,
            "repos": items,
            "count": items.len()
        }))
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

fn collect_git_repos(root: &Path, current: &Path, repos: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = fs::read_dir(current)
        .map_err(|e| format!("Failed to scan {}: {}", current.to_string_lossy(), e))?;

    let mut has_git_marker = false;
    let mut child_dirs: Vec<PathBuf> = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry in {}: {}", current.to_string_lossy(), e))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if name == ".git" {
            has_git_marker = true;
            continue;
        }

        let Ok(file_type) = entry.file_type() else { continue };
        if !file_type.is_dir() {
            continue;
        }

        if should_skip_dir(&name) {
            continue;
        }

        child_dirs.push(path);
    }

    if has_git_marker {
        repos.push(current.to_path_buf());
        return Ok(());
    }

    for dir in child_dirs {
        if dir.starts_with(root) {
            collect_git_repos(root, &dir, repos)?;
        }
    }

    Ok(())
}

fn should_skip_dir(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | ".next"
            | ".nuxt"
            | ".turbo"
            | ".idea"
            | ".vscode"
    ) || name.starts_with('.')
}
