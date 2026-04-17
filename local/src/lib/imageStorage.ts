// imageStorage 统一处理图片写入应用沙盒时的复制与下载细节。
import * as FileSystem from "expo-file-system/legacy";

// isRemoteImageUri 用来判断传入图片是否仍然是网络地址。
export function isRemoteImageUri(uri: string) {
  return /^https?:\/\//i.test(uri);
}

// ensureDir 会在写文件前先保证目标目录已经存在。
async function ensureDir(targetDir: string) {
  const dirInfo = await FileSystem.getInfoAsync(targetDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true });
  }
}

// getAppStoragePath 把相对路径拼成应用 documentDirectory 下的绝对路径。
function getAppStoragePath(relativePath: string) {
  if (!FileSystem.documentDirectory) {
    return "";
  }
  const baseDir = FileSystem.documentDirectory.endsWith("/")
    ? FileSystem.documentDirectory
    : `${FileSystem.documentDirectory}/`;
  return `${baseDir}${relativePath.replace(/^\/+/, "")}`;
}

// ensureParentDirForFile 会在写文件前补齐父目录。
async function ensureParentDirForFile(targetPath: string) {
  const normalized = targetPath.replace(/\\/g, "/");
  const lastSlashIndex = normalized.lastIndexOf("/");
  if (lastSlashIndex < 0) {
    return;
  }
  const parentDir = normalized.slice(0, lastSlashIndex);
  if (!parentDir) {
    return;
  }
  await ensureDir(parentDir);
}

// saveImageToAppRelativePath 会把图片写入应用沙盒中的固定相对路径。
export async function saveImageToAppRelativePath(
  uri: string,
  relativePath: string,
) {
  const targetPath = getAppStoragePath(relativePath);
  if (!targetPath) {
    return uri;
  }

  const normalizedSourceUri = uri.replace(/\\/g, "/");
  const normalizedTargetPath = targetPath.replace(/\\/g, "/");
  if (normalizedSourceUri === normalizedTargetPath) {
    return targetPath;
  }

  try {
    await ensureParentDirForFile(targetPath);
    const existed = await FileSystem.getInfoAsync(targetPath);
    if (existed.exists) {
      await FileSystem.deleteAsync(targetPath, { idempotent: true });
    }

    if (isRemoteImageUri(uri) && FileSystem.downloadAsync) {
      const downloaded = await FileSystem.downloadAsync(uri, targetPath);
      return downloaded.uri || targetPath;
    }

    await FileSystem.copyAsync({ from: uri, to: targetPath });
    return targetPath;
  } catch {
    return uri;
  }
}
