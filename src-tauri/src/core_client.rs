//! JSON-RPC client for the `werd` core sidecar.
//!
//! The Python package (`wreader`) owns the data: the book index, the table of
//! contents, the reading position, the statistics and the achievements all live in
//! `~/.wreader` as plain JSON/TOML.  This module re-implements **none** of that --
//! it starts the headless sidecar (`python -m wreader.serve`) and speaks its
//! one-JSON-object-per-line protocol, so the GUI and the terminal reader write
//! exactly the same numbers into exactly the same files.
//!
//! ```text
//! GUI (Rust)  --stdin-->  {"id":1,"method":"list","params":{}}
//!             <--stdout-- {"id":1,"result":{"books":[...]}}
//! ```
//!
//! Two ways to get that process, decided by [`CoreCommand::resolve`]: in a release
//! build it is the **frozen** sidecar that ships inside the app (a Tauri resource,
//! built by `packaging/build-core.sh`), so the user never has to install Python; in
//! a development build it is the core checkout's own interpreter, so edits to
//! `../wreader/` take effect immediately.
//!
//! See `wreader/serve.py` for the method table; `README.md` here lists the ones
//! the GUI uses and `src/lib/core.ts` is the typed wrapper around them.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;

use serde_json::{json, Value};

/// Everything that can go wrong while talking to the core.
#[derive(Debug)]
pub enum CoreError {
    /// The interpreter or the package could not be found or started.
    Startup(String),
    /// Pipes broke, or the child died in the middle of a request.
    Transport(String),
    /// A line was not the JSON we expected (protocol mismatch).
    Protocol(String),
    /// The core answered with an `error` object of its own.
    Core { kind: String, message: String },
}

impl std::fmt::Display for CoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            // 起不来：把解释器和原因一起报出来，用户能照着改环境变量
            CoreError::Startup(message) => write!(f, "core startup failed: {}", message),
            // 管道断了 / 子进程死了
            CoreError::Transport(message) => write!(f, "core transport failed: {}", message),
            // 收到的不是我们认识的 JSON
            CoreError::Protocol(message) => write!(f, "core protocol error: {}", message),
            // 内核自己抛的异常：`type` 就是 Python 的类名，原样带出去
            CoreError::Core { kind, message } => write!(f, "core {}: {}", kind, message),
        }
    }
}

impl std::error::Error for CoreError {}

/// The command (program + arguments) used to start the core.
pub struct CoreCommand {
    /// 解释器可执行文件（venv 里的 python，或者系统 python3）
    pub program: String,
    /// 传给解释器的参数，通常是 `-m wreader.serve`
    pub args: Vec<String>,
}

/// The arguments that make any Python interpreter run the sidecar.
fn default_args() -> Vec<String> {
    // 与文档里给用户的那条命令一字不差：`python -m wreader.serve`
    vec!["-m".to_string(), "wreader.serve".to_string()]
}

/// The arguments to use when only *program* was given, without arguments.
///
/// A Python interpreter has to be told which module to run; the frozen sidecar
/// (`werd-core`) *is* that module's entry point (`packaging/werd_core.py`) and
/// takes no arguments at all -- handing it `-m wreader.serve` would only work by
/// accident, because `serve.main` ignores `argv` today.
fn args_for(program: &str) -> Vec<String> {
    // 只看文件名：`/usr/local/bin/python3.13` → `python3.13`，`…/werd-core` → `werd-core`
    let name = std::path::Path::new(program)
        .file_name()
        .map(|name| name.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    // python / python3 / python3.13（Windows 上是 python.exe）都当解释器
    if name.starts_with("python") {
        default_args()
    } else {
        // 冻结点，或者用户自己的包装脚本：参数由它自己决定
        Vec::new()
    }
}

/// Return `<repos>/wreader/.venv/bin/python` when *parent* holds a dev checkout.
fn dev_interpreter_in(parent: &std::path::Path) -> Option<String> {
    // 两种常见布局：(a) `wreader/` 与 `Paget/` 并排；(b) 界面直接放在 `wreader/` 里
    let candidates = [
        parent.join("wreader").join(".venv").join("bin").join("python"),
        parent.join(".venv").join("bin").join("python"),
    ];
    // 第一个真实存在的就是它
    candidates
        .iter()
        .find(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned())
}

/// Return `<repo>/.venv/bin/python` when this is a development checkout.
fn dev_interpreter() -> Option<String> {
    // CARGO_MANIFEST_DIR 是 `<gui>/src-tauri`；再上两级就是 GUI 项目的父目录
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    // 上两级：`src-tauri` → GUI 根 → 放着两个仓库的那一层
    dev_interpreter_in(manifest.parent()?.parent()?)
}

/// The file name of the frozen sidecar on this platform.
fn sidecar_name() -> &'static str {
    // Windows 上的可执行文件带 .exe 后缀，其余平台就是名字本身
    if cfg!(windows) {
        "werd-core.exe"
    } else {
        "werd-core"
    }
}

