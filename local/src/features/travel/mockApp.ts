import { createUlid, isUlid, nowTimestamp } from "@/lib/ids";
// 该模块存放旅行空间相关的前端 mock 业务逻辑。

// normalizeCode 统一规范邀请码大小写，避免 mock 存储里出现大小写不一致的问题。
function normalizeCode(code: string) {
  return code.trim().toUpperCase();
}

// countDisplayChars 按字符而不是字节统计长度，避免中文名称被误判。
function countDisplayChars(text: string) {
  return Array.from(text).length;
}

// clampSpaceName 统一裁剪空间名称，保证不会超过十个字符。
function clampSpaceName(text: string) {
  return Array.from(text.trim()).slice(0, 10).join("");
}

// buildDefaultSpaceName 生成新的默认空间名，格式固定为“XX的空间”。
function buildDefaultSpaceName(ownerName: string) {
  const cleanOwnerName = Array.from(ownerName.trim() || "你")
    .slice(0, 4)
    .join("");
  return `${cleanOwnerName}的空间`;
}

// cloneSpace 返回一份纯数据拷贝，避免页面直接改动内存里的 mock 源数据。
function cloneSpace(space: SpaceData): SpaceData {
  return JSON.parse(JSON.stringify(space)) as SpaceData;
}

// createId 统一为所有 mock 记录生成 ULID。
function createId() {
  return createUlid();
}

// clamp 把模拟坐标和电量限制在安全范围内。
function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

// randomOffset 给地图点位增加微小偏移，让模拟移动看起来更自然。
function randomOffset() {
  return (Math.random() - 0.5) * 0.008;
}

// isRemoteUri 用来区分网络图片地址和本地沙盒文件路径。
function isRemoteUri(uri: string) {
  return /^https?:\/\//i.test(uri);
}

// toAvatarFields 把单个头像地址拆成新 schema 里使用的本地与远程字段。
function toAvatarFields(uri: string) {
  if (!uri) {
    return { avatar_local_uri: "", avatar_remote_url: "" };
  }
  if (isRemoteUri(uri)) {
    return { avatar_local_uri: "", avatar_remote_url: uri };
  }
  return { avatar_local_uri: uri, avatar_remote_url: "" };
}

// getUserAvatarUri 负责挑选最适合页面渲染的头像地址。
function getUserAvatarUri(user: UserRow) {
  return user.avatar_local_uri || user.avatar_remote_url || "";
}

// createSpaceMemberId 根据空间和用户主键生成稳定的成员关系 id。
function createSpaceMemberId(spaceId: string, userId: string) {
  return `${spaceId}_${userId}`;
}

// getActiveMemberIds 只返回某个空间中尚未删除的成员 id。
function getActiveMemberIds(space: SpaceData) {
  return new Set(space.spaceMembers.map((item) => item.user_id));
}

// activeMemberCount 用来判断空间是否需要在无人时自动移除。
function activeMemberCount(space: SpaceData) {
  return space.spaceMembers.length;
}

export type UserProfile = {
  id: string;
  username: string;
  accountName: string;
  avatarUrl: string;
  nickname: string;
};

export type UserRow = {
  id: string;
  nickname: string;
  avatar_local_uri: string;
  avatar_remote_url: string;
  created_at: number;
  updated_at: number;
};

export type SpaceRow = {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
};

export type SpaceMemberRow = {
  id: string;
  space_id: string;
  user_id: string;
  created_at: number;
  updated_at: number;
};

