import type { LottieEditableProperty } from "@gruber/contracts";

type JsonObject = Record<string, unknown>;

export function updateLinkedScaleVector(
  current: number[],
  axis: number,
  value: number,
  linked: boolean,
): number[] {
  const next = [...current];
  if (linked && axis < 2) {
    next[0] = value;
    next[1] = value;
  } else {
    next[axis] = value;
  }
  return next;
}

export function applyLottiePropertyOverrides(
  source: Record<string, unknown>,
  properties: LottieEditableProperty[],
): Record<string, unknown> {
  const document = structuredClone(source);
  for (const property of properties) {
    if (!property.overridden) continue;
    const segments = property.path.split("/").slice(1).map((segment) =>
      segment.replaceAll("~1", "/").replaceAll("~0", "~"));
    const key = segments.pop();
    if (!key) continue;
    const parent = resolveParent(document, segments);
    if (!parent) continue;
    if (property.type === "boolean") {
      parent[key] = !Boolean(property.value);
    } else if (property.type === "text" || property.path.endsWith("/sc")) {
      parent[key] = String(property.value);
    } else if (property.type === "color") {
      setAnimatableValue(parent[key], hexToRgba(String(property.value)));
    } else if (property.type === "number") {
      setAnimatableValue(parent[key], Number(property.value));
    } else if (property.type === "vector" && Array.isArray(property.value)) {
      setAnimatableValue(parent[key], property.value);
    }
  }
  return document;
}

function resolveParent(document: JsonObject, segments: string[]): JsonObject | null {
  let current: unknown = document;
  for (const segment of segments) {
    if (Array.isArray(current)) current = current[Number(segment)];
    else if (isObject(current)) current = current[segment];
    else return null;
  }
  return isObject(current) || Array.isArray(current) ? current as JsonObject : null;
}

function setAnimatableValue(property: unknown, value: number | number[]): void {
  if (!isObject(property)) return;
  property.a = 0;
  property.k = value;
  delete property.x;
}

function hexToRgba(value: string): number[] {
  const normalized = /^#[0-9a-fA-F]{6}$/.test(value) ? value.slice(1) : "FFFFFF";
  return [0, 2, 4].map((index) =>
    Number.parseInt(normalized.slice(index, index + 2), 16) / 255).concat(1);
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
