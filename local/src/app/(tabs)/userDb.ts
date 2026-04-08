import { database } from "@/model";
import User from "@/model/User";
import { assignModelId } from "@/lib/watermelon";
import {
  getCurrentUser,
  updateCurrentUserProfile,
  type UserProfile,
} from "./mockApp";

export type UserProfileData = {
  // id 与 mock/current user 的业务主键保持一致，便于跨层同步。
  id: string;
  // nickname 是大厅、动态、位置页等场景统一展示的昵称。
  nickname: string;
  // avatarLocalUri 指向用户从相册选中后复制进沙盒的头像文件。
  avatarLocalUri: string;
  // avatarRemoteUrl 保存一个可回退使用的线上头像地址。
  avatarRemoteUrl: string;
  // deletedAt 预留给未来同步删除或注销场景。
  deletedAt: number | null;
};

// toData 把 Watermelon 的用户记录转换成页面更容易使用的资料结构。
function toData(row: User): UserProfileData {
  return {
    id: row.id,
    nickname: row.nickname || "未命名用户",
    avatarLocalUri: row.avatarLocalUri || "",
    avatarRemoteUrl: row.avatarRemoteUrl || "",
    deletedAt: typeof row.deletedAt === "number" ? row.deletedAt : null,
  };
}

// toSeed 把内存中的当前用户映射成首次落库时使用的初始化结构。
function toSeed(current: UserProfile): UserProfileData {
  return {
    id: current.id,
    nickname: current.nickname || current.username || "旅行者",
    avatarLocalUri: "",
    avatarRemoteUrl: current.avatarUrl || "",
    deletedAt: null,
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
    return toData(existed);
  }

  // seed 是首次落库时使用的默认资料快照。
  const seed = toSeed(current);
  let created: User | null = null;
  await database.write(async () => {
    const collection = database.collections.get<User>("users");
    created = await collection.create((row) => {
      assignModelId(row, seed.id);
      row.nickname = seed.nickname;
      row.avatarLocalUri = seed.avatarLocalUri;
      row.avatarRemoteUrl = seed.avatarRemoteUrl;
      row.deletedAt = null;
    });
  });

  return created ? toData(created) : seed;
}

// getCurrentUserProfileFromDb 始终返回 mock 当前用户在本地库里的最新资料。
export async function getCurrentUserProfileFromDb() {
  const current = getCurrentUser();
  const row = await getUserRowById(current.id);
  if (!row) {
    return ensureCurrentUserProfileInDb();
  }
  return toData(row);
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
      item.deletedAt = null;
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
  const row = await getUserRowById(current.id);
  if (!row) {
    await ensureCurrentUserProfileInDb();
    return updateCurrentUserAvatarInDb(avatarLocalUri, avatarRemoteUrl);
  }

  await database.write(async () => {
    await row.update((item) => {
      item.avatarLocalUri = avatarLocalUri;
      if (avatarRemoteUrl !== undefined) {
        item.avatarRemoteUrl = avatarRemoteUrl;
      }
      item.deletedAt = null;
    });
  });

  updateCurrentUserProfile({
    avatarLocalUri,
    avatarRemoteUrl:
      avatarRemoteUrl ?? (avatarLocalUri ? row.avatarRemoteUrl || "" : ""),
  });
  return getCurrentUserProfileFromDb();
}
