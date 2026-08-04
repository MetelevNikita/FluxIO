import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLaunchAgentPlist,
  buildDatabaseUrl,
  buildNpmInvocation,
  buildSystemdUnit,
  buildWindowsTaskCommand,
  commandVersionArguments,
  mergeWindowsPathValues,
  npmCiArguments,
  parseEnv,
  serializeEnv,
  validatePort,
  windowsToolCandidates,
} from "./setup.mjs";

test("setup uses the version flags expected by FFmpeg tools", () => {
  assert.deepEqual(commandVersionArguments("ffmpeg"), ["-version"]);
  assert.deepEqual(commandVersionArguments("/opt/homebrew/bin/ffprobe"), ["-version"]);
  assert.deepEqual(commandVersionArguments("C:\\Tools\\ffmpeg.exe"), ["-version"]);
  assert.deepEqual(commandVersionArguments('"C:\\Program Files\\FFmpeg\\bin\\ffprobe.exe"'), ["-version"]);
  assert.deepEqual(commandVersionArguments("/opt/homebrew/bin/tsp"), ["--version"]);
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
  const postgres = windowsToolCandidates("psql", environment);

  assert.ok(ffmpeg.includes("C:\\Users\\operator\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe"));
  assert.ok(ffmpeg.includes("C:\\ffmpeg\\bin\\ffmpeg.exe"));
  assert.ok(tsduck.includes("C:\\Program Files\\TSDuck\\bin\\tsp.exe"));
  assert.ok(postgres.includes("C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe"));
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
});
