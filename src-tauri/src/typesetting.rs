//! Private TeX Live lifecycle and bounded, cancellable typesetting jobs.
//! Plugins pass files, never executable paths, package-manager arguments or shell commands.
use crate::ai_requests::{self, AiRequests};
use base64::{engine::general_purpose::STANDARD, Engine};
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::Read,
    path::{Component, Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock,
    },
    time::Duration,
};
use tauri::{AppHandle, Manager, State};
use tokio::{
    io::AsyncReadExt,
    process::{Child, Command},
    sync::Mutex,
};

const REPOSITORY: &str =
    "https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/2025/tlnet-final";
const INPUT_LIMIT: usize = 64 * 1024 * 1024;
const LOG_LIMIT: usize = 1024 * 1024;
const OUTPUT_LIMIT: u64 = 64 * 1024 * 1024;

#[derive(Default)]
pub struct TypesettingState(pub Arc<Mutex<()>>);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Configuration {
    mode: String,
    bin_directory: String,
}
impl Default for Configuration {
    fn default() -> Self {
        Self {
            mode: "bundled".into(),
            bin_directory: String::new(),
        }
    }
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    schema_version: u32,
    year: u32,
    platform: String,
    runtime_id: String,
    bin_directory: String,
    archive_sha256: String,
    repository: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    available: bool,
    initialized: bool,
    mode: String,
    runtime_id: Option<String>,
    reason: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    configuration: Configuration,
    runtime_directory: String,
    user_tree: String,
    templates_directory: String,
    repository: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Asset {
    name: String,
    data_base64: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    source: String,
    #[serde(default)]
    assets: Vec<Asset>,
    passes: Option<u32>,
    timeout_ms: Option<u64>,
    #[serde(default)]
    return_files: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputFile {
    name: String,
    data_base64: String,
}
#[derive(Serialize)]
pub struct CompileResult {
    success: bool,
    pdf: Option<String>,
    log: String,
    files: Vec<OutputFile>,
}

#[derive(Clone)]
struct Locations {
    data: PathBuf,
    bundle: PathBuf,
}
impl Locations {
    fn app(app: &AppHandle) -> Result<Self, String> {
        let resources = app.path().resource_dir().map_err(err)?;
        // Tauri development uses source resources; installed builds use the resource map.
        let bundle = resources.join("texlive");
        #[cfg(debug_assertions)]
        let bundle = if bundle.join("manifest.json").is_file() {
            resources.join("texlive")
        } else {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/texlive")
        };
        Ok(Self {
            data: app.path().app_data_dir().map_err(err)?.join("typesetting"),
            bundle,
        })
    }
    fn config(&self) -> Result<Configuration, String> {
        let path = self.data.join("configuration.json");
        if !path.exists() {
            return Ok(Configuration::default());
        }
        let config: Configuration =
            serde_json::from_slice(&fs::read(path).map_err(err)?).map_err(err)?;
        if config.mode != "bundled" && config.mode != "external" {
            return Err("Invalid TeX runtime configuration".into());
        }
        Ok(config)
    }
    fn manifest(&self) -> Result<Manifest, String> {
        let manifest: Manifest =
            serde_json::from_slice(&fs::read(self.bundle.join("manifest.json")).map_err(err)?)
                .map_err(err)?;
        if manifest.schema_version != 1
            || manifest.year != 2025
            || manifest.platform != "linux-x64"
            || manifest.repository != REPOSITORY
            || !flat_name(&manifest.runtime_id)
            || !manifest.runtime_id.starts_with("texlive-2025-linux-x64-")
            || manifest.bin_directory != "bin/x86_64-linux"
            || manifest.archive_sha256.len() != 64
            || !manifest
                .archive_sha256
                .bytes()
                .all(|b| b.is_ascii_hexdigit())
        {
            return Err("Invalid or incompatible TeX Live bundle manifest".into());
        }
        Ok(manifest)
    }
    fn user_tree(&self) -> PathBuf {
        self.data.join("packages/2025")
    }
    fn runtime(&self, manifest: &Manifest) -> PathBuf {
        self.data.join("runtimes").join(&manifest.runtime_id)
    }
    fn status(&self) -> Result<Status, String> {
        let config = self.config()?;
        let mut status = Status {
            available: false,
            initialized: false,
            mode: config.mode.clone(),
            runtime_id: None,
            reason: None,
        };
        if !cfg!(all(target_os = "linux", target_arch = "x86_64")) {
            status.reason = Some("unsupported-platform".into());
            return Ok(status);
        }
        if !Path::new("/usr/bin/bwrap").is_file() {
            status.reason = Some("sandbox-missing".into());
            return Ok(status);
        }
        if config.mode == "external" {
            status.initialized = external_tree(Path::new(&config.bin_directory)).is_ok();
            status.available = status.initialized;
            if !status.available {
                status.reason = Some("engine-missing".into());
            }
            return Ok(status);
        }
        match self.manifest() {
            Ok(manifest) => {
                status.initialized = ready(&self.runtime(&manifest), &manifest);
                status.available =
                    status.initialized || self.bundle.join("runtime.tar.gz").is_file();
                status.runtime_id = Some(manifest.runtime_id);
                if !status.available {
                    status.reason = Some("bundle-missing".into());
                }
            }
            Err(_) => status.reason = Some("bundle-missing".into()),
        }
        Ok(status)
    }
    async fn engine(&self) -> Result<(PathBuf, PathBuf), String> {
        if !cfg!(all(target_os = "linux", target_arch = "x86_64")) {
            return Err("XeLaTeX currently supports Linux x86-64 only".into());
        }
        if !Path::new("/usr/bin/bwrap").is_file() {
            return Err("bubblewrap is required for isolated XeLaTeX jobs".into());
        }
        let config = self.config()?;
        fs::create_dir_all(self.user_tree()).map_err(err)?;
        fs::create_dir_all(self.data.join("templates")).map_err(err)?;
        if config.mode == "external" {
            return external_tree(Path::new(&config.bin_directory));
        }
        let manifest = self.manifest()?;
        let runtime = self.runtime(&manifest);
        if !ready(&runtime, &manifest) {
            self.extract(&manifest, &runtime).await?;
        }
        Ok((runtime.clone(), runtime.join(&manifest.bin_directory)))
    }
    async fn extract(&self, manifest: &Manifest, destination: &Path) -> Result<(), String> {
        let locations = self.clone();
        let manifest = manifest.clone();
        let destination = destination.to_path_buf();
        let cancel = CancelExtraction(Arc::new(AtomicBool::new(false)));
        let signal = cancel.0.clone();
        tokio::task::spawn_blocking(move || {
            // Retain the installation lock inside the worker after a caller is cancelled.
            static INSTALL: OnceLock<std::sync::Mutex<()>> = OnceLock::new();
            let _lock = INSTALL
                .get_or_init(|| std::sync::Mutex::new(()))
                .lock()
                .map_err(err)?;
            if ready(&destination, &manifest) {
                return Ok(());
            }
            locations.extract_sync(&manifest, &destination, &signal)
        })
        .await
        .map_err(err)?
    }
    fn extract_sync(
        &self,
        manifest: &Manifest,
        destination: &Path,
        cancelled: &AtomicBool,
    ) -> Result<(), String> {
        let archive_path = self.bundle.join("runtime.tar.gz");
        if fs::metadata(&archive_path).map_err(err)?.len() > 512 * 1024 * 1024 {
            return Err("TeX runtime archive too large".into());
        }
        let mut archive = File::open(&archive_path).map_err(err)?;
        let mut digest = Sha256::new();
        let mut buffer = [0; 65536];
        loop {
            if cancelled.load(Ordering::Relaxed) {
                return Err("Runtime initialization cancelled".into());
            }
            let count = archive.read(&mut buffer).map_err(err)?;
            if count == 0 {
                break;
            }
            digest.update(&buffer[..count]);
        }
        if format!("{:x}", digest.finalize()) != manifest.archive_sha256 {
            return Err("TeX runtime SHA-256 mismatch".into());
        }
        fs::create_dir_all(destination.parent().ok_or("Invalid runtime directory")?)
            .map_err(err)?;
        let staging = TemporaryDirectory::new(destination.parent().unwrap(), ".install-")?;
        let mut archive = tar::Archive::new(GzDecoder::new(File::open(archive_path).map_err(err)?));
        let mut total = 0_u64;
        let mut count = 0;
        let mut links = Vec::new();
        for entry in archive.entries().map_err(err)? {
            if cancelled.load(Ordering::Relaxed) {
                return Err("Runtime initialization cancelled".into());
            }
            let mut entry = entry.map_err(err)?;
            count += 1;
            total = total
                .checked_add(entry.size())
                .ok_or("TeX archive overflow")?;
            if count > 100_000 || total > 2 * 1024 * 1024 * 1024 {
                return Err("TeX runtime extraction limit exceeded".into());
            }
            let path = entry.path().map_err(err)?.into_owned();
            if !safe_relative(&path) {
                return Err("Unsafe TeX archive path".into());
            }
            let kind = entry.header().entry_type();
            if kind.is_symlink() {
                let link = entry
                    .link_name()
                    .map_err(err)?
                    .ok_or("Missing TeX symlink target")?
                    .into_owned();
                if !safe_link(&path, &link) {
                    return Err("Unsafe TeX archive link".into());
                }
                links.push((path, link));
            } else if kind.is_file() || kind.is_dir() {
                if !entry.unpack_in(&staging.0).map_err(err)? {
                    return Err("Unsafe TeX archive entry".into());
                }
            } else {
                return Err("Unsupported TeX archive entry".into());
            }
        }
        #[cfg(unix)]
        install_links(&staging.0, &links)?;
        validate_bin(&staging.0.join(&manifest.bin_directory))?;
        if cancelled.load(Ordering::Relaxed) {
            return Err("Runtime initialization cancelled".into());
        }
        for file in [
            "LICENSE.TL",
            "LICENSE.CTAN",
            "texmf-var/web2c/xetex/xelatex.fmt",
            "texmf-dist/fonts/opentype/public/fandol/FandolSong-Regular.otf",
        ] {
            if !staging.0.join(file).is_file() {
                return Err(format!("Required TeX resource missing: {file}"));
            }
        }
        fs::write(
            staging.0.join(".cachalot-runtime"),
            &manifest.archive_sha256,
        )
        .map_err(err)?;
        if destination.exists() {
            return Err("Incomplete runtime exists; preserve it and repair before retrying".into());
        }
        fs::rename(&staging.0, destination).map_err(err)?;
        Ok(())
    }
}
struct CancelExtraction(Arc<AtomicBool>);
impl Drop for CancelExtraction {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}
fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}
fn ready(root: &Path, manifest: &Manifest) -> bool {
    fs::read_to_string(root.join(".cachalot-runtime"))
        .ok()
        .as_deref()
        == Some(manifest.archive_sha256.as_str())
        && validate_bin(&root.join(&manifest.bin_directory)).is_ok()
}
fn validate_bin(bin: &Path) -> Result<(), String> {
    for name in ["xelatex", "xdvipdfmx", "kpsewhich", "tlmgr"] {
        if !bin.join(name).is_file() {
            return Err(format!("Missing TeX executable: {name}"));
        }
    }
    Ok(())
}
fn external_tree(directory: &Path) -> Result<(PathBuf, PathBuf), String> {
    let bin = fs::canonicalize(directory).map_err(err)?;
    validate_bin(&bin)?;
    let root = bin
        .parent()
        .and_then(Path::parent)
        .ok_or("Invalid TeX Live bin directory")?
        .to_path_buf();
    for resource in [
        "texmf-dist/web2c/texmf.cnf",
        "texmf-var/web2c/xetex/xelatex.fmt",
    ] {
        if !root.join(resource).is_file() {
            return Err(
                "External engine must be a self-contained TeX Live tree with xelatex format".into(),
            );
        }
    }
    Ok((root, bin))
}
fn safe_relative(path: &Path) -> bool {
    path.components()
        .all(|part| matches!(part, Component::Normal(_) | Component::CurDir))
}
fn safe_link(path: &Path, link: &Path) -> bool {
    let mut depth = path
        .parent()
        .map(|p| {
            p.components()
                .filter(|p| matches!(p, Component::Normal(_)))
                .count()
        })
        .unwrap_or(0);
    for part in link.components() {
        match part {
            Component::Normal(_) => depth += 1,
            Component::CurDir => (),
            Component::ParentDir if depth > 0 => depth -= 1,
            _ => return false,
        }
    }
    true
}
#[cfg(unix)]
fn install_links(root: &Path, links: &[(PathBuf, PathBuf)]) -> Result<(), String> {
    let root = fs::canonicalize(root).map_err(err)?;
    for (path, link) in links {
        let target = root.join(path);
        let parent = target.parent().ok_or("Invalid symlink path")?;
        // Do not follow an earlier archive symlink when creating another link.
        let mut ancestor = parent.to_path_buf();
        while ancestor != root {
            if fs::symlink_metadata(&ancestor).is_ok_and(|m| m.file_type().is_symlink()) {
                return Err("TeX symlink ancestor rejected".into());
            }
            ancestor = ancestor
                .parent()
                .ok_or("Invalid symlink ancestor")?
                .to_path_buf();
        }
        fs::create_dir_all(parent).map_err(err)?;
        std::os::unix::fs::symlink(link, target).map_err(err)?;
    }
    for (path, _) in links {
        if !fs::canonicalize(root.join(path))
            .map_err(err)?
            .starts_with(&root)
        {
            return Err("TeX symlink escapes runtime".into());
        }
    }
    Ok(())
}
fn flat_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name.as_bytes()[0].is_ascii_alphanumeric()
        && !name.contains("..")
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}
struct TemporaryDirectory(PathBuf);
impl TemporaryDirectory {
    fn new(parent: &Path, prefix: &str) -> Result<Self, String> {
        fs::create_dir_all(parent).map_err(err)?;
        let path = parent.join(format!("{prefix}{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).map_err(err)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).map_err(err)?;
        }
        Ok(Self(path))
    }
}
impl Drop for TemporaryDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Cancellation drops this guard; kill the owned process group as well as the child.
struct Process(Child);
impl Drop for Process {
    fn drop(&mut self) {
        #[cfg(unix)]
        if let Some(pid) = self.0.id() {
            unsafe {
                libc::kill(-(pid as i32), libc::SIGKILL);
            }
        }
        let _ = self.0.start_kill();
    }
}
async fn drain(mut pipe: impl tokio::io::AsyncRead + Unpin) -> Vec<u8> {
    let mut output = Vec::new();
    let mut buffer = [0; 8192];
    while let Ok(count) = pipe.read(&mut buffer).await {
        if count == 0 {
            break;
        }
        let take = count.min(LOG_LIMIT.saturating_sub(output.len()));
        output.extend_from_slice(&buffer[..take]);
    }
    output
}
async fn execute(mut command: Command, timeout: Duration) -> Result<(bool, String), String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    {
        command.process_group(0);
        // Also bounds intermediate files and memory, rather than only returned bytes.
        unsafe {
            command.pre_exec(|| {
                for (resource, limit) in [
                    (libc::RLIMIT_FSIZE, 64 * 1024 * 1024),
                    (libc::RLIMIT_AS, 2 * 1024 * 1024 * 1024),
                ] {
                    let limit = libc::rlimit {
                        rlim_cur: limit,
                        rlim_max: limit,
                    };
                    if libc::setrlimit(resource, &limit) != 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                }
                Ok(())
            });
        }
    }
    let mut process = Process(command.spawn().map_err(err)?);
    let stdout = tokio::spawn(drain(process.0.stdout.take().ok_or("Missing stdout")?));
    let stderr = tokio::spawn(drain(process.0.stderr.take().ok_or("Missing stderr")?));
    let (success, timed_out) = match tokio::time::timeout(timeout, process.0.wait()).await {
        Ok(result) => (result.map_err(err)?.success(), false),
        Err(_) => {
            #[cfg(unix)]
            if let Some(pid) = process.0.id() {
                unsafe {
                    libc::kill(-(pid as i32), libc::SIGKILL);
                }
            }
            let _ = process.0.kill().await;
            (false, true)
        }
    };
    let mut log = stdout.await.map_err(err)?;
    log.extend(stderr.await.map_err(err)?);
    log.truncate(LOG_LIMIT);
    let mut log = String::from_utf8_lossy(&log).into_owned();
    if timed_out {
        log.push_str("\nXeLaTeX task exceeded its time limit.\n");
    }
    Ok((success, log))
}