/// The frozen sidecar named `werd-core` inside *dir*, if it is actually there.
fn bundled_binary_in(dir: &std::path::Path) -> Option<String> {
    let path = dir.join(sidecar_name());
    // 只有真的存在才算数（`tauri dev` 也会把它拷到调试产物旁边）
    path.is_file().then(|| path.to_string_lossy().into_owned())
}

/// The frozen sidecar that ships with the app, if this build has one.
///
/// Two places are looked at, in this order:
///
/// 1. next to the main executable (`werd-core`), which is where Tauri puts a
///    `bundle.externalBin` -- and where a developer's own copy would sit;
/// 2. `<resource dir>/core/werd-core`, which is how the **shipped** build carries
///    it: `tauri.conf.json` maps `binaries/werd-core` to the `core` resource, so
///    the directory ends up in `Contents/Resources/core/` on macOS (next to the
///    executable's library directory on Windows/Linux).  The resource dir is not
///    guessable from `current_exe`, which is why it is passed in.
///
/// The layout is a directory rather than a single file because of startup time --
/// see the measurement in `packaging/build-core.sh`.
fn bundled_binary(resource_dir: Option<&std::path::Path>) -> Option<String> {
    // 1) 主程序旁边：手工放过去的副本，或者将来又回到单文件发行
    let beside_executable = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().and_then(bundled_binary_in));
    // 2) 打包时的资源目录：<resource dir>/core/werd-core
    let in_resources = resource_dir.and_then(|dir| bundled_binary_in(&dir.join("core")));
    // 先看旁边，再退回资源目录
    beside_executable.or(in_resources)
}

/// Build the command from already-probed candidates (pure, so it can be tested).
///
/// `allow_bundled` is `false` in development builds **on purpose**: `tauri dev`
/// copies the frozen sidecar next to the freshly built app, and using it there
/// would hide every edit to `../wreader/` behind a stale binary.  To exercise the
/// bundled one from a dev build, set `$WREADER_CORE_COMMAND` explicitly.
fn auto_command_with(bundled: Option<String>, dev: Option<String>, allow_bundled: bool) -> CoreCommand {
    // 1) 随包分发的那份内核：产品里最该用，用户机器上不必装 Python
    if allow_bundled {
        if let Some(program) = bundled {
            return CoreCommand { program, args: Vec::new() };
        }
    }
    // 2) 开发目录里的 venv（本机开发时的常态）
    if let Some(program) = dev {
        return CoreCommand { program, args: default_args() };
    }
    // 3) 兜底：系统 python3，要求 `wreader` 已经装进它
    CoreCommand { program: "python3".to_string(), args: default_args() }
}

/// Probe the machine and build the command (see [`auto_command_with`] for the order).
fn auto_command(resource_dir: Option<&std::path::Path>, allow_bundled: bool) -> CoreCommand {
    // 传进来的两份候选：随包内核（主程序旁边或资源目录里）+ 开发 venv
    auto_command_with(bundled_binary(resource_dir), dev_interpreter(), allow_bundled)
}

