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
    updatedAt.textContent = `Обновлено ${new Date().toLocaleTimeString("ru-RU")}`;
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
    `${overview.totals.fluxioCpuPercent.toFixed(1)}% ядер · ${overview.totals.fluxioMachinePercent.toFixed(1)}% машины`,
  );
  setText("fluxio-memory", formatMemory(overview.totals.memoryMb));
  setText("fluxio-processes", String(overview.totals.processes));
  cards.replaceChildren(
    ...(overview.instances.length > 0
      ? overview.instances.map(instanceCard)
      : [emptyState()]),
  );
}

function emptyState(): HTMLElement {
  const article = document.createElement("article");
  article.className = "instance-card empty-state";
  const title = document.createElement("h2");
  title.textContent = "Программ пока нет";
  const hint = document.createElement("p");
  hint.className = "current-item";
  hint.textContent =
    "Нажмите «Добавить программу», чтобы создать первый эфирный контур: базу, службу и порт API.";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Добавить программу";
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
  badge.textContent = instance.enabled ? stateLabel(instance) : "ОТКЛЮЧЕНА";
  heading.append(title, badge);

  const current = document.createElement("p");
  current.className = "current-item";
  current.textContent = instance.error ?? instance.currentItemName ?? "Нет активного ролика";

  const metrics = document.createElement("dl");
  const metricRows: Array<[string, string]> = [
    ["CPU цепочки", `${instance.cpuPercent.toFixed(1)}%`],
    ["Память", formatMemory(instance.memoryMb)],
    ["Процессы", String(instance.processes)],
    ["FPS", instance.fps > 0 ? instance.fps.toFixed(1) : "—"],
    ["Скорость", instance.speed > 0 ? `${instance.speed.toFixed(2)}×` : "—"],
    ["Поток", instance.bitrateKbps > 0 ? `${(instance.bitrateKbps / 1_000).toFixed(2)} Mbps` : "—"],
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
  button.textContent = instance.online ? "Открыть программу" : "Сервис недоступен";
  button.disabled = !instance.online || !instance.enabled;
  button.addEventListener("click", () => void launcherBridge.open(instance.id));
  const rename = document.createElement("button");
  rename.type = "button";
  rename.className = "secondary";
  rename.textContent = "Переименовать";
  rename.addEventListener("click", () => openDialog(instance.id, instance.name));
  const actions = document.createElement("div");
  actions.className = "instance-actions";
  actions.append(button, rename);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "secondary";
  remove.textContent = "Удалить";
  remove.addEventListener("click", async () => {
    if (!window.confirm(`Удалить программу «${instance.name}», её службу, базу и настройки? Это действие нельзя отменить.`)) return;
    updatedAt.textContent = `Удаление ${instance.name}…`;
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
  dialogTitle.textContent = id ? "Переименовать программу" : "Новая программа";
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
  updatedAt.textContent = editingId ? "Переименование…" : "Создание программы…";
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
  if (!instance.online) return "НЕТ СВЯЗИ";
  if (instance.healthStatus === "degraded") return "ОГРАНИЧЕННО";
  return stateClass(instance.playoutState) === "running" ? "В ЭФИРЕ" : "ГОТОВА";
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