#[cfg(target_os = "linux")]
fn compiler_command(
    runtime: &Path,
    bin: &Path,
    packages: &Path,
    job: &Path,
    program: &str,
) -> Result<Command, String> {
    let relative_bin = bin.strip_prefix(runtime).map_err(err)?;
    let sandbox_bin = Path::new("/runtime").join(relative_bin);
    let mut command = Command::new("/usr/bin/bwrap");
    command.args([
        "--unshare-all",
        "--die-with-parent",
        "--new-session",
        "--cap-drop",
        "ALL",
        "--clearenv",
    ]);
    for system in ["/usr", "/lib", "/lib64"] {
        if Path::new(system).exists() {
            command.args(["--ro-bind", system, system]);
        }
    }
    command.args([
        "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--dir", "/etc",
    ]);
    for system in ["/etc/fonts", "/etc/ld.so.cache"] {
        if Path::new(system).exists() {
            command.args(["--ro-bind", system, system]);
        }
    }
    command
        .arg("--ro-bind")
        .arg(runtime)
        .arg("/runtime")
        .arg("--ro-bind")
        .arg(packages)
        .arg("/packages")
        .arg("--ro-bind")
        .arg(
            packages
                .parent()
                .and_then(Path::parent)
                .ok_or("Invalid user tree")?
                .join("templates"),
        )
        .arg("/templates")
        .arg("--bind")
        .arg(job)
        .arg("/job")
        .args(["--chdir", "/job"]);
    for (key, value) in [
        ("PATH", format!("{}:/usr/bin:/bin", sandbox_bin.display())),
        ("TEXMFHOME", "/packages".into()),
        ("TEXMFROOT", "/runtime".into()),
        ("TEXMFDIST", "/runtime/texmf-dist".into()),
        ("TEXMFSYSVAR", "/runtime/texmf-var".into()),
        ("TEXMFSYSCONFIG", "/runtime/texmf-config".into()),
        ("TEXMFLOCAL", "/packages".into()),
        ("TEXMFVAR", "/job/cache".into()),
        ("TEXMFCONFIG", "/job/config".into()),
        ("TEXMFCNF", "/runtime:/runtime/texmf-dist/web2c".into()),
        ("TEXINPUTS", ".:/templates//:".into()),
        ("openin_any", "p".into()),
        ("openout_any", "p".into()),
        ("shell_escape", "f".into()),
        ("MKTEXFMT", "0".into()),
        ("MKTEXPK", "0".into()),
        ("MKTEXTEX", "0".into()),
        ("XDG_CACHE_HOME", "/tmp/cache".into()),
        ("LANG", "C.UTF-8".into()),
    ] {
        command.args(["--setenv", key, &value]);
    }
    command.arg("--").arg(sandbox_bin.join(program));
    Ok(command)
}
#[cfg(not(target_os = "linux"))]
fn compiler_command(_: &Path, _: &Path, _: &Path, _: &Path, _: &str) -> Result<Command, String> {
    Err("Isolated XeLaTeX is not implemented on this platform".into())
}

