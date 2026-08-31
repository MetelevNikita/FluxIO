import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildLaunchAgentPlist,
  buildLinuxDesktopEntry,
  buildMacDesktopLauncher,
  buildMacDesktopLauncherPlist,
  buildDatabaseUrl,
  buildNpmInvocation,
  buildSystemdUnit,
  buildWindowsShortcutCommand,
  buildWindowsTaskCommand,
  commandVersionArguments,
  desktopPackagingScript,
  electronRuntimePath,
  mergeWindowsPathValues,
  npmCiArguments,
  parseEnv,
  platformServiceStopCommand,
  pruneRetiredSourceFiles,
  probeGstreamerDvbPlugin,
  selectEnvBackupsToRemove,
  serializeEnv,
  validatePort,
  windowsToolCandidates,
} from "./setup.mjs";

test("setup removes retired sources left by an archive copied over an old version", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fluxio-retired-sources-"));
  const retired = path.join(root, "apps/media-server/src/effects/lottie.ts");
  const current = path.join(root, "apps/media-server/src/effects/current.ts");
  try {
    await mkdir(path.dirname(retired), { recursive: true });
    await writeFile(retired, "legacy");
    await writeFile(current, "current");

    assert.deepEqual(await pruneRetiredSourceFiles(root), ["apps/media-server/src/effects/lottie.ts"]);
    await assert.rejects(readFile(retired));
    assert.equal(await readFile(current, "utf8"), "current");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup uses the version flags expected by FFmpeg tools", () => {
  assert.deepEqual(commandVersionArguments("ffmpeg"), ["-version"]);
  assert.deepEqual(commandVersionArguments("/opt/homebrew/bin/ffprobe"), ["-version"]);
  assert.deepEqual(commandVersionArguments("C:\\Tools\\ffmpeg.exe"), ["-version"]);
  assert.deepEqual(commandVersionArguments('"C:\\Program Files\\FFmpeg\\bin\\ffprobe.exe"'), ["-version"]);
  assert.deepEqual(commandVersionArguments("/opt/homebrew/bin/tsp"), ["--version"]);
  assert.deepEqual(commandVersionArguments("/opt/homebrew/bin/gst-launch-1.0"), ["--version"]);
  assert.deepEqual(commandVersionArguments("brew"), ["--version"]);
});

test("production setup always installs build-time dev dependencies", () => {
  assert.deepEqual(npmCiArguments(), ["ci", "--include=dev"]);
});

test("Windows setup runs npm-cli.js with node.exe instead of spawning npm.cmd", () => {
  const nodePath = "C:\\Program Files\\nodejs\\node.exe";
  const npmCliPath = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
  assert.deepEqual(
    buildNpmInvocation({
      platform: "win32",
      nodePath,
      fileExists: (candidate) => candidate === npmCliPath,
    }),
    {
      command: nodePath,
      prefixArgs: [npmCliPath],
      shell: false,
    },
  );
});

test("Windows setup falls back to npm.cmd through the command shell", () => {
  const nodePath = "C:\\Program Files\\nodejs\\node.exe";
  const npmCmdPath = "C:\\Program Files\\nodejs\\npm.cmd";
  assert.deepEqual(
    buildNpmInvocation({
      platform: "win32",
      nodePath,
      fileExists: (candidate) => candidate === npmCmdPath,
    }),
    {
      command: npmCmdPath,
      prefixArgs: [],
      shell: true,
    },
  );
});

test("macOS and Linux keep the native npm command", () => {
  assert.deepEqual(buildNpmInvocation({ platform: "darwin" }), {
    command: "npm",
    prefixArgs: [],
    shell: false,
  });
  assert.deepEqual(buildNpmInvocation({ platform: "linux" }), {
    command: "npm",
    prefixArgs: [],
    shell: false,
  });
});

