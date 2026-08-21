import {
  broadcastTaskFileContentSchema,
  graphicEffectAssetSchema,
  type BroadcastTaskFileContent,
  type GraphicEffectAsset,
} from "@gruber/contracts";

export const demoBroadcastEffectId = "fx2-demo-dynamic-title";

const demoPreset = graphicEffectAssetSchema.parse({
  id: "fx-demo-lower-third",
  name: "FluxIO Responsive Lower Third",
  filePath: "/tmp/fluxio-demo-lower-third.mov",
  kind: "video",
  durationSeconds: 4,
  width: 1920,
  height: 1080,
  lottie: {
    sourcePath: "/tmp/fluxio-demo-lower-third.json",
    version: "5.12.2",
    frameRate: 25,
    inPoint: 0,
    outPoint: 100,
    backgroundColor: "transparent",
    responsiveTextKeys: ["main_title"],
    properties: [
      {
        id: "demo-main-title",
        path: "/layers/1/t/d/k/0/s/t",
        group: "Main composition · main_title",
        label: "Text",
        type: "text",
        value: "Вечерние новости",
        textBox: {
          xPercent: 8,
          yPercent: 78,
          fontSizePercent: 4.2,
          color: "#FFFFFF",
          align: "left",
        },
      },
      {
        id: "demo-kicker",
        path: "/layers/2/t/d/k/0/s/t",
        group: "Main composition · kicker",
        label: "Text",
        type: "text",
        value: "ПРЯМОЙ ЭФИР",
        textBox: {
          xPercent: 8,
          yPercent: 72,
          fontSizePercent: 1.8,
          color: "#5FE1D2",
          align: "left",
        },
      },
    ],
  },
});

const demoDynamicTitle = graphicEffectAssetSchema.parse({
  id: demoBroadcastEffectId,
  name: "Dynamic title · JSON demo",
  filePath: "broadcast://dynamic-title",
  kind: "video",
  durationSeconds: 0,
  width: 0,
  height: 0,
  broadcast: {
    kind: "dynamic-title",
    presetEffectId: demoPreset.id,
    dataMapping: {
      filePath: "/demo/newsroom-rundown.json",
      matchSourceKey: "media.name",
      bindings: [
        { sourceKey: "programme.title", targetKey: "main_title" },
        { sourceKey: "programme.status", targetKey: "kicker" },
      ],
    },
    settings: {
      dynamicTitle: {
        source: "task-file",
        text: "Резервный заголовок",
        taskKey: "main_title",
        dynamicKey: "main_title",
        startSeconds: 1,
        durationSeconds: 8,
      },
    },
  },
});

export const demoGraphicEffects: GraphicEffectAsset[] = [demoDynamicTitle, demoPreset];

export const demoBroadcastTaskContent: BroadcastTaskFileContent =
  broadcastTaskFileContentSchema.parse({
    filePath: "/demo/newsroom-rundown.json",
    records: [
      {
        "media.name": "production.mp4",
        "programme.title": "Вечерние новости",
        "programme.status": "ПРЯМОЙ ЭФИР",
        presenter: "Анна Орлова",
      },
      {
        "media.name": "spring-sale.mp4",
        "programme.title": "Главная тема дня",
        "programme.status": "НОВОСТИ",
        presenter: "Максим Ветров",
      },
      {
        "media.name": "delivery.mp4",
        "programme.title": "Прогноз погоды",
        "programme.status": "ДАЛЕЕ",
        presenter: "Ирина Белова",
      },
    ],
    fields: [
      { key: "media.name", populatedCount: 3, samples: ["production.mp4", "spring-sale.mp4", "delivery.mp4"] },
      { key: "presenter", populatedCount: 3, samples: ["Анна Орлова", "Максим Ветров", "Ирина Белова"] },
      { key: "programme.status", populatedCount: 3, samples: ["ПРЯМОЙ ЭФИР", "НОВОСТИ", "ДАЛЕЕ"] },
      { key: "programme.title", populatedCount: 3, samples: ["Вечерние новости", "Главная тема дня", "Прогноз погоды"] },
    ],
    entries: [],
    warnings: [],
  });
