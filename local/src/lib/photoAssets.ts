import { File, Paths } from "expo-file-system";

import { saveImageToAppRelativePath } from "./imageStorage";

// docs/data-design.md 约定所有 photo 文件都统一落在 photos/{photoId}.jpg。
const PHOTO_DIR = "photos";

// getPhotoRelativePath 返回照片在应用沙盒内的固定相对路径。
export function getPhotoRelativePath(photoId: string) {
  return `${PHOTO_DIR}/${photoId}.jpg`;
}

// getPhotoLocalFile 把约定路径解析成可直接读 exists / uri 的 File 实例。
export function getPhotoLocalFile(photoId: string) {
  return new File(Paths.document, PHOTO_DIR, `${photoId}.jpg`);
}

// getExistingPhotoLocalUri 只在固定路径文件真实存在时返回本地 uri。
export function getExistingPhotoLocalUri(photoId: string) {
  const localPhotoFile = getPhotoLocalFile(photoId);
  return localPhotoFile.exists ? localPhotoFile.uri : "";
}

// savePhotoToLocalStorage 统一把图片物理文件写入约定路径。
// 调用方不需要关心原图来自相册、拍照还是远端下载，只要给出 photoId 和源 uri 即可。
export async function savePhotoToLocalStorage(
  photoId: string,
  sourceUri: string,
) {
  await saveImageToAppRelativePath(sourceUri, getPhotoRelativePath(photoId));
  return getExistingPhotoLocalUri(photoId);
}

// resolveRenderablePhotoUri 优先使用本地固定路径；若文件不存在，再回退到 remote_url。
// 若两边都不可用，就返回空串，让上层把它当异常图片隐藏掉。
export function resolveRenderablePhotoUri(photoId: string, remoteUrl: string) {
  return (
    getExistingPhotoLocalUri(photoId) || normalizeOptionalString(remoteUrl)
  );
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
