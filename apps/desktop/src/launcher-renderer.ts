interface InstanceOverview {
  id: string;
  name: string;
  apiUrl: string;
  enabled: boolean;
  online: boolean;
  healthStatus: string | null;
  playoutState: string | null;
  currentItemName: string | null;
  fps: number;
  speed: number;
  bitrateKbps: number;
  cpuPercent: number;
  memoryMb: number;
  processes: number;
  error: string | null;
}

interface Overview {
  instances: InstanceOverview[];
  totals: {
    cpuCores: number;
    fluxioCpuPercent: number;
    fluxioMachinePercent: number;
    memoryMb: number;
    processes: number;
    systemCpuPercent: number;
  };
}

interface LauncherBridge {
  restore: (id: string) => Promise<void>;
  overview: () => Promise<Overview>;
  open: (id: string) => Promise<void>;
  add: (name: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  delete: (id: string) => Promise<void>;
}

const launcherBridge = (window as unknown as { fluxioLauncher: LauncherBridge }).fluxioLauncher;
const cards = requiredElement("instances");
const updatedAt = requiredElement("updated-at");
const dialog = requiredElement("instance-dialog") as HTMLDialogElement;
const form = requiredElement("instance-form") as HTMLFormElement;
const nameInput = requiredElement("instance-name") as HTMLInputElement;
const dialogTitle = requiredElement("dialog-title");
let loading = false;
let cardLayout = "";
let editingId: string | null = null;

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element;
}

async function refresh(): Promise<void> {
  if (loading) return;
  loading = true;
  try {
    render(await launcherBridge.overview());
    updatedAt.textContent = `Updated ${new Date().toLocaleTimeString("en-US")}`;
  } catch (error) {
    updatedAt.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    loading = false;
  }
}

function render(overview: Overview): void {
  setText("system-cpu", `${overview.totals.systemCpuPercent.toFixed(1)}%`);
  setText(
    "fluxio-cpu",
    `${overview.totals.fluxioCpuPercent.toFixed(1)}% cores · ${overview.totals.fluxioMachinePercent.toFixed(1)}% system`,
  );
  setText("fluxio-memory", formatMemory(overview.totals.memoryMb));
  setText("fluxio-processes", String(overview.totals.processes));
  const layout = JSON.stringify(overview.instances.map(({ id, name, online, enabled }) => ({ id, name, online, enabled })));
  if (layout !== cardLayout) {
    cards.replaceChildren(...(overview.instances.length ? overview.instances.map(instanceCard) : [emptyState()]));
    cardLayout = layout;
  } else {
    overview.instances.forEach((instance, index) => {
      const card = cards.children[index] as HTMLElement;
      const fresh = instanceCard(instance);
      card.className = fresh.className;
      const values = fresh.querySelectorAll(".state-badge, .current-item, dd, button");
      card.querySelectorAll(".state-badge, .current-item, dd, button").forEach((element, position) => {
        const next = values[position]!;
        if (element.textContent !== next.textContent) element.textContent = next.textContent;
        if (element instanceof HTMLButtonElement && next instanceof HTMLButtonElement) element.disabled = next.disabled;
      });
    });
  }
}

function emptyState(): HTMLElement {
  const article = document.createElement("article");
  article.className = "instance-card empty-state";
  const title = document.createElement("h2");
  title.textContent = "No programs yet";
  const hint = document.createElement("p");
  hint.className = "current-item";
  hint.textContent =
    "Select Add program to create the first playout chain: database, service, and API port.";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Add program";
  button.addEventListener("click", () => openDialog(null));
  article.append(title, hint, button);
  return article;
}

