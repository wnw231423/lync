import * as FileSystem from "expo-file-system/legacy";

type SpaceSessionPayload = {
  lastSpaceCode: string;
};

// SPACE_SESSION_DIR 存放空间工作台的轻量级本地会话信息。
const SPACE_SESSION_DIR = "travel-space-session";
// SPACE_SESSION_FILE 记录最近一次打开的空间口令，便于下次启动时恢复。
const SPACE_SESSION_FILE = "workspace.json";

// getSpaceSessionFilePath 返回会话文件在应用沙盒中的固定路径。
function getSpaceSessionFilePath() {
  const baseDir = FileSystem.documentDirectory?.endsWith("/")
    ? FileSystem.documentDirectory
    : `${FileSystem.documentDirectory ?? ""}/`;
  return `${baseDir}${SPACE_SESSION_DIR}/${SPACE_SESSION_FILE}`;
}

// ensureParentDir 在写入会话文件前保证父目录已经存在。
async function ensureParentDir(targetPath: string) {
  const parts = targetPath.split("/");
  parts.pop();
  const dirPath = parts.join("/");
  if (!dirPath) {
    return;
  }

  const info = await FileSystem.getInfoAsync(dirPath);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dirPath, { intermediates: true });
  }
}

// normalizeSpaceCode 统一整理口令格式，避免写入不同大小写版本。
function normalizeSpaceCode(code: string) {
  return code.trim().toUpperCase();
}

// readLastSpaceCode 读取上一次使用的空间口令。
export async function readLastSpaceCode() {
  if (!FileSystem.documentDirectory) {
    return "";
  }

  const sessionPath = getSpaceSessionFilePath();
  const info = await FileSystem.getInfoAsync(sessionPath);
  if (!info.exists) {
    return "";
  }

  try {
    const raw = await FileSystem.readAsStringAsync(sessionPath);
    const parsed = JSON.parse(raw) as Partial<SpaceSessionPayload>;
    return normalizeSpaceCode(parsed.lastSpaceCode ?? "");
  } catch {
    return "";
  }
}

// saveLastSpaceCode 保存最近一次打开的空间口令。
export async function saveLastSpaceCode(code: string) {
  if (!FileSystem.documentDirectory) {
    return;
  }

  const sessionPath = getSpaceSessionFilePath();
  await ensureParentDir(sessionPath);
  await FileSystem.writeAsStringAsync(
    sessionPath,
    JSON.stringify({ lastSpaceCode: normalizeSpaceCode(code) }),
  );
}

// clearLastSpaceCode 在没有可恢复空间时清空本地记忆。
export async function clearLastSpaceCode() {
  if (!FileSystem.documentDirectory) {
    return;
  }

  const sessionPath = getSpaceSessionFilePath();
  const info = await FileSystem.getInfoAsync(sessionPath);
  if (info.exists) {
    await FileSystem.deleteAsync(sessionPath, { idempotent: true });
  }
}
