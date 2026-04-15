import * as FileSystem from "expo-file-system/legacy";
import { saveImageToAppRelativePath } from "./imageStorage";

type ProfileAssetPayload = {
  avatarLocalUri: string;
  avatarDisplayUri: string;
};

// 文档要求头像统一落到应用沙盒里的 avatars/{userId}.jpg。
const AVATAR_DIR = "avatars";
// 兼容旧版本：历史实现曾用元数据文件记录头像路径。
const LEGACY_PROFILE_ASSET_DIR = "travel-profile-assets";

// getAvatarRelativePath 返回 docs 约定的头像相对路径。
function getAvatarRelativePath(userId: string) {
  return `${AVATAR_DIR}/${userId}.jpg`;
}

// getAvatarAbsolutePath 把相对路径转换成 documentDirectory 下的绝对路径。
function getAvatarAbsolutePath(userId: string) {
  if (!FileSystem.documentDirectory) {
    return "";
  }
  const baseDir = FileSystem.documentDirectory.endsWith("/")
    ? FileSystem.documentDirectory
    : `${FileSystem.documentDirectory}/`;
  return `${baseDir}${getAvatarRelativePath(userId)}`;
}

// 旧实现里每个用户都会有一份 json 元数据，升级时需要兼容读取。
function getLegacyProfileAssetFilePath(userId: string) {
  if (!FileSystem.documentDirectory) {
    return "";
  }
  const baseDir = FileSystem.documentDirectory.endsWith("/")
    ? FileSystem.documentDirectory
    : `${FileSystem.documentDirectory}/`;
  return `${baseDir}${LEGACY_PROFILE_ASSET_DIR}/${userId}.json`;
}

// 读取旧版本元数据，尝试把历史头像迁移到新的固定路径。
async function readLegacyAvatarUri(userId: string) {
  const legacyMetaPath = getLegacyProfileAssetFilePath(userId);
  if (!legacyMetaPath) {
    return "";
  }

  const legacyMetaInfo = await FileSystem.getInfoAsync(legacyMetaPath);
  if (!legacyMetaInfo.exists) {
    return "";
  }

  try {
    const raw = await FileSystem.readAsStringAsync(legacyMetaPath);
    const parsed = JSON.parse(raw) as Partial<ProfileAssetPayload>;
    const legacyAvatarUri = parsed.avatarLocalUri?.trim() || "";
    if (!legacyAvatarUri) {
      return "";
    }

    const legacyAvatarInfo = await FileSystem.getInfoAsync(legacyAvatarUri);
    if (!legacyAvatarInfo.exists) {
      return "";
    }

    return await saveImageToAppRelativePath(
      legacyAvatarUri,
      getAvatarRelativePath(userId),
    );
  } catch {
    return "";
  }
}

// 给本地头像补一个显示版本号，解决固定路径覆盖后 RN 图片缓存不刷新的问题。
function buildAvatarDisplayUri(
  avatarLocalUri: string,
  modificationTime?: number,
) {
  if (!avatarLocalUri) {
    return "";
  }
  const version =
    typeof modificationTime === "number" && Number.isFinite(modificationTime)
      ? Math.round(modificationTime)
      : Date.now();
  return `${avatarLocalUri}?v=${version}`;
}

// 兼容 FileInfo 联合类型，安全读取文件修改时间。
function getFileModificationTime(fileInfo: FileSystem.FileInfo) {
  return "modificationTime" in fileInfo ? fileInfo.modificationTime : undefined;
}

// readProfileAssets 读取当前用户的头像文件；若是旧版本数据则自动迁移。
export async function readProfileAssets(
  userId: string,
): Promise<ProfileAssetPayload> {
  const avatarLocalUri = getAvatarAbsolutePath(userId);
  if (!avatarLocalUri) {
    return { avatarLocalUri: "", avatarDisplayUri: "" };
  }

  const avatarInfo = await FileSystem.getInfoAsync(avatarLocalUri);
  if (avatarInfo.exists) {
    return {
      avatarLocalUri,
      avatarDisplayUri: buildAvatarDisplayUri(
        avatarLocalUri,
        getFileModificationTime(avatarInfo),
      ),
    };
  }

  const migratedAvatarUri = await readLegacyAvatarUri(userId);
  if (!migratedAvatarUri) {
    return { avatarLocalUri: "", avatarDisplayUri: "" };
  }

  const migratedInfo = await FileSystem.getInfoAsync(migratedAvatarUri);
  return {
    avatarLocalUri: migratedAvatarUri,
    avatarDisplayUri: buildAvatarDisplayUri(
      migratedAvatarUri,
      getFileModificationTime(migratedInfo),
    ),
  };
}

// saveProfileAvatarAsset 把头像保存到 avatars/{userId}.jpg，供个人页和空间页复用。
export async function saveProfileAvatarAsset(
  userId: string,
  sourceUri: string,
) {
  return saveImageToAppRelativePath(sourceUri, getAvatarRelativePath(userId));
}
