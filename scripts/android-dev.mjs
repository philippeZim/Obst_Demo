import { networkInterfaces } from "node:os";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function getLanIp() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        const ip = net.address;
        if (
          ip.startsWith("192.168.") ||
          ip.startsWith("10.") ||
          (ip.startsWith("172.") && parseInt(ip.split(".")[1]) >= 16 && parseInt(ip.split(".")[1]) <= 31)
        ) {
          return ip;
        }
      }
    }
  }
  return null;
}

const ip = getLanIp();
if (!ip) {
  console.error("Could not detect LAN IP. Are you connected to a network?");
  process.exit(1);
}

console.log(`Detected LAN IP: ${ip}`);
const home = process.env.HOME;
const androidSdk = process.env.ANDROID_HOME ?? `${home}/Android/Sdk`;
const env = {
  ...process.env,
  TAURI_DEV_HOST: ip,
  ANDROID_HOME: androidSdk,
  PATH: [
    `${home}/.cargo/bin`,
    `${androidSdk}/platform-tools`,
    process.env.PATH,
  ].join(":"),
};
const proc = spawn("npx", ["tauri", "android", "dev"], {
  cwd: root,
  stdio: "inherit",
  env,
});

proc.on("exit", (code) => process.exit(code ?? 1));