test("offline setup resolves the platform-native installed Electron runtime", () => {
  assert.equal(
    electronRuntimePath("C:\\FluxIO", "win32"),
    "C:\\FluxIO\\node_modules\\electron\\dist\\electron.exe",
  );
  assert.equal(
    electronRuntimePath("/srv/FluxIO", "linux"),
    "/srv/FluxIO/node_modules/electron/dist/electron",
  );
  assert.equal(
    electronRuntimePath("/Applications/FluxIO", "darwin"),
    "/Applications/FluxIO/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
  );
});

test("offline production setup never invokes the NSIS packaging script", () => {
  assert.equal(
    desktopPackagingScript({
      buildInstaller: true,
      mode: "production",
      offlineMode: true,
    }),
    "package:desktop:offline-dir",
  );
  assert.equal(
    desktopPackagingScript({
      buildInstaller: false,
      mode: "production",
      offlineMode: true,
    }),
    "package:desktop:offline-dir",
  );
  assert.equal(
    desktopPackagingScript({
      buildInstaller: true,
      mode: "production",
      offlineMode: false,
    }),
    "package:desktop",
  );
  assert.equal(
    desktopPackagingScript({
      buildInstaller: false,
      mode: "test",
      offlineMode: true,
    }),
    null,
  );
});

test("setup builds an encoded URL for local PostgreSQL without SSL", () => {
  assert.equal(
    buildDatabaseUrl({
      database: "gruber-prod",
      password: "p@ss word",
      port: 5433,
      username: "gruber-user",
    }),
    "postgresql://gruber-user:p%40ss%20word@127.0.0.1:5433/gruber-prod",
  );
});

test("setup environment serialization round-trips quoted values", () => {
  const values = {
    DATABASE_URL: "postgresql://gruber:p@ss@127.0.0.1:5432/gruber",
    FFMPEG_PATH: "/Applications/FFmpeg Tools/ffmpeg",
    TSDUCK_PATH: "/Applications/TSDuck Tools/tsp",
    GRUBER_SECRET_KEY: "abc$def`ghi\\jkl\"mno",
  };
  assert.deepEqual(parseEnv(serializeEnv(values)), values);
});

test("setup keeps only the two newest .env backups", () => {
  const files = [
    ".env",
    ".env.example",
    ".env.backup-2026-08-17T03-29-19-087Z",
    ".env.backup-2026-08-24T10-56-29-861Z",
    ".env.backup-2026-08-20T07-42-10-145Z",
    ".env.backup-2026-08-24T09-46-43-370Z",
    "package.json",
  ];
  assert.deepEqual(selectEnvBackupsToRemove(files), [
    ".env.backup-2026-08-20T07-42-10-145Z",
    ".env.backup-2026-08-17T03-29-19-087Z",
  ]);
});

test("setup never touches files that only look like .env backups", () => {
  assert.deepEqual(
    selectEnvBackupsToRemove([".env", ".env.example", "notes.env.backup-2026-01-01T00-00-00-000Z"]),
    [],
  );
});

test("setup leaves the backups alone until there are more than it keeps", () => {
  const files = [
    ".env.backup-2026-08-24T09-46-43-370Z",
    ".env.backup-2026-08-24T10-56-29-861Z",
  ];
  assert.deepEqual(selectEnvBackupsToRemove(files), []);
});

test("setup validates TCP ports", () => {
  assert.equal(validatePort("4310"), 4310);
  assert.throws(() => validatePort("0"), /1 to 65535/);
  assert.throws(() => validatePort("12.5"), /1 to 65535/);
});