impl CoreCommand {
    /// Resolve the sidecar command.
    ///
    /// *resource_dir* is the app's resource directory (`tauri::Manager::path`),
    /// which is where a packaged build finds its frozen sidecar; `None` is fine for
    /// tests and for callers that are not a Tauri app.
    ///
    /// Order:
    ///
    /// 1. `$WREADER_CORE_COMMAND` -- a whole command line, e.g.
    ///    `WREADER_CORE_COMMAND=/path/to/werd-core`.  Winning over everything else
    ///    is what lets a dev build (or a test run) point at the **bundled** binary.
    /// 2. `$WREADER_CORE_PYTHON` -- an interpreter that has `wreader` installed.
    /// 3. automatic: the frozen sidecar (release builds), then the dev checkout's
    ///    `.venv/bin/python`.
    /// 4. `python3` from `PATH`, which only works when `wreader` is installed for it.
    fn resolve(resource_dir: Option<&std::path::Path>) -> Self {
        // 1) 整条命令行最优先（显式压过一切，包括随包分发的那份内核）
        if let Ok(line) = std::env::var("WREADER_CORE_COMMAND") {
            let mut parts = line.split_whitespace().map(str::to_string);
            if let Some(program) = parts.next() {
                let args: Vec<String> = parts.collect();
                // 只写了可执行文件：解释器补 `-m wreader.serve`，冻结点不用补
                let args = if args.is_empty() { args_for(&program) } else { args };
                return Self { program, args };
            }
        }
        // 2) 显式指定解释器
        if let Ok(program) = std::env::var("WREADER_CORE_PYTHON") {
            return Self { program, args: default_args() };
        }
        // 3) 自动判定；开发构建里跳过随包内核（免得改成旧的冻结点盖住源码）
        auto_command(resource_dir, !cfg!(debug_assertions))
    }
}

/// A live sidecar process plus the plumbing to talk to it.
pub struct CoreClient {
    /// 子进程句柄；Drop 时杀掉，避免留下孤儿 python
    child: Child,
    /// 请求写进这里（一行一个 JSON）；`Option` 是为了 Drop 时能把它丢掉来关 stdin
    stdin: Option<ChildStdin>,
    /// 响应从这里读（一行一个 JSON）
    stdout: BufReader<ChildStdout>,
    /// 请求 id 自增：协议是一问一答，id 用来确认读到的就是自己那一条
    next_id: u64,
}