function instanceCard(instance: InstanceOverview): HTMLElement {
  const article = document.createElement("article");
  article.className = `instance-card ${!instance.enabled ? "disabled" : instance.online ? stateClass(instance.playoutState) : "offline"}`;

  const heading = document.createElement("div");
  heading.className = "instance-heading";
  const title = document.createElement("div");
  const name = document.createElement("h2");
  name.textContent = instance.name;
  const address = document.createElement("small");
  address.textContent = instance.apiUrl;
  title.append(name, address);
  const badge = document.createElement("span");
  badge.className = "state-badge";
  badge.textContent = instance.enabled ? stateLabel(instance) : "DISABLED";
  heading.append(title, badge);

  const current = document.createElement("p");
  current.className = "current-item";
  current.textContent = instance.error ?? instance.currentItemName ?? "No active clip";

  const metrics = document.createElement("dl");
  const metricRows: Array<[string, string]> = [
    ["Playout CPU", `${instance.cpuPercent.toFixed(1)}%`],
    ["Memory", formatMemory(instance.memoryMb)],
    ["Processes", String(instance.processes)],
    ["FPS", instance.fps > 0 ? instance.fps.toFixed(1) : "—"],
    ["Speed", instance.speed > 0 ? `${instance.speed.toFixed(2)}×` : "—"],
    ["Bitrate", instance.bitrateKbps > 0 ? `${(instance.bitrateKbps / 1_000).toFixed(2)} Mbps` : "—"],
  ];
  for (const [label, value] of metricRows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    metrics.append(dt, dd);
  }

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = instance.online ? "Open program" : "Service unavailable";
  button.disabled = !instance.online || !instance.enabled;
  button.addEventListener("click", () => void launcherBridge.open(instance.id));
  const rename = document.createElement("button");
  rename.type = "button";
  rename.className = "secondary";
  rename.textContent = "Rename";
  rename.addEventListener("click", () => openDialog(instance.id, instance.name));
  const actions = document.createElement("div");
  actions.className = "instance-actions";
  const restore = document.createElement("button");
  restore.type = "button";
  restore.className = "secondary";
  restore.textContent = "Восстановить сессию";
  restore.disabled = !instance.online || !instance.enabled || stateClass(instance.playoutState) === "running";
  restore.addEventListener("click", async () => {
    try { await launcherBridge.restore(instance.id); }
    catch (error) { updatedAt.textContent = error instanceof Error ? error.message : String(error); }
  });
  actions.append(button, rename, restore);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "secondary";
  remove.textContent = "Delete";
  remove.addEventListener("click", async () => {
    if (!window.confirm(`Delete “${instance.name}”, its service, database, and settings? This cannot be undone.`)) return;
    updatedAt.textContent = `Deleting ${instance.name}…`;
    try {
      await launcherBridge.delete(instance.id);
      await refresh();
    } catch (error) {
      updatedAt.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  actions.append(remove);
  article.append(heading, current, metrics, actions);
  return article;
}

function openDialog(id: string | null, name = ""): void {
  editingId = id;
  dialogTitle.textContent = id ? "Rename program" : "New program";
  nameInput.value = name;
  dialog.showModal();
  nameInput.focus();
  nameInput.select();
}

document.getElementById("add-instance")?.addEventListener("click", () => openDialog(null));
document.getElementById("cancel-instance")?.addEventListener("click", () => dialog.close());
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;
  const submit = requiredElement("save-instance") as HTMLButtonElement;
  submit.disabled = true;
  updatedAt.textContent = editingId ? "Renaming…" : "Creating program…";
  try {
    if (editingId) await launcherBridge.rename(editingId, name);
    else await launcherBridge.add(name);
    dialog.close();
    await refresh();
  } catch (error) {
    updatedAt.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    submit.disabled = false;
  }
});

function stateClass(state: string | null): string {
  return ["starting", "running", "stopping"].includes(state ?? "") ? "running" : "idle";
}

function stateLabel(instance: InstanceOverview): string {
  if (!instance.online) return "OFFLINE";
  if (instance.healthStatus === "degraded") return "DEGRADED";
  return stateClass(instance.playoutState) === "running" ? "ON AIR" : "READY";
}

function setText(id: string, value: string): void {
  requiredElement(id).textContent = value;
}

function formatMemory(value: number): string {
  return value >= 1_024 ? `${(value / 1_024).toFixed(1)} GB` : `${value.toFixed(0)} MB`;
}

document.getElementById("refresh")?.addEventListener("click", () => void refresh());
void refresh();
window.setInterval(() => void refresh(), 2_000);
