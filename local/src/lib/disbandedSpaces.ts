import * as FileSystem from "expo-file-system/legacy";

const DISBANDED_SPACE_DIR = "space-flags";
const DISBANDED_SPACE_FILE = "disbanded-spaces.json";

function getDisbandedSpaceFilePath() {
  if (!FileSystem.documentDirectory) {
    return "";
  }

  const baseDir = FileSystem.documentDirectory.endsWith("/")
    ? FileSystem.documentDirectory
    : `${FileSystem.documentDirectory}/`;
  return `${baseDir}${DISBANDED_SPACE_DIR}/${DISBANDED_SPACE_FILE}`;
}

async function ensureDisbandedSpaceDir() {
  const filePath = getDisbandedSpaceFilePath();
  if (!filePath) {
    return;
  }

  const normalized = filePath.replace(/\\/g, "/");
  const lastSlashIndex = normalized.lastIndexOf("/");
  if (lastSlashIndex < 0) {
    return;
  }

  const parentDir = normalized.slice(0, lastSlashIndex);
  const info = await FileSystem.getInfoAsync(parentDir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(parentDir, { intermediates: true });
  }
}

async function readDisbandedSpaceIds() {
  const filePath = getDisbandedSpaceFilePath();
  if (!filePath) {
    return new Set<string>();
  }

  const info = await FileSystem.getInfoAsync(filePath);
  if (!info.exists) {
    return new Set<string>();
  }

  try {
    const raw = await FileSystem.readAsStringAsync(filePath);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set<string>();
    }
    return new Set(
      parsed.filter(
        (item): item is string => typeof item === "string" && !!item,
      ),
    );
  } catch {
    return new Set<string>();
  }
}

async function writeDisbandedSpaceIds(ids: Set<string>) {
  const filePath = getDisbandedSpaceFilePath();
  if (!filePath) {
    return;
  }

  await ensureDisbandedSpaceDir();
  await FileSystem.writeAsStringAsync(
    filePath,
    JSON.stringify(Array.from(ids).sort(), null, 2),
  );
}

export async function markSpaceAsDisbanded(spaceId: string) {
  const cleanSpaceId = spaceId.trim();
  if (!cleanSpaceId) {
    return;
  }

  const ids = await readDisbandedSpaceIds();
  ids.add(cleanSpaceId);
  await writeDisbandedSpaceIds(ids);
}

export async function isSpaceDisbanded(spaceId: string) {
  const cleanSpaceId = spaceId.trim();
  if (!cleanSpaceId) {
    return false;
  }

  const ids = await readDisbandedSpaceIds();
  return ids.has(cleanSpaceId);
}