impl CoreClient {
    /// Start the core and complete the `ping` handshake.
    ///
    /// The handshake is deliberately part of *starting*: a wrong interpreter or a
    /// missing `wreader` package then fails right here, with a readable message,
    /// instead of surfacing as a mysterious hang on the first book.
    pub fn start(command: &CoreCommand) -> Result<Self, CoreError> {
        // 起子进程；stderr 继承下来，内核的报错直接落在运行终端里（stdout 是协议，不能混）
        let mut child = Command::new(&command.program)
            .args(&command.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            // 连可执行文件都起不来（路径写错 / 没权限）
            .map_err(|err| {
                CoreError::Startup(format!("cannot run {}: {}", command.program, err))
            })?;
        // 取走两个管道的所有权（上面声明了 piped，正常情况下一定拿得到）
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| CoreError::Startup("the child has no stdin pipe".to_string()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| CoreError::Startup("the child has no stdout pipe".to_string()))?;
        // 组装客户端
        let mut client = Self {
            child,
            stdin: Some(stdin),
            stdout: BufReader::new(stdout),
            next_id: 1,
        };
        // 握手：ping 通了才算真的活着（结果只用来看有没有报错）
        client.request("ping", json!({}))?;
        Ok(client)
    }

    /// Send one request and return its `result`.
    ///
    /// Blocks until the matching answer arrives; the sidecar answers strictly in
    /// order, so one `CoreClient` must never be used from two threads at once
    /// (that is what [`CoreState`]'s mutex is for).
    pub fn request(&mut self, method: &str, params: Value) -> Result<Value, CoreError> {
        // 本请求的 id，从 1 开始
        let id = self.next_id;
        self.next_id += 1;
        // 组装成一行请求；params 一律给对象，内核就是这么要求的
        let request = json!({ "id": id, "method": method, "params": params });
        let line = serde_json::to_string(&request)
            .map_err(|err| CoreError::Protocol(err.to_string()))?;
        // 写一行再冲洗：内核是一问一答地等，不 flush 就会互相卡住
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| CoreError::Transport("stdin already closed".to_string()))?;
        stdin
            .write_all(line.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
            .map_err(|err| CoreError::Transport(err.to_string()))?;

        // 读回一行响应；空行（协议允许）直接跳过
        let mut buffer = String::new();
        loop {
            buffer.clear();
            let read = self
                .stdout
                .read_line(&mut buffer)
                .map_err(|err| CoreError::Transport(err.to_string()))?;
            // EOF：子进程已经退出（多半是启动就失败，stderr 上有原因）
            if read == 0 {
                return Err(CoreError::Transport(
                    "the core exited without answering".to_string(),
                ));
            }
            // 有内容的才算一条响应
            if !buffer.trim().is_empty() {
                break;
            }
        }

        // 解析这一行
        let trimmed = buffer.trim();
        let response: Value = serde_json::from_str(trimmed)
            .map_err(|err| CoreError::Protocol(format!("{}: {}", err, trimmed)))?;
        // 内核自己抛的异常：转成 CoreError::Core，界面上好分门别类地提示
        if let Some(error) = response.get("error") {
            let kind = error
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("Error")
                .to_string();
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            return Err(CoreError::Core { kind, message });
        }
        // id 必须对上；对不上说明协议乱了（比如上一轮漏读了一行），宁可报错也别一路错位
        if response.get("id").and_then(Value::as_u64) != Some(id) {
            return Err(CoreError::Protocol(format!(
                "answer id mismatch for request #{}: {}",
                id, trimmed
            )));
        }
        Ok(response.get("result").cloned().unwrap_or(Value::Null))
    }
}

impl Drop for CoreClient {
    /// Stop the sidecar when the app goes away (no orphaned python processes).
    fn drop(&mut self) {
        // 丢掉 stdin = 关掉管道 = 告诉内核"输入结束了"，它会自己收尾退出
        drop(self.stdin.take());
        // 保险：还赖着就杀掉，并收尸（不然会攒僵尸进程）
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// The GUI's handle on the core: one child process, shared by every command.
pub struct CoreState {
    /// 请求串行化用的锁：协议是一问一答，并发读会读到对方的响应
    client: Mutex<Option<CoreClient>>,
    /// 启动命令（挂掉之后重试用同一份）
    command: CoreCommand,
}

impl CoreState {
    /// Build the state, resolving the core command.
    ///
    /// *resource_dir* is the app's resource directory (`app.path().resource_dir()`);
    /// a packaged build finds its frozen sidecar there (see [`CoreCommand::resolve`]).
    pub fn new(resource_dir: Option<std::path::PathBuf>) -> Self {
        Self {
            client: Mutex::new(None),
            command: CoreCommand::resolve(resource_dir.as_deref()),
        }
    }

    /// Run *method* on the core, starting it on first use and after a crash.
    pub fn call(&self, method: &str, params: Value) -> Result<Value, CoreError> {
        // 同一时刻只允许一个请求（见 CoreClient::request 的说明）
        let mut guard = self
            .client
            .lock()
            .map_err(|_| CoreError::Transport("the core mutex is poisoned".to_string()))?;
        // 还没起来（第一次，或者上一次传输断了被丢掉）：现在起一个
        if guard.is_none() {
            *guard = Some(CoreClient::start(&self.command)?);
        }
        // 刚刚保证过不是 None
        let client = guard.as_mut().expect("the client was just started");
        match client.request(method, params) {
            Ok(value) => Ok(value),
            Err(err) => {
                // 传输层断了就把进程丢掉：下一次请求会重新起一个干净的内核
                if matches!(err, CoreError::Transport(_)) {
                    *guard = None;
                }
                Err(err)
            }
        }
    }

    /// The core version, read live (this also proves the core still answers).
    pub fn version(&self) -> Result<String, CoreError> {
        let value = self.call("version", json!({}))?;
        // 内核一定带 `version`；缺了就回空串，界面照常显示
        Ok(value
            .get("version")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string())
    }
}

impl Default for CoreState {
    /// The same as [`CoreState::new`] without a resource directory.
    fn default() -> Self {
        Self::new(None)
    }
}

#[cfg(test)]
mod tests {
    //! These tests talk to the **real** sidecar (`python -m wreader.serve`).
    //!
    //! They are the contract test between this shell and the Python core: if the
    //! protocol drifts, this is where it shows up.  When the Python environment is
    //! missing the test says so and skips, because the shell itself has nothing to
    //! prove without a core to talk to.

    use super::*;

    /// Environment variables are **process wide**, so the tests that set them must
    /// queue up -- otherwise one test sees the other's `WREADER_CORE_*` value.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    /// Take the env lock; a panicking test must not poison the others.
    fn env_guard() -> std::sync::MutexGuard<'static, ()> {
        // 上一个用例 panic 会让锁中毒：这里直接取回内层数据继续用
        ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Start a real client, or explain why this machine cannot run the test.
    fn client() -> Option<CoreClient> {
        // 先取一份命令快照：改 env 的用例可能正在跑，锁一下才读得完整（快照之后就不怕了）
        let command = {
            let _guard = env_guard();
            CoreCommand::resolve(None)
        };
        match CoreClient::start(&command) {
            Ok(client) => Some(client),
            Err(err) => {
                // 解释器 / 包不在：把怎么修打出来，然后跳过（不假装通过）
                eprintln!("SKIP: the reading core is not available here: {}", err);
                eprintln!("      set WREADER_CORE_PYTHON=/path/to/python,");
                eprintln!("      or run `pip install -e .` in the wreader checkout.");
                None
            }
        }
    }

    #[test]
    fn ping_reports_a_version() {
        // 起得来就说明握手成功了；这里再确认版本号真的带回来了
        let Some(mut client) = client() else { return };
        let pong = client.request("ping", json!({})).expect("ping");
        assert_eq!(pong.get("pong"), Some(&Value::Bool(true)));
        assert!(pong.get("version").and_then(Value::as_str).is_some());
    }

    #[test]
    fn the_shelf_comes_back_as_rows() {
        // `list` 的形状就是 GUI 书架直接吃的那种（一行一本）
        let Some(mut client) = client() else { return };
        let shelf = client.request("list", json!({})).expect("list");
        assert!(shelf.get("books").and_then(Value::as_array).is_some());
    }

    #[test]
    fn an_unknown_method_comes_back_as_an_error_not_a_crash() {
        // 打错方法名：内核回一条 error，连接依然可用（下一句还能继续问）
        let Some(mut client) = client() else { return };
        match client.request("no_such_method", json!({})) {
            Err(CoreError::Core { kind, message }) => {
                assert_eq!(kind, "ServeError");
                assert!(message.contains("no_such_method"), "got {}", message);
            }
            other => panic!("expected a core error, got {:?}", other),
        }
        // 出错之后连接还活着
        assert!(client.request("ping", json!({})).is_ok());
    }

    #[test]
    fn a_python_exception_travels_as_its_type_name() {
        // 内核抛的 Python 异常类型要原样传回来（前端才能分门别类地提示）
        let Some(mut client) = client() else { return };
        match client.request("event", json!({ "event_type": "not_an_event" })) {
            Err(CoreError::Core { kind, .. }) => assert_eq!(kind, "AchievementsError"),
            other => panic!("expected a core error, got {:?}", other),
        }
    }

    #[test]
    fn many_requests_in_a_row_keep_the_answers_aligned() {
        // 连续多问几次：id 对不上的话这里会直接报 Protocol 错
        let Some(mut client) = client() else { return };
        for _ in 0..5 {
            assert!(client.request("ping", json!({})).is_ok());
        }
        let shelf = client.request("list", json!({})).expect("list");
        assert!(shelf.get("books").is_some());
        assert!(client.request("paths", json!({})).is_ok());
    }

    #[test]
    fn the_core_command_can_be_pointed_at_a_custom_interpreter() {
        // 解析顺序里 env 优先，这样打包后可以指向自带的解释器
        let _guard = env_guard();
        let previous = std::env::var("WREADER_CORE_PYTHON").ok();
        std::env::set_var("WREADER_CORE_PYTHON", "/opt/example/python");
        let command = CoreCommand::resolve(None);
        assert_eq!(command.program, "/opt/example/python");
        assert_eq!(command.args, vec!["-m".to_string(), "wreader.serve".to_string()]);
        // 还原环境，别影响同进程里别的用例
        match previous {
            Some(value) => std::env::set_var("WREADER_CORE_PYTHON", value),
            None => std::env::remove_var("WREADER_CORE_PYTHON"),
        }
    }

    #[test]
    fn a_python_interpreter_is_told_which_module_to_run() {
        // 解释器：必须补上 `-m wreader.serve`
        assert_eq!(args_for("/usr/local/bin/python3.13"), default_args());
        assert_eq!(args_for("python.exe"), default_args());
        // 冻结点自己就是入口（packaging/werd_core.py）：不能再塞参数
        assert!(args_for("/tmp/bundle/werd-core").is_empty());
    }

    #[test]
    fn the_bundled_sidecar_is_found_next_to_the_main_executable() {
        // 造一个假 bundle 目录：先空着，里面不该找到内核
        let dir = std::env::temp_dir().join("paget-bundled-test");
        std::fs::create_dir_all(&dir).expect("temp dir");
        assert_eq!(bundled_binary_in(&dir), None);
        // 放一个同名文件进去（Tauri 打包后就是这样并排放着）
        let path = dir.join(sidecar_name());
        std::fs::write(&path, b"").expect("fake sidecar");
        assert_eq!(bundled_binary_in(&dir), Some(path.to_string_lossy().into_owned()));
        // 收尾：别在 temp 里留垃圾
        std::fs::remove_file(&path).expect("cleanup");
        std::fs::remove_dir_all(&dir).expect("cleanup");
    }

    #[test]
    fn the_bundled_sidecar_is_found_in_the_resource_dir() {
        // 打包后的布局：<resource dir>/core/werd-core（见 tauri.conf.json 的 resources）
        let dir = std::env::temp_dir().join("paget-resource-test");
        let core = dir.join("core");
        std::fs::create_dir_all(&core).expect("temp dir");
        let path = core.join(sidecar_name());
        std::fs::write(&path, b"").expect("fake sidecar");
        // 只给资源目录（本测试进程旁边没有内核），就该在这里找到
        assert_eq!(bundled_binary(Some(&dir)), Some(path.to_string_lossy().into_owned()));
        // 没有资源目录时只看主程序旁边：本测试进程旁边没有内核，所以是 None
        assert_eq!(bundled_binary(None), None);
        // 收尾：别在 temp 里留垃圾
        std::fs::remove_file(&path).expect("cleanup");
        std::fs::remove_dir_all(&dir).expect("cleanup");
    }

    #[test]
    fn a_release_build_prefers_the_bundled_sidecar() {
        // 两者都在时：随包内核优先，而且不带任何参数
        let command = auto_command_with(
            Some("/app/Contents/MacOS/werd-core".to_string()),
            Some("/repos/wreader/.venv/bin/python".to_string()),
            true,
        );
        assert_eq!(command.program, "/app/Contents/MacOS/werd-core");
        assert!(command.args.is_empty());
    }

    #[test]
    fn a_dev_build_prefers_the_checkout() {
        // 开发构建（allow_bundled = false）：走 venv，改了内核立刻生效
        let command = auto_command_with(
            Some("/target/debug/werd-core".to_string()),
            Some("/repos/wreader/.venv/bin/python".to_string()),
            false,
        );
        assert_eq!(command.program, "/repos/wreader/.venv/bin/python");
        assert_eq!(command.args, default_args());
        // 两者都没有时，才退到系统 python3
        let fallback = auto_command_with(None, None, true);
        assert_eq!(fallback.program, "python3");
        assert_eq!(fallback.args, default_args());
        // 开发构建里即便有随包内核，没有 venv 也不该拿它当内核
        let no_venv = auto_command_with(Some("/target/debug/werd-core".to_string()), None, false);
        assert_eq!(no_venv.program, "python3");
    }

    #[test]
    fn an_explicit_command_line_wins_and_keeps_its_arguments() {
        // 显式指定的整条命令行：原样使用，一个参数都不改
        let _guard = env_guard();
        let previous = std::env::var("WREADER_CORE_COMMAND").ok();
        std::env::set_var("WREADER_CORE_COMMAND", "/opt/werd-core --quiet");
        let command = CoreCommand::resolve(None);
        assert_eq!(command.program, "/opt/werd-core");
        assert_eq!(command.args, vec!["--quiet".to_string()]);
        // 只写可执行文件（打包后的常态）：不该再补 `-m wreader.serve`
        std::env::set_var("WREADER_CORE_COMMAND", "/opt/werd-core");
        assert!(CoreCommand::resolve(None).args.is_empty());
        // 还原环境
        match previous {
            Some(value) => std::env::set_var("WREADER_CORE_COMMAND", value),
            None => std::env::remove_var("WREADER_CORE_COMMAND"),
        }
    }
}