test("setup discovers Windows tools in PATH refresh and standard install locations", () => {
  const environment = {
    LOCALAPPDATA: "C:\\Users\\operator\\AppData\\Local",
    ProgramData: "C:\\ProgramData",
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
    SystemDrive: "C:",
    USERPROFILE: "C:\\Users\\operator",
  };
  const ffmpeg = windowsToolCandidates("ffmpeg", environment);
  const tsduck = windowsToolCandidates("tsp.exe", environment);
  const gstreamer = windowsToolCandidates("gst-launch-1.0", environment);
  const postgres = windowsToolCandidates("psql", environment);

  assert.ok(ffmpeg.includes("C:\\Users\\operator\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe"));
  assert.ok(ffmpeg.includes("C:\\ffmpeg\\bin\\ffmpeg.exe"));
  assert.ok(tsduck.includes("C:\\Program Files\\TSDuck\\bin\\tsp.exe"));
  assert.ok(gstreamer.includes(
    "C:\\Program Files\\gstreamer\\1.0\\msvc_x86_64\\bin\\gst-launch-1.0.exe",
  ));
  assert.ok(gstreamer.includes(
    "C:\\Users\\operator\\AppData\\Local\\Programs\\gstreamer\\1.0\\msvc_x86_64\\bin\\gst-launch-1.0.exe",
  ));
  assert.ok(gstreamer.includes(
    "C:\\gstreamer\\1.0\\msvc_x86_64\\bin\\gst-launch-1.0.exe",
  ));
  assert.ok(postgres.includes("C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe"));
});

test("setup validates the Windows GStreamer dvbsubenc runtime", () => {
  const calls = [];
  const probe = probeGstreamerDvbPlugin(
    "D:\\Media Tools\\gstreamer\\bin\\gst-launch-1.0.exe",
    {
      platform: "win32",
      spawnSyncImpl(command, args) {
        calls.push([command, args]);
        return { error: undefined, status: 0, stderr: "", stdout: "" };
      },
    },
  );
  assert.deepEqual(calls, [[
    "D:\\Media Tools\\gstreamer\\bin\\gst-inspect-1.0.exe",
    ["--exists", "dvbsubenc"],
  ]]);
  assert.equal(probe.available, true);
  assert.equal(
    probe.inspectPath,
    "D:\\Media Tools\\gstreamer\\bin\\gst-inspect-1.0.exe",
  );
});

test("setup retries the dvbsubenc probe and never reports a timeout as a missing plugin", () => {
  let attempt = 0;
  const probe = probeGstreamerDvbPlugin("/opt/homebrew/bin/gst-launch-1.0", {
    platform: "darwin",
    spawnSyncImpl() {
      attempt += 1;
      return { error: new Error("spawnSync gst-inspect-1.0 ETIMEDOUT"), status: null };
    },
  });
  assert.equal(attempt, 2);
  assert.equal(probe.available, false);
  assert.equal(probe.inconclusive, true);
});

test("setup treats a clean non-zero dvbsubenc exit as a genuinely missing plugin", () => {
  const probe = probeGstreamerDvbPlugin("/opt/homebrew/bin/gst-launch-1.0", {
    platform: "darwin",
    spawnSyncImpl: () => ({ error: undefined, status: 1, stderr: "", stdout: "" }),
  });
  assert.equal(probe.available, false);
  assert.equal(probe.inconclusive, false);
});

test("setup merges refreshed Windows PATH values without duplicates", () => {
  assert.equal(
    mergeWindowsPathValues(
      "C:\\Windows\\System32;C:\\Program Files\\NodeJS",
      "c:\\program files\\nodejs;C:\\Program Files\\TSDuck\\bin",
    ),
    "C:\\Windows\\System32;C:\\Program Files\\NodeJS;C:\\Program Files\\TSDuck\\bin",
  );
});

test("setup generates a relocatable systemd unit for the cloned repository", () => {
  const unit = buildSystemdUnit({
    environmentPath: "/srv/Gruber Project/.env",
    nodePath: "/usr/local/bin/node",
    rootPath: "/srv/Gruber Project",
    serviceUser: "gruber",
  });
  assert.match(unit, /User=gruber/);
  assert.match(unit, /WorkingDirectory="\/srv\/Gruber Project"/);
  assert.match(unit, /EnvironmentFile="\/srv\/Gruber Project\/\.env"/);
  assert.match(unit, /ExecStart="\/usr\/local\/bin\/node" "\/srv\/Gruber Project\/apps\/media-server\/dist\/index\.js"/);
});

