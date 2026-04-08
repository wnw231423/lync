import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";

// DEFAULT_IMAGE_EXT 是无法从地址判断扩展名时使用的兜底后缀。
const DEFAULT_IMAGE_EXT = ".jpg";

// 判断传入地址是否仍然是远程图片链接。
export function isRemoteImageUri(uri: string) {
  return /^https?:\/\//i.test(uri);
}

// getFileExt 尝试从图片地址末尾提取扩展名，查询串和 hash 会被忽略。
function getFileExt(uri: string) {
  const cleanUri = uri.split("?")[0].split("#")[0];
  const match = cleanUri.match(/\.([a-zA-Z0-9]{2,8})$/);
  return match ? `.${match[1].toLowerCase()}` : DEFAULT_IMAGE_EXT;
}

// ensureDir 会在写文件前确保目标目录已经存在。
async function ensureDir(targetDir: string) {
  const dirInfo = await FileSystem.getInfoAsync(targetDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true });
  }
}

// 把图片复制到应用沙盒目录，便于后续离线复用。
export async function saveImageToLocalDir(uri: string, folderName: string) {
  if (!FileSystem.documentDirectory) {
    return uri;
  }

  const baseDir = FileSystem.documentDirectory.endsWith("/")
    ? FileSystem.documentDirectory
    : `${FileSystem.documentDirectory}/`;
  const targetDir = `${baseDir}${folderName}`;
  const targetPath = `${targetDir}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}${getFileExt(uri)}`;

  try {
    await ensureDir(targetDir);
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

// ensureAlbumPermission 专门处理系统相册权限，不把权限细节泄露给页面层。
async function ensureAlbumPermission() {
  const currentPermission = await MediaLibrary.getPermissionsAsync();
  if (currentPermission.granted) {
    return;
  }

  const nextPermission = currentPermission.canAskAgain
    ? await MediaLibrary.requestPermissionsAsync()
    : currentPermission;

  if (!nextPermission.granted) {
    throw new Error("请先允许应用访问相册，然后再执行保存。");
  }
}

// 在准备好本地文件后，把图片写入系统相册。
export async function saveImageToAlbum(uri: string, folderName: string) {
  const localImageUri = await saveImageToLocalDir(uri, folderName);
  if (isRemoteImageUri(localImageUri)) {
    throw new Error("图片未能成功转成本地文件，暂时无法写入系统相册。");
  }

  await ensureAlbumPermission();
  await MediaLibrary.saveToLibraryAsync(localImageUri);
  return localImageUri;
}
