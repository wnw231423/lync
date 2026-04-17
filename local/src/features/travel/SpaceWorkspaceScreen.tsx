// SpaceWorkspaceScreen 是空间大厅的核心容器，串起侧栏、动态流、发布弹层和空间菜单。
import { Ionicons } from "@expo/vector-icons";
import { Q } from "@nozbe/watermelondb";
import { router, useFocusEffect } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from "react";
import {
  Alert,
  Animated,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SoftIconBadge } from "@/components/SoftIconBadge";
import { database } from "@/model";
import Comment from "@/model/Comment";
import Photo from "@/model/Photo";
import Post from "@/model/Post";
import { createUlid, isUlid, nowTimestamp } from "@/lib/ids";
import {
  isRemoteImageUri,
  saveImageToAppRelativePath,
  saveImageToAlbum,
} from "@/lib/imageStorage";
import {
  clearLastSpaceCode,
  readLastSpaceCode,
  saveLastSpaceCode,
} from "@/lib/spaceSession";
import { isSpaceDisbanded } from "@/lib/disbandedSpaces";
import {
  assignModelId,
  assignTimestamps,
  dateToTimestamp,
} from "@/lib/watermelon";
import {
  createSpaceLocally,
  disbandSpaceLocally,
  getSpaceSnapshotFromDb,
  leaveSpaceLocally,
  listJoinedSpacesFromDb,
  type JoinedSpaceSummary,
  type SpaceData,
} from "@/features/travel/spaceDb";
import {
  ensureCurrentUserProfileInDb,
  getCurrentUserProfileFromDb,
  type UserProfileData,
} from "@/features/travel/userDb";
import { styles, workspaceTheme } from "@/features/travel/spaceWorkspaceStyles";
import { syncSpace } from "@/sync/sync";

// ImagePickerModule / ClipboardModule 用懒加载方式描述原生模块接口，
// 这样在 Jest 或缺少原生依赖的环境里也不会因为静态 import 直接报错。
type ImagePickerModule = {
  launchImageLibraryAsync: (options: Record<string, unknown>) => Promise<{
    canceled: boolean;
    assets: { uri: string }[];
  }>;
};

type ClipboardModule = {
  setStringAsync: (value: string) => Promise<boolean>;
};

type ScrollableFeedHandle = {
  scrollTo: (options: { x?: number; y?: number; animated?: boolean }) => void;
};

// FeedComment / FeedPostImage / FeedPost 是大厅动态流真正使用的轻量视图模型。
// 这里会把数据库原始记录和页面需要的展示字段重新整理成更好用的结构。
type FeedComment = {
  id: string;
  commenterId: string;
  text: string;
  createdAt: number;
};

type FeedPostImage = {
  id: string;
  postId: string;
  uploaderId: string;
  uri: string;
};

type FeedPost = {
  id: string;
  authorId: string;
  caption: string;
  images: FeedPostImage[];
  createdAt: number;
  comments: FeedComment[];
};

type SpaceWorkspaceScreenProps = {
  initialCode?: string;
};

type CenterDialogProps = {
  visible: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
};

type UserAvatarProps = {
  uri?: string;
  name: string;
  size?: number;
  textSize?: number;
};

let imagePickerModuleCache: ImagePickerModule | null | undefined;
let clipboardModuleCache: ClipboardModule | null | undefined;

function normalizeSpaceCode(code?: string) {
  return typeof code === "string" ? code.trim().toUpperCase() : "";
}

// clampSpaceNameInput 在输入阶段先按字符数限制空间名称，避免弹窗里超长。
function clampSpaceNameInput(value: string) {
  return Array.from(value.replaceAll("_", "").trim()).slice(0, 8).join("");
}

function buildDefaultSpaceName(ownerName: string) {
  const cleanOwnerName = Array.from(ownerName.trim() || "我")
    .slice(0, 4)
    .join("");
  return clampSpaceNameInput(`${cleanOwnerName}的空间`);
}

// formatFeedTime 把动态时间统一格式化成短时间文案。
function formatSharedSpaceToken(spaceName: string, spaceId: string) {
  const cleanName = clampSpaceNameInput(spaceName);
  const cleanId = normalizeSpaceCode(spaceId);
  if (!cleanName || !cleanId) {
    return "";
  }
  return `${cleanName}_${cleanId}`;
}

function parseSharedSpaceToken(input: string) {
  const cleanInput = input.trim();
  const separatorIndex = cleanInput.lastIndexOf("_");
  if (separatorIndex <= 0 || separatorIndex >= cleanInput.length - 1) {
    return null;
  }

  const name = clampSpaceNameInput(cleanInput.slice(0, separatorIndex));
  const id = normalizeSpaceCode(cleanInput.slice(separatorIndex + 1));
  if (!name || !id) {
    return null;
  }

  return { name, id };
}