fn validate_input(input: &Input) -> Result<Vec<(String, Vec<u8>)>, String> {
    if input.source.is_empty()
        || input.source.len() > 2 * 1024 * 1024
        || input.source.contains('\0')
        || !(1..=3).contains(&input.passes.unwrap_or(1))
        || !(1000..=300_000).contains(&input.timeout_ms.unwrap_or(120_000))
        || input.assets.len() > 256
        || input.return_files.len() > 64
    {
        return Err("Invalid or oversized typesetting job".into());
    }
    let mut names = HashSet::new();
    let mut total = input.source.len();
    let mut assets = Vec::new();
    for asset in &input.assets {
        if !flat_name(&asset.name)
            || asset.name.starts_with("document.")
            || !names.insert(asset.name.clone())
            || asset.data_base64.len() > INPUT_LIMIT * 4 / 3 + 4
        {
            return Err("Invalid or duplicate TeX asset filename".into());
        }
        let bytes = STANDARD.decode(&asset.data_base64).map_err(err)?;
        total = total.checked_add(bytes.len()).ok_or("TeX input overflow")?;
        if total > INPUT_LIMIT {
            return Err("TeX assets exceed 64 MiB".into());
        }
        assets.push((asset.name.clone(), bytes));
    }
    let mut returns = HashSet::new();
    for file in &input.return_files {
        if !flat_name(file)
            || file.starts_with("document.")
            || !returns.insert(file)
            || names.contains(file)
        {
            return Err("Invalid, duplicate or input-shadowing TeX output filename".into());
        }
    }
    Ok(assets)
}
fn output_file(job: &Path, name: &str, remaining: &mut u64) -> Result<Option<Vec<u8>>, String> {
    let path = job.join(name);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(err(error)),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > *remaining {
        return Err("Invalid or oversized typesetting output".into());
    }
    *remaining -= metadata.len();
    Ok(Some(fs::read(path).map_err(err)?))
}
async fn compile(locations: &Locations, input: Input) -> Result<CompileResult, String> {
    let assets = validate_input(&input)?;
    let (runtime, bin) = locations.engine().await?;
    let job = TemporaryDirectory::new(&locations.data.join("jobs"), "job-")?;
    fs::write(job.0.join("document.tex"), &input.source).map_err(err)?;
    for (name, bytes) in assets {
        fs::write(job.0.join(name), bytes).map_err(err)?;
    }
    let timeout = Duration::from_millis(input.timeout_ms.unwrap_or(120_000));
    let deadline = tokio::time::Instant::now() + timeout;
    let mut log = String::new();
    let mut success = true;
    for _ in 0..input.passes.unwrap_or(1) {
        let mut command =
            compiler_command(&runtime, &bin, &locations.user_tree(), &job.0, "xelatex")?;
        command.arg("-output-directory=.");
        command.args([
            "-no-pdf",
            "-no-shell-escape",
            "-interaction=nonstopmode",
            "-halt-on-error",
            "-file-line-error",
            "-jobname=document",
            "document.tex",
        ]);
        let (ok, output) = execute(
            command,
            deadline.saturating_duration_since(tokio::time::Instant::now()),
        )
        .await?;
        append_log(&mut log, &output);
        if !ok {
            success = false;
            break;
        }
    }
    if success {
        let mut command =
            compiler_command(&runtime, &bin, &locations.user_tree(), &job.0, "xdvipdfmx")?;
        command.args(["-q", "-o", "document.pdf", "document.xdv"]);
        let (ok, output) = execute(
            command,
            deadline.saturating_duration_since(tokio::time::Instant::now()),
        )
        .await?;
        success = ok;
        append_log(&mut log, &output);
    }
    let mut remaining = OUTPUT_LIMIT;
    let pdf = if success {
        output_file(&job.0, "document.pdf", &mut remaining)?
    } else {
        None
    };
    if success && !pdf.as_ref().is_some_and(|pdf| pdf.starts_with(b"%PDF-")) {
        success = false;
        append_log(&mut log, "\nThe compiler did not produce a PDF.\n");
    }
    let mut files = Vec::new();
    if success {
        for name in input.return_files {
            if let Some(bytes) = output_file(&job.0, &name, &mut remaining)? {
                files.push(OutputFile {
                    name,
                    data_base64: STANDARD.encode(bytes),
                });
            }
        }
    }
    Ok(CompileResult {
        success,
        pdf: if success {
            pdf.map(|bytes| STANDARD.encode(bytes))
        } else {
            None
        },
        log,
        files,
    })
}
fn append_log(log: &mut String, output: &str) {
    let room = LOG_LIMIT.saturating_sub(log.len());
    let mut take = room.min(output.len());
    while !output.is_char_boundary(take) {
        take -= 1;
    }
    log.push_str(&output[..take]);
}

