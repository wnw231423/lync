// userDb 负责当前用户资料的本地持久化，并把昵称、头像同步回 mock 业务层。
import { database } from "@/model";
import User from "@/model/User";
import { assignModelId } from "@/lib/watermelon";
import { readProfileAssets, saveProfileAvatarAsset } from "@/lib/profileAssets";
import {
  getCurrentUser,
  updateCurrentUserProfile,
  type UserProfile,
} from "@/features/travel/mockApp";

// UserProfileData 是页面真正消费的资料结构，已经把数据库字段和头像文件整合好了。
export type UserProfileData = {
  // id 与 mock/current user 的业务主键保持一致，便于跨层同步。
  id: string;
  // nickname 是大厅、动态、位置页等场景统一展示的昵称。
  nickname: string;
  // avatarLocalUri 来自独立的前端本地文件存储，不再放在 WatermelonDB 里。
  avatarLocalUri: string;
  // avatarRemoteUrl 作为没有本地头像时的回退地址，来源于当前用户基线资料。
  avatarRemoteUrl: string;
  // avatarDisplayUri 专门给 React Native 渲染使用，必要时会附带版本号绕过缓存。
  avatarDisplayUri: string;
};

// toData 把 Watermelon 的昵称记录和本地头像资产拼成页面真正需要的结构。
async function toData(
  row: User,
  current: UserProfile,
): Promise<UserProfileData> {
  const assets = await readProfileAssets(row.id);
  return {
    id: row.id,
    nickname: row.nickname || "未命名用户",
    avatarLocalUri: assets.avatarLocalUri,
    avatarRemoteUrl: current.avatarUrl || "",
    avatarDisplayUri: assets.avatarDisplayUri || current.avatarUrl || "",
  };
}

// toSeed 把内存中的当前用户映射成首次落库时写入 users 表的最小结构。
function toSeed(current: UserProfile) {
  return {
    id: current.id,
    nickname: current.nickname || current.username || "旅行者",
  };
}

// getUserRowById 会吞掉 Watermelon `find` 在记录不存在时抛出的异常。
async function getUserRowById(userId: string) {
  const collection = database.collections.get<User>("users");
  try {
    return await collection.find(userId);
  } catch {
    return null;
  }
}

// ensureCurrentUserProfileInDb 会在首次启动时确保当前用户已经写入本地库。
export async function ensureCurrentUserProfileInDb() {
  const current = getCurrentUser();
  const existed = await getUserRowById(current.id);
  if (existed) {
    return toData(existed, current);
  }

  // seed 是首次落库时使用的默认资料快照。
  const seed = toSeed(current);
  let created: User | null = null;
  await database.write(async () => {
    const collection = database.collections.get<User>("users");
    created = await collection.create((row) => {
      assignModelId(row, seed.id);
      row.nickname = seed.nickname;
    });
  });

  if (created) {
    return toData(created, current);
  }

  return {
    id: seed.id,
    nickname: seed.nickname,
    avatarLocalUri: "",
    avatarRemoteUrl: current.avatarUrl || "",
    avatarDisplayUri: current.avatarUrl || "",
  };
}

// getCurrentUserProfileFromDb 始终返回 mock 当前用户在本地库里的最新资料。
export async function getCurrentUserProfileFromDb() {
  const current = getCurrentUser();
  const row = await getUserRowById(current.id);
  if (!row) {
    return ensureCurrentUserProfileInDb();
  }
  return toData(row, current);
}

// updateCurrentUserNicknameInDb 持久化新昵称，并同步映射到 mock 空间数据里。
export async function updateCurrentUserNicknameInDb(nickname: string) {
  // clean 统一去掉首尾空白，避免出现“看不见”的空格昵称。
  const clean = nickname.trim();
  if (!clean) {
    return getCurrentUserProfileFromDb();
  }

  const current = getCurrentUser();
  const row = await getUserRowById(current.id);
  if (!row) {
    await ensureCurrentUserProfileInDb();
    return updateCurrentUserNicknameInDb(clean);
  }

  await database.write(async () => {
    await row.update((item) => {
      item.nickname = clean;
    });
  });

  updateCurrentUserProfile({ nickname: clean });
  return getCurrentUserProfileFromDb();
}

// updateCurrentUserAvatarInDb 保存头像路径，并同步映射到 mock 空间数据里。
export async function updateCurrentUserAvatarInDb(
  avatarLocalUri: string,
  avatarRemoteUrl?: string,
) {
  const current = getCurrentUser();
  await ensureCurrentUserProfileInDb();
  const nextAvatarLocalUri = await saveProfileAvatarAsset(
    current.id,
    avatarLocalUri,
  );

  updateCurrentUserProfile({
    avatarLocalUri: nextAvatarLocalUri,
    avatarRemoteUrl: avatarRemoteUrl ?? current.avatarUrl ?? "",
  });
  return getCurrentUserProfileFromDb();
}
