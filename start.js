const { spawn } = require("child_process");

process.env.HOST = process.env.HOST || "0.0.0.0";
process.env.PORT = process.env.PORT || "8787";

const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(cmd, ["run", "start", "-w", "@tsbot/server"], {
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
