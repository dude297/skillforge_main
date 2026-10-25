// Live-e2e process lifecycle for the operator API: own the port, prove readiness from OUR process, keep its stderr,
// and stop by waiting for the exit. No retries: a failure here is reported with the server's own log.
import { spawn, type ChildProcess } from "node:child_process";
import { openSync, readFileSync } from "node:fs";

const answers = async (base: string) => {
  try { return (await fetch(`${base}ui/health`)).ok; } catch { return false; }
};

export async function startServer(py: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; base: string; log: string; readyMs: number }) {
  // a stale server from an aborted run would answer /ui/health with another DB and token
  if (await answers(opts.base)) throw new Error(`${opts.base} is already served by another process; stop it first`);
  const p = spawn(py, args, { cwd: opts.cwd, env: opts.env, stdio: ["ignore", "ignore", openSync(opts.log, "w")] });
  for (let i = 0; i < opts.readyMs / 100; i++) {
    if (p.exitCode !== null) throw new Error(`server exited early (code ${p.exitCode}):\n${readFileSync(opts.log, "utf-8")}`);
    if (await answers(opts.base)) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server not ready after ${opts.readyMs} ms:\n${readFileSync(opts.log, "utf-8")}`);
}

/** kill the whole tree and WAIT until it is gone: taskkill is asynchronous, and a dying server still holds the port */
export async function stopServer(p: ChildProcess | null) {
  if (!p?.pid || p.exitCode !== null) return;
  const gone = new Promise((r) => p.once("exit", r));
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" });
  else p.kill();
  await gone;
}