function formatFeedTime(ts: number) {
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// resolveRenderablePhotoUri 优先读取本地图片；如果文件丢失，再回退到远程地址。
async function resolveRenderablePhotoUri(localUri: string, remoteUrl: string) {
  const cleanLocalUri = localUri.trim();
  if (cleanLocalUri) {
    try {
      const localInfo = await FileSystem.getInfoAsync(cleanLocalUri);
      if (localInfo.exists) {
        return cleanLocalUri;
      }
    } catch {
      // 忽略本地文件探测异常，继续回退到远程地址。
    }
  }

  return remoteUrl.trim();
}

// getImagePickerModule / getClipboardModule 会按需加载原生模块，并把结果缓存起来。
function getImagePickerModule() {
  if (imagePickerModuleCache !== undefined) {
    return imagePickerModuleCache;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    imagePickerModuleCache = require("expo-image-picker") as ImagePickerModule;
  } catch {
    imagePickerModuleCache = null;
  }
  return imagePickerModuleCache;
}

function getClipboardModule() {
  if (clipboardModuleCache !== undefined) {
    return clipboardModuleCache;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    clipboardModuleCache = require("expo-clipboard") as ClipboardModule;
  } catch {
    clipboardModuleCache = null;
  }
  return clipboardModuleCache;
}

// UserAvatar 统一处理大厅里的头像渲染和兜底首字显示。
function UserAvatar({ uri, name, size = 40, textSize = 16 }: UserAvatarProps) {
  const fallback = Array.from(name.trim())[0] || "空";

  return (
    <View
      style={[
        styles.avatarFallback,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Text style={[styles.avatarFallbackText, { fontSize: textSize }]}>
        {fallback}
      </Text>
    </View>
  );
}

function FeedImage({ uri }: { uri: string }) {
  const [aspectRatio, setAspectRatio] = useState(1);

  return (
    <Image
      source={{ uri }}
      style={[
        styles.feedImage,
        aspectRatio >= 1 ? styles.feedImageLandscape : styles.feedImagePortrait,
        { aspectRatio },
      ]}
      resizeMode="contain"
      onLoad={({ nativeEvent }) => {
        const width = nativeEvent.source?.width ?? 0;
        const height = nativeEvent.source?.height ?? 0;
        if (width > 0 && height > 0) {
          setAspectRatio(width / height);
        }
      }}
    />
  );
}

// CenterDialog 是大厅里复用的居中弹窗壳子，创建空间、加入空间、分享空间都走这里。
function CenterDialog({
  visible,
  title,
  description,
  onClose,
  children,
  footer,
}: CenterDialogProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.dialogMask}>
        <Pressable style={styles.dialogBackdrop} onPress={onClose} />
        <View style={styles.dialogCard}>
          <View style={styles.dialogHeader}>
            <View style={styles.dialogTitleWrap}>
              <Text style={styles.dialogTitle}>{title}</Text>
              {description ? (
                <Text style={styles.dialogDescription}>{description}</Text>
              ) : null}
            </View>
            <Pressable style={styles.dialogClose} onPress={onClose}>
              <Ionicons
                name="close"
                size={18}
                color={workspaceTheme.iconMuted}
              />
            </Pressable>
          </View>
          <View style={styles.dialogBody}>{children}</View>
          {footer ? <View style={styles.dialogFooter}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

export function SpaceWorkspaceScreen({
  initialCode = "",
}: SpaceWorkspaceScreenProps) {
  const normalizedInitialCode = normalizeSpaceCode(initialCode);
  const { width, height } = useWindowDimensions();
  const sidebarDockWidth = 28;
  const sidebarWidth =
    width >= 900
      ? 292
      : width >= 760
        ? 248
        : Math.min(Math.max(width * 0.66, 236), 286);
  const sidebarHiddenOffset = sidebarWidth + sidebarDockWidth + 36;
  const shouldAutoCloseSidebar = width < 720;

  // 这一组状态负责驱动大厅的核心视图：当前空间、动态列表、侧栏和弹层。
  const [hydrating, setHydrating] = useState(true);
  const [activeSpaceCode, setActiveSpaceCode] = useState(normalizedInitialCode);
  const [currentSpace, setCurrentSpace] = useState<SpaceData | null>(null);
  const [dbPosts, setDbPosts] = useState<FeedPost[]>([]);
  const [joinedSpaces, setJoinedSpaces] = useState<JoinedSpaceSummary[]>([]);
  const [currentProfile, setCurrentProfile] = useState<UserProfileData | null>(
    null,
  );
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [compactHeaderVisible, setCompactHeaderVisible] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [composerVisible, setComposerVisible] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [publishingPost, setPublishingPost] = useState(false);
  const [syncingSpace, setSyncingSpace] = useState(false);
  const [updatingPostId, setUpdatingPostId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<FeedPostImage | null>(null);
  const [savingPreview, setSavingPreview] = useState(false);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const [postText, setPostText] = useState("");
  const [selectedImageUris, setSelectedImageUris] = useState<string[]>([]);
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>(
    {},
  );
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createNameInput, setCreateNameInput] = useState("");
  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const [joinTokenInput, setJoinTokenInput] = useState("");
  const [createdCodeVisible, setCreatedCodeVisible] = useState(false);
  const [createdSpaceCode, setCreatedSpaceCode] = useState("");
  const [shareCodeVisible, setShareCodeVisible] = useState(false);

  // 这一组 ref 主要给动画、滚动阈值和评论输入焦点管理使用。
  const currentProfileRef = useRef<UserProfileData | null>(null);
  const sidebarProgress = useRef(new Animated.Value(0)).current;
  const scrollY = useRef(new Animated.Value(0)).current;
  const feedScrollRef = useRef<ScrollableFeedHandle | null>(null);
  const activeSpaceCodeRef = useRef(normalizedInitialCode);
  const compactHeaderVisibleRef = useRef(false);
  const feedSectionStartRef = useRef(240);
  const feedScrollOffsetRef = useRef(0);
  const keyboardHeightRef = useRef(0);
  const focusedCommentPostIdRef = useRef<string | null>(null);
  const commentInputRefs = useRef<
    Record<string, ComponentRef<typeof TextInput> | null>
  >({});

  useEffect(() => {
    activeSpaceCodeRef.current = activeSpaceCode;
  }, [activeSpaceCode]);

  useEffect(() => {
    currentProfileRef.current = currentProfile;
  }, [currentProfile]);

  useEffect(() => {
    compactHeaderVisibleRef.current = false;
    feedSectionStartRef.current = 240;
    setCompactHeaderVisible(false);
    scrollY.setValue(0);
  }, [activeSpaceCode, scrollY]);

  useEffect(() => {
    Animated.spring(sidebarProgress, {
      toValue: sidebarVisible ? 1 : 0,
      useNativeDriver: true,
      damping: 22,
      stiffness: 240,
      mass: 0.9,
    }).start();
  }, [sidebarProgress, sidebarVisible]);

  const ensureCommentInputVisible = useCallback(
    (postId: string) => {
      const input = commentInputRefs.current[postId];
      if (!input?.measureInWindow) {
        return;
      }

      const delay = Platform.OS === "android" ? 180 : 90;
      setTimeout(() => {
        input.measureInWindow((_x, y, _width, inputHeight) => {
          const keyboardHeight = keyboardHeightRef.current;
          if (keyboardHeight <= 0) {
            return;
          }

          const safeGap = 18;
          const visibleBottom = height - keyboardHeight - safeGap;
          const inputBottom = y + inputHeight;
          if (inputBottom <= visibleBottom) {
            return;
          }

          const delta = inputBottom - visibleBottom + 14;
          feedScrollRef.current?.scrollTo?.({
            y: Math.max(feedScrollOffsetRef.current + delta, 0),
            animated: true,
          });
        });
      }, delay);
    },
    [height],
  );

  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      keyboardHeightRef.current = event.endCoordinates.height;
      if (focusedCommentPostIdRef.current) {
        ensureCommentInputVisible(focusedCommentPostIdRef.current);
      }
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      keyboardHeightRef.current = 0;
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [ensureCommentInputVisible]);

  // loadDbPosts 会把 posts / photos / comments 三张表重新拼装成大厅动态流。
  const loadDbPosts = useCallback(async (spaceId: string) => {
    const postCollection = database.collections.get<Post>("posts");
    const photoCollection = database.collections.get<Photo>("photos");
    const commentCollection = database.collections.get<Comment>("comments");

    const [posts, photos, comments] = await Promise.all([
      postCollection
        .query(Q.where("space_id", spaceId), Q.sortBy("created_at", Q.desc))
        .fetch(),
      photoCollection
        .query(Q.where("space_id", spaceId), Q.sortBy("shoted_at", Q.asc))
        .fetch(),
      commentCollection
        .query(Q.where("space_id", spaceId), Q.sortBy("commented_at", Q.asc))
        .fetch(),
    ]);

    const activePostIds = new Set(posts.map((item) => item.id));
    const photoMap = new Map<string, FeedPostImage[]>();
    const resolvedPhotos = await Promise.all(
      photos.map(async (item) => ({
        item,
        uri: await resolveRenderablePhotoUri(
          item.localUri || "",
          item.remoteUrl || "",
        ),
      })),
    );
    resolvedPhotos.forEach(({ item, uri }) => {
      if (!item.postId || !activePostIds.has(item.postId) || !uri) {
        return;
      }
      const list = photoMap.get(item.postId) ?? [];
      list.push({
        id: item.id,
        postId: item.postId,
        uploaderId: item.uploaderId || "",
        uri,
      });
      photoMap.set(item.postId, list);
    });

    const commentMap = new Map<string, FeedComment[]>();
    comments.forEach((item) => {
      if (!item.postId || !activePostIds.has(item.postId)) {
        return;
      }
      const list = commentMap.get(item.postId) ?? [];
      list.push({
        id: item.id,
        commenterId: item.commenterId || "",
        text: item.content || "",
        createdAt: dateToTimestamp(item.commentedAt),
      });
      commentMap.set(item.postId, list);
    });

    setDbPosts(
      posts
        .filter((item) => (photoMap.get(item.id) ?? []).length > 0)
        .map((item) => {
          const postCreatedAt = dateToTimestamp(item.createdAt);
          const postImages = photoMap.get(item.id) ?? [];
          const rawComments = [...(commentMap.get(item.id) ?? [])].sort(
            (left, right) => left.createdAt - right.createdAt,
          );
          const captionIndex = rawComments.findIndex(
            (comment) => Math.abs(comment.createdAt - postCreatedAt) <= 1_000,
          );
          const captionComment =
            captionIndex >= 0 ? rawComments[captionIndex] : null;

          return {
            id: item.id,
            authorId:
              captionComment?.commenterId ||
              postImages[0]?.uploaderId ||
              rawComments[0]?.commenterId ||
              "",
            caption: captionComment?.text || "",
            images: postImages,
            createdAt: postCreatedAt,
            comments: rawComments.filter((_, index) => index !== captionIndex),
          };
        }),
    );
  }, []);

  // loadSpaceSnapshot 负责切换空间时准备本地展示数据，并刷新最近使用空间记忆。
  const loadSpaceSnapshot = useCallback(
    async (spaceCode: string, profile?: UserProfileData | null) => {
      const nextSpace = spaceCode
        ? await getSpaceSnapshotFromDb(
            spaceCode,
            profile ?? currentProfileRef.current,
          )
        : null;
      setCurrentSpace(nextSpace);
      if (!nextSpace) {
        setDbPosts([]);
        await clearLastSpaceCode();
        return;
      }
      await loadDbPosts(nextSpace.id);
      await saveLastSpaceCode(nextSpace.code);
    },
    [loadDbPosts],
  );

  const refreshWorkspace = useCallback(
    async (preferredCode?: string) => {
      setHydrating(true);
      try {
        const profile =
          (await ensureCurrentUserProfileInDb()) ??
          (await getCurrentUserProfileFromDb());
        setCurrentProfile(profile);
        const nextJoinedSpaces = await listJoinedSpacesFromDb(profile.id);
        setJoinedSpaces(nextJoinedSpaces);

        const preferred = normalizeSpaceCode(preferredCode);
        const remembered = preferred ? "" : await readLastSpaceCode();
        const joinedCodeSet = new Set(
          nextJoinedSpaces.map((item) => item.code),
        );
        const candidate =
          preferred ||
          normalizeSpaceCode(activeSpaceCodeRef.current) ||
          normalizeSpaceCode(remembered);
        const resolvedCode =
          candidate && joinedCodeSet.has(candidate)
            ? candidate
            : (nextJoinedSpaces[0]?.code ?? "");

        activeSpaceCodeRef.current = resolvedCode;
        setActiveSpaceCode(resolvedCode);

        if (!resolvedCode) {
          setCurrentSpace(null);
          setDbPosts([]);
          await clearLastSpaceCode();
          return;
        }

        await loadSpaceSnapshot(resolvedCode, profile);
      } finally {
        setHydrating(false);
      }
    },
    [loadSpaceSnapshot],
  );

  useFocusEffect(
    useCallback(() => {
      void refreshWorkspace();
    }, [refreshWorkspace]),
  );

  useEffect(() => {
    if (!normalizedInitialCode) {
      return;
    }
    if (normalizedInitialCode === activeSpaceCodeRef.current) {
      return;
    }
    void refreshWorkspace(normalizedInitialCode);
  }, [normalizedInitialCode, refreshWorkspace]);

  const currentUserId = currentProfile?.id ?? "";
  const currentUserName = currentProfile?.nickname || "空间用户";

  const ensureActiveProfile = useCallback(async () => {
    const profile =
      currentProfile ??
      (await ensureCurrentUserProfileInDb()) ??
      (await getCurrentUserProfileFromDb());
    if (!currentProfile) {
      setCurrentProfile(profile);
    }
    return profile;
  }, [currentProfile]);

  const sidebarTranslateX = sidebarProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-sidebarHiddenOffset, 0],
  });
  const sidebarOpacity = sidebarProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.22, 1],
  });
  const sidebarOverlayOpacity = sidebarProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const workspaceDimOpacity = sidebarProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, shouldAutoCloseSidebar ? 0.18 : 0.1],
  });
  const compactHeaderOpacity = scrollY.interpolate({
    inputRange: [48, 112],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });
  const compactHeaderTranslateY = scrollY.interpolate({
    inputRange: [48, 112],
    outputRange: [-10, 0],
    extrapolate: "clamp",
  });

  const users = useMemo(() => {
    const map = new Map<string, { nickname: string; avatarUrl: string }>();
    for (const user of currentSpace?.users ?? []) {
      map.set(user.id, {
        nickname: user.nickname,
        avatarUrl: "",
      });
    }
    if (currentUserId) {
      map.set(currentUserId, {
        nickname: currentUserName,
        avatarUrl: "",
      });
    }
    return map;
  }, [currentSpace, currentUserId, currentUserName]);

  const activeMembers = useMemo(() => {
    if (!currentSpace) {
      return [];
    }
    return currentSpace.spaceMembers.map((item) => {
      const profile = users.get(item.user_id);
      return {
        id: item.user_id,
        nickname: profile?.nickname || "成员",
        avatarUrl: profile?.avatarUrl || "",
      };
    });
  }, [currentSpace, users]);

  const editingPost = useMemo(() => {
    if (!editingPostId) {
      return null;
    }
    return dbPosts.find((item) => item.id === editingPostId) ?? null;
  }, [dbPosts, editingPostId]);

  const profileName = currentUserName;
  const profileAvatarUri = "";

  const activateSpace = useCallback(
    async (spaceCode: string) => {
      const nextCode = normalizeSpaceCode(spaceCode);
      if (!nextCode) {
        return;
      }
      setMenuOpen(false);
      setSidebarVisible(false);
      activeSpaceCodeRef.current = nextCode;
      setActiveSpaceCode(nextCode);
      await refreshWorkspace(nextCode);
    },
    [refreshWorkspace],
  );

  const pickImageUrisFromAlbum = async () => {
    const imagePicker = getImagePickerModule();
    if (!imagePicker) {
      Alert.alert(
        "相册不可用",
        "当前构建未包含选图模块，请重新构建开发客户端。",
      );
      return [] as string[];
    }

    try {
      const result = await imagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        allowsMultipleSelection: true,
        quality: 1,
        selectionLimit: 9,
      });
      if (result.canceled) {
        return [] as string[];
      }
      return result.assets
        .map((asset: { uri: string }) => asset.uri)
        .filter(Boolean);
    } catch (error) {
      Alert.alert("选择图片失败", String(error));
      return [] as string[];
    }
  };

  const pickImagesForComposer = async () => {
    const uris = await pickImageUrisFromAlbum();
    if (uris.length === 0) {
      return;
    }
    setSelectedImageUris((prev) => Array.from(new Set([...prev, ...uris])));
  };

  const removeSelectedImage = (uri: string) => {
    setSelectedImageUris((prev) => prev.filter((item) => item !== uri));
  };

  const openComposer = () => {
    setMenuOpen(false);
    setComposerVisible(true);
  };

  const openCreateSpaceDialog = () => {
    const suggestedName = buildDefaultSpaceName(currentUserName);
    setCreateNameInput((current) => current || suggestedName);
    setCreateModalVisible(true);
  };

  const onPublishPost = async () => {
    if (!currentSpace || publishingPost) {
      return;
    }

    const activeProfile = await ensureActiveProfile();

    const cleanText = postText.trim();
    const mergedInputUris = Array.from(new Set(selectedImageUris));
    if (mergedInputUris.length === 0) {
      Alert.alert("发布失败", "动态至少需要一张图片。");
      return;
    }

    setPublishingPost(true);
    try {
      const createdAt = nowTimestamp();
      const postId = createUlid();
      const preparedImages = await Promise.all(
        mergedInputUris.map(async (uri, index) => {
          const photoId = createUlid();
          const localPath = await saveImageToAppRelativePath(
            uri,
            `photos/${photoId}.jpg`,
          );
          return {
            id: photoId,
            localUri: localPath,
            remoteUrl: isRemoteImageUri(uri) ? uri : "",
            shotedAt: createdAt + index,
          };
        }),
      );

      await database.write(async () => {
        const postCollection = database.collections.get<Post>("posts");
        const photoCollection = database.collections.get<Photo>("photos");
        const commentCollection = database.collections.get<Comment>("comments");

        await postCollection.create((post) => {
          assignModelId(post, postId);
          post.spaceId = currentSpace.id;
          assignTimestamps(post, createdAt, createdAt);
        });

        for (const image of preparedImages) {
          await photoCollection.create((photo) => {
            assignModelId(photo, image.id);
            photo.spaceId = currentSpace.id;
            photo.postId = postId;
            photo.uploaderId = activeProfile.id;
            photo.localUri = image.localUri;
            photo.remoteUrl = image.remoteUrl;
            photo.shotedAt = new Date(image.shotedAt);
            assignTimestamps(photo, image.shotedAt, image.shotedAt);
          });
        }

        if (cleanText) {
          await commentCollection.create((item) => {
            assignModelId(item, createUlid());
            item.spaceId = currentSpace.id;
            item.content = cleanText;
            item.commenterId = activeProfile.id;
            item.postId = postId;
            item.commentedAt = new Date(createdAt);
            assignTimestamps(item, createdAt, createdAt);
          });
        }
      });

      await loadDbPosts(currentSpace.id);
      setPostText("");
      setSelectedImageUris([]);
      setComposerVisible(false);
    } catch (error) {
      Alert.alert("发布动态失败", String(error));
    } finally {
      setPublishingPost(false);
    }
  };

  const onAddImagesToPost = async (postId: string) => {
    if (!currentSpace || updatingPostId) {
      return;
    }

    const activeProfile = await ensureActiveProfile();

    const uris = Array.from(new Set(await pickImageUrisFromAlbum()));
    if (uris.length === 0) {
      return;
    }

    setUpdatingPostId(postId);
    try {
      const createdAt = nowTimestamp();
      const preparedImages = await Promise.all(
        uris.map(async (uri, index) => {
          const photoId = createUlid();
          const localPath = await saveImageToAppRelativePath(
            uri,
            `photos/${photoId}.jpg`,
          );
          return {
            id: photoId,
            localUri: localPath,
            remoteUrl: isRemoteImageUri(uri) ? uri : "",
            shotedAt: createdAt + index,
          };
        }),
      );

      await database.write(async () => {
        const photoCollection = database.collections.get<Photo>("photos");
        for (const image of preparedImages) {
          await photoCollection.create((photo) => {
            assignModelId(photo, image.id);
            photo.spaceId = currentSpace.id;
            photo.postId = postId;
            photo.uploaderId = activeProfile.id;
            photo.localUri = image.localUri;
            photo.remoteUrl = image.remoteUrl;
            photo.shotedAt = new Date(image.shotedAt);
            assignTimestamps(photo, image.shotedAt, image.shotedAt);
          });
        }
      });

      await loadDbPosts(currentSpace.id);
    } catch (error) {
      Alert.alert("添加图片失败", String(error));
    } finally {
      setUpdatingPostId((current) => (current === postId ? null : current));
    }
  };

  const removePostImage = async (image: FeedPostImage) => {
    if (!currentSpace) {
      return;
    }

    setDeletingImageId(image.id);
    try {
      await database.write(async () => {
        const photoCollection = database.collections.get<Photo>("photos");
        const record = await photoCollection.find(image.id);
        await record.markAsDeleted();
      });
      setPreviewImage((current) => (current?.id === image.id ? null : current));
      await loadDbPosts(currentSpace.id);
    } catch (error) {
      Alert.alert("删除图片失败", String(error));
    } finally {
      setDeletingImageId((current) => (current === image.id ? null : current));
    }
  };

  const onDeletePostImage = (image: FeedPostImage, imageCount: number) => {
    if (imageCount <= 1) {
      Alert.alert("暂时不能删除", "当前动态至少需要保留一张图片。");
      return;
    }

    Alert.alert("删除图片", "删除后空间成员将看不到这张图片，确定继续吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => {
          void removePostImage(image);
        },
      },
    ]);
  };

  const onComment = async (postId: string) => {
    if (!currentSpace) {
      return;
    }

    const activeProfile = await ensureActiveProfile();

    const content = (commentInputs[postId] ?? "").trim();
    if (!content) {
      Alert.alert("评论失败", "请输入评论内容。");
      return;
    }

    commentInputRefs.current[postId]?.blur?.();
    Keyboard.dismiss();

    const commentedAt = nowTimestamp();
    await database.write(async () => {
      const collection = database.collections.get<Comment>("comments");
      await collection.create((item) => {
        assignModelId(item, createUlid());
        item.spaceId = currentSpace.id;
        item.content = content;
        item.commenterId = activeProfile.id;
        item.postId = postId;
        item.commentedAt = new Date(commentedAt);
        assignTimestamps(item, commentedAt, commentedAt);
      });
    });

    setCommentInputs((prev) => ({ ...prev, [postId]: "" }));
    await loadDbPosts(currentSpace.id);
  };

  const onSavePreviewImage = async () => {
    if (!previewImage) {
      return;
    }
    setSavingPreview(true);
    try {
      await saveImageToAlbum(previewImage.uri, "travel-saved-images");
      Alert.alert("保存成功", "图片已经保存到系统相册。");
    } catch (error) {
      Alert.alert("保存失败", String(error));
    } finally {
      setSavingPreview(false);
    }
  };

  const onCreateSpace = async () => {
    const nextSpaceName = clampSpaceNameInput(createNameInput);
    if (!nextSpaceName) {
      Alert.alert("创建失败", "请输入空间名称。");
      return;
    }

    try {
      const profile = await ensureActiveProfile();
      const nextSpaceId = createUlid();

      await createSpaceLocally({
        userId: profile.id,
        spaceId: nextSpaceId,
        name: nextSpaceName,
      });

      setCreateModalVisible(false);
      setCreateNameInput("");
      setCreatedSpaceCode(formatSharedSpaceToken(nextSpaceName, nextSpaceId));
      setCreatedCodeVisible(true);
      await activateSpace(nextSpaceId);
    } catch (error) {
      Alert.alert("创建失败", String(error));
    }
  };

  const onJoinSpace = async () => {
    const parsedToken = parseSharedSpaceToken(joinTokenInput);
    const nextSpaceId = parsedToken?.id ?? "";
    const nextSpaceName = parsedToken?.name ?? "";
    if (!nextSpaceId) {
      Alert.alert("加入失败", "请输入好友分享给你的空间口令。");
      return;
    }
    if (!isUlid(nextSpaceId)) {
      Alert.alert("加入失败", "分享口令里的 ID号 必须是 26 位 ULID。");
      return;
    }
    if (!nextSpaceName) {
      Alert.alert("加入失败", "请按“空间名_ID号”的格式输入分享口令。");
      return;
    }

    if (await isSpaceDisbanded(nextSpaceId)) {
      Alert.alert("加入失败", "该空间已解散。");
      return;
    }

    const alreadyJoined = joinedSpaces.some(
      (item) => item.id === nextSpaceId || item.code === nextSpaceId,
    );
    if (alreadyJoined) {
      Alert.alert("加入失败", "该空间已加入。");
      return;
    }

    try {
      const profile = await ensureActiveProfile();
      await createSpaceLocally({
        userId: profile.id,
        spaceId: nextSpaceId,
        name: nextSpaceName,
      });

      setJoinModalVisible(false);
      setJoinTokenInput("");
      await activateSpace(nextSpaceId);
    } catch (error) {
      Alert.alert("加入失败", String(error));
    }
  };

  const onLeaveSpace = async () => {
    if (!currentSpace) {
      return;
    }
    const profile = await ensureActiveProfile();
    setMenuOpen(false);
    const ok = await leaveSpaceLocally(currentSpace.id, profile.id);
    if (!ok) {
      Alert.alert("退出失败", "没有找到当前空间里的本地成员关系。");
      return;
    }
    setSidebarVisible(false);
    void refreshWorkspace();
  };

  const onDisbandSpace = async () => {
    if (!currentSpace) {
      return;
    }
    setMenuOpen(false);
    const ok = await disbandSpaceLocally(currentSpace.id);
    if (!ok) {
      Alert.alert("解散失败", "没有找到当前空间。");
      return;
    }
    setSidebarVisible(false);
    void refreshWorkspace();
  };

  const openBookkeeping = () => {
    if (!activeSpaceCodeRef.current) {
      return;
    }
    setMenuOpen(false);
    router.push({
      pathname: "/bookkeeping",
      params: { code: activeSpaceCodeRef.current },
    });
  };

  const openLocation = () => {
    if (!activeSpaceCodeRef.current) {
      return;
    }
    setMenuOpen(false);
    router.push({
      pathname: "/location",
      params: { code: activeSpaceCodeRef.current },
    });
  };

  const onSyncCurrentSpace = async () => {
    if (!currentSpace || syncingSpace) {
      return;
    }

    const profile = await ensureActiveProfile();
    setSyncingSpace(true);
    try {
      await syncSpace({ userId: profile.id, spaceId: currentSpace.id });
      await refreshWorkspace(currentSpace.id);
      Alert.alert("同步完成", "当前空间的本地数据已经完成一次同步。");
    } catch (error) {
      console.log(error);
      Alert.alert(
        "同步失败",
        `${String(error)}\n\n请确认本地服务端已经启动，并且 EXPO_PUBLIC_API_URL 配置正确。`,
      );
    } finally {
      setSyncingSpace(false);
    }
  };

  const copySpaceCode = useCallback(async (shareToken: string) => {
    if (!shareToken) {
      return;
    }
    const clipboard = getClipboardModule();
    if (!clipboard) {
      Alert.alert(
        "无法复制",
        "当前环境暂不支持复制，请手动记下这个分享口令：空间名_ID号。",
      );
      return;
    }
    try {
      await clipboard.setStringAsync(shareToken);
      Alert.alert(
        "已复制",
        "分享口令已复制。把“空间名_ID号”发给好友，对方粘贴后就能加入空间。",
      );
    } catch {
      Alert.alert("复制失败", "这次没有复制成功，请稍后再试。");
    }
  }, []);

  const openShareDialog = () => {
    if (!currentSpace) {
      return;
    }
    setMenuOpen(false);
    setShareCodeVisible(true);
  };

  const actionMenuItems = [
    {
      key: "share",
      label: "分享空间",
      description: "复制“空间名_ID号”发给好友",
      icon: "copy-outline" as const,
      onPress: openShareDialog,
    },
    {
      key: "bookkeeping",
      description: "管理共同开销和账单",
      label: "空间记账",
      icon: "wallet-outline" as const,
      onPress: openBookkeeping,
    },
    {
      key: "location",
      description: "查看成员实时位置",
      label: "位置共享",
      icon: "navigate-outline" as const,
      onPress: openLocation,
    },
    {
      key: "leave",
      description: "离开此共享空间",
      label: "退出空间",
      icon: "log-out-outline" as const,
      tone: "warn" as const,
      onPress: onLeaveSpace,
    },
    {
      key: "disband",
      description: "永久删除此空间",
      label: "解散空间",
      icon: "trash-outline" as const,
      danger: true,
      onPress: onDisbandSpace,
    },
  ];

  const onFeedScroll = useCallback(
    (event: { nativeEvent: { contentOffset: { y: number } } }) => {
      const nextVisible =
        !!currentSpace &&
        event.nativeEvent.contentOffset.y >= feedSectionStartRef.current;
      if (compactHeaderVisibleRef.current !== nextVisible) {
        compactHeaderVisibleRef.current = nextVisible;
        setCompactHeaderVisible(nextVisible);
      }
    },
    [currentSpace],
  );

  const onFeedScrollNative = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      feedScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
      onFeedScroll({
        nativeEvent: {
          contentOffset: {
            y: event.nativeEvent.contentOffset.y,
          },
        },
      });
    },
    [onFeedScroll],
  );

  const renderWorkspaceActions = (compact: boolean) =>
    compact ? (
      <View
        style={[
          styles.headerActionRow,
          compact && styles.headerActionRowCompact,
        ]}
      >
        <Pressable
          style={[
            styles.headerActionButtonCompact,
            styles.headerActionButtonCompactPrimary,
          ]}
          onPress={openComposer}
        >
          <Ionicons name="add" size={16} color={workspaceTheme.iconOnAccent} />
          <Text
            style={[
              styles.headerActionButtonCompactText,
              styles.headerActionButtonCompactTextPrimary,
            ]}
          >
            发布
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.headerActionButtonCompact,
            styles.headerActionButtonCompactSecondary,
          ]}
          onPress={() => setMenuOpen(true)}
        >
          <Ionicons
            name="settings-outline"
            size={16}
            color={workspaceTheme.icon}
          />
          <Text
            style={[
              styles.headerActionButtonCompactText,
              styles.headerActionButtonCompactTextSecondary,
            ]}
          >
            菜单
          </Text>
        </Pressable>
      </View>
    ) : (
      <View style={styles.heroActionRow}>
        <Pressable style={styles.heroPrimaryAction} onPress={openComposer}>
          <Ionicons name="add" size={18} color={workspaceTheme.iconOnAccent} />
          <Text style={styles.heroPrimaryActionText}>发布动态</Text>
        </Pressable>
        <Pressable
          style={[
            styles.heroSecondaryAction,
            syncingSpace && styles.actionButtonDisabled,
          ]}
          onPress={() => void onSyncCurrentSpace()}
          disabled={syncingSpace}
        >
          <Ionicons name="sync-outline" size={18} color={workspaceTheme.icon} />
          <Text style={styles.heroSecondaryActionText}>
            {syncingSpace ? "同步中" : "同步信息"}
          </Text>
        </Pressable>
        <Pressable
          style={styles.heroSecondaryAction}
          onPress={() => setMenuOpen(true)}
        >
          <Ionicons
            name="settings-outline"
            size={18}
            color={workspaceTheme.icon}
          />
          <Text style={styles.heroSecondaryActionText}>菜单</Text>
        </Pressable>
      </View>
    );

  const heroTitleStyle = useMemo(() => {
    const currentNameLength = Array.from(currentSpace?.name ?? "").length;
    if (currentNameLength >= 8) {
      return styles.spaceHeroTitleCompact;
    }
    if (currentNameLength >= 6) {
      return styles.spaceHeroTitleMedium;
    }
    return null;
  }, [currentSpace?.name]);

  const emptyStateTitle = joinedSpaces.length
    ? "空间正在准备中"
    : "从这里开始你的空间";
  const emptyStateDescription = joinedSpaces.length
    ? "我们正在同步最近一次使用的空间内容。"
    : "你还没有加入任何空间，可以先创建一个，或者通过“空间名_ID号”加入已有空间。";

  const onFeedSectionLayout = useCallback(
    (event: { nativeEvent: { layout: { y: number } } }) => {
      feedSectionStartRef.current = Math.max(
        event.nativeEvent.layout.y - 20,
        140,
      );
    },
    [],
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={styles.backgroundOrbTop} />
        <View style={styles.backgroundOrbBottom} />

        <View style={styles.workspaceLayer}>
          <KeyboardAvoidingView
            style={styles.workspaceKeyboard}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <View
              style={styles.workspaceCard}
              pointerEvents={sidebarVisible ? "none" : "auto"}
            >
              {currentSpace ? (
                <Animated.View
                  pointerEvents={compactHeaderVisible ? "auto" : "none"}
                  style={[
                    styles.compactHeader,
                    {
                      opacity: compactHeaderOpacity,
                      transform: [{ translateY: compactHeaderTranslateY }],
                    },
                  ]}
                >
                  <View style={styles.compactHeaderContent}>
                    <Text
                      style={styles.compactHeaderTitle}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                    >
                      {currentSpace.name}
                    </Text>
                    {renderWorkspaceActions(true)}
                  </View>
                </Animated.View>
              ) : null}

              <Animated.ScrollView
                key={currentSpace?.code ?? "empty-space"}
                ref={(node) => {
                  feedScrollRef.current =
                    (node as unknown as ScrollableFeedHandle | null) ?? null;
                }}
                style={styles.feedScroll}
                contentContainerStyle={styles.feedContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                scrollEnabled={!sidebarVisible}
                scrollEventThrottle={16}
                onScroll={Animated.event(
                  [{ nativeEvent: { contentOffset: { y: scrollY } } }],
                  {
                    useNativeDriver: true,
                    listener: onFeedScrollNative,
                  },
                )}
              >
                {currentSpace ? (
                  <View style={styles.spaceHero}>
                    <View style={styles.spaceHeroHeaderBlock}>
                      <View style={styles.spaceHeroInfo}>
                        <View style={styles.spaceTitleInlineRow}>
                          <Text
                            style={[styles.spaceHeroTitle, heroTitleStyle]}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.64}
                          >
                            {currentSpace.name}
                          </Text>
                        </View>
                        <Text style={styles.spaceHeroSubtitle}>
                          共享空间 · {activeMembers.length}位成员
                        </Text>
                      </View>
                    </View>

                    <View style={styles.heroMemberSection}>
                      <Text style={styles.memberLabel}>成员</Text>
                      <View style={styles.memberStack}>
                        {activeMembers.slice(0, 8).map((member, index) => (
                          <View
                            key={member.id}
                            style={[
                              styles.memberAvatarWrap,
                              { marginLeft: index === 0 ? 0 : -10 },
                            ]}
                          >
                            <UserAvatar
                              uri={member.avatarUrl}
                              name={member.nickname}
                              size={34}
                              textSize={13}
                            />
                          </View>
                        ))}
                      </View>
                    </View>

                    {renderWorkspaceActions(false)}
                  </View>
                ) : null}

                {hydrating ? (
                  <View style={styles.heroEmptyCard}>
                    <Text style={styles.heroEmptyTitle}>正在打开空间</Text>
                    <Text style={styles.heroEmptyText}>
                      我们正在同步最近一次使用的空间内容。
                    </Text>
                  </View>
                ) : null}

                {!hydrating && !currentSpace ? (
                  <View style={styles.heroEmptyCard}>
                    <SoftIconBadge
                      name="albums-outline"
                      tone="sky"
                      size={56}
                      iconSize={24}
                    />
                    <Text style={styles.heroEmptyTitle}>{emptyStateTitle}</Text>
                    <Text style={styles.heroEmptyText}>
                      {emptyStateDescription}
                    </Text>
                    <View style={styles.emptyActionRow}>
                      <Pressable
                        style={styles.emptyPrimaryButton}
                        onPress={openCreateSpaceDialog}
                      >
                        <Text style={styles.emptyPrimaryButtonText}>
                          创建空间
                        </Text>
                      </Pressable>
                      <Pressable
                        style={styles.emptyGhostButton}
                        onPress={() => setJoinModalVisible(true)}
                      >
                        <Text style={styles.emptyGhostButtonText}>
                          加入空间
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {!hydrating && currentSpace ? (
                  <View onLayout={onFeedSectionLayout}>
                    {dbPosts.length === 0 ? (
                      <View style={styles.heroEmptyCard}>
                        <Text style={styles.heroEmptyTitle}>还没有动态</Text>
                        <Text style={styles.heroEmptyText}>
                          点击上方的发布动态按钮，发出这个空间的第一条动态。
                        </Text>
                      </View>
                    ) : null}

                    {dbPosts.map((post) => {
                      const author = users.get(post.authorId);
                      const authorName = author?.nickname || "成员";
                      const authorAvatar = author?.avatarUrl;

                      return (
                        <View key={post.id} style={styles.postCard}>
                          <View style={styles.postHeader}>
                            <View style={styles.postAuthorWrap}>
                              <UserAvatar
                                uri={authorAvatar}
                                name={authorName}
                                size={40}
                                textSize={15}
                              />
                              <View style={styles.postAuthorTextWrap}>
                                <Text style={styles.postAuthor}>
                                  {authorName}
                                </Text>
                                <Text style={styles.postMeta}>
                                  {formatFeedTime(post.createdAt)}
                                </Text>
                              </View>
                            </View>

                            <Pressable
                              style={styles.postEditButton}
                              onPress={() => setEditingPostId(post.id)}
                            >
                              <Ionicons
                                name="create-outline"
                                size={14}
                                color={workspaceTheme.icon}
                              />
                              <Text style={styles.postEditButtonText}>
                                编辑
                              </Text>
                            </Pressable>
                          </View>

                          {post.caption ? (
                            <Text style={styles.postText}>{post.caption}</Text>
                          ) : null}

                          {post.images.length > 0 ? (
                            <ScrollView
                              horizontal
                              showsHorizontalScrollIndicator={false}
                              style={styles.postImageRow}
                            >
                              {post.images.map((image, index) => (
                                <Pressable
                                  key={`${post.id}-${image.id}-${index}`}
                                  onPress={() => setPreviewImage(image)}
                                >
                                  <FeedImage uri={image.uri} />
                                </Pressable>
                              ))}
                            </ScrollView>
                          ) : null}

                          <View style={styles.commentList}>
                            {post.comments.length === 0 ? (
                              <Text style={styles.commentEmptyText}>
                                暂无评论
                              </Text>
                            ) : (
                              post.comments.map((comment) => (
                                <View
                                  key={comment.id}
                                  style={styles.commentCard}
                                >
                                  <Text style={styles.commentAuthor}>
                                    {users.get(comment.commenterId)?.nickname ||
                                      "成员"}
                                  </Text>
                                  <Text style={styles.commentText}>
                                    {comment.text}
                                  </Text>
                                </View>
                              ))
                            )}
                          </View>

                          <View style={styles.commentRow}>
                            <TextInput
                              ref={(input) => {
                                commentInputRefs.current[post.id] = input;
                              }}
                              style={styles.commentInput}
                              placeholder="写下你的评论..."
                              placeholderTextColor={workspaceTheme.placeholder}
                              value={commentInputs[post.id] ?? ""}
                              onChangeText={(text) =>
                                setCommentInputs((prev) => ({
                                  ...prev,
                                  [post.id]: text,
                                }))
                              }
                              onFocus={() => {
                                focusedCommentPostIdRef.current = post.id;
                                ensureCommentInputVisible(post.id);
                              }}
                              onBlur={() => {
                                if (
                                  focusedCommentPostIdRef.current === post.id
                                ) {
                                  focusedCommentPostIdRef.current = null;
                                }
                              }}
                              multiline
                              textAlignVertical="top"
                            />
                            <Pressable
                              style={styles.commentButton}
                              onPress={() => void onComment(post.id)}
                            >
                              <Text style={styles.commentButtonText}>发送</Text>
                            </Pressable>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </Animated.ScrollView>

              <Animated.View
                pointerEvents="none"
                style={[
                  styles.workspaceDimLayer,
                  { opacity: workspaceDimOpacity },
                ]}
              />
            </View>
          </KeyboardAvoidingView>

          {sidebarVisible && shouldAutoCloseSidebar ? (
            <Animated.View
              pointerEvents="box-none"
              style={[
                styles.sidebarBackdrop,
                { opacity: sidebarOverlayOpacity },
              ]}
            >
              <Pressable
                style={styles.dialogBackdrop}
                onPress={() => setSidebarVisible(false)}
              />
            </Animated.View>
          ) : null}
        </View>

        <View style={[styles.sidebarDockShell, { width: sidebarDockWidth }]}>
          <Pressable
            style={[
              styles.sidebarDockCard,
              sidebarVisible && styles.sidebarDockCardActive,
            ]}
            onPress={() => setSidebarVisible((value) => !value)}
          >
            <Ionicons
              name={sidebarVisible ? "chevron-back" : "chevron-forward"}
              size={18}
              color={
                sidebarVisible
                  ? workspaceTheme.iconOnAccent
                  : workspaceTheme.icon
              }
            />
            {!sidebarVisible ? (
              <Text style={styles.sidebarDockHint}>个人主页</Text>
            ) : null}
          </Pressable>
        </View>

        <Animated.View
          style={[
            styles.sidebarShell,
            {
              left: 16,
              width: sidebarWidth,
              opacity: sidebarOpacity,
              transform: [{ translateX: sidebarTranslateX }],
            },
          ]}
          pointerEvents={sidebarVisible ? "auto" : "none"}
        >
          <View style={styles.sidebarCard}>
            <View style={styles.sidebarTopBar}>
              <View>
                <Text style={styles.sidebarTopLabel}>空间</Text>
                <Text style={styles.sidebarTopTitle}>空间列表</Text>
              </View>
              <Pressable
                style={styles.sidebarCloseButton}
                onPress={() => setSidebarVisible(false)}
              >
                <Ionicons
                  name="close"
                  size={18}
                  color={workspaceTheme.iconMuted}
                />
              </Pressable>
            </View>

            <Pressable
              style={styles.sidebarProfileCard}
              onPress={() => router.push("/profile")}
            >
              <UserAvatar
                uri={profileAvatarUri}
                name={profileName}
                size={54}
                textSize={18}
              />
              <View style={styles.sidebarProfileTextWrap}>
                <Text style={styles.sidebarProfileName}>{profileName}</Text>
                <Text style={styles.sidebarProfileSubText}>
                  点击进入个人资料页
                </Text>
              </View>
            </Pressable>

            <View style={styles.sidebarSectionHeader}>
              <Text style={styles.sidebarSectionTitle}>空间列表</Text>
              <Text style={styles.sidebarSectionSubText}>
                {joinedSpaces.length} 个
              </Text>
            </View>

            <ScrollView
              style={styles.sidebarSpaceList}
              contentContainerStyle={styles.sidebarSpaceListContent}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
            >
              {joinedSpaces.length === 0 ? (
                <View style={styles.sidebarEmptyCard}>
                  <Text style={styles.sidebarEmptyText}>
                    这里会显示你已经加入的所有空间。
                  </Text>
                </View>
              ) : (
                joinedSpaces.map((item) => {
                  const active = item.code === activeSpaceCode;
                  return (
                    <Pressable
                      key={item.id}
                      style={[
                        styles.sidebarSpaceCard,
                        active && styles.sidebarSpaceCardActive,
                      ]}
                      onPress={() => void activateSpace(item.code)}
                    >
                      <View style={styles.sidebarSpaceTopRow}>
                        <Text
                          style={[
                            styles.sidebarSpaceName,
                            active && styles.sidebarSpaceNameActive,
                          ]}
                          numberOfLines={1}
                        >
                          {item.name}
                        </Text>
                        {active ? (
                          <View style={styles.sidebarSpaceActiveDot} />
                        ) : null}
                      </View>
                      <Text
                        style={[
                          styles.sidebarSpaceCode,
                          active && styles.sidebarSpaceCodeActive,
                        ]}
                        numberOfLines={1}
                      >
                        {formatSharedSpaceToken(item.name, item.code)}
                      </Text>
                      <Text
                        style={[
                          styles.sidebarSpaceMeta,
                          active && styles.sidebarSpaceMetaActive,
                        ]}
                      >
                        {item.memberCount} 人 · {item.photoCount} 张图
                      </Text>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>

            <View style={styles.sidebarBottomActions}>
              <Pressable
                style={styles.sidebarCreateButton}
                onPress={openCreateSpaceDialog}
              >
                <Ionicons
                  name="add"
                  size={18}
                  color={workspaceTheme.iconOnAccent}
                />
                <Text style={styles.sidebarCreateButtonText}>创建空间</Text>
              </Pressable>
              <Pressable
                style={styles.sidebarJoinButton}
                onPress={() => setJoinModalVisible(true)}
              >
                <Ionicons
                  name="enter-outline"
                  size={18}
                  color={workspaceTheme.icon}
                />
                <Text style={styles.sidebarJoinButtonText}>加入空间</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </View>

      <CenterDialog
        visible={createModalVisible}
        title="创建空间"
        description="这里会先在本地创建空间，空间名称固定下来；之后是否同步，由你手动决定。"
        onClose={() => setCreateModalVisible(false)}
        footer={
          <View style={styles.dialogActionRow}>
            <Pressable
              style={styles.dialogGhostButton}
              onPress={() => setCreateModalVisible(false)}
            >
              <Text style={styles.dialogGhostButtonText}>取消</Text>
            </Pressable>
            <Pressable
              style={styles.dialogPrimaryButton}
              onPress={() => void onCreateSpace()}
            >
              <Text style={styles.dialogPrimaryButtonText}>创建</Text>
            </Pressable>
          </View>
        }
      >
        <TextInput
          value={createNameInput}
          onChangeText={(value) =>
            setCreateNameInput(clampSpaceNameInput(value))
          }
          placeholder="输入空间名称（最多 8 字）"
          placeholderTextColor={workspaceTheme.placeholder}
          maxLength={8}
          style={styles.dialogInput}
        />
        <Text style={styles.dialogHelperText}>
          请输入最多 8 个字的空间名，创建后名称将固定。
        </Text>
      </CenterDialog>

      <CenterDialog
        visible={shareCodeVisible}
        title="分享空间"
        description="复制下面的分享口令发给好友，让对方粘贴“空间名_ID号”加入当前空间。"
        onClose={() => setShareCodeVisible(false)}
        footer={
          <View style={styles.dialogActionRow}>
            <Pressable
              style={styles.dialogGhostButton}
              onPress={() => setShareCodeVisible(false)}
            >
              <Text style={styles.dialogGhostButtonText}>关闭</Text>
            </Pressable>
            <Pressable
              style={styles.dialogPrimaryButton}
              onPress={() =>
                void copySpaceCode(
                  formatSharedSpaceToken(
                    currentSpace?.name ?? "",
                    currentSpace?.code ?? "",
                  ),
                )
              }
            >
              <Text style={styles.dialogPrimaryButtonText}>复制分享口令</Text>
            </Pressable>
          </View>
        }
      >
        <TextInput
          value={formatSharedSpaceToken(
            currentSpace?.name ?? "",
            currentSpace?.code ?? "",
          )}
          editable={false}
          selectTextOnFocus
          style={[styles.dialogInput, styles.dialogReadonlyInput]}
        />
      </CenterDialog>

      <CenterDialog
        visible={joinModalVisible}
        title="加入空间"
        description="输入朋友分享给你的口令，先在本地加入这个空间；等你点同步时，再和服务器端空间整合。"
        onClose={() => {
          setJoinModalVisible(false);
          setJoinTokenInput("");
        }}
        footer={
          <View style={styles.dialogActionRow}>
            <Pressable
              style={styles.dialogGhostButton}
              onPress={() => {
                setJoinModalVisible(false);
                setJoinTokenInput("");
              }}
            >
              <Text style={styles.dialogGhostButtonText}>取消</Text>
            </Pressable>
            <Pressable
              style={styles.dialogPrimaryButton}
              onPress={() => void onJoinSpace()}
            >
              <Text style={styles.dialogPrimaryButtonText}>加入</Text>
            </Pressable>
          </View>
        }
      >
        <TextInput
          value={joinTokenInput}
          onChangeText={setJoinTokenInput}
          autoCapitalize="characters"
          placeholder="输入分享口令：空间名_ID号"
          placeholderTextColor={workspaceTheme.placeholder}
          maxLength={64}
          style={styles.dialogInput}
        />
        <Text style={styles.dialogHelperText}>
          分享时请原样发送，好友直接粘贴这串口令即可加入。
        </Text>
      </CenterDialog>

      <CenterDialog
        visible={createdCodeVisible}
        title="新空间已创建"
        description="你已经进入新空间，复制下面的分享口令发给好友，让对方粘贴“空间名_ID号”加入空间。"
        onClose={() => setCreatedCodeVisible(false)}
        footer={
          <View style={styles.dialogActionRow}>
            <Pressable
              style={styles.dialogGhostButton}
              onPress={() => void copySpaceCode(createdSpaceCode)}
            >
              <Text style={styles.dialogGhostButtonText}>复制分享口令</Text>
            </Pressable>
            <Pressable
              style={styles.dialogPrimaryButton}
              onPress={() => setCreatedCodeVisible(false)}
            >
              <Text style={styles.dialogPrimaryButtonText}>知道了</Text>
            </Pressable>
          </View>
        }
      >
        <TextInput
          value={createdSpaceCode}
          editable={false}
          selectTextOnFocus
          style={[styles.dialogInput, styles.dialogReadonlyInput]}
        />
      </CenterDialog>

      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <View style={styles.spaceMenuMask}>
          <Pressable
            style={styles.spaceMenuBackdrop}
            onPress={() => setMenuOpen(false)}
          />
          <View style={styles.spaceMenuSheet}>
            <View style={styles.spaceMenuHeader}>
              <Text style={styles.spaceMenuTitle}>空间菜单</Text>
              <Pressable
                style={styles.spaceMenuCloseButton}
                onPress={() => setMenuOpen(false)}
              >
                <Ionicons
                  name="close"
                  size={20}
                  color={workspaceTheme.iconMuted}
                />
              </Pressable>
            </View>

            <View style={styles.spaceMenuList}>
              {actionMenuItems.map((item) => (
                <Pressable
                  key={item.key}
                  style={[
                    styles.spaceMenuItem,
                    item.tone === "warn" && styles.spaceMenuItemWarn,
                    item.danger && styles.spaceMenuItemDanger,
                  ]}
                  onPress={item.onPress}
                >
                  <View
                    style={[
                      styles.spaceMenuIconWrap,
                      item.tone === "warn" && styles.spaceMenuIconWrapWarn,
                      item.danger && styles.spaceMenuIconWrapDanger,
                    ]}
                  >
                    <Ionicons
                      name={item.icon}
                      size={20}
                      color={
                        item.danger
                          ? workspaceTheme.danger
                          : item.tone === "warn"
                            ? "#F97316"
                            : workspaceTheme.icon
                      }
                    />
                  </View>
                  <View style={styles.spaceMenuTextWrap}>
                    <Text
                      style={[
                        styles.spaceMenuItemTitle,
                        item.tone === "warn" && styles.spaceMenuItemTitleWarn,
                        item.danger && styles.spaceMenuItemTitleDanger,
                      ]}
                    >
                      {item.label}
                    </Text>
                    <Text style={styles.spaceMenuItemDescription}>
                      {item.description}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={composerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setComposerVisible(false)}
      >
        <View style={styles.sheetMask}>
          <KeyboardAvoidingView
            style={styles.sheetKeyboardWrap}
            behavior="padding"
            keyboardVerticalOffset={Platform.OS === "ios" ? 18 : 0}
          >
            <View style={[styles.sheetCard, styles.publishSheet]}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>发布动态</Text>
                <Pressable
                  style={styles.sheetCloseButton}
                  onPress={() => setComposerVisible(false)}
                >
                  <Text style={styles.sheetCloseButtonText}>关闭</Text>
                </Pressable>
              </View>

              <ScrollView
                style={styles.sheetBody}
                contentContainerStyle={styles.sheetBodyContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <Pressable
                  style={styles.selectImageButton}
                  onPress={() => void pickImagesForComposer()}
                >
                  <Ionicons
                    name="image-outline"
                    size={18}
                    color={workspaceTheme.icon}
                  />
                  <Text style={styles.selectImageButtonText}>选择图片</Text>
                </Pressable>

                {selectedImageUris.length > 0 ? (
                  <View style={styles.sheetPreviewCard}>
                    <Text style={styles.sheetPreviewTitle}>
                      已选择 {selectedImageUris.length} 张图片
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                    >
                      {selectedImageUris.map((uri, index) => (
                        <View
                          key={`${uri}-${index}`}
                          style={styles.selectedImageCard}
                        >
                          <Pressable
                            onPress={() =>
                              setPreviewImage({
                                id: `draft-${index}`,
                                postId: "draft",
                                uploaderId: currentUserId,
                                uri,
                              })
                            }
                          >
                            <Image
                              source={{ uri }}
                              style={styles.selectedImage}
                              resizeMode="cover"
                            />
                          </Pressable>
                          <Pressable
                            style={styles.selectedImageRemove}
                            onPress={() => removeSelectedImage(uri)}
                          >
                            <Text style={styles.selectedImageRemoveText}>
                              移除
                            </Text>
                          </Pressable>
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                ) : (
                  <View style={styles.sheetEmptyCard}>
                    <Text style={styles.sheetEmptyText}>
                      选好图片后会显示在这里。
                    </Text>
                  </View>
                )}

                <TextInput
                  style={styles.composerInput}
                  placeholder="写一点想分享的内容..."
                  placeholderTextColor={workspaceTheme.placeholder}
                  value={postText}
                  onChangeText={setPostText}
                  multiline
                  textAlignVertical="top"
                />
              </ScrollView>

              <View style={styles.sheetFooter}>
                <Pressable
                  style={[
                    styles.sheetPrimaryButton,
                    publishingPost && styles.disabledButton,
                  ]}
                  disabled={publishingPost}
                  onPress={() => void onPublishPost()}
                >
                  <Text style={styles.sheetPrimaryButtonText}>
                    {publishingPost ? "发布中..." : "发布动态"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal
        visible={!!editingPost}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingPostId(null)}
      >
        <View style={styles.sheetMask}>
          <View style={styles.sheetKeyboardWrap}>
            <View style={[styles.sheetCard, styles.editorSheet]}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>编辑动态图片</Text>
                <Pressable
                  style={styles.sheetCloseButton}
                  onPress={() => setEditingPostId(null)}
                >
                  <Text style={styles.sheetCloseButtonText}>关闭</Text>
                </Pressable>
              </View>

              {editingPost ? (
                <Pressable
                  style={[
                    styles.selectImageButton,
                    updatingPostId === editingPost.id && styles.disabledButton,
                  ]}
                  disabled={updatingPostId === editingPost.id}
                  onPress={() => void onAddImagesToPost(editingPost.id)}
                >
                  <Ionicons name="add" size={18} color={workspaceTheme.icon} />
                  <Text style={styles.selectImageButtonText}>
                    {updatingPostId === editingPost.id
                      ? "添加中..."
                      : "添加图片"}
                  </Text>
                </Pressable>
              ) : null}

              {editingPost?.caption ? (
                <View style={styles.editorCaptionCard}>
                  <Text style={styles.editorCaptionLabel}>
                    这条动态的文字内容
                  </Text>
                  <Text style={styles.editorCaptionText}>
                    {editingPost.caption}
                  </Text>
                </View>
              ) : null}

              {editingPost?.images.length ? (
                <View style={styles.sheetPreviewCard}>
                  <Text style={styles.sheetPreviewTitle}>
                    当前共有 {editingPost.images.length} 张图片
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {editingPost.images.map((image) => (
                      <View key={image.id} style={styles.selectedImageCard}>
                        <Pressable onPress={() => setPreviewImage(image)}>
                          <Image
                            source={{ uri: image.uri }}
                            style={styles.selectedImage}
                            resizeMode="cover"
                          />
                        </Pressable>
                        <Pressable
                          style={[
                            styles.selectedImageRemove,
                            deletingImageId === image.id &&
                              styles.disabledButton,
                          ]}
                          disabled={deletingImageId === image.id}
                          onPress={() =>
                            onDeletePostImage(image, editingPost.images.length)
                          }
                        >
                          <Text style={styles.selectedImageRemoveText}>
                            {deletingImageId === image.id
                              ? "删除中..."
                              : "删除"}
                          </Text>
                        </Pressable>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              ) : (
                <View style={styles.sheetEmptyCard}>
                  <Text style={styles.sheetEmptyText}>当前还没有图片。</Text>
                </View>
              )}
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!previewImage}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewImage(null)}
      >
        <View style={styles.previewMask}>
          <Pressable
            style={styles.previewClose}
            onPress={() => setPreviewImage(null)}
          >
            <Text style={styles.previewCloseText}>关闭</Text>
          </Pressable>
          {previewImage ? (
            <Image
              source={{ uri: previewImage.uri }}
              style={styles.previewImage}
              resizeMode="contain"
            />
          ) : null}
          <View style={styles.previewActionRow}>
            <Pressable
              style={styles.previewSaveButton}
              disabled={savingPreview}
              onPress={() => void onSavePreviewImage()}
            >
              <Text style={styles.previewSaveButtonText}>
                {savingPreview ? "保存中..." : "保存到系统相册"}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

export default SpaceWorkspaceScreen;
