#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
};
use tauri::Manager;

#[derive(Clone)]
struct SimulationSpec {
    script: PathBuf,
    port: u16,
    scene: String,
}

#[derive(Default)]
struct SimulationState(Mutex<Option<SimulationSpec>>);

fn daemon_root() -> Result<PathBuf, String> {
    if let Ok(value) = env::var("ZEBAO_DAEMON_ROOT") {
        let candidate = PathBuf::from(value);
        if candidate.join("tools/simulation/start_mujoco_shadow.ps1").is_file() {
            return Ok(candidate);
        }
    }

    let current = env::current_dir().map_err(|error| error.to_string())?;
    for base in current.ancestors() {
        for candidate in [base.join("zebao_daemon"), base.join("../zebao_daemon")] {
            if candidate.join("tools/simulation/start_mujoco_shadow.ps1").is_file() {
                return candidate.canonicalize().map_err(|error| error.to_string());
            }
        }
    }
    Err("未找到泽宝 MuJoCo 后端。请安装桌面仿真组件。".into())
}

fn run_script(script: &Path, action: &str, port: u16, scene: &str) -> Result<(), String> {
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(script)
        .args(["-Action", action, "-Port", &port.to_string(), "-Scene", scene, "-Headless"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(0x08000000)
        .output()
        .map_err(|error| format!("无法启动物理仿真：{error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if detail.is_empty() { "MuJoCo 进程启动失败".into() } else { detail })
    }
}

#[cfg(windows)]
trait HiddenProcess {
    fn creation_flags(&mut self, flags: u32) -> &mut Self;
}

#[cfg(windows)]
impl HiddenProcess for Command {
    fn creation_flags(&mut self, flags: u32) -> &mut Self {
        use std::os::windows::process::CommandExt;
        CommandExt::creation_flags(self, flags)
    }
}

#[cfg(not(windows))]
trait HiddenProcess {
    fn creation_flags(&mut self, _flags: u32) -> &mut Self;
}

#[cfg(not(windows))]
impl HiddenProcess for Command {
    fn creation_flags(&mut self, _flags: u32) -> &mut Self { self }
}

#[tauri::command]
fn simulation_start(port: u16, scene: String, state: tauri::State<'_, SimulationState>) -> Result<(), String> {
    if port < 1024 || !matches!(scene.as_str(), "empty" | "minimal" | "museum" | "kitchen") {
        return Err("仿真参数不在安全范围内".into());
    }
    let root = daemon_root()?;
    let script = root.join("tools/simulation/start_mujoco_shadow.ps1");
    run_script(&script, "start", port, &scene)?;
    *state.0.lock().map_err(|_| "仿真状态锁异常")? = Some(SimulationSpec { script, port, scene });
    Ok(())
}

#[tauri::command]
fn simulation_stop(state: tauri::State<'_, SimulationState>) -> Result<(), String> {
    let spec = state.0.lock().map_err(|_| "仿真状态锁异常")?.take();
    if let Some(spec) = spec {
        run_script(&spec.script, "stop", spec.port, &spec.scene)?;
    }
    Ok(())
}

#[tauri::command]
fn simulation_running(state: tauri::State<'_, SimulationState>) -> bool {
    state.0.lock().map(|guard| guard.is_some()).unwrap_or(false)
}

fn main() {
    let app = tauri::Builder::default()
        .manage(SimulationState::default())
        .invoke_handler(tauri::generate_handler![simulation_start, simulation_stop, simulation_running])
        .build(tauri::generate_context!())
        .expect("泽宝桌面端初始化失败");

    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let state = handle.state::<SimulationState>();
            if let Ok(mut guard) = state.0.lock() {
                if let Some(spec) = guard.take() {
                    let _ = run_script(&spec.script, "stop", spec.port, &spec.scene);
                }
            };
        }
    });
}