export type PhotoRow = {
  id: string;
  space_id: string;
  uploader_id: string;
  local_uri: string;
  remote_url: string;
  post_id: string;
  shoted_at: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

export type ExpenseRow = {
  id: string;
  space_id: string;
  payer_id: string;
  amount: number;
  description: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

export type CommentRow = {
  id: string;
  space_id: string;
  content: string;
  commenter_id: string;
  post_id: string;
  commented_at: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

export type PostRow = {
  id: string;
  space_id: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

export type LocationItem = {
  id: string;
  user_id: string;
  username: string;
  avatarUrl: string;
  latitude: number;
  longitude: number;
  battery: number;
  sharing: boolean;
  updated_at: number;
};

export type SpaceData = {
  id: string;
  name: string;
  code: string;
  space: SpaceRow;
  users: UserRow[];
  spaceMembers: SpaceMemberRow[];
  photos: PhotoRow[];
  expenses: ExpenseRow[];
  comments: CommentRow[];
  posts: PostRow[];
  locations: LocationItem[];
};

export type TeamData = SpaceData;

export type JoinedSpaceSummary = {
  id: string;
  code: string;
  name: string;
  createdAt: number;
  memberCount: number;
  photoCount: number;
  updatedAt: number;
};

type JoinResult =
  | { ok: true; space: SpaceData }
  | { ok: false; message: string };

type LeaveResult =
  | { ok: true; space: SpaceData | null; message: string }
  | { ok: false; message: string };

// MEMBER_AVATARS 是 mock 成员的固定头像素材，便于反复创建空间时保持角色辨识度。
const MEMBER_AVATARS: Record<string, string> = {
  me: "https://i.pravatar.cc/200?img=11",
  xiaoli: "https://i.pravatar.cc/200?img=48",
  ajun: "https://i.pravatar.cc/200?img=13",
};

// MEMBER_IDS 为示例成员提前生成稳定主键，避免同一角色在不同结构里 id 不一致。
const MEMBER_IDS = {
  me: createId(),
  xiaoli: createId(),
  ajun: createId(),
};

// CURRENT_USER 表示当前 mock 流程里始终扮演“我”的默认旅行者资料。
const CURRENT_USER: UserProfile = {
  id: MEMBER_IDS.me,
  username: "旅行者小王",
  accountName: "旅行者小王",
  avatarUrl: MEMBER_AVATARS.me,
  nickname: "小王",
};

// SAMPLE_IMAGES 是初始化动态时随机抽取的默认风景图素材池。
const SAMPLE_IMAGES = [
  "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1200",
  "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1200",
  "https://images.unsplash.com/photo-1526778548025-fa2f459cd5c1?w=1200",
  "https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1200",
];

// SAMPLE_TEXTS 是构造示例动态正文时复用的简短旅行文案。
const SAMPLE_TEXTS = [
  "我们到达酒店并顺利办理入住。",
  "今天在本地市场吃到了很好吃的食物。",
  "傍晚山顶风景非常值得。",
  "晚饭后沿河散步很舒服。",
];

// 这组范围限定了 mock 位置共享的坐标边界，保证测试点位落在同一片区域内。
const LAT_MIN = 31.215;
const LAT_MAX = 31.24;
const LON_MIN = 121.455;
const LON_MAX = 121.485;

// spaces 是服务端同步尚未接入前，前端内存里的 mock 真值源。
const spaces = new Map<string, SpaceData>();

// randomImage 从示例图库里随机抽一张，供初始化动态和补图流程复用。
function randomImage() {
  return SAMPLE_IMAGES[Math.floor(Math.random() * SAMPLE_IMAGES.length)];
}

// randomText 从示例文案池里随机取一句，模拟真实用户发布动态时的文字。
function randomText() {
  return SAMPLE_TEXTS[Math.floor(Math.random() * SAMPLE_TEXTS.length)];
}

// createUserRow 生成与规范化 `users` 表结构一致的用户记录。
function createUserRow(
  id: string,
  nickname: string,
  avatarUri: string,
  createdAt: number,
): UserRow {
  const avatarFields = toAvatarFields(avatarUri);
  return {
    id,
    nickname,
    ...avatarFields,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

// createPhoto 生成一条同时关联动态和旅行空间的图片记录。
function createPhoto(
  spaceId: string,
  uploaderId: string,
  postId: string,
  uri: string,
  shotedAt: number,
): PhotoRow {
  return {
    id: createId(),
    space_id: spaceId,
    uploader_id: uploaderId,
    local_uri: isRemoteUri(uri) ? "" : uri,
    remote_url: isRemoteUri(uri) ? uri : "",
    post_id: postId,
    shoted_at: shotedAt,
    created_at: shotedAt,
    updated_at: shotedAt,
    deleted_at: null,
  };
}

// createComment 生成一条挂在动态上的评论记录。
function createComment(
  spaceId: string,
  postId: string,
  commenterId: string,
  content: string,
  commentedAt: number,
): CommentRow {
  return {
    id: createId(),
    space_id: spaceId,
    content,
    commenter_id: commenterId,
    post_id: postId,
    commented_at: commentedAt,
    created_at: commentedAt,
    updated_at: commentedAt,
    deleted_at: null,
  };
}

// getCurrentUser 返回当前 mock 流程里扮演“我”的本地用户。
export function getCurrentUser() {
  return CURRENT_USER;
}

// updateCurrentUserProfile 会把资料修改同步映射到已有 mock 空间和位置数据里。
export function updateCurrentUserProfile(next: {
  nickname?: string;
  avatarUrl?: string;
  avatarLocalUri?: string;
  avatarRemoteUrl?: string;
}) {
  const updatedAt = nowTimestamp();

  if (next.nickname && next.nickname.trim()) {
    const clean = next.nickname.trim();
    CURRENT_USER.username = clean;
    CURRENT_USER.nickname = clean;
    CURRENT_USER.accountName = clean;
  }

  if (next.avatarLocalUri !== undefined || next.avatarRemoteUrl !== undefined) {
    CURRENT_USER.avatarUrl =
      next.avatarLocalUri || next.avatarRemoteUrl || CURRENT_USER.avatarUrl;
  } else if (next.avatarUrl && next.avatarUrl.trim()) {
    CURRENT_USER.avatarUrl = next.avatarUrl.trim();
  }

  const latestNickname = CURRENT_USER.username;
  const latestAvatarFields =
    next.avatarLocalUri !== undefined || next.avatarRemoteUrl !== undefined
      ? {
          avatar_local_uri: next.avatarLocalUri ?? "",
          avatar_remote_url: next.avatarRemoteUrl ?? "",
        }
      : toAvatarFields(CURRENT_USER.avatarUrl);

  for (const space of spaces.values()) {
    space.users = space.users.map((user) =>
      user.id === CURRENT_USER.id
        ? {
            ...user,
            nickname: latestNickname,
            avatar_local_uri: latestAvatarFields.avatar_local_uri,
            avatar_remote_url: latestAvatarFields.avatar_remote_url,
            updated_at: updatedAt,
          }
        : user,
    );

    space.locations = space.locations.map((item) =>
      item.user_id === CURRENT_USER.id
        ? {
            ...item,
            username: latestNickname,
            avatarUrl: CURRENT_USER.avatarUrl,
            updated_at: updatedAt,
          }
        : item,
    );

    const hasCurrentUser = space.users.some(
      (user) => user.id === CURRENT_USER.id,
    );
    if (!hasCurrentUser) {
      space.users.push(
        createUserRow(
          CURRENT_USER.id,
          latestNickname,
          CURRENT_USER.avatarUrl,
          updatedAt,
        ),
      );
    }

    space.comments = space.comments.map((comment) =>
      comment.commenter_id === CURRENT_USER.id
        ? { ...comment, updated_at: updatedAt }
        : comment,
    );
  }
}

// createSpaceForCurrentUser 会为当前用户初始化一个包含成员、动态、账单和位置的示例空间。
export function createSpaceForCurrentUser() {
  // createdAt 作为这次初始化的统一基准时间，方便后续排序和对比更新。
  const createdAt = nowTimestamp();
  const spaceId = createId();
  // 当前 mock 阶段直接复用空间 id 作为口令，后续接服务端后可切换成独立邀请码。
  const code = spaceId;

  // 先构造三位默认成员的规范化用户行数据。
  const currentUserRow = createUserRow(
    CURRENT_USER.id,
    CURRENT_USER.username,
    CURRENT_USER.avatarUrl,
    createdAt,
  );
  const xiaoliRow = createUserRow(
    MEMBER_IDS.xiaoli,
    "小丽",
    MEMBER_AVATARS.xiaoli,
    createdAt,
  );
  const ajunRow = createUserRow(
    MEMBER_IDS.ajun,
    "阿军",
    MEMBER_AVATARS.ajun,
    createdAt,
  );

  // spaceRow 对应 docs/data-design.md 中 `spaces` 表的一条主记录。
  const spaceRow: SpaceRow = {
    id: spaceId,
    name: buildDefaultSpaceName(CURRENT_USER.nickname || CURRENT_USER.username),
    created_at: createdAt,
    updated_at: createdAt,
  };

  // spaceMembers 模拟当前空间里三位旅伴都已加入的成员关系。
  const spaceMembers: SpaceMemberRow[] = [
    {
      id: createSpaceMemberId(spaceId, CURRENT_USER.id),
      space_id: spaceId,
      user_id: CURRENT_USER.id,
      created_at: createdAt,
      updated_at: createdAt,
    },
    {
      id: createSpaceMemberId(spaceId, MEMBER_IDS.xiaoli),
      space_id: spaceId,
      user_id: MEMBER_IDS.xiaoli,
      created_at: createdAt,
      updated_at: createdAt,
    },
    {
      id: createSpaceMemberId(spaceId, MEMBER_IDS.ajun),
      space_id: spaceId,
      user_id: MEMBER_IDS.ajun,
      created_at: createdAt,
      updated_at: createdAt,
    },
  ];

  // 第一条动态模拟刚刚发布的旅行照片，并配两张图方便验证多图布局。
  // 让示例动态发生在当前时刻之前，避免大厅里出现“未来时间”。
  const firstPostCreatedAt = createdAt - 12 * 60 * 1000;
  const firstPostId = createId();
  const firstCaption = randomText();
  const firstPhotoA = createPhoto(
    spaceId,
    MEMBER_IDS.xiaoli,
    firstPostId,
    randomImage(),
    firstPostCreatedAt,
  );
  const firstPhotoB = createPhoto(
    spaceId,
    MEMBER_IDS.xiaoli,
    firstPostId,
    randomImage(),
    firstPostCreatedAt + 60_000,
  );

  // 第二条动态模拟更早的一条通知型内容，便于验证时间排序和评论回显。
  const secondPostCreatedAt = createdAt - 60 * 60 * 1000;
  const secondPostId = createId();
  const secondCaption = "明天早上 8 点酒店大堂集合。";
  const secondPhoto = createPhoto(
    spaceId,
    MEMBER_IDS.ajun,
    secondPostId,
    randomImage(),
    secondPostCreatedAt,
  );

  // posts 只保存动态主记录，正文文字会放进 comments 里作为首条评论。
  const posts: PostRow[] = [
    {
      id: firstPostId,
      space_id: spaceId,
      created_at: firstPostCreatedAt,
      updated_at: firstPostCreatedAt,
      deleted_at: null,
    },
    {
      id: secondPostId,
      space_id: spaceId,
      created_at: secondPostCreatedAt,
      updated_at: secondPostCreatedAt,
      deleted_at: null,
    },
  ];

  // comments 既包含动态正文，也包含成员后续回复。
  const comments: CommentRow[] = [
    createComment(
      spaceId,
      firstPostId,
      MEMBER_IDS.xiaoli,
      firstCaption,
      firstPostCreatedAt,
    ),
    createComment(
      spaceId,
      firstPostId,
      MEMBER_IDS.ajun,
      "这个景色太棒了！",
      firstPostCreatedAt + 4 * 60 * 1000,
    ),
    createComment(
      spaceId,
      secondPostId,
      MEMBER_IDS.ajun,
      secondCaption,
      secondPostCreatedAt,
    ),
  ];

  // SpaceData 是前端当前阶段的聚合读取模型，方便页面一次拿到整段旅行上下文。
  const space: SpaceData = {
    id: spaceId,
    name: spaceRow.name,
    code,
    space: spaceRow,
    users: [currentUserRow, xiaoliRow, ajunRow],
    spaceMembers,
    photos: [firstPhotoA, firstPhotoB, secondPhoto],
    // 这里的 amount 继续沿用 mock 层“元”为单位的旧约定，落库时会转成“分”。
    expenses: [
      {
        id: createId(),
        space_id: spaceId,
        payer_id: CURRENT_USER.id,
        amount: 86,
        description: "打车去酒店",
        created_at: createdAt,
        updated_at: createdAt,
        deleted_at: null,
      },
      {
        id: createId(),
        space_id: spaceId,
        payer_id: MEMBER_IDS.xiaoli,
        amount: 248,
        description: "晚饭",
        created_at: createdAt,
        updated_at: createdAt,
        deleted_at: null,
      },
    ],
    comments,
    posts,
    // locations 提供初始地图点位，保证位置页一打开就能看到旅伴分布。
    locations: [
      {
        id: createId(),
        user_id: CURRENT_USER.id,
        username: CURRENT_USER.username,
        avatarUrl: CURRENT_USER.avatarUrl,
        latitude: 31.2286,
        longitude: 121.4721,
        battery: 78,
        sharing: true,
        updated_at: createdAt,
      },
      {
        id: createId(),
        user_id: MEMBER_IDS.xiaoli,
        username: "小丽",
        avatarUrl: MEMBER_AVATARS.xiaoli,
        latitude: 31.2331,
        longitude: 121.4663,
        battery: 56,
        sharing: true,
        updated_at: createdAt,
      },
      {
        id: createId(),
        user_id: MEMBER_IDS.ajun,
        username: "阿军",
        avatarUrl: MEMBER_AVATARS.ajun,
        latitude: 31.2215,
        longitude: 121.4796,
        battery: 28,
        sharing: true,
        updated_at: createdAt,
      },
    ],
  };

  spaces.set(code, space);
  return cloneSpace(space);
}

// joinSpaceByCode 会让当前用户重新激活并加入已有的 mock 空间。
export function joinSpaceByCode(inputCode: string): JoinResult {
  const code = normalizeCode(inputCode);
  if (!code) {
    return { ok: false, message: "请输入空间口令。" };
  }
  if (!isUlid(code)) {
    return { ok: false, message: "空间口令必须是 26 位 ID号。" };
  }

  const space = spaces.get(code);
  if (!space) {
    return { ok: false, message: "未找到旅行空间，请确认口令。" };
  }

  const joinedAt = nowTimestamp();
  // existingMember 代表“重新加入曾经离开的空间”时要恢复的成员关系记录。
  const existingMember = space.spaceMembers.find(
    (item) => item.user_id === CURRENT_USER.id,
  );

  if (existingMember) {
    existingMember.updated_at = joinedAt;
  } else {
    space.spaceMembers.push({
      id: createSpaceMemberId(space.id, CURRENT_USER.id),
      space_id: space.id,
      user_id: CURRENT_USER.id,
      created_at: joinedAt,
      updated_at: joinedAt,
    });
  }

  // existingUser 负责同步当前用户最新昵称和头像，避免老空间里显示过时资料。
  const existingUser = space.users.find((user) => user.id === CURRENT_USER.id);
  if (existingUser) {
    const avatarFields = toAvatarFields(CURRENT_USER.avatarUrl);
    existingUser.nickname = CURRENT_USER.username;
    existingUser.avatar_local_uri = avatarFields.avatar_local_uri;
    existingUser.avatar_remote_url = avatarFields.avatar_remote_url;
    existingUser.updated_at = joinedAt;
  } else {
    space.users.push(
      createUserRow(
        CURRENT_USER.id,
        CURRENT_USER.username,
        CURRENT_USER.avatarUrl,
        joinedAt,
      ),
    );
  }

  // existingLocation 用来决定是恢复旧位置还是新建当前位置共享记录。
  const existingLocation = space.locations.find(
    (item) => item.user_id === CURRENT_USER.id,
  );
  if (existingLocation) {
    existingLocation.username = CURRENT_USER.username;
    existingLocation.avatarUrl = CURRENT_USER.avatarUrl;
    existingLocation.latitude = clamp(
      31.2286 + randomOffset(),
      LAT_MIN,
      LAT_MAX,
    );
    existingLocation.longitude = clamp(
      121.4721 + randomOffset(),
      LON_MIN,
      LON_MAX,
    );
    existingLocation.battery = 74;
    existingLocation.updated_at = joinedAt;
  } else {
    space.locations.push({
      id: createId(),
      user_id: CURRENT_USER.id,
      username: CURRENT_USER.username,
      avatarUrl: CURRENT_USER.avatarUrl,
      latitude: clamp(31.2286 + randomOffset(), LAT_MIN, LAT_MAX),
      longitude: clamp(121.4721 + randomOffset(), LON_MIN, LON_MAX),
      battery: 74,
      sharing: true,
      updated_at: joinedAt,
    });
  }

  return { ok: true, space: cloneSpace(space) };
}

// leaveSpaceByCode 会把当前用户标记为离开，并移除对应的实时位置。
export function leaveSpaceByCode(inputCode: string): LeaveResult {
  const code = normalizeCode(inputCode);
  if (!isUlid(code)) {
    return { ok: false, message: "空间口令必须是 26 位 ID号。" };
  }

  const space = spaces.get(code);
  if (!space) {
    return { ok: false, message: "旅行空间不存在。" };
  }

  const leftAt = nowTimestamp();
  space.spaceMembers = space.spaceMembers.filter(
    (item) => item.user_id !== CURRENT_USER.id,
  );
  space.space.updated_at = leftAt;
  space.locations = space.locations.filter(
    (item) => item.user_id !== CURRENT_USER.id,
  );

  if (activeMemberCount(space) === 0) {
    spaces.delete(code);
    return { ok: true, space: null, message: "你已退出，空间已自动结束。" };
  }

  return { ok: true, space: cloneSpace(space), message: "你已退出旅行空间。" };
}

// getSpaceByCode 根据邀请码安全查找 mock 旅行空间。
export function getSpaceByCode(inputCode: string) {
  const code = normalizeCode(inputCode);
  if (!isUlid(code)) {
    return null;
  }
  const space = spaces.get(code);
  return space ? cloneSpace(space) : null;
}

// renameSpaceByCode 允许前端在不改数据库结构的前提下更新空间名称。
export function renameSpaceByCode(inputCode: string, nextName: string) {
  const code = normalizeCode(inputCode);
  const cleanName = clampSpaceName(nextName);
  if (!isUlid(code)) {
    return { ok: false as const, message: "空间口令格式不正确。" };
  }
  if (!cleanName) {
    return { ok: false as const, message: "请输入空间名称。" };
  }
  if (countDisplayChars(nextName.trim()) > 10) {
    return { ok: false as const, message: "空间名称最多 10 个字。" };
  }

  const space = spaces.get(code);
  if (!space) {
    return { ok: false as const, message: "没有找到当前空间。" };
  }

  const renamedAt = nowTimestamp();
  space.name = cleanName;
  space.space.name = cleanName;
  space.space.updated_at = renamedAt;

  return { ok: true as const, space: cloneSpace(space) };
}

// listJoinedSpacesForCurrentUser 返回当前用户仍然属于其中的所有旅行空间摘要。
export function listJoinedSpacesForCurrentUser(): JoinedSpaceSummary[] {
  return Array.from(spaces.values())
    .filter((space) =>
      space.spaceMembers.some((item) => item.user_id === CURRENT_USER.id),
    )
    .map((space) => ({
      id: space.id,
      code: space.code,
      name: space.name,
      createdAt: space.space.created_at,
      memberCount: activeMemberCount(space),
      photoCount: space.photos.filter((item) => !item.deleted_at).length,
      updatedAt: Math.max(
        space.space.updated_at,
        ...space.posts.map((item) => item.updated_at),
        ...space.comments.map((item) => item.updated_at),
        ...space.photos.map((item) => item.updated_at),
        ...space.expenses.map((item) => item.updated_at),
      ),
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((item) => ({ ...item }));
}

// addPostToSpace 会向 mock 空间追加一条新动态及其配图记录。
export function addPostToSpace(
  inputCode: string,
  text: string,
  imageUris?: string[],
) {
  const space = spaces.get(normalizeCode(inputCode));
  if (!space) {
    return { ok: false as const, message: "旅行空间不存在。" };
  }

  const cleanText = text.trim();
  const cleanImages = (imageUris ?? [])
    .map((uri) => uri.trim())
    .filter(Boolean);
  if (cleanImages.length === 0) {
    return {
      ok: false as const,
      message: "根据当前数据结构，发布动态时至少需要一张图片。",
    };
  }

  const createdAt = nowTimestamp();
  const postId = createId();
  // 每张图片都映射成独立 photo 记录，便于后续成员共同增删图片。
  const photos = cleanImages.map((uri, index) =>
    createPhoto(space.id, CURRENT_USER.id, postId, uri, createdAt + index),
  );

  space.posts.unshift({
    id: postId,
    space_id: space.id,
    created_at: createdAt,
    updated_at: createdAt,
    deleted_at: null,
  });
  space.photos.unshift(...photos);

  if (cleanText) {
    space.comments.unshift(
      createComment(space.id, postId, CURRENT_USER.id, cleanText, createdAt),
    );
  }

  return { ok: true as const, space: cloneSpace(space) };
}

// addCommentToPost 会追加一条评论，并同步更新父动态的更新时间。
export function addCommentToPost(
  inputCode: string,
  postId: string,
  text: string,
) {
  const space = spaces.get(normalizeCode(inputCode));
  if (!space) {
    return { ok: false as const, message: "旅行空间不存在。" };
  }

  const post = space.posts.find(
    (item) => item.id === postId && !item.deleted_at,
  );
  if (!post) {
    return { ok: false as const, message: "动态不存在。" };
  }

  const content = text.trim();
  if (!content) {
    return { ok: false as const, message: "请输入评论内容。" };
  }

  const commentedAt = nowTimestamp();
  // 同时更新父动态的 updated_at，保证最新评论会推动动态排序。
  space.comments.push(
    createComment(space.id, postId, CURRENT_USER.id, content, commentedAt),
  );
  post.updated_at = commentedAt;

  return { ok: true as const, space: cloneSpace(space) };
}

// addExpenseToSpace 会向 mock 空间追加一条账单记录。
export function addExpenseToSpace(
  inputCode: string,
  title: string,
  amountText: string,
) {
  const space = spaces.get(normalizeCode(inputCode));
  if (!space) {
    return { ok: false as const, message: "旅行空间不存在。" };
  }

  const cleanTitle = title.trim();
  const parsed = Number(amountText);
  if (!cleanTitle) {
    return { ok: false as const, message: "请输入项目名称。" };
  }
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { ok: false as const, message: "金额必须大于 0。" };
  }

  const createdAt = nowTimestamp();
  // mock 账单层当前仍以“元”为单位，进入 WatermelonDB 时会统一转换成“分”。
  space.expenses.unshift({
    id: createId(),
    space_id: space.id,
    payer_id: CURRENT_USER.id,
    amount: Number(parsed.toFixed(2)),
    description: cleanTitle,
    created_at: createdAt,
    updated_at: createdAt,
    deleted_at: null,
  });

  return { ok: true as const, space: cloneSpace(space) };
}

// simulateOtherMembersLocation 通过轻微扰动成员坐标来模拟实时移动效果。
export function simulateOtherMembersLocation(inputCode: string) {
  const space = spaces.get(normalizeCode(inputCode));
  if (!space) {
    return { ok: false as const, message: "旅行空间不存在。" };
  }

  const activeMemberIds = getActiveMemberIds(space);
  space.locations = space.locations
    .filter((item) => activeMemberIds.has(item.user_id))
    .map((item) => {
      const battery = clamp(
        Math.round(item.battery - Math.random() * 4),
        1,
        100,
      );
      return {
        ...item,
        latitude: clamp(item.latitude + randomOffset(), LAT_MIN, LAT_MAX),
        longitude: clamp(item.longitude + randomOffset(), LON_MIN, LON_MAX),
        battery,
        updated_at: nowTimestamp(),
      };
    });

  return { ok: true as const, space: cloneSpace(space) };
}

// disbandSpaceByCode 会彻底移除一个 mock 旅行空间。
export function disbandSpaceByCode(inputCode: string) {
  const code = normalizeCode(inputCode);
  if (!isUlid(code)) {
    return false;
  }
  return spaces.delete(code);
}

export function createTeamForCurrentUser() {
  return createSpaceForCurrentUser();
}

// joinTeamByCode 是保留给旧页面命名的兼容封装，内部已切到 space 语义。
export function joinTeamByCode(inputCode: string) {
  const result = joinSpaceByCode(inputCode);
  if (!result.ok) {
    return result;
  }
  return { ok: true as const, team: result.space };
}

// leaveTeamByCode 同样保留旧命名，避免页面逐步迁移时一次性改动过大。
export function leaveTeamByCode(inputCode: string) {
  const result = leaveSpaceByCode(inputCode);
  if (!result.ok) {
    return result;
  }
  return { ok: true as const, team: result.space, message: result.message };
}

export function getTeamByCode(inputCode: string) {
  return getSpaceByCode(inputCode);
}

// addPostToTeam 继续对外暴露旧接口名，内部委托给新的 addPostToSpace。
export function addPostToTeam(
  inputCode: string,
  text: string,
  imageUris?: string[],
) {
  const result = addPostToSpace(inputCode, text, imageUris);
  if (!result.ok) {
    return result;
  }
  return { ok: true as const, team: result.space };
}

// addExpenseToTeam 兼容旧记账入口，避免页面侧立即重命名全部调用点。
export function addExpenseToTeam(
  inputCode: string,
  title: string,
  amountText: string,
) {
  const result = addExpenseToSpace(inputCode, title, amountText);
  if (!result.ok) {
    return result;
  }
  return { ok: true as const, team: result.space };
}

export function disbandTeamByCode(inputCode: string) {
  return disbandSpaceByCode(inputCode);
}

// getDisplayAvatarForUser 返回页面应优先展示的头像地址，兼容本地和远程两种来源。
export function getDisplayAvatarForUser(user: UserRow) {
  return getUserAvatarUri(user);
}