#[tauri::command]
pub fn typesetting_status(app: AppHandle) -> Result<Status, String> {
    Locations::app(&app)?.status()
}
#[tauri::command]
pub fn typesetting_settings(app: AppHandle) -> Result<Settings, String> {
    let locations = Locations::app(&app)?;
    Ok(Settings {
        configuration: locations.config()?,
        runtime_directory: locations.data.join("runtimes").display().to_string(),
        user_tree: locations.user_tree().display().to_string(),
        templates_directory: locations.data.join("templates").display().to_string(),
        repository: REPOSITORY.into(),
    })
}
#[tauri::command]
pub async fn typesetting_configure(
    app: AppHandle,
    state: State<'_, TypesettingState>,
    configuration: Configuration,
) -> Result<(), String> {
    let _lock = state.0.lock().await;
    if configuration.mode != "bundled" && configuration.mode != "external" {
        return Err("Invalid TeX runtime mode".into());
    }
    if configuration.mode == "external" {
        external_tree(Path::new(&configuration.bin_directory))?;
    }
    let locations = Locations::app(&app)?;
    fs::create_dir_all(&locations.data).map_err(err)?;
    let temporary = locations.data.join("configuration.json.part");
    fs::write(&temporary, serde_json::to_vec(&configuration).map_err(err)?).map_err(err)?;
    fs::rename(temporary, locations.data.join("configuration.json")).map_err(err)
}
#[tauri::command]
pub async fn typesetting_initialize(
    app: AppHandle,
    state: State<'_, TypesettingState>,
    requests: State<'_, AiRequests>,
    request_id: Option<String>,
) -> Result<(), String> {
    ai_requests::run(&requests, request_id, async {
        let _lock = state.0.lock().await;
        Locations::app(&app)?.engine().await?;
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn typesetting_compile(
    app: AppHandle,
    state: State<'_, TypesettingState>,
    requests: State<'_, AiRequests>,
    input: Input,
    request_id: Option<String>,
) -> Result<CompileResult, String> {
    ai_requests::run(&requests, request_id, async {
        let _lock = state.0.lock().await;
        compile(&Locations::app(&app)?, input).await
    })
    .await
}
fn manager(bin: &Path, user_tree: &Path) -> Command {
    let mut command = Command::new(bin.join("tlmgr"));
    command
        .env_clear()
        .env("PATH", format!("{}:/usr/bin:/bin", bin.display()))
        .env("TEXMFHOME", user_tree)
        .env("LANG", "C.UTF-8")
        .args(["--usermode", "--usertree"])
        .arg(user_tree);
    command
}
async fn install_packages(locations: &Locations, packages: Vec<String>) -> Result<String, String> {
    if packages.is_empty()
        || packages.len() > 64
        || packages
            .iter()
            .any(|name| !flat_name(name) || name.contains('.'))
    {
        return Err("Enter 1–64 TeX Live package names".into());
    }
    if locations.config()?.mode != "bundled" {
        return Err("Manage external TeX Live packages with its own tlmgr".into());
    }
    let (_, bin) = locations.engine().await?;
    let user_tree = locations.user_tree();
    if !user_tree.join("tlpkg/texlive.tlpdb").exists() {
        let mut command = manager(&bin, &user_tree);
        command.arg("init-usertree");
        let (ok, log) = execute(command, Duration::from_secs(30)).await?;
        if !ok {
            return Err(log);
        }
    }
    let mut command = manager(&bin, &user_tree);
    command
        .args(["--repository", REPOSITORY, "install"])
        .args(packages);
    let (ok, log) = execute(command, Duration::from_secs(300)).await?;
    if !ok {
        return Err(log);
    }
    Ok(log)
}
#[tauri::command]
pub async fn typesetting_install_packages(
    app: AppHandle,
    state: State<'_, TypesettingState>,
    requests: State<'_, AiRequests>,
    packages: Vec<String>,
    request_id: Option<String>,
) -> Result<String, String> {
    ai_requests::run(&requests, request_id, async {
        let _lock = state.0.lock().await;
        install_packages(&Locations::app(&app)?, packages).await
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input(source: &str) -> Input {
        Input {
            source: source.into(),
            assets: vec![],
            passes: None,
            timeout_ms: None,
            return_files: vec![],
        }
    }
    #[test]
    fn input_paths_duplicates_shadowing_and_limits_are_rejected() {
        for name in [
            "../secret",
            "/etc/passwd",
            "a/b.pdf",
            ".hidden",
            "document.tex",
            "a\\b.pdf",
        ] {
            let mut value = input("hello");
            value.assets.push(Asset {
                name: name.into(),
                data_base64: STANDARD.encode("hello"),
            });
            assert!(validate_input(&value).is_err(), "{name}");
        }
        let mut value = input("hello");
        value.assets.push(Asset {
            name: "formula.pdf".into(),
            data_base64: STANDARD.encode("pdf"),
        });
        value.return_files.push("formula.pdf".into());
        assert!(validate_input(&value).is_err());
        value.return_files = vec!["slots.tsv".into(), "slots.tsv".into()];
        assert!(validate_input(&value).is_err());
        value.return_files.clear();
        value.passes = Some(4);
        assert!(validate_input(&value).is_err());
        assert!(!safe_relative(Path::new("../bad")));
        assert!(!safe_link(
            Path::new("bin/xelatex"),
            Path::new("../../outside")
        ));
        assert!(safe_link(
            Path::new("bin/linux/tlmgr"),
            Path::new("../../texmf-dist/scripts/tlmgr.pl")
        ));
    }
    #[cfg(unix)]
    #[test]
    fn output_symlinks_and_oversized_files_are_rejected() {
        let job = TemporaryDirectory::new(&std::env::temp_dir(), "cachalot-tex-test-").unwrap();
        fs::write(job.0.join("real.txt"), "large").unwrap();
        std::os::unix::fs::symlink("real.txt", job.0.join("link.txt")).unwrap();
        assert!(output_file(&job.0, "link.txt", &mut 100).is_err());
        assert!(output_file(&job.0, "real.txt", &mut 3).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn archive_link_indirection_cannot_escape_staging() {
        let directory =
            TemporaryDirectory::new(&std::env::temp_dir(), "cachalot-tex-links-").unwrap();
        fs::create_dir(directory.0.join("inner")).unwrap();
        let links = vec![
            (PathBuf::from("a"), PathBuf::from("inner/..")),
            (PathBuf::from("a/escape"), PathBuf::from("..")),
        ];
        assert!(install_links(&directory.0, &links).is_err());
        assert!(!directory.0.join("escape").exists());
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn cancellation_kills_owned_child_and_descendant() {
        let directory =
            TemporaryDirectory::new(&std::env::temp_dir(), "cachalot-tex-process-").unwrap();
        let mut command = Command::new("/bin/sh");
        command.current_dir(&directory.0).args([
            "-c",
            "echo $$ > parent.pid; sleep 120 & echo $! > child.pid; wait",
        ]);
        let mut work = Box::pin(execute(command, Duration::from_secs(120)));
        tokio::select! { result = &mut work => panic!("unexpected completion: {result:?}"), _ = tokio::time::sleep(Duration::from_millis(150)) => () }
        let pids: Vec<i32> = ["parent.pid", "child.pid"]
            .iter()
            .map(|file| {
                fs::read_to_string(directory.0.join(file))
                    .unwrap()
                    .trim()
                    .parse()
                    .unwrap()
            })
            .collect();
        drop(work);
        tokio::time::sleep(Duration::from_millis(150)).await;
        for pid in pids {
            let stat = fs::read_to_string(format!("/proc/{pid}/stat"));
            assert!(
                stat.is_err() || stat.unwrap().split_whitespace().nth(2) == Some("Z"),
                "process {pid} is still running"
            );
        }
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn deadline_stops_process_and_log_is_bounded() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "sleep 30"]);
        let (ok, log) = execute(command, Duration::from_millis(40)).await.unwrap();
        assert!(!ok);
        assert!(log.contains("time limit"));
        let mut log = String::new();
        append_log(&mut log, &"中文".repeat(LOG_LIMIT));
        assert!(log.len() <= LOG_LIMIT);
    }
    fn native_formula() -> Vec<u8> {
        // A source PDF with independently positioned numerator, denominator and a vector bar.
        let stream =
            "BT /F1 10 Tf 4 17 Td (x+1) Tj ET 2 13 29 0.5 re f BT /F1 10 Tf 8 3 Td (y) Tj ET";
        let objects = ["<< /Type /Catalog /Pages 2 0 R >>".into(), "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".into(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 34 30] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>".into(),
            format!("<< /Length {} >>\nstream\n{stream}\nendstream", stream.len()), "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic >>".into()];
        let mut pdf = b"%PDF-1.4\n".to_vec();
        let mut offsets = vec![0];
        for (i, object) in objects.iter().enumerate() {
            offsets.push(pdf.len());
            pdf.extend(format!("{} 0 obj\n{object}\nendobj\n", i + 1).as_bytes());
        }
        let xref = pdf.len();
        pdf.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes());
        for offset in offsets.iter().skip(1) {
            pdf.extend(format!("{offset:010} 00000 n \n").as_bytes());
        }
        pdf.extend(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
                objects.len() + 1
            )
            .as_bytes(),
        );
        pdf
    }
    /// Explicit opt-in: downloads nothing, uses the actual prepared bundle and Linux sandbox.
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    #[tokio::test]
    #[ignore = "requires npm run texlive:prepare and host user namespaces"]
    async fn bundled_xelatex_compiles_chinese_native_formula_and_measurements() {
        let directory =
            TemporaryDirectory::new(&std::env::temp_dir(), "cachalot-tex-real-").unwrap();
        let locations = Locations {
            data: directory.0.join("data"),
            bundle: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/texlive"),
        };
        let (root, _) = locations.engine().await.unwrap();
        assert!(root.join(".cachalot-runtime").is_file());
        let package = locations.user_tree().join("tex/latex/user/user-marker.sty");
        fs::create_dir_all(package.parent().unwrap()).unwrap();
        fs::write(
            &package,
            "\\ProvidesPackage{user-marker}\n\\newcommand{\\usermarker}{UserPackageOK}",
        )
        .unwrap();
        fs::write(
            locations.data.join("templates/user-template.tex"),
            "TemplateOK",
        )
        .unwrap();
        let mut job = input(include_str!("../../tests/fixtures/typesetting.tex"));
        job.assets.push(Asset {
            name: "formula.pdf".into(),
            data_base64: STANDARD.encode(native_formula()),
        });
        job.return_files.push("slots.csv".into());
        job.passes = Some(2);
        let result = compile(&locations, job).await.unwrap();
        assert!(result.success, "{}", result.log);
        assert!(result.files.iter().any(|file| file.name == "slots.csv"
            && STANDARD
                .decode(&file.data_base64)
                .unwrap()
                .starts_with(b"formula-1,")));
        let destination =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.test-cache/texlive-verification");
        fs::create_dir_all(&destination).unwrap();
        let pdf = destination.join("chinese-native-formula.pdf");
        fs::write(&pdf, STANDARD.decode(result.pdf.unwrap()).unwrap()).unwrap();
        let text = std::process::Command::new("pdftotext")
            .args([pdf.to_str().unwrap(), "-"])
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&text.stdout);
        assert!(
            text.contains("中文排版")
                && text.contains("UserPackageOK")
                && text.contains("TemplateOK")
                && text.contains("x+1"),
            "{text}"
        );
        assert_eq!(
            fs::read_dir(locations.data.join("jobs")).unwrap().count(),
            0
        );
        let failed = compile(&locations, input("\\documentclass{article}\\usepackage{cachalot-nonexistent-package}\\begin{document}test\\end{document}")).await.unwrap();
        assert!(!failed.success && failed.pdf.is_none());
        assert!(failed.log.contains("cachalot-nonexistent-package"));
        assert!(
            package.is_file(),
            "reinitialization must preserve user packages"
        );
        let secret = directory.0.join("host-secret.tex");
        fs::write(&secret, "HOSTFILELEAK").unwrap();
        let marker = directory.0.join("shell-marker");
        let isolated = compile(&locations, input(&format!("\\documentclass{{article}}\\begin{{document}}\\IfFileExists{{{}}}{{\\errmessage{{HOSTFILELEAK}}}}{{IsolationOK}}\\immediate\\write18{{touch {}}}\\end{{document}}", secret.display(), marker.display()))).await.unwrap();
        assert!(isolated.success, "{}", isolated.log);
        assert!(!marker.exists());
        // A runaway TeX job is stopped; a subsequent job still uses the same reader/runtime.
        let mut runaway =
            input("\\documentclass{article}\\begin{document}\\loop\\iftrue\\repeat\\end{document}");
        runaway.timeout_ms = Some(1000);
        let timeout = compile(&locations, runaway).await.unwrap();
        assert!(!timeout.success && timeout.log.contains("time limit"));
        let restored = compile(
            &locations,
            input("\\documentclass{article}\\begin{document}AfterTimeoutOK\\end{document}"),
        )
        .await
        .unwrap();
        assert!(restored.success, "{}", restored.log);
        // The same self-contained tree can be explicitly selected as an external runtime.
        fs::write(
            locations.data.join("configuration.json"),
            serde_json::to_vec(&Configuration {
                mode: "external".into(),
                bin_directory: root.join("bin/x86_64-linux").display().to_string(),
            })
            .unwrap(),
        )
        .unwrap();
        assert_eq!(locations.status().unwrap().mode, "external");
        let external = compile(
            &locations,
            input("\\documentclass{article}\\begin{document}ExternalOK\\end{document}"),
        )
        .await
        .unwrap();
        assert!(external.success, "{}", external.log);
        assert!(install_packages(&locations, vec!["booktabs".into()])
            .await
            .unwrap_err()
            .contains("external TeX Live"));
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    #[tokio::test]
    #[ignore = "requires prepared runtime and an explicit network-enabled run"]
    async fn user_package_install_is_persistent_and_used_by_compiler() {
        let directory =
            TemporaryDirectory::new(&std::env::temp_dir(), "cachalot-tex-packages-").unwrap();
        let locations = Locations {
            data: directory.0.join("data"),
            bundle: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/texlive"),
        };
        install_packages(&locations, vec!["booktabs".into()])
            .await
            .unwrap();
        assert!(locations
            .user_tree()
            .join("tex/latex/booktabs/booktabs.sty")
            .is_file());
        let output = compile(&locations, input("\\documentclass{article}\\usepackage{booktabs}\\begin{document}\\begin{tabular}{ll}\\toprule A&B\\\\\\midrule C&D\\\\\\bottomrule\\end{tabular}\\end{document}")).await.unwrap();
        assert!(output.success, "{}", output.log);
        locations.engine().await.unwrap();
        assert!(locations
            .user_tree()
            .join("tex/latex/booktabs/booktabs.sty")
            .is_file());
    }
}
