import { execFileSync } from "node:child_process";

const ports = process.argv.slice(2);

for (const port of ports) {
  const pids = findListeningPids(port);

  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGTERM");
      console.log(`Freed port ${port} (pid ${pid})`);
    } catch (error) {
      if (error?.code !== "ESRCH") {
        console.warn(`Could not free port ${port} (pid ${pid})`);
      }
    }
  }
}

function findListeningPids(port) {
  try {
    const output = execFileSync("lsof", [`-tiTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
