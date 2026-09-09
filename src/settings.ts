import {
  App,
  Notice,
  PluginSettingTab,
  Setting,
  type ButtonComponent,
  type Plugin,
} from "obsidian";
import { hostname, networkInterfaces } from "node:os";
import type { ServerManager } from "./server-manager";

const HOST_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;

export function getMachineHosts(): string[] {
  const localHostname = hostname();
  const addresses = Object.values(networkInterfaces()).flatMap((entries) =>
    (entries ?? []).filter((entry) => entry.family === "IPv4" && !entry.internal).map((entry) => entry.address),
  );
  return [...new Set([localHostname, localHostname.split(".")[0]!, ...addresses])];
}

export interface Settings {
  host: string;
  allowedHosts: string[];
  port: number;
  bearerToken: string;
  vaultName: string;
  autoStart: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  host: "127.0.0.1",
  allowedHosts: [],
  port: 3333,
  bearerToken: "",
  vaultName: "",
  autoStart: false,
};

interface HostPlugin extends Plugin {
  settings: Settings;
  saveSettings: () => Promise<void>;
}

export class McpSettingsTab extends PluginSettingTab {
  private unsubscribe: (() => void) | null = null;

  constructor(
    app: App,
    private plugin: HostPlugin,
    private manager: ServerManager,
  ) {
    super(app, plugin);
  }

  hide(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  display(): void {
    const { containerEl, plugin, manager } = this;
    this.unsubscribe?.();
    containerEl.empty();

    const status = containerEl.createDiv({ cls: "mcp-status" });
    const renderStatus = (): void => {
      const s = manager.getState();
      status.empty();
      const label = status.createSpan();
      label.setText(`Status: ${s.status}`);
      if (s.status === "running" && s.port) {
        const url = `http://${plugin.settings.host}:${s.port}/mcp`;
        status.createEl("code", { text: url, cls: "mcp-status-url" });
      }
      if (s.lastError) {
        status.createEl("div", { text: s.lastError, cls: "mod-warning mcp-status-error" });
      }
      if (s.status === "running") {
        status.createEl("div", {
          text: "Note: host, allowed hosts, port, and token changes require stopping and starting the server.",
          cls: "mcp-status-hint setting-item-description",
        });
      }
    };
    this.unsubscribe = manager.subscribe(renderStatus);

    new Setting(containerEl)
      .setName("Server control")
      .setDesc("Start or stop the server.")
      .addButton((btn: ButtonComponent) =>
        btn.setButtonText("Start").onClick(() => manager.start()),
      )
      .addButton((btn: ButtonComponent) =>
        btn.setButtonText("Stop").onClick(() => manager.stop()),
      );

    new Setting(containerEl)
      .setName("Auto-start on launch")
      .addToggle((t) =>
        t.setValue(plugin.settings.autoStart).onChange(async (v) => {
          plugin.settings.autoStart = v;
          await plugin.saveSettings();
        }),
      );

    const hostWarning = containerEl.createDiv({
      cls: "mod-warning mcp-host-warning setting-item-description",
    });
    hostWarning.setText(
      "Warning: binding to a non-loopback address exposes your vault to every device on your network. Set a bearer token and make sure your firewall is configured before using this.",
    );
    const updateHostWarning = (host: string): void => {
      const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
      hostWarning.toggle(!loopback);
    };
    updateHostWarning(plugin.settings.host);

    new Setting(containerEl)
      .setName("Host")
      .setDesc("Bind address. Keep 127.0.0.1 unless you know what you're doing.")
      .addText((t) => {
        t.setPlaceholder("127.0.0.1").setValue(plugin.settings.host);
        t.onChange(async (v) => {
          const trimmed = v.trim().toLowerCase();
          const candidate = trimmed || "127.0.0.1";
          if (!HOST_RE.test(candidate)) {
            t.inputEl.addClass("mcp-input-invalid");
            return;
          }
          t.inputEl.removeClass("mcp-input-invalid");
          plugin.settings.host = candidate;
          updateHostWarning(candidate);
          await plugin.saveSettings();
        });
      });
    containerEl.appendChild(hostWarning);

    new Setting(containerEl)
      .setName("Automatically allowed hosts")
      .setDesc("localhost, 127.0.0.1, [::1], and the bind address, each with the server's listening port.");

    new Setting(containerEl)
      .setName("Additional allowed hosts")
      .setDesc(
        "One destination hostname or IP per line—not connecting machines. Bare entries allow the host alone or with the server's listening port. Use host:port for another exact port. Omit schemes, paths, and wildcards. Stop and start the server to apply changes.",
      )
      .addTextArea((t) => {
        t.inputEl.rows = 4;
        t.inputEl.cols = 28;
        t.inputEl.setAttribute("aria-label", "Additional allowed hosts");
        t
          .setValue(plugin.settings.allowedHosts.join("\n"))
          .onChange(async (v) => {
            plugin.settings.allowedHosts = v.split(/\r?\n/).map((host) => host.trim()).filter(Boolean);
            await plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Port")
      .setDesc("HTTP port to listen on (1–65535).")
      .addText((t) => {
        t.setPlaceholder("3333").setValue(String(plugin.settings.port));
        t.onChange(async (v) => {
          const n = Number(v);
          if (Number.isInteger(n) && n > 0 && n < 65536) {
            t.inputEl.removeClass("mcp-input-invalid");
            plugin.settings.port = n;
            await plugin.saveSettings();
          } else {
            t.inputEl.addClass("mcp-input-invalid");
          }
        });
      });

    new Setting(containerEl)
      .setName("Bearer token")
      .setDesc(
        "Required. Clients must send Authorization: Bearer <token>.",
      )
      .addText((t) => {
        t.inputEl.type = "password";
        t
          .setPlaceholder("(empty)")
          .setValue(plugin.settings.bearerToken)
          .onChange(async (v) => {
            plugin.settings.bearerToken = v.trim();
            await plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Connection snippet")
      .setDesc("Paste this into a client's config.")
      .addButton((btn) =>
        btn.setButtonText("Copy JSON").onClick(async () => {
          const snippet = {
            mcpServers: {
              obsidian: {
                url: `http://${plugin.settings.host}:${plugin.settings.port}/mcp`,
                ...(plugin.settings.bearerToken
                  ? { headers: { Authorization: `Bearer ${plugin.settings.bearerToken}` } }
                  : {}),
              },
            },
          };
          try {
            await navigator.clipboard.writeText(JSON.stringify(snippet, null, 2));
            const msg = plugin.settings.bearerToken
              ? "Copied — snippet includes your bearer token. Treat it as a secret."
              : "Copied connection snippet to clipboard.";
            new Notice(msg, plugin.settings.bearerToken ? 8_000 : 4_000);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(`Copy failed: ${msg}`, 6_000);
          }
        }),
      );
  }
}
