use std::process::{Command, Stdio};
use std::{fs, path::{Path, PathBuf}};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SkillScanRootRecord {
    path: String,
    enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct SkillLibraryRecord {
    canonical_path: String,
    source_path: String,
    imported_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SkillInstallRecord {
    skill_name: String,
    scope: String,
    installed_path: String,
    link_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SkillsManifest {
    version: u8,
    scan_roots: Vec<SkillScanRootRecord>,
    library: HashMap<String, SkillLibraryRecord>,
    installs: Vec<SkillInstallRecord>,
}

impl Default for SkillsManifest {
    fn default() -> Self {
        Self {
            version: 1,
            scan_roots: Vec::new(),
            library: HashMap::new(),
            installs: Vec::new(),
        }
    }
}

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

fn resolve_file_path(workspace_path: Option<&str>, path: &str) -> Result<PathBuf, String> {
    let workspace = workspace_path
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Blocked: workspacePath is required for file mutation".to_string())?;

    let workspace_root = fs::canonicalize(workspace)
        .map_err(|e| format!("Blocked: workspacePath is invalid: {} ({})", workspace, e))?;

    if !workspace_root.is_dir() {
        return Err(format!("Blocked: workspacePath is not a directory: {}", workspace));
    }

    let requested = PathBuf::from(path.trim());
    if requested.as_os_str().is_empty() {
        return Err("Blocked: file path is required".to_string());
    }

    let resolved = if requested.is_absolute() {
        lexical_normalize(&requested)
    } else {
        lexical_normalize(&workspace_root.join(requested))
    };

    if !resolved.starts_with(&workspace_root) {
        return Err(format!(
            "Blocked: file path escapes workspace root: {}",
            workspace_root.to_string_lossy()
        ));
    }

    Ok(resolved)
}

fn lexical_normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }

    normalized
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

fn apply_exact_edit(content: &str, old_string: &str, new_string: &str, replace_all: bool) -> Result<(String, usize), String> {
    if old_string.is_empty() {
        return Err("oldString cannot be empty".to_string());
    }

    let match_count = content.matches(old_string).count();
    if match_count == 0 {
        return Err("oldString not found in file".to_string());
    }

    if !replace_all && match_count != 1 {
        return Err(format!("oldString matched {} times; set replaceAll=true to replace all", match_count));
    }

    let replacements = if replace_all { match_count } else { 1 };
    let next_content = if replace_all {
        content.replace(old_string, new_string)
    } else {
        content.replacen(old_string, new_string, 1)
    };

    Ok((next_content, replacements))
}

#[cfg(test)]
mod tests {
    use super::{
        agent_run_command,
        apply_exact_edit,
        build_app_skill_catalog,
        build_search_queries,
        extract_duckduckgo_html_results,
        import_skill_to_library_impl,
        install_library_skill_to_app_impl,
        is_dangerous_command,
        normalize_app_skill_raw,
        parse_skill_frontmatter,
        resolve_command_scope,
        run_background_command,
        run_wait_command
    };
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

    fn write_skill(root: &PathBuf, relative_dir: &str, name: &str, description: &str) -> PathBuf {
        let skill_dir = root.join(relative_dir);
        fs::create_dir_all(&skill_dir).expect("create skill dir");
        let skill_path = skill_dir.join("SKILL.md");
        fs::write(
            &skill_path,
            format!(
                "---\nname: {name}\ndescription: {description}\n---\n\n# {name}\n\nbody"
            ),
        )
        .expect("write skill");
        skill_path
    }

    #[test]
    fn app_skill_catalog_prefers_workspace_over_global_repo_and_system() {
        let root = std::env::temp_dir().join(format!("agent-skills-catalog-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create root");

        let workspace_root = root.join("workspace");
        let global_root = root.join("global");
        let repo_root = root.join("repo");
        let system_root = root.join("system");

        write_skill(&global_root, "release-flow", "release-flow", "global");
        write_skill(&repo_root, "release-flow", "release-flow", "repo");
        write_skill(&workspace_root, "release-flow", "release-flow", "workspace");
        write_skill(&system_root, "git-branching", "git-branching", "system");

        let catalog = build_app_skill_catalog(
            Some(&workspace_root),
            Some(&global_root),
            Some(&repo_root),
            Some(&system_root),
        )
        .expect("build catalog");

        let release_flow = catalog
            .iter()
            .find(|item| item["name"].as_str() == Some("release-flow"))
            .expect("release-flow exists");
        assert_eq!(release_flow["sourceType"].as_str(), Some("workspace"));
        assert_eq!(release_flow["writable"].as_bool(), Some(true));

        let git_branching = catalog
            .iter()
            .find(|item| item["name"].as_str() == Some("git-branching"))
            .expect("git-branching exists");
        assert_eq!(git_branching["sourceType"].as_str(), Some("system"));
        assert_eq!(git_branching["writable"].as_bool(), Some(false));
    }

    #[test]
    fn import_and_install_library_skill_creates_app_entry() {
        let root = std::env::temp_dir().join(format!("agent-skills-install-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create root");

        let source_root = root.join("source");
        let library_root = root.join("library");
        let app_root = root.join("app");
        let skill_path = write_skill(&source_root, "agent-design-guide", "agent-design-guide", "guide");

        let imported = import_skill_to_library_impl(&skill_path, &library_root)
            .expect("import to library");
        assert!(PathBuf::from(imported["skill"]["canonicalPath"].as_str().unwrap()).exists());

        let installed = install_library_skill_to_app_impl("agent-design-guide", &library_root, &app_root)
            .expect("install to app");
        assert!(PathBuf::from(installed["installedPath"].as_str().unwrap()).exists());
    }

    #[test]
    fn normalize_app_skill_raw_preserves_enabled_flag() {
        let raw = "---
name: legacy-debug-skill
description: 旧技能
---

# Legacy Debug Skill";
        let normalized = normalize_app_skill_raw("legacy-debug-skill", raw, false)
            .expect("normalize app skill raw");
        let (meta, _) = parse_skill_frontmatter(&normalized);

        assert_eq!(meta.get("name").map(String::as_str), Some("legacy-debug-skill"));
        assert_eq!(meta.get("enabled").map(String::as_str), Some("false"));
    }

    #[test]
    fn installed_app_skill_keeps_workspace_path_and_respects_link_mode() {
        let root = std::env::temp_dir().join(format!("agent-skills-installed-catalog-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create root");

        let source_root = root.join("source");
        let library_root = root.join("library");
        let app_root = root.join("app");
        let skill_path = write_skill(&source_root, "release-flow", "release-flow", "guide");

        import_skill_to_library_impl(&skill_path, &library_root)
            .expect("import to library");
        let installed = install_library_skill_to_app_impl("release-flow", &library_root, &app_root)
            .expect("install to app");

        let catalog = build_app_skill_catalog(Some(&app_root), None, None, None)
            .expect("build app skill catalog");
        let release_flow = catalog
            .iter()
            .find(|item| item["name"].as_str() == Some("release-flow"))
            .expect("release-flow exists");

        let source_path = release_flow["sourcePath"].as_str().expect("source path");
        assert!(source_path.starts_with(app_root.to_string_lossy().as_ref()));
        assert_eq!(release_flow["sourceType"].as_str(), Some("workspace"));

        let expected_writable = installed["linkType"].as_str() != Some("symlink");
        assert_eq!(release_flow["writable"].as_bool(), Some(expected_writable));
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

    #[test]
    fn apply_exact_edit_requires_unique_match_by_default() {
        let error = apply_exact_edit("hello hello", "hello", "hi", false)
            .expect_err("should reject ambiguous match");

        assert!(error.contains("matched 2 times"));
    }

    #[test]
    fn apply_exact_edit_replaces_all_when_requested() {
        let (content, replacements) = apply_exact_edit("hello hello", "hello", "hi", true)
            .expect("should replace all matches");

        assert_eq!(content, "hi hi");
        assert_eq!(replacements, 2);
    }

    #[test]
    fn build_search_queries_adds_compact_cjk_variant() {
        let queries = build_search_queries("深圳 今天天气");

        assert_eq!(queries[0], "深圳 今天天气");
        assert!(queries.iter().any(|query| query == "深圳今天天气"));
    }

    #[test]
    fn extract_duckduckgo_html_results_parses_serp_markup() {
        let html = r#"
        <html><body>
          <div class="result results_links_deep web-result">
            <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">LangGraph Docs</a>
            <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Build stateful agents for LLM workflows.</a>
          </div>
        </body></html>
        "#;

        let results = extract_duckduckgo_html_results(html);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0]["title"].as_str(), Some("LangGraph Docs"));
        assert_eq!(results[0]["url"].as_str(), Some("https://example.com/docs"));
        assert_eq!(results[0]["snippet"].as_str(), Some("Build stateful agents for LLM workflows."));
        assert_eq!(results[0]["provider"].as_str(), Some("duckduckgo_html"));
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

/// Write a full file. Creates parent directories when missing.
#[tauri::command]
pub async fn agent_write_file(
    path: String,
    content: String,
    workspace_path: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let resolved = resolve_file_path(workspace_path.as_deref(), &path)?;

        if let Some(parent) = resolved.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directories: {}", e))?;
        }

        fs::write(&resolved, content.as_bytes())
            .map_err(|e| format!("Failed to write {}: {}", resolved.display(), e))?;

        Ok(serde_json::json!({
            "ok": true,
            "path": resolved.to_string_lossy().to_string(),
            "bytes": content.len(),
            "summary": "文件写入完成。"
        }))
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

/// Perform a single exact replacement in a file.
#[tauri::command]
pub async fn agent_edit_file(
    path: String,
    old_string: String,
    new_string: String,
    replace_all: Option<bool>,
    workspace_path: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let resolved = resolve_file_path(workspace_path.as_deref(), &path)?;
        let content = fs::read_to_string(&resolved)
            .map_err(|e| format!("Failed to read {}: {}", resolved.display(), e))?;

        let (next_content, replacements) = apply_exact_edit(
            &content,
            &old_string,
            &new_string,
            replace_all.unwrap_or(false)
        )?;

        fs::write(&resolved, next_content.as_bytes())
            .map_err(|e| format!("Failed to write {}: {}", resolved.display(), e))?;

        Ok(serde_json::json!({
            "ok": true,
            "path": resolved.to_string_lossy().to_string(),
            "replacements": replacements,
            "summary": format!("已完成 {} 处替换。", replacements)
        }))
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentFileEdit {
    old_string: String,
    new_string: String,
    replace_all: Option<bool>,
}

/// Perform multiple exact replacements in sequence.
#[tauri::command]
pub async fn agent_multiedit_file(
    path: String,
    edits: Vec<AgentFileEdit>,
    workspace_path: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let resolved = resolve_file_path(workspace_path.as_deref(), &path)?;
        let mut content = fs::read_to_string(&resolved)
            .map_err(|e| format!("Failed to read {}: {}", resolved.display(), e))?;

        let mut replacements = 0usize;
        for edit in edits.iter() {
            let (next_content, count) = apply_exact_edit(
                &content,
                &edit.old_string,
                &edit.new_string,
                edit.replace_all.unwrap_or(false)
            )?;
            content = next_content;
            replacements += count;
        }

        fs::write(&resolved, content.as_bytes())
            .map_err(|e| format!("Failed to write {}: {}", resolved.display(), e))?;

        Ok(serde_json::json!({
            "ok": true,
            "path": resolved.to_string_lossy().to_string(),
            "replacements": replacements,
            "summary": format!("已完成 {} 处替换。", replacements)
        }))
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

/// Execute a lightweight web search using DuckDuckGo's instant answer API.
#[tauri::command]
pub async fn agent_web_search(
    query: String,
    limit: Option<usize>,
    provider: Option<String>,
    api_key: Option<String>,
) -> Result<serde_json::Value, String> {
    let normalized_query = normalize_search_query(&query);
    if normalized_query.is_empty() {
        return Ok(serde_json::json!({
            "ok": false,
            "query": query,
            "results": [],
            "error": "query is required"
        }));
    }

    let result_limit = limit.unwrap_or(5).clamp(1, 10);
    let search_queries = build_search_queries(&normalized_query);
    let client = reqwest::Client::new();
    let mut results: Vec<serde_json::Value> = Vec::new();
    let mut providers: Vec<String> = Vec::new();

    let normalized_provider = provider
        .unwrap_or_else(|| "tavily".to_string())
        .trim()
        .to_lowercase();
    let search_api_key = api_key.unwrap_or_default().trim().to_string();

    if normalized_provider == "tavily" && !search_api_key.is_empty() {
        if let Ok(tavily_results) = fetch_tavily_results(&client, &normalized_query, result_limit, &search_api_key).await {
            if !tavily_results.is_empty() {
                providers.push("tavily".to_string());
                merge_search_results(&mut results, tavily_results, result_limit);
            }
        }
    }

    for candidate_query in search_queries.iter() {
        if results.len() >= result_limit {
            break;
        }

        let instant_results = fetch_duckduckgo_instant_results(&client, candidate_query).await.unwrap_or_default();
        if !instant_results.is_empty() {
            providers.push("duckduckgo_instant".to_string());
            merge_search_results(&mut results, instant_results, result_limit);
        }

        if results.len() < result_limit {
            let html_results = fetch_duckduckgo_html_results(&client, candidate_query).await.unwrap_or_default();
            if !html_results.is_empty() {
                providers.push("duckduckgo_html".to_string());
                merge_search_results(&mut results, html_results, result_limit);
            }
        }

        if results.len() >= result_limit {
            break;
        }
    }

    Ok(serde_json::json!({
        "ok": true,
        "query": query,
        "normalizedQuery": normalized_query,
        "requestedProvider": normalized_provider,
        "provider": if providers.is_empty() {
            "none".to_string()
        } else {
            providers.join("+")
        },
        "results": results,
        "summary": if results.is_empty() {
            "未找到搜索结果。".to_string()
        } else {
            format!("找到 {} 条搜索结果。", results.len())
        }
    }))
}

async fn fetch_tavily_results(
    client: &reqwest::Client,
    query: &str,
    limit: usize,
    api_key: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let response = client
        .post("https://api.tavily.com/search")
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&serde_json::json!({
            "query": query,
            "search_depth": "advanced",
            "max_results": limit,
            "include_answer": false,
            "include_images": false,
            "include_raw_content": false
        }))
        .send()
        .await
        .map_err(|e| format!("Tavily search failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Tavily search failed: HTTP {} {}", status.as_u16(), body));
    }

    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Tavily response: {}", e))?;

    let results = payload["results"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| {
            let title = item["title"].as_str().unwrap_or("").trim().to_string();
            let url = item["url"].as_str().unwrap_or("").trim().to_string();
            let snippet = item["content"].as_str().unwrap_or("").trim().to_string();
            if title.is_empty() || url.is_empty() {
                return None;
            }

            Some(serde_json::json!({
                "title": title,
                "url": url,
                "snippet": snippet,
                "score": item["score"].as_f64(),
                "provider": "tavily"
            }))
        })
        .collect();

    Ok(results)
}

fn collect_duckduckgo_topics(value: &serde_json::Value, output: &mut Vec<serde_json::Value>) {
    let Some(items) = value.as_array() else {
        return;
    };

    for item in items {
        if let (Some(text), Some(url)) = (item["Text"].as_str(), item["FirstURL"].as_str()) {
            output.push(serde_json::json!({
                "title": summarize_topic_title(text),
                "url": url,
                "snippet": text
            }));
            continue;
        }

        collect_duckduckgo_topics(&item["Topics"], output);
    }
}

fn summarize_topic_title(text: &str) -> String {
    let trimmed = text.trim();
    trimmed
        .split(" - ")
        .next()
        .filter(|part| !part.trim().is_empty())
        .unwrap_or(trimmed)
        .to_string()
}

fn normalize_search_query(query: &str) -> String {
    query
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn build_search_queries(query: &str) -> Vec<String> {
    let normalized = normalize_search_query(query);
    let mut queries = Vec::new();

    push_unique_query(&mut queries, normalized.clone());
    push_unique_query(&mut queries, trim_search_punctuation(&normalized));

    if contains_cjk(&normalized) && normalized.contains(' ') {
        push_unique_query(&mut queries, normalized.replace(' ', ""));
    }

    queries
}

fn trim_search_punctuation(query: &str) -> String {
    query
        .trim_matches(|ch: char| ch.is_whitespace() || "，。！？、,.!?;；:：()（）[]【】“”\"'‘’".contains(ch))
        .to_string()
}

fn contains_cjk(input: &str) -> bool {
    input.chars().any(|ch| {
        ('\u{4E00}'..='\u{9FFF}').contains(&ch)
            || ('\u{3400}'..='\u{4DBF}').contains(&ch)
            || ('\u{3040}'..='\u{30FF}').contains(&ch)
            || ('\u{AC00}'..='\u{D7AF}').contains(&ch)
    })
}

fn push_unique_query(queries: &mut Vec<String>, value: String) {
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        return;
    }

    if !queries.iter().any(|existing| existing == &trimmed) {
        queries.push(trimmed);
    }
}

async fn fetch_duckduckgo_instant_results(
    client: &reqwest::Client,
    query: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let url = format!(
        "https://api.duckduckgo.com/?q={}&format=json&no_html=1&no_redirect=1&skip_disambig=0",
        urlencoding::encode(query)
    );

    let response = client
        .get(&url)
        .header("Accept", "application/json")
        .header("User-Agent", "flow-desk/1.0")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .send()
        .await
        .map_err(|e| format!("Web search failed: {}", e))?;

    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse web search response: {}", e))?;

    let mut results: Vec<serde_json::Value> = Vec::new();

    if let (Some(abstract_text), Some(abstract_url)) = (
        payload["AbstractText"].as_str(),
        payload["AbstractURL"].as_str()
    ) {
        if !abstract_text.trim().is_empty() && !abstract_url.trim().is_empty() {
            results.push(serde_json::json!({
                "title": payload["Heading"].as_str().filter(|v| !v.trim().is_empty()).unwrap_or("Instant Answer"),
                "url": abstract_url,
                "snippet": abstract_text,
                "provider": "duckduckgo_instant"
            }));
        }
    }

    collect_duckduckgo_topics(&payload["RelatedTopics"], &mut results);
    for item in results.iter_mut() {
        if item["provider"].is_null() {
            item["provider"] = serde_json::Value::String("duckduckgo_instant".to_string());
        }
    }

    Ok(results)
}

async fn fetch_duckduckgo_html_results(
    client: &reqwest::Client,
    query: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let url = format!(
        "https://html.duckduckgo.com/html/?q={}&kl=wt-wt",
        urlencoding::encode(query)
    );

    let response = client
        .get(&url)
        .header("Accept", "text/html")
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .send()
        .await
        .map_err(|e| format!("HTML search failed: {}", e))?;

    let html = response
        .text()
        .await
        .map_err(|e| format!("Failed to read HTML search response: {}", e))?;

    Ok(extract_duckduckgo_html_results(&html))
}

fn extract_duckduckgo_html_results(html: &str) -> Vec<serde_json::Value> {
    let mut results = Vec::new();
    let mut cursor = 0usize;

    while let Some(class_idx_rel) = html[cursor..].find("result__a") {
        let class_idx = cursor + class_idx_rel;
        let anchor_start = match html[..class_idx].rfind("<a ") {
            Some(value) => value,
            None => {
                cursor = class_idx + "result__a".len();
                continue;
            }
        };

        let href = extract_anchor_href(&html[anchor_start..]).unwrap_or_default();
        let title = extract_tag_text(&html[anchor_start..], "</a>").unwrap_or_default();
        let next_anchor = html[class_idx + "result__a".len()..]
            .find("result__a")
            .map(|offset| class_idx + "result__a".len() + offset)
            .unwrap_or(html.len());
        let snippet_window = &html[class_idx..next_anchor];
        let snippet = extract_class_text(snippet_window, "result__snippet").unwrap_or_default();
        let normalized_url = normalize_search_result_url(&href);

        if !title.trim().is_empty() && !normalized_url.trim().is_empty() {
            results.push(serde_json::json!({
                "title": decode_html_entities(&title),
                "url": normalized_url,
                "snippet": decode_html_entities(&snippet),
                "provider": "duckduckgo_html"
            }));
        }

        cursor = next_anchor;
    }

    results
}

fn extract_anchor_href(segment: &str) -> Option<String> {
    let href_marker = "href=\"";
    let href_start = segment.find(href_marker)? + href_marker.len();
    let href_end = segment[href_start..].find('"')? + href_start;
    Some(segment[href_start..href_end].to_string())
}

fn extract_tag_text(segment: &str, closing_tag: &str) -> Option<String> {
    let start = segment.find('>')? + 1;
    let end = segment[start..].find(closing_tag)? + start;
    Some(strip_tags(&segment[start..end]))
}

fn extract_class_text(segment: &str, class_name: &str) -> Option<String> {
    let class_idx = segment.find(class_name)?;
    let tag_start = segment[..class_idx].rfind('<')?;
    let content_start = segment[tag_start..].find('>')? + tag_start + 1;

    for closing_tag in ["</a>", "</span>", "</div>"] {
        if let Some(content_end_rel) = segment[content_start..].find(closing_tag) {
            let content_end = content_start + content_end_rel;
            return Some(strip_tags(&segment[content_start..content_end]));
        }
    }

    None
}

fn strip_tags(value: &str) -> String {
    let mut output = String::new();
    let mut inside_tag = false;

    for ch in value.chars() {
        match ch {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            _ if !inside_tag => output.push(ch),
            _ => {}
        }
    }

    output.trim().to_string()
}

fn normalize_search_result_url(url: &str) -> String {
    let decoded = decode_html_entities(url);

    if let Some(uddg_idx) = decoded.find("uddg=") {
        let encoded = decoded[uddg_idx + 5..]
            .split('&')
            .next()
            .unwrap_or("");

        if let Ok(value) = urlencoding::decode(encoded) {
            return value.into_owned();
        }
    }

    if decoded.starts_with("//") {
        return format!("https:{}", decoded);
    }

    if decoded.starts_with('/') {
        return format!("https://duckduckgo.com{}", decoded);
    }

    decoded
}

fn decode_html_entities(input: &str) -> String {
    input
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
}

fn merge_search_results(
    target: &mut Vec<serde_json::Value>,
    candidates: Vec<serde_json::Value>,
    limit: usize,
) {
    for candidate in candidates {
        if target.len() >= limit {
            break;
        }

        let candidate_url = candidate["url"].as_str().unwrap_or("").trim();
        if candidate_url.is_empty() {
            continue;
        }

        if target.iter().any(|item| item["url"].as_str().unwrap_or("") == candidate_url) {
            continue;
        }

        target.push(candidate);
    }
}

#[tauri::command]
pub async fn agent_scan_skills(
    roots: Vec<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut items: Vec<serde_json::Value> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();

        for root in roots.iter() {
            let expanded_root = expand_user_path(root);
            if !expanded_root.exists() || !expanded_root.is_dir() {
                continue;
            }

            collect_skill_entries(&expanded_root, &expanded_root, &mut items, &mut seen)?;
        }

        items.sort_by(|left, right| {
            let left_name = left["title"].as_str().unwrap_or(left["name"].as_str().unwrap_or(""));
            let right_name = right["title"].as_str().unwrap_or(right["name"].as_str().unwrap_or(""));
            left_name.cmp(right_name)
                .then_with(|| left["skillPath"].as_str().unwrap_or("").cmp(right["skillPath"].as_str().unwrap_or("")))
        });

        Ok(serde_json::json!({
            "ok": true,
            "skills": items,
            "count": items.len()
        }))
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

#[tauri::command]
pub async fn agent_discover_skills(
    roots: Vec<String>,
) -> Result<serde_json::Value, String> {
    agent_scan_skills(roots).await
}

#[tauri::command]
pub async fn agent_get_skill_scan_roots() -> Result<serde_json::Value, String> {
    let manifest = load_skills_manifest()?;
    Ok(serde_json::json!({
        "ok": true,
        "roots": manifest.scan_roots
    }))
}

#[tauri::command]
pub async fn agent_set_skill_scan_roots(
    roots: Vec<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let mut manifest = load_skills_manifest()?;
    manifest.scan_roots = roots
        .into_iter()
        .filter_map(|value| {
            let path = value["path"].as_str()?.trim().to_string();
            if path.is_empty() {
                return None;
            }
            Some(SkillScanRootRecord {
                path,
                enabled: value["enabled"].as_bool().unwrap_or(true),
            })
        })
        .collect();
    save_skills_manifest(&manifest)?;
    Ok(serde_json::json!({
        "ok": true,
        "roots": manifest.scan_roots
    }))
}

#[tauri::command]
pub async fn agent_list_library_skills() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let library_root = resolve_central_skill_root();
        let mut items: Vec<serde_json::Value> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        let manifest = load_skills_manifest().unwrap_or_default();

        if library_root.exists() && library_root.is_dir() {
            collect_skill_entries(&library_root, &library_root, &mut items, &mut seen)?;
        }

        let mut skills = items
            .into_iter()
            .map(|item| {
                let name = item["name"].as_str().unwrap_or("").to_string();
                let skill_path = item["skillPath"].as_str().unwrap_or("").to_string();
                let record = manifest.library.get(&name);
                let install_targets = manifest.installs
                    .iter()
                    .filter(|value| value.skill_name == name)
                    .map(|value| serde_json::json!({
                        "scope": value.scope,
                        "installedPath": value.installed_path,
                        "linkType": value.link_type,
                    }))
                    .collect::<Vec<_>>();
                let installed_scopes = install_targets
                    .iter()
                    .filter_map(|value| value["scope"].as_str().map(|scope| scope.to_string()))
                    .collect::<Vec<_>>();
                serde_json::json!({
                    "name": name,
                    "title": item["title"].as_str().unwrap_or(""),
                    "description": item["description"].as_str().unwrap_or(""),
                    "canonicalPath": skill_path,
                    "sourcePath": record.map(|value| value.source_path.clone()).unwrap_or_default(),
                    "files": item["files"].clone(),
                    "installedScopes": installed_scopes,
                    "installTargets": install_targets,
                })
            })
            .collect::<Vec<_>>();

        skills.sort_by(|left, right| {
            left["title"].as_str().unwrap_or("").cmp(right["title"].as_str().unwrap_or(""))
        });

        Ok(serde_json::json!({
            "ok": true,
            "skills": skills
        }))
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

#[tauri::command]
pub async fn agent_import_skill_to_library(
    skill_path: String,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let library_root = resolve_central_skill_root();
        fs::create_dir_all(&library_root)
            .map_err(|e| format!("Failed to create {}: {}", library_root.display(), e))?;
        let result = import_skill_to_library_impl(Path::new(&skill_path), &library_root)?;
        let mut manifest = load_skills_manifest()?;
        let skill = &result["skill"];
        let skill_name = skill["name"].as_str().unwrap_or("").to_string();
        if !skill_name.is_empty() {
            manifest.library.insert(skill_name, SkillLibraryRecord {
                canonical_path: skill["canonicalPath"].as_str().unwrap_or("").to_string(),
                source_path: skill["sourcePath"].as_str().unwrap_or("").to_string(),
                imported_at: current_timestamp_string(),
            });
            save_skills_manifest(&manifest)?;
        }
        Ok(result)
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

#[tauri::command]
pub async fn agent_install_library_skill_to_app(
    skill_name: String,
    scope: String,
    workspace_path: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let library_root = resolve_central_skill_root();
        let app_root = match scope.as_str() {
            "workspace" => resolve_workspace_app_skill_root(workspace_path.as_deref())
                .ok_or_else(|| "workspacePath is required for workspace install".to_string())?,
            _ => resolve_global_app_skill_root(),
        };

        let result = install_library_skill_to_app_impl(&skill_name, &library_root, &app_root)?;
        let mut manifest = load_skills_manifest()?;
        upsert_install_record(&mut manifest, SkillInstallRecord {
            skill_name: skill_name.clone(),
            scope: scope.clone(),
            installed_path: result["installedPath"].as_str().unwrap_or("").to_string(),
            link_type: result["linkType"].as_str().unwrap_or("copy").to_string(),
        });
        save_skills_manifest(&manifest)?;
        Ok(result)
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

#[tauri::command]
pub async fn agent_uninstall_library_skill_from_app(
    skill_name: String,
    scope: String,
    workspace_path: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let app_root = match scope.as_str() {
            "workspace" => resolve_workspace_app_skill_root(workspace_path.as_deref())
                .ok_or_else(|| "workspacePath is required for workspace uninstall".to_string())?,
            _ => resolve_global_app_skill_root(),
        };
        let install_dir = app_root.join(&skill_name);
        remove_path_if_exists(&install_dir)?;

        let mut manifest = load_skills_manifest()?;
        remove_install_record(&mut manifest, &skill_name, &scope);
        save_skills_manifest(&manifest)?;

        Ok(serde_json::json!({
            "ok": true,
            "removed": true,
            "scope": scope,
            "skillName": skill_name,
            "removedPath": install_dir.to_string_lossy().to_string()
        }))
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

#[tauri::command]
pub async fn agent_migrate_app_skill_overrides(
    overrides: serde_json::Value,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let global_root = resolve_global_app_skill_root();
        fs::create_dir_all(&global_root)
            .map_err(|e| format!("Failed to create {}: {}", global_root.display(), e))?;

        let Some(entries) = overrides.as_object() else {
            return Ok(serde_json::json!({
                "ok": true,
                "migrated": Vec::<String>::new(),
                "skipped": Vec::<String>::new()
            }));
        };

        let mut migrated = Vec::new();
        let mut skipped = Vec::new();

        for (raw_name, override_value) in entries {
            let content = override_value.get("content").and_then(|value| value.as_str()).unwrap_or("").trim().to_string();
            if content.is_empty() {
                continue;
            }
            let enabled = override_value.get("enabled").and_then(|value| value.as_bool()).unwrap_or(true);
            let skill_name = sanitize_skill_name(raw_name);
            if skill_name.is_empty() {
                continue;
            }

            let skill_dir = global_root.join(&skill_name);
            if skill_dir.exists() {
                skipped.push(skill_name);
                continue;
            }
            fs::create_dir_all(&skill_dir)
                .map_err(|e| format!("Failed to create {}: {}", skill_dir.display(), e))?;
            let skill_path = skill_dir.join("SKILL.md");
            let normalized = normalize_app_skill_raw(&skill_name, &content, enabled)?;
            fs::write(&skill_path, normalized)
                .map_err(|e| format!("Failed to write {}: {}", skill_path.display(), e))?;
            migrated.push(skill_name);
        }

        Ok(serde_json::json!({
            "ok": true,
            "migrated": migrated,
            "skipped": skipped
        }))
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

#[tauri::command]
pub async fn agent_list_app_skills(
    workspace_path: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace_root = resolve_workspace_app_skill_root(workspace_path.as_deref());
        let global_root = resolve_global_app_skill_root();
        let repo_root = resolve_repo_app_skill_root();
        let system_root = resolve_system_skill_root();
        let items = build_app_skill_catalog(
            workspace_root.as_deref(),
            Some(global_root.as_path()),
            Some(repo_root.as_path()),
            Some(system_root.as_path()),
        )?;

        Ok(serde_json::json!({
            "ok": true,
            "skills": items,
            "count": items.len()
        }))
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

#[tauri::command]
pub async fn agent_create_app_skill(
    workspace_path: String,
    base_name: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace_root = resolve_workspace_app_skill_root(Some(workspace_path.as_str()))
            .ok_or_else(|| "workspacePath is required".to_string())?;
        fs::create_dir_all(&workspace_root)
            .map_err(|e| format!("Failed to create {}: {}", workspace_root.display(), e))?;

        let skill_name = ensure_unique_skill_name(
            &workspace_root,
            base_name.as_deref().unwrap_or("custom-debug-skill"),
        );
        let skill_dir = workspace_root.join(&skill_name);
        fs::create_dir_all(&skill_dir)
            .map_err(|e| format!("Failed to create {}: {}", skill_dir.display(), e))?;
        let skill_path = skill_dir.join("SKILL.md");
        fs::write(&skill_path, create_app_skill_template(&skill_name))
            .map_err(|e| format!("Failed to write {}: {}", skill_path.display(), e))?;

        Ok(serde_json::json!({
            "ok": true,
            "skill": build_app_skill_entry_from_path(&skill_path, "workspace", true)?
        }))
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

#[tauri::command]
pub async fn agent_save_app_skill(
    skill_path: String,
    content: String,
    workspace_path: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&skill_path);
        resolve_app_skill_write_scope(&path, workspace_path.as_deref())?;
        fs::write(&path, content.as_bytes())
            .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
        Ok(serde_json::json!({
            "ok": true,
            "skillPath": skill_path
        }))
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

#[tauri::command]
pub async fn agent_delete_app_skill(
    skill_path: String,
    workspace_path: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&skill_path);
        resolve_app_skill_write_scope(&path, workspace_path.as_deref())?;
        let skill_dir = path.parent()
            .ok_or_else(|| format!("Skill path has no parent: {}", path.display()))?;
        remove_path_if_exists(skill_dir)?;
        Ok(serde_json::json!({
            "ok": true,
            "deletedPath": skill_dir.to_string_lossy().to_string()
        }))
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

#[tauri::command]
pub async fn agent_copy_app_skill_to_workspace(
    skill_path: String,
    workspace_path: String,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source_skill = fs::canonicalize(&skill_path)
            .map_err(|e| format!("Failed to canonicalize {}: {}", skill_path, e))?;
        let source_dir = source_skill.parent()
            .ok_or_else(|| format!("Skill path has no parent: {}", source_skill.display()))?;
        let (_, _) = parse_skill_file(&source_skill)?;
        let skill_name = sanitize_skill_name(
            source_dir.file_name().and_then(|value| value.to_str()).unwrap_or("unknown-skill")
        );
        let workspace_root = resolve_workspace_app_skill_root(Some(workspace_path.as_str()))
            .ok_or_else(|| "workspacePath is required".to_string())?;
        fs::create_dir_all(&workspace_root)
            .map_err(|e| format!("Failed to create {}: {}", workspace_root.display(), e))?;
        let target_dir = workspace_root.join(&skill_name);
        remove_path_if_exists(&target_dir)?;
        copy_dir_all(source_dir, &target_dir)?;
        let target_skill = target_dir.join("SKILL.md");

        Ok(serde_json::json!({
            "ok": true,
            "skillPath": target_skill.to_string_lossy().to_string()
        }))
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

#[tauri::command]
pub async fn agent_scan_runtime_skills(
    workspace_path: Option<String>,
) -> Result<serde_json::Value, String> {
    agent_list_app_skills(workspace_path).await
}

#[tauri::command]
pub async fn agent_read_skill(
    skill_path: String,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let content = fs::read_to_string(&skill_path)
            .map_err(|e| format!("Failed to read {}: {}", skill_path, e))?;

        Ok(serde_json::json!({
            "ok": true,
            "skillPath": skill_path,
            "content": content
        }))
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

#[tauri::command]
pub async fn agent_write_skill(
    skill_path: String,
    content: String,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        fs::write(&skill_path, content.as_bytes())
            .map_err(|e| format!("Failed to write {}: {}", skill_path, e))?;

        Ok(serde_json::json!({
            "ok": true,
            "skillPath": skill_path,
            "bytes": content.len()
        }))
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

#[tauri::command]
pub async fn agent_delete_skill(
    skill_path: String,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let skill_file = PathBuf::from(&skill_path);
        let file_name = skill_file.file_name().and_then(|value| value.to_str()).unwrap_or("");
        if file_name != "SKILL.md" {
            return Err(format!("Refusing to delete non-skill file: {}", skill_path));
        }

        let skill_dir = skill_file.parent()
            .ok_or_else(|| format!("Skill path has no parent directory: {}", skill_path))?;

        fs::remove_dir_all(skill_dir)
            .map_err(|e| format!("Failed to delete {}: {}", skill_dir.display(), e))?;

        Ok(serde_json::json!({
            "ok": true,
            "deletedPath": skill_dir.to_string_lossy().to_string()
        }))
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

fn expand_user_path(input: &str) -> PathBuf {
    let trimmed = input.trim();
    if trimmed == "~" {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home);
        }
    }

    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }

    PathBuf::from(trimmed)
}

fn collect_skill_entries(
    scan_root: &Path,
    current: &Path,
    items: &mut Vec<serde_json::Value>,
    seen: &mut HashSet<String>,
) -> Result<(), String> {
    let skill_path = current.join("SKILL.md");
    if skill_path.is_file() {
        let canonical = fs::canonicalize(&skill_path)
            .map_err(|e| format!("Failed to canonicalize {}: {}", skill_path.display(), e))?;
        let key = canonical.to_string_lossy().to_string();

        if seen.insert(key) {
            items.push(build_skill_entry(scan_root, &canonical)?);
        }
        return Ok(());
    }

    let entries = fs::read_dir(current)
        .map_err(|e| format!("Failed to scan {}: {}", current.to_string_lossy(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry in {}: {}", current.to_string_lossy(), e))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(file_type) = entry.file_type() else { continue };

        if !file_type.is_dir() || should_skip_skill_scan_dir(&name) {
            continue;
        }

        collect_skill_entries(scan_root, &path, items, seen)?;
    }

    Ok(())
}

fn build_skill_entry(scan_root: &Path, skill_path: &Path) -> Result<serde_json::Value, String> {
    let content = fs::read_to_string(skill_path)
        .map_err(|e| format!("Failed to read {}: {}", skill_path.display(), e))?;
    let (meta, body) = parse_skill_frontmatter(&content);
    let skill_dir = skill_path.parent().unwrap_or(scan_root);
    let files = collect_skill_files(skill_dir)?;

    let name = meta.get("name")
        .cloned()
        .unwrap_or_else(|| skill_dir.file_name().and_then(|value| value.to_str()).unwrap_or("unknown-skill").to_string());
    let description = meta.get("description").cloned().unwrap_or_default();
    let title = extract_skill_title(&body).unwrap_or_else(|| to_title_case(&name));

    Ok(serde_json::json!({
        "id": skill_path.to_string_lossy().to_string(),
        "name": name,
        "title": title,
        "description": description,
        "skillPath": skill_path.to_string_lossy().to_string(),
        "rootPath": scan_root.to_string_lossy().to_string(),
        "files": files
    }))
}

fn parse_skill_frontmatter(content: &str) -> (HashMap<String, String>, String) {
    let mut meta = HashMap::new();

    if let Some(rest) = content.strip_prefix("---\n") {
        if let Some(idx) = rest.find("\n---\n") {
            let frontmatter = &rest[..idx];
            let body = rest[idx + 5..].to_string();

            for line in frontmatter.lines() {
                if let Some(separator) = line.find(':') {
                    let key = line[..separator].trim();
                    let value = line[separator + 1..].trim();
                    if !key.is_empty() {
                        meta.insert(key.to_string(), value.to_string());
                    }
                }
            }

            return (meta, body);
        }
    }

    (meta, content.to_string())
}

fn extract_skill_title(body: &str) -> Option<String> {
    body.lines()
        .map(str::trim)
        .find(|line| line.starts_with('#'))
        .map(|line| line.trim_start_matches('#').trim().to_string())
        .filter(|line| !line.is_empty())
}

fn to_title_case(value: &str) -> String {
    value
        .split(['-', '_', ' '])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn collect_skill_files(skill_dir: &Path) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    collect_relative_files(skill_dir, skill_dir, &mut files)?;
    files.sort();
    Ok(files)
}

fn collect_relative_files(
    root: &Path,
    current: &Path,
    files: &mut Vec<String>,
) -> Result<(), String> {
    let entries = fs::read_dir(current)
        .map_err(|e| format!("Failed to scan {}: {}", current.to_string_lossy(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry in {}: {}", current.to_string_lossy(), e))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(file_type) = entry.file_type() else { continue };

        if file_type.is_dir() {
            if should_skip_dir(&name) {
                continue;
            }
            collect_relative_files(root, &path, files)?;
            continue;
        }

        let relative = path.strip_prefix(root)
            .ok()
            .map(|value| value.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|| path.to_string_lossy().replace('\\', "/"));
        files.push(relative);
    }

    Ok(())
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

fn should_skip_skill_scan_dir(name: &str) -> bool {
    if matches!(name, ".codex" | ".cursor" | ".agents") {
        return false;
    }

    should_skip_dir(name)
}

fn resolve_home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"))
}

fn resolve_flowdesk_home_dir() -> PathBuf {
    resolve_home_dir().join(".flow-desk")
}

fn resolve_skills_manifest_path() -> PathBuf {
    resolve_flowdesk_home_dir().join("skills-manifest.json")
}

fn resolve_central_skill_root() -> PathBuf {
    resolve_flowdesk_home_dir().join("skills")
}

fn resolve_global_app_skill_root() -> PathBuf {
    resolve_flowdesk_home_dir().join("app-skills")
}

fn resolve_workspace_app_skill_root(workspace_path: Option<&str>) -> Option<PathBuf> {
    workspace_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| PathBuf::from(value).join(".flow-desk").join("app-skills"))
}

fn resolve_repo_app_skill_root() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let app_root = manifest_dir.parent().unwrap_or(manifest_dir.as_path());
    app_root.join("app-skills")
}

fn resolve_system_skill_root() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let app_root = manifest_dir.parent().unwrap_or(manifest_dir.as_path());
    app_root.join("src").join("agent").join("skills")
}

fn default_discover_roots() -> Vec<SkillScanRootRecord> {
    let home = resolve_home_dir();
    vec![
        home.join("Documents"),
        home.join("Desktop"),
        home.join("Developer"),
        home.join("projects"),
        home.join("code"),
        home.join("repos"),
        home.join("work"),
        home.join("src"),
        PathBuf::from("/Applications"),
    ]
    .into_iter()
    .map(|path| SkillScanRootRecord {
        path: path.to_string_lossy().to_string(),
        enabled: path.exists(),
    })
    .collect()
}

fn load_skills_manifest() -> Result<SkillsManifest, String> {
    let manifest_path = resolve_skills_manifest_path();
    if !manifest_path.exists() {
        return Ok(SkillsManifest {
            scan_roots: default_discover_roots(),
            ..SkillsManifest::default()
        });
    }

    let raw = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read {}: {}", manifest_path.display(), e))?;
    let mut manifest: SkillsManifest = serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse {}: {}", manifest_path.display(), e))?;
    if manifest.scan_roots.is_empty() {
        manifest.scan_roots = default_discover_roots();
    }
    Ok(manifest)
}

fn save_skills_manifest(manifest: &SkillsManifest) -> Result<(), String> {
    let manifest_path = resolve_skills_manifest_path();
    if let Some(parent) = manifest_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
    }
    let raw = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("Failed to serialize skills manifest: {}", e))?;
    fs::write(&manifest_path, raw)
        .map_err(|e| format!("Failed to write {}: {}", manifest_path.display(), e))
}

fn current_timestamp_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn parse_skill_file(skill_path: &Path) -> Result<(HashMap<String, String>, String), String> {
    let content = fs::read_to_string(skill_path)
        .map_err(|e| format!("Failed to read {}: {}", skill_path.display(), e))?;
    Ok(parse_skill_frontmatter(&content))
}

fn sanitize_skill_name(name: &str) -> String {
    let normalized = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') { ch } else { '-' })
        .collect::<String>();
    normalized
        .split('-')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst)
        .map_err(|e| format!("Failed to create {}: {}", dst.display(), e))?;

    for entry in fs::read_dir(src)
        .map_err(|e| format!("Failed to read {}: {}", src.display(), e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read entry in {}: {}", src.display(), e))?;
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed to inspect {}: {}", entry.path().display(), e))?;
        let target = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)
                .map_err(|e| format!("Failed to copy {}: {}", target.display(), e))?;
        }
    }

    Ok(())
}

fn collect_skill_file_paths(current: &Path, items: &mut Vec<PathBuf>) -> Result<(), String> {
    let skill_path = current.join("SKILL.md");
    if skill_path.is_file() {
        items.push(skill_path);
        return Ok(());
    }

    let entries = fs::read_dir(current)
        .map_err(|e| format!("Failed to scan {}: {}", current.to_string_lossy(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry in {}: {}", current.to_string_lossy(), e))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(file_type) = entry.file_type() else { continue };
        let is_dir_like = file_type.is_dir() || (file_type.is_symlink() && path.is_dir());

        if !is_dir_like || should_skip_skill_scan_dir(&name) {
            continue;
        }

        collect_skill_file_paths(&path, items)?;
    }

    Ok(())
}

fn is_symlink_path(path: &Path) -> Result<bool, String> {
    Ok(fs::symlink_metadata(path)
        .map_err(|e| format!("Failed to inspect {}: {}", path.display(), e))?
        .file_type()
        .is_symlink())
}

fn remove_path_if_exists(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    let metadata = fs::symlink_metadata(path)
        .map_err(|e| format!("Failed to inspect {}: {}", path.display(), e))?;
    if metadata.file_type().is_symlink() || metadata.is_file() {
        fs::remove_file(path)
            .map_err(|e| format!("Failed to remove {}: {}", path.display(), e))?;
    } else if metadata.is_dir() {
        fs::remove_dir_all(path)
            .map_err(|e| format!("Failed to remove {}: {}", path.display(), e))?;
    }

    Ok(())
}

#[cfg(unix)]
fn try_symlink_dir(src: &Path, dst: &Path) -> Result<(), String> {
    std::os::unix::fs::symlink(src, dst)
        .map_err(|e| format!("Failed to create symlink {} -> {}: {}", dst.display(), src.display(), e))
}

#[cfg(not(unix))]
fn try_symlink_dir(_src: &Path, _dst: &Path) -> Result<(), String> {
    Err("symlink not supported on this platform".to_string())
}

fn upsert_install_record(manifest: &mut SkillsManifest, record: SkillInstallRecord) {
    manifest.installs.retain(|item| !(item.skill_name == record.skill_name && item.scope == record.scope));
    manifest.installs.push(record);
}

fn remove_install_record(manifest: &mut SkillsManifest, skill_name: &str, scope: &str) {
    manifest.installs.retain(|item| !(item.skill_name == skill_name && item.scope == scope));
}

fn frontmatter_bool(meta: &HashMap<String, String>, key: &str, default: bool) -> bool {
    match meta.get(key).map(|value| value.trim().to_lowercase()) {
        Some(value) if value == "false" || value == "0" || value == "no" => false,
        Some(value) if value == "true" || value == "1" || value == "yes" => true,
        Some(_) => default,
        None => default,
    }
}

fn normalize_app_skill_raw(name: &str, raw: &str, enabled: bool) -> Result<String, String> {
    let (mut meta, body) = parse_skill_frontmatter(raw);
    meta.insert("name".to_string(), name.to_string());
    meta.insert("enabled".to_string(), if enabled { "true" } else { "false" }.to_string());

    let mut lines = vec!["---".to_string()];
    let mut keys = meta.keys().cloned().collect::<Vec<_>>();
    keys.sort();
    if let Some(index) = keys.iter().position(|key| key == "name") {
        let name_key = keys.remove(index);
        keys.insert(0, name_key);
    }
    if let Some(index) = keys.iter().position(|key| key == "description") {
        let description_key = keys.remove(index);
        let insert_at = usize::min(1, keys.len());
        keys.insert(insert_at, description_key);
    }
    if let Some(index) = keys.iter().position(|key| key == "enabled") {
        let enabled_key = keys.remove(index);
        let insert_at = usize::min(2, keys.len());
        keys.insert(insert_at, enabled_key);
    }
    for key in keys {
        if let Some(value) = meta.get(&key) {
            lines.push(format!("{}: {}", key, value));
        }
    }
    lines.push("---".to_string());
    lines.push(String::new());
    let normalized_body = body.trim().to_string();
    if !normalized_body.is_empty() {
        lines.push(normalized_body);
    }
    Ok(lines.join("\n"))
}

fn create_app_skill_template(name: &str) -> String {
    [
        "---",
        &format!("name: {}", name),
        "description: 请填写这个自定义技能的用途",
        "enabled: true",
        "---",
        "",
        "# 自定义技能",
        "",
        "## 适用场景",
        "",
        "- 什么时候应该使用这个技能？",
        "- 它主要帮助 AI 解决什么问题？",
        "",
        "## 操作步骤",
        "",
        "1. 在这里写第 1 步。",
        "2. 在这里写第 2 步。",
        "",
        "## 注意事项",
        "",
        "- 是否有不要使用它的场景？",
        "- 是否有风险、前置条件或限制？",
    ]
    .join("\n")
}

fn ensure_unique_skill_name(root: &Path, base_name: &str) -> String {
    let normalized = sanitize_skill_name(base_name);
    if normalized.is_empty() {
        return "custom-debug-skill".to_string();
    }
    if !root.join(&normalized).exists() {
        return normalized;
    }

    let mut index = 2;
    loop {
        let candidate = format!("{}-{}", normalized, index);
        if !root.join(&candidate).exists() {
            return candidate;
        }
        index += 1;
    }
}

fn build_app_skill_entry_from_path(
    skill_path: &Path,
    source_type: &str,
    writable: bool,
) -> Result<serde_json::Value, String> {
    let skill_dir = skill_path
        .parent()
        .ok_or_else(|| format!("Skill path has no parent: {}", skill_path.display()))?;
    let content = fs::read_to_string(skill_path)
        .map_err(|e| format!("Failed to read {}: {}", skill_path.display(), e))?;
    let (meta, body) = parse_skill_frontmatter(&content);
    let files = collect_skill_files(skill_dir)?;
    let name = meta.get("name")
        .cloned()
        .unwrap_or_else(|| skill_dir.file_name().and_then(|value| value.to_str()).unwrap_or("unknown-skill").to_string());
    let title = extract_skill_title(&body).unwrap_or_else(|| to_title_case(&name));
    let enabled = frontmatter_bool(&meta, "enabled", true);

    Ok(serde_json::json!({
        "name": name,
        "title": title,
        "description": meta.get("description").cloned().unwrap_or_default(),
        "sourceType": source_type,
        "sourcePath": skill_path.to_string_lossy().to_string(),
        "effectivePath": skill_path.to_string_lossy().to_string(),
        "writable": writable,
        "enabled": enabled,
        "files": files,
        "content": content
    }))
}

fn path_within_root(path: &Path, root: &Path) -> bool {
    path.starts_with(root)
}

fn resolve_app_skill_write_scope(
    skill_path: &Path,
    workspace_path: Option<&str>,
) -> Result<(), String> {
    let canonical = fs::canonicalize(skill_path)
        .map_err(|e| format!("Failed to canonicalize {}: {}", skill_path.display(), e))?;
    let global_root = resolve_global_app_skill_root();
    if global_root.exists() {
        let canonical_global = fs::canonicalize(&global_root)
            .map_err(|e| format!("Failed to canonicalize {}: {}", global_root.display(), e))?;
        if path_within_root(&canonical, &canonical_global) {
            return Ok(());
        }
    }

    let workspace_root = resolve_workspace_app_skill_root(workspace_path)
        .ok_or_else(|| "workspacePath is required for workspace app skill mutation".to_string())?;
    if workspace_root.exists() {
        let canonical_workspace = fs::canonicalize(&workspace_root)
            .map_err(|e| format!("Failed to canonicalize {}: {}", workspace_root.display(), e))?;
        if path_within_root(&canonical, &canonical_workspace) {
            return Ok(());
        }
    }

    Err(format!("Refusing to mutate non-writable App Skill: {}", skill_path.display()))
}

pub fn import_skill_to_library_impl(skill_path: &Path, library_root: &Path) -> Result<serde_json::Value, String> {
    let canonical_skill_path = fs::canonicalize(skill_path)
        .map_err(|e| format!("Failed to canonicalize {}: {}", skill_path.display(), e))?;
    if canonical_skill_path.file_name().and_then(|value| value.to_str()) != Some("SKILL.md") {
        return Err(format!("Expected SKILL.md, got {}", canonical_skill_path.display()));
    }

    let (meta, body) = parse_skill_file(&canonical_skill_path)?;
    let source_dir = canonical_skill_path
        .parent()
        .ok_or_else(|| format!("Skill path has no parent: {}", canonical_skill_path.display()))?;
    let skill_name = sanitize_skill_name(
        meta.get("name")
            .map(String::as_str)
            .unwrap_or_else(|| source_dir.file_name().and_then(|value| value.to_str()).unwrap_or("unknown-skill")),
    );
    if skill_name.is_empty() {
        return Err("Skill name is required".to_string());
    }

    let canonical_dir = library_root.join(&skill_name);
    if canonical_dir.exists() {
        fs::remove_dir_all(&canonical_dir)
            .map_err(|e| format!("Failed to replace {}: {}", canonical_dir.display(), e))?;
    }
    copy_dir_all(source_dir, &canonical_dir)?;
    let canonical_skill_file = canonical_dir.join("SKILL.md");
    let title = extract_skill_title(&body).unwrap_or_else(|| to_title_case(&skill_name));

    Ok(serde_json::json!({
        "ok": true,
        "skill": {
            "name": skill_name,
            "title": title,
            "description": meta.get("description").cloned().unwrap_or_default(),
            "canonicalPath": canonical_skill_file.to_string_lossy().to_string(),
            "sourcePath": canonical_skill_path.to_string_lossy().to_string()
        }
    }))
}

pub fn install_library_skill_to_app_impl(
    skill_name: &str,
    library_root: &Path,
    app_root: &Path,
) -> Result<serde_json::Value, String> {
    let canonical_dir = library_root.join(skill_name);
    let canonical_skill = canonical_dir.join("SKILL.md");
    if !canonical_skill.is_file() {
        return Err(format!("Library skill does not exist: {}", canonical_skill.display()));
    }

    fs::create_dir_all(app_root)
        .map_err(|e| format!("Failed to create {}: {}", app_root.display(), e))?;
    let install_dir = app_root.join(skill_name);
    if install_dir.exists() {
        let metadata = fs::symlink_metadata(&install_dir)
            .map_err(|e| format!("Failed to inspect {}: {}", install_dir.display(), e))?;
        if metadata.file_type().is_symlink() || metadata.is_dir() {
            fs::remove_dir_all(&install_dir)
                .or_else(|_| fs::remove_file(&install_dir))
                .map_err(|e| format!("Failed to clear {}: {}", install_dir.display(), e))?;
        }
    }

    let link_type = match try_symlink_dir(&canonical_dir, &install_dir) {
        Ok(_) => "symlink".to_string(),
        Err(_) => {
            copy_dir_all(&canonical_dir, &install_dir)?;
            "copy".to_string()
        }
    };

    Ok(serde_json::json!({
        "ok": true,
        "installedPath": install_dir.to_string_lossy().to_string(),
        "linkType": link_type
    }))
}

fn build_catalog_entries(
    root: Option<&Path>,
    source_type: &str,
    writable: bool,
    catalog: &mut HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    let Some(root) = root else {
        return Ok(());
    };
    if !root.exists() || !root.is_dir() {
        return Ok(());
    }

    let mut skill_paths = Vec::new();
    collect_skill_file_paths(root, &mut skill_paths)?;
    skill_paths.sort();

    for skill_path in skill_paths {
        let content = fs::read_to_string(&skill_path)
            .map_err(|e| format!("Failed to read {}: {}", skill_path.display(), e))?;
        let (meta, body) = parse_skill_frontmatter(&content);
        let skill_dir = skill_path
            .parent()
            .ok_or_else(|| format!("Skill path has no parent: {}", skill_path.display()))?;
        let name = meta.get("name")
            .cloned()
            .unwrap_or_else(|| skill_dir.file_name().and_then(|value| value.to_str()).unwrap_or("unknown-skill").to_string());
        if catalog.contains_key(&name) {
            continue;
        }
        let files = collect_skill_files(skill_dir)?;
        let title = extract_skill_title(&body).unwrap_or_else(|| to_title_case(&name));
        let enabled = frontmatter_bool(&meta, "enabled", true);
        let is_symlinked = is_symlink_path(&skill_path)? || is_symlink_path(skill_dir)?;
        catalog.insert(
            name.clone(),
            serde_json::json!({
                "name": name,
                "title": title,
                "description": meta.get("description").cloned().unwrap_or_default(),
                "sourceType": source_type,
                "sourcePath": skill_path.to_string_lossy().to_string(),
                "effectivePath": skill_path.to_string_lossy().to_string(),
                "writable": writable && !is_symlinked,
                "enabled": enabled,
                "files": files,
                "content": content
            }),
        );
    }

    Ok(())
}

pub fn build_app_skill_catalog(
    workspace_root: Option<&Path>,
    global_root: Option<&Path>,
    repo_root: Option<&Path>,
    system_root: Option<&Path>,
) -> Result<Vec<serde_json::Value>, String> {
    let mut catalog = HashMap::new();
    build_catalog_entries(workspace_root, "workspace", true, &mut catalog)?;
    build_catalog_entries(global_root, "global", true, &mut catalog)?;
    build_catalog_entries(repo_root, "repo", false, &mut catalog)?;
    build_catalog_entries(system_root, "system", false, &mut catalog)?;

    let mut items = catalog.into_values().collect::<Vec<_>>();
    items.sort_by(|left, right| {
        let left_name = left["title"].as_str().unwrap_or(left["name"].as_str().unwrap_or(""));
        let right_name = right["title"].as_str().unwrap_or(right["name"].as_str().unwrap_or(""));
        left_name.cmp(right_name)
    });
    Ok(items)
}
