import * as FileSystem from "expo-file-system/legacy";
import { database } from "@/model";
import User from "@/model/User";
import { createUlid } from "@/lib/ids";
import { assignModelId } from "@/lib/watermelon";

// userDb 现在只负责“当前用户是谁”和“当前用户昵称是什么”这两件本地真值。
// 头像已经改成由昵称首字生成的蓝色徽标，因此这里不再读写头像文件。

const CURRENT_USER_SESSION_DIR = "current-user";
const CURRENT_USER_SESSION_FILE = "session.json";
const DEFAULT_CURRENT_USER_NAME = "空间用户";

type CurrentUserSession = {
  id: string;
  nickname: string;
};

export type CurrentUserIdentity = {
  id: string;
  username: string;
};

// UserProfileData 仍然保留 avatar 字段，是为了兼容现有页面的数据结构。
// 这三个字段现在都会返回空字符串，页面统一走首字母蓝色徽标。
export type UserProfileData = {
  id: string;
  nickname: string;
  avatarLocalUri: string;
  avatarRemoteUrl: string;
  avatarDisplayUri: string;
};

function getCurrentUserSessionPath() {
  if (!FileSystem.documentDirectory) {
    return "";
  }

  const baseDir = FileSystem.documentDirectory.endsWith("/")
    ? FileSystem.documentDirectory
    : `${FileSystem.documentDirectory}/`;
  return `${baseDir}${CURRENT_USER_SESSION_DIR}/${CURRENT_USER_SESSION_FILE}`;
}

async function ensureCurrentUserSessionDir() {
  const sessionPath = getCurrentUserSessionPath();
  if (!sessionPath) {
    return;
  }

  const normalized = sessionPath.replace(/\\/g, "/");
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

function sanitizeNickname(nickname: string) {
  const clean = nickname.trim();
  return clean || DEFAULT_CURRENT_USER_NAME;
}

async function readCurrentUserSession(): Promise<CurrentUserSession | null> {
  const sessionPath = getCurrentUserSessionPath();
  if (!sessionPath) {
    return null;
  }

  const info = await FileSystem.getInfoAsync(sessionPath);
  if (!info.exists) {
    return null;
  }

  try {
    const raw = await FileSystem.readAsStringAsync(sessionPath);
    const parsed = JSON.parse(raw) as Partial<CurrentUserSession>;
    if (typeof parsed.id !== "string" || !parsed.id.trim()) {
      return null;
    }

    return {
      id: parsed.id.trim(),
      nickname: sanitizeNickname(parsed.nickname ?? DEFAULT_CURRENT_USER_NAME),
    };
  } catch {
    return null;
  }
}

async function writeCurrentUserSession(session: CurrentUserSession) {
  const sessionPath = getCurrentUserSessionPath();
  if (!sessionPath) {
    return;
  }

  await ensureCurrentUserSessionDir();
  await FileSystem.writeAsStringAsync(
    sessionPath,
    JSON.stringify(session, null, 2),
  );
}

async function ensureCurrentUserSession(): Promise<CurrentUserSession> {
  const existing = await readCurrentUserSession();
  if (existing) {
    return existing;
  }

  const created: CurrentUserSession = {
    id: createUlid(),
    nickname: DEFAULT_CURRENT_USER_NAME,
  };
  await writeCurrentUserSession(created);
  return created;
}

async function syncCurrentUserSessionNickname(nickname: string) {
  const session = await ensureCurrentUserSession();
  const nextNickname = sanitizeNickname(nickname);
  if (session.nickname === nextNickname) {
    return;
  }

  await writeCurrentUserSession({
    ...session,
    nickname: nextNickname,
  });
}

async function getUserRowById(userId: string) {
  const collection = database.collections.get<User>("users");
  try {
    return await collection.find(userId);
  } catch {
    return null;
  }
}

function toProfileData(id: string, nickname: string): UserProfileData {
  return {
    id,
    nickname: sanitizeNickname(nickname),
    avatarLocalUri: "",
    avatarRemoteUrl: "",
    avatarDisplayUri: "",
  };
}

export async function ensureCurrentUserIdentity(): Promise<CurrentUserIdentity> {
  const profile = await ensureCurrentUserProfileInDb();
  return {
    id: profile.id,
    username: profile.nickname,
  };
}

// ensureCurrentUserProfileInDb 会确保“当前这台设备上的用户”有稳定 id，
// 并且在 users 表中一定存在一条对应记录。
export async function ensureCurrentUserProfileInDb() {
  const session = await ensureCurrentUserSession();
  const existed = await getUserRowById(session.id);
  if (existed) {
    const nextNickname = sanitizeNickname(existed.nickname || session.nickname);
    if (nextNickname !== session.nickname) {
      await syncCurrentUserSessionNickname(nextNickname);
    }
    return toProfileData(existed.id, nextNickname);
  }

  let createdUserId = session.id;
  let createdUserNickname = session.nickname;

  await database.write(async () => {
    const collection = database.collections.get<User>("users");
    const created = await collection.create((row) => {
      assignModelId(row, session.id);
      row.nickname = sanitizeNickname(session.nickname);
    });
    createdUserId = created.id;
    createdUserNickname = created.nickname;
  });

  return toProfileData(createdUserId, createdUserNickname);
}

export async function getCurrentUserProfileFromDb() {
  const session = await ensureCurrentUserSession();
  const row = await getUserRowById(session.id);
  if (!row) {
    return ensureCurrentUserProfileInDb();
  }

  const nextNickname = sanitizeNickname(row.nickname || session.nickname);
  if (nextNickname !== session.nickname) {
    await syncCurrentUserSessionNickname(nextNickname);
  }

  return toProfileData(row.id, nextNickname);
}

export async function updateCurrentUserNicknameInDb(nickname: string) {
  const clean = sanitizeNickname(nickname);
  const session = await ensureCurrentUserSession();
  const row = await getUserRowById(session.id);
  if (!row) {
    await ensureCurrentUserProfileInDb();
    return updateCurrentUserNicknameInDb(clean);
  }

  await database.write(async () => {
    await row.update((item) => {
      item.nickname = clean;
    });
  });

  await syncCurrentUserSessionNickname(clean);
  return getCurrentUserProfileFromDb();
}