test("setup generates macOS and Windows background launch definitions", () => {
  const plist = buildLaunchAgentPlist({
    label: "live.gruber.media",
    nodePath: "/opt/Node & Tools/node",
    rootPath: "/Users/operator/Gruber & Playout",
    stderrPath: "/tmp/error.log",
    stdoutPath: "/tmp/output.log",
  });
  assert.match(plist, /live\.gruber\.media/);
  assert.match(plist, /Node &amp; Tools/);
  assert.match(plist, /Gruber &amp; Playout/);
  assert.match(
    plist,
    /\/Users\/operator\/Gruber &amp; Playout\/apps\/media-server\/dist\/index\.js/,
  );
  assert.doesNotMatch(plist, /\\apps\\media-server/);

  const windows = buildWindowsTaskCommand({
    nodePath: "C:\\Program Files\\nodejs\\node.exe",
    rootPath: "C:\\Gruber Project",
    scriptPath: "C:\\Gruber Project\\apps\\media-server\\dist\\index.js",
    start: true,
    taskName: "Gruber Playout Media Service",
  });
  assert.match(windows, /New-ScheduledTaskAction/);
  assert.match(windows, /LogonType Interactive/);
  assert.match(windows, /Start-ScheduledTask/);
  assert.match(windows, /C:\\Gruber Project/);
  assert.ok(
    windows.indexOf("Stop-ScheduledTask") < windows.indexOf("Register-ScheduledTask"),
  );
});

test("setup creates branded desktop launchers on Windows, macOS and Linux", () => {
  const windows = buildWindowsShortcutCommand({
    iconPath: "C:\\FluxIO\\apps\\desktop\\build\\icon.ico",
    launcherPath: "C:\\FluxIO Project\\launch.mjs",
    nodePath: "C:\\Program Files\\nodejs\\node.exe",
    rootPath: "C:\\FluxIO Project",
  });
  assert.match(windows, /GetFolderPath\('Desktop'\)/);
  assert.match(windows, /FluxIO\.lnk/);
  assert.match(windows, /launch\.mjs/);
  assert.match(windows, /icon\.ico,0/);

  const macLauncher = buildMacDesktopLauncher({
    launcherPath: "/Users/operator/FluxIO Project/launch.mjs",
    nodePath: "/usr/local/bin/node",
  });
  assert.match(macLauncher, /^#!\/bin\/sh/);
  assert.match(macLauncher, /exec '\/usr\/local\/bin\/node'/);
  assert.match(macLauncher, /'\/Users\/operator\/FluxIO Project\/launch\.mjs'/);
  const plist = buildMacDesktopLauncherPlist("4.2.10");
  assert.match(plist, /live\.fluxio\.desktop-launcher/);
  assert.match(plist, /<string>4\.2\.10<\/string>/);

  const linux = buildLinuxDesktopEntry({
    iconPath: "/srv/FluxIO Project/icon.png",
    launcherPath: "/srv/FluxIO Project/launch.mjs",
    nodePath: "/usr/bin/node",
    rootPath: "/srv/FluxIO Project",
  });
  assert.match(linux, /Name=FluxIO/);
  assert.match(linux, /Exec="\/usr\/bin\/node" "\/srv\/FluxIO Project\/launch\.mjs"/);
  assert.match(linux, /Terminal=false/);
});

test("Ctrl+C stop commands cover each production service manager", () => {
  assert.deepEqual(
    platformServiceStopCommand({ kind: "systemd", label: "gruber-media.service" }),
    {
      command: "sudo",
      args: ["systemctl", "stop", "gruber-media.service"],
    },
  );
  assert.deepEqual(
    platformServiceStopCommand({
      kind: "launchd",
      domain: "gui/501",
      plistPath: "/Users/operator/Library/LaunchAgents/live.gruber.media.plist",
    }),
    {
      command: "launchctl",
      args: [
        "bootout",
        "gui/501",
        "/Users/operator/Library/LaunchAgents/live.gruber.media.plist",
      ],
    },
  );
  const windows = platformServiceStopCommand({
    kind: "windows-task",
    label: "Gruber Playout Media Service",
  });
  assert.equal(windows.command, "powershell.exe");
  assert.match(windows.args.at(-1), /Stop-ScheduledTask/);
});
