import { Notice } from "obsidian";
import { isIP } from "node:net";
import type { HttpServerHandle } from "obsidian-mcp-pro";
import { buildMcpServer, startHttpServer } from "obsidian-mcp-pro";
import type { Settings } from "./settings";

export type ServerStatus = "stopped" | "starting" | "running" | "error";

export interface ServerState {
  status: ServerStatus;
  port?: number;
  url?: string;
  lastError?: string;
}

type Listener = (state: ServerState) => void;

/**
 * The library matches the HTTP `Host` header verbatim, so an entry saved as a
 * bare hostname never matches a client that includes the port — which every
 * client does unless the port is 80. Derive the port-qualified form here
 * instead of persisting it: the settings list stays editable, and it follows
 * the port when the user changes it. Bare IPv6 literals are bracketed to match
 * the form a client actually sends.
 */
export function expandHosts(entries: string[], port: number): string[] {
  const expanded = new Set<string>();
  for (const entry of entries) {
    const host = isIP(entry) === 6 ? `[${entry}]` : entry;
    expanded.add(host);
    if (!host.includes(":") || host.endsWith("]")) {
      expanded.add(`${host}:${port}`);
    }
  }
  return [...expanded];
}

/**
 * Runs the MCP HTTP server in-process (inside the app's renderer Node).
 * No child process, no node_modules requirement at install time — the
 * whole server is bundled into the plugin's `main.js` by esbuild.
 */
export class ServerManager {
  private handle: HttpServerHandle | null = null;
  private state: ServerState = { status: "stopped" };
  private listeners: Set<Listener> = new Set();
  private opChain: Promise<void> = Promise.resolve();

  constructor(
    private vaultPath: string,
    private getSettings: () => Settings,
  ) {}

  // Serialize start/stop so rapid user clicks can't race. The internal
  // `opChain` always resolves (errors are swallowed there so the next queued
  // op still runs), but the public promise returned to callers rejects on
  // failure — so `await manager.start()` in the settings tab can surface
  // errors. Errors are ALSO routed through `fail()` which updates state and
  // posts a Notice, so `void manager.start()` callers still see the error.
  private enqueue(op: () => Promise<void>): Promise<void> {
    const next = this.opChain.catch(() => undefined).then(op);
    this.opChain = next.catch(() => undefined);
    return next;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  getState(): ServerState {
    return this.state;
  }

  isRunning(): boolean {
    return this.state.status === "running" || this.state.status === "starting";
  }

  start(): Promise<void> {
    return this.enqueue(async () => {
      // Guard against every "already active" state, not just "running".
      // `isRunning()` covers both `starting` and `running`; `handle` presence
      // is a separate invariant in case state/handle ever drift apart.
      if (this.handle || this.isRunning()) return;
      const settings = this.getSettings();
      this.setState({ status: "starting", port: settings.port });

      if (settings.vaultName) {
        process.env.OBSIDIAN_VAULT_NAME = settings.vaultName;
      }
      process.env.OBSIDIAN_VAULT_PATH = this.vaultPath;

      try {
        const handle = await startHttpServer({
          host: settings.host,
          allowedHosts: expandHosts(settings.allowedHosts, settings.port),
          port: settings.port,
          bearerToken: settings.bearerToken,
          // Streamable HTTP keeps one transport attached to each McpServer.
          // Returning the same server instance for a second session causes the
          // SDK to reject the second connect. Build a fresh server for every
          // session instead; vault configuration remains process-scoped.
          buildMcpServer: () => buildMcpServer(this.vaultPath),
          installSignalHandlers: false,
        });
        this.handle = handle;
        this.setState({
          status: "running",
          port: handle.port,
          url: handle.url,
        });
      } catch (err) {
        this.handle = null;
        this.clearEnv();
        this.fail(err instanceof Error ? err.message : String(err));
      }
    });
  }

  stop(): Promise<void> {
    return this.enqueue(async () => {
      const handle = this.handle;
      this.handle = null;
      if (handle) {
        try {
          await handle.stop();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[obsidian-mcp-pro] stop error:", err);
          new Notice(`Stop failed — ${msg}`, 6_000);
        }
      }
      this.clearEnv();
      this.setState({ status: "stopped" });
    });
  }

  private clearEnv(): void {
    delete process.env.OBSIDIAN_VAULT_NAME;
    delete process.env.OBSIDIAN_VAULT_PATH;
  }

  private fail(msg: string): void {
    console.error("[obsidian-mcp-pro]", msg);
    new Notice(msg, 6_000);
    this.setState({ status: "error", lastError: msg });
  }

  private setState(next: ServerState): void {
    this.state = next;
    for (const l of this.listeners) l(next);
  }
}
