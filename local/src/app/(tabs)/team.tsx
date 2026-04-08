import { Q } from "@nozbe/watermelondb";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SoftIconBadge } from "@/components/SoftIconBadge";
import { database } from "@/model";
import Comment from "@/model/Comment";
import Photo from "@/model/Photo";
import Post from "@/model/Post";
import { createUlid, nowTimestamp } from "@/lib/ids";
import {
  isRemoteImageUri,
  saveImageToAlbum,
  saveImageToLocalDir,
} from "@/lib/imageStorage";
import {
  assignModelId,
  assignTimestamps,
  dateToTimestamp,
} from "@/lib/watermelon";
import { syncMockSpaceToDatabase } from "./dbSync";
import {
  disbandSpaceByCode,
  getCurrentUser,
  getSpaceByCode,
  leaveSpaceByCode,
  type SpaceData,
} from "./mockApp";
import {
  ensureCurrentUserProfileInDb,
  getCurrentUserProfileFromDb,
  type UserProfileData,
} from "./userDb";

type ImagePickerModule = {
  launchImageLibraryAsync: (options: Record<string, unknown>) => Promise<{
    canceled: boolean;
    assets: { uri: string }[];
  }>;
};

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
  posterId: string;
  caption: string;
  images: FeedPostImage[];
  createdAt: number;
  comments: FeedComment[];
};

let imagePickerModuleCache: ImagePickerModule | null | undefined;

// 懒加载图片选择模块，避免测试环境缺少原生模块时报错。
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

// 把时间格式化成动态列表里更紧凑的展示文案。
function formatTime(ts: number) {
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// 头像组件优先显示图片，失败时退回到昵称末位字。
function Avatar({ uri, name }: { uri?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const text = name.trim().slice(-1) || "\u6e38";

  if (!uri || failed) {
    return (
      <View style={styles.avatarFallback}>
        <Text style={styles.avatarFallbackText}>{text}</Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={styles.avatar}
      onError={() => setFailed(true)}
    />
  );
}

// 动态配图会根据原图宽高比自适应显示尺寸。
function FeedImage({ uri }: { uri: string }) {
  const [aspectRatio, setAspectRatio] = useState(1);

  return (
    <Image
      source={{ uri }}
      style={[
        styles.postImage,
        aspectRatio >= 1 ? styles.postImageLandscape : styles.postImagePortrait,
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

export default function TeamPage() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const spaceCode = typeof code === "string" ? code : "";
  const currentUser = getCurrentUser();

  // space 保存当前旅行空间在前端 mock 层里的完整快照。
  const [space, setSpace] = useState<SpaceData | null>(() =>
    spaceCode ? getSpaceByCode(spaceCode) : null,
  );
  // dbPosts 是由 posts、photos、comments 三张表拼出来的动态视图模型。
  const [dbPosts, setDbPosts] = useState<FeedPost[]>([]);
  // postText 保存待发布动态的文字内容，落库时会写成首条评论。
  const [postText, setPostText] = useState("");
  // selectedImageUris 维护当前动态草稿里已选择的全部图片。
  const [selectedImageUris, setSelectedImageUris] = useState<string[]>([]);
  // commentInputs 以 postId 为键保存每条动态各自的评论草稿。
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>(
    {},
  );
  const [menuOpen, setMenuOpen] = useState(false);
  // composerVisible 控制发布动态弹层的显示与关闭。
  const [composerVisible, setComposerVisible] = useState(false);
  // editingPostId 标记当前正在编辑图片的动态。
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  // publishingPost 用来避免重复点击“发布动态”造成重复发帖。
  const [publishingPost, setPublishingPost] = useState(false);
  // updatingPostId 标记当前哪条动态正在追加图片。
  const [updatingPostId, setUpdatingPostId] = useState<string | null>(null);
  // previewImage 不为空时会打开全屏图片预览弹窗，并携带所属动态信息。
  const [previewImage, setPreviewImage] = useState<FeedPostImage | null>(null);
  const [savingPreview, setSavingPreview] = useState(false);
  // deletingImageId 标记当前哪一张图片正在执行删除。
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  // currentProfile 叠加了本地数据库里最新的用户资料，用来覆盖 mock 当前用户信息。
  const [currentProfile, setCurrentProfile] = useState<UserProfileData | null>(
    null,
  );

  // commentInputRefs 用来在评论提交后主动收起对应输入框。
  const commentInputRefs = useRef<Record<string, { blur?: () => void } | null>>(
    {},
  );

  // 从本地数据库读取动态、图片和评论，并拼装成页面需要的结构。
  const loadDbPosts = useCallback(async (spaceId: string) => {
    const postCollection = database.collections.get<Post>("posts");
    const photoCollection = database.collections.get<Photo>("photos");
    const commentCollection = database.collections.get<Comment>("comments");

    const [posts, photos, comments] = await Promise.all([
      postCollection.query(Q.sortBy("created_at", Q.desc)).fetch(),
      photoCollection
        .query(Q.where("space_id", spaceId), Q.sortBy("shoted_at", Q.asc))
        .fetch(),
      commentCollection.query(Q.sortBy("commented_at", Q.asc)).fetch(),
    ]);

    const activePostIds = new Set<string>();
    const photoMap = new Map<string, FeedPostImage[]>();
    photos.forEach((item) => {
      if (item.deletedAt || !item.postId) {
        return;
      }

      activePostIds.add(item.postId);
      const list = photoMap.get(item.postId) ?? [];
      list.push({
        id: item.id,
        postId: item.postId,
        uploaderId: item.uploaderId || "",
        uri: item.remoteUrl || item.localUri,
      });
      photoMap.set(item.postId, list);
    });

    const commentMap = new Map<string, FeedComment[]>();
    comments.forEach((item) => {
      if (item.deletedAt || !item.postId || !activePostIds.has(item.postId)) {
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
        .filter((item) => !item.deletedAt && activePostIds.has(item.id))
        .map((item) => {
          const postCreatedAt = dateToTimestamp(item.createdAt);
          const rawComments = [...(commentMap.get(item.id) ?? [])].sort(
            (left, right) => left.createdAt - right.createdAt,
          );
          const captionIndex = rawComments.findIndex(
            (comment) =>
              comment.commenterId === item.posterId &&
              // 閺傚洦顢嶆导姘稊娑撳搫褰傜敮鏍︽眽閸︺劌鍨卞铏圭仜闂傛潙鍟撻崗銉ф畱妫ｆ牗娼拠鍕啈閽€钘夌氨閵?
              Math.abs(comment.createdAt - postCreatedAt) <= 1_000,
          );

          return {
            id: item.id,
            posterId: item.posterId,
            caption: captionIndex >= 0 ? rawComments[captionIndex].text : "",
            images: photoMap.get(item.id) ?? [],
            createdAt: postCreatedAt,
            comments: rawComments.filter((_, index) => index !== captionIndex),
          };
        }),
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!spaceCode) {
        setSpace(null);
        setDbPosts([]);
        setCurrentProfile(null);
        return;
      }

      const nextSpace = getSpaceByCode(spaceCode);
      setSpace(nextSpace);
      if (!nextSpace) {
        setDbPosts([]);
        setCurrentProfile(null);
        return;
      }

      void (async () => {
        await ensureCurrentUserProfileInDb();
        const profile = await getCurrentUserProfileFromDb();
        setCurrentProfile(profile);
        await syncMockSpaceToDatabase(nextSpace);
        await loadDbPosts(nextSpace.id);
      })();
    }, [loadDbPosts, spaceCode]),
  );

  const users = useMemo(() => {
    const map = new Map<string, { nickname: string; avatarUrl: string }>();
    for (const user of space?.users ?? []) {
      if (user.deleted_at) {
        continue;
      }

      map.set(user.id, {
        nickname: user.nickname,
        avatarUrl: user.avatar_local_uri || user.avatar_remote_url || "",
      });
    }

    map.set(currentUser.id, {
      nickname: currentProfile?.nickname || currentUser.username,
      avatarUrl:
        currentProfile?.avatarLocalUri ||
        currentProfile?.avatarRemoteUrl ||
        currentUser.avatarUrl ||
        "",
    });

    return map;
  }, [
    currentProfile,
    currentUser.avatarUrl,
    currentUser.id,
    currentUser.username,
    space,
  ]);

  // editingPost 根据 editingPostId 找到当前正在编辑图片的那条动态。
  const editingPost = useMemo(() => {
    if (!editingPostId) {
      return null;
    }

    return dbPosts.find((item) => item.id === editingPostId) ?? null;
  }, [dbPosts, editingPostId]);

  // 打开系统相册选择图片，返回当前这次挑选到的全部图片地址。
  const pickImageUrisFromAlbum = async () => {
    const imagePicker = getImagePickerModule();
    if (!imagePicker) {
      Alert.alert(
        "\u76f8\u518c\u4e0d\u53ef\u7528",
        "\u5f53\u524d\u6784\u5efa\u672a\u5305\u542b\u9009\u56fe\u6a21\u5757\uff0c\u8bf7\u91cd\u65b0\u6784\u5efa\u5f00\u53d1\u5ba2\u6237\u7aef\u3002",
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
      Alert.alert("相册异常", String(error));
      return [] as string[];
    }
  };

  // 为发布动态草稿追加图片，并去重避免重复选择同一张图。
  const pickImagesForComposer = async () => {
    const uris = await pickImageUrisFromAlbum();
    if (uris.length === 0) {
      return;
    }

    setSelectedImageUris((prev) => Array.from(new Set([...prev, ...uris])));
  };

  // 从草稿里移除某一张已选图片，方便重新整理发布内容。
  const removeSelectedImage = (uri: string) => {
    setSelectedImageUris((prev) => prev.filter((item) => item !== uri));
  };

  // 打开发布动态弹层，让用户先完成选图和输入，再决定是否真正发送。
  const openComposer = () => {
    setMenuOpen(false);
    setComposerVisible(true);
  };

  // 打开某条动态的图片编辑弹层，方便组员继续追加或删除图片。
  const openPostEditor = (postId: string) => {
    setEditingPostId(postId);
  };

  // 发布动态时先创建 post，再写入图片；如果填写了文字，就把文字保存成首条评论。
  const onPublishPost = async () => {
    if (!space || publishingPost) {
      return;
    }

    const cleanText = postText.trim();
    const mergedInputUris = Array.from(new Set(selectedImageUris));

    if (mergedInputUris.length === 0) {
      Alert.alert(
        "\u53d1\u5e03\u5931\u8d25",
        "\u6839\u636e\u5f53\u524d\u6570\u636e\u7ed3\u6784\uff0c\u52a8\u6001\u81f3\u5c11\u9700\u8981\u4e00\u5f20\u56fe\u7247\u6765\u5f52\u5c5e\u5230\u65c5\u884c\u7a7a\u95f4\u3002",
      );
      return;
    }

    setPublishingPost(true);
    try {
      const createdAt = nowTimestamp();
      const postId = createUlid();
      const preparedImages = await Promise.all(
        mergedInputUris.map(async (uri, index) => {
          const localPath = await saveImageToLocalDir(
            uri,
            "travel-post-images",
          );
          return {
            id: createUlid(),
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
          post.posterId = currentUser.id;
          post.deletedAt = null;
          assignTimestamps(post, createdAt, createdAt);
        });

        for (const image of preparedImages) {
          await photoCollection.create((photo) => {
            assignModelId(photo, image.id);
            photo.spaceId = space.id;
            photo.postId = postId;
            photo.uploaderId = currentUser.id;
            photo.localUri = image.localUri;
            photo.remoteUrl = image.remoteUrl;
            photo.shotedAt = new Date(image.shotedAt);
            photo.deletedAt = null;
            assignTimestamps(photo, image.shotedAt, image.shotedAt);
          });
        }

        if (cleanText) {
          await commentCollection.create((item) => {
            assignModelId(item, createUlid());
            item.content = cleanText;
            item.commenterId = currentUser.id;
            item.postId = postId;
            item.commentedAt = new Date(createdAt);
            item.deletedAt = null;
            assignTimestamps(item, createdAt, createdAt);
          });
        }
      });

      await loadDbPosts(space.id);
      setPostText("");
      setSelectedImageUris([]);
      setComposerVisible(false);
    } catch (error) {
      Alert.alert("发布失败", String(error));
    } finally {
      setPublishingPost(false);
    }
  };

  // 任意同行成员都可以继续给已有动态追加图片。
  const onAddImagesToPost = async (postId: string) => {
    if (!space || updatingPostId) {
      return;
    }

    const uris = Array.from(new Set(await pickImageUrisFromAlbum()));
    if (uris.length === 0) {
      return;
    }

    setUpdatingPostId(postId);
    try {
      const createdAt = nowTimestamp();
      const preparedImages = await Promise.all(
        uris.map(async (uri, index) => {
          const localPath = await saveImageToLocalDir(
            uri,
            "travel-post-images",
          );
          return {
            id: createUlid(),
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
            photo.spaceId = space.id;
            photo.postId = postId;
            photo.uploaderId = currentUser.id;
            photo.localUri = image.localUri;
            photo.remoteUrl = image.remoteUrl;
            photo.shotedAt = new Date(image.shotedAt);
            photo.deletedAt = null;
            assignTimestamps(photo, image.shotedAt, image.shotedAt);
          });
        }
      });

      await loadDbPosts(space.id);
    } catch (error) {
      Alert.alert("添加图片失败", String(error));
    } finally {
      setUpdatingPostId((current) => (current === postId ? null : current));
    }
  };

  // 真正执行图片删除，删除后所有成员都会看到最新结果。
  const removePostImage = async (image: FeedPostImage) => {
    if (!space) {
      return;
    }

    setDeletingImageId(image.id);
    try {
      await database.write(async () => {
        const photoCollection = database.collections.get<Photo>("photos");
        const record = await photoCollection.find(image.id);
        await record.update((item) => {
          item.deletedAt = nowTimestamp();
        });
      });

      setPreviewImage((current) => (current?.id === image.id ? null : current));
      await loadDbPosts(space.id);
    } catch (error) {
      Alert.alert("删除图片失败", String(error));
    } finally {
      setDeletingImageId((current) => (current === image.id ? null : current));
    }
  };

  // 删除前先确认，并防止把当前动态的最后一张图片删空。
  const onDeletePostImage = (image: FeedPostImage, imageCount: number) => {
    if (imageCount <= 1) {
      Alert.alert(
        "\u6682\u65f6\u4e0d\u80fd\u5220\u9664",
        "\u5f53\u524d\u52a8\u6001\u81f3\u5c11\u9700\u8981\u4fdd\u7559\u4e00\u5f20\u56fe\u7247\u3002\u4f60\u53ef\u4ee5\u5148\u4e3a\u8fd9\u6761\u52a8\u6001\u8865\u56fe\uff0c\u518d\u5220\u9664\u65e7\u56fe\u3002",
      );
      return;
    }

    Alert.alert(
      "\u5220\u9664\u56fe\u7247",
      "\u5220\u9664\u540e\u5c0f\u7ec4\u6210\u5458\u90fd\u5c06\u770b\u4e0d\u5230\u8fd9\u5f20\u56fe\u7247\uff0c\u786e\u5b9a\u7ee7\u7eed\u5417\uff1f",
      [
        { text: "\u53d6\u6d88", style: "cancel" },
        {
          text: "\u5220\u9664",
          style: "destructive",
          onPress: () => {
            void removePostImage(image);
          },
        },
      ],
    );
  };

  // 发表评论后刷新当前动态列表。
  const onComment = async (postId: string) => {
    if (!space) {
      return;
    }

    const content = (commentInputs[postId] ?? "").trim();
    if (!content) {
      Alert.alert(
        "\u8bc4\u8bba\u5931\u8d25",
        "\u8bf7\u8f93\u5165\u8bc4\u8bba\u5185\u5bb9\u3002",
      );
      return;
    }

    commentInputRefs.current[postId]?.blur?.();
    Keyboard.dismiss();

    const commentedAt = nowTimestamp();
    await database.write(async () => {
      const collection = database.collections.get<Comment>("comments");
      await collection.create((item) => {
        assignModelId(item, createUlid());
        item.content = content;
        item.commenterId = currentUser.id;
        item.postId = postId;
        item.commentedAt = new Date(commentedAt);
        item.deletedAt = null;
        assignTimestamps(item, commentedAt, commentedAt);
      });
    });

    setCommentInputs((prev) => ({ ...prev, [postId]: "" }));
    await loadDbPosts(space.id);
  };

  // 把当前预览中的图片保存到系统相册。
  const onSavePreviewImage = async () => {
    if (!previewImage) {
      return;
    }

    setSavingPreview(true);
    try {
      await saveImageToAlbum(previewImage.uri, "travel-saved-images");
      Alert.alert(
        "\u4fdd\u5b58\u6210\u529f",
        "\u56fe\u7247\u5df2\u7ecf\u4fdd\u5b58\u5230\u7cfb\u7edf\u76f8\u518c\u3002",
      );
    } catch (error) {
      Alert.alert("保存失败", String(error));
    } finally {
      setSavingPreview(false);
    }
  };

  // onLeave 让当前用户离开旅行空间，并回到大厅。
  const onLeave = () => {
    setMenuOpen(false);
    if (!spaceCode) {
      return;
    }

    const result = leaveSpaceByCode(spaceCode);
    if (!result.ok) {
      Alert.alert("\u9000\u51fa\u5931\u8d25", result.message);
      return;
    }
    router.replace("/");
  };

  // onDisband 解散当前旅行空间。
  const onDisband = () => {
    setMenuOpen(false);
    if (!spaceCode) {
      return;
    }

    const ok = disbandSpaceByCode(spaceCode);
    if (!ok) {
      Alert.alert(
        "\u89e3\u6563\u5931\u8d25",
        "\u6ca1\u6709\u627e\u5230\u5f53\u524d\u7a7a\u95f4\u3002",
      );
      return;
    }
    router.replace("/");
  };

  // onBackToLobby 统一处理回到大厅，方便切换到其他旅行空间。
  const onBackToLobby = () => {
    setMenuOpen(false);
    router.replace("/");
  };
  if (!space) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerWrap}>
          <Text style={styles.emptyTitle}>
            {"\u7a7a\u95f4\u4e0d\u5b58\u5728"}
          </Text>
          <Pressable style={styles.mainBtn} onPress={onBackToLobby}>
            <Text style={styles.mainBtnText}>{"\u56de\u5230\u5927\u5385"}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardWrap}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <View style={styles.titleBlock}>
              <Text style={styles.title}>{space.name}</Text>
              <View style={styles.spaceCodeRow}>
                <Text style={styles.subTitle}>
                  {"\u7a7a\u95f4\u53e3\u4ee4\uff1a"}
                  {space.code}
                </Text>
              </View>
            </View>
            <Pressable
              style={styles.menuTrigger}
              onPress={() => setMenuOpen((v) => !v)}
            >
              <SoftIconBadge
                name={menuOpen ? "close-outline" : "apps-outline"}
                tone={menuOpen ? "peach" : "sky"}
                size={48}
                iconSize={22}
              />
            </Pressable>
          </View>

          {menuOpen ? (
            <View style={styles.menuCard}>
              <Pressable style={styles.menuItem} onPress={openComposer}>
                <View style={styles.menuItemIconRow}>
                  <SoftIconBadge
                    name="images-outline"
                    tone="sky"
                    size={44}
                    iconSize={19}
                  />
                  <View style={styles.menuItemTextWrap}>
                    <Text style={styles.menuText}>
                      {"\u53d1\u5e03\u52a8\u6001"}
                    </Text>
                    <Text style={styles.menuItemSubText}>
                      {
                        "\u5148\u9009\u56fe\u7247\u548c\u6587\u6848\uff0c\u518d\u786e\u8ba4\u53d1\u9001"
                      }
                    </Text>
                  </View>
                </View>
              </Pressable>
              <Pressable
                style={styles.menuItem}
                onPress={() => {
                  setMenuOpen(false);
                  router.push({
                    pathname: "/bookkeeping",
                    params: { code: spaceCode },
                  });
                }}
              >
                <View style={styles.menuItemIconRow}>
                  <SoftIconBadge
                    name="wallet-outline"
                    tone="peach"
                    size={44}
                    iconSize={19}
                  />
                  <View style={styles.menuItemTextWrap}>
                    <Text style={styles.menuText}>
                      {"\u65c5\u884c\u8bb0\u8d26"}
                    </Text>
                    <Text style={styles.menuItemSubText}>
                      {"\u8bb0\u5f55\u6d88\u8d39\u4e0e\u7ed3\u7b97"}
                    </Text>
                  </View>
                </View>
              </Pressable>
              <Pressable
                style={styles.menuItem}
                onPress={() => {
                  setMenuOpen(false);
                  router.push({
                    pathname: "/location",
                    params: { code: spaceCode },
                  });
                }}
              >
                <View style={styles.menuItemIconRow}>
                  <SoftIconBadge
                    name="navigate-outline"
                    tone="mint"
                    size={44}
                    iconSize={19}
                  />
                  <View style={styles.menuItemTextWrap}>
                    <Text style={styles.menuText}>位置共享</Text>
                    <Text style={styles.menuItemSubText}>查看旅伴实时位置</Text>
                  </View>
                </View>
              </Pressable>
              <Pressable style={styles.menuItem} onPress={onLeave}>
                <View style={styles.menuItemIconRow}>
                  <SoftIconBadge
                    name="log-out-outline"
                    tone="aqua"
                    size={44}
                    iconSize={19}
                  />
                  <View style={styles.menuItemTextWrap}>
                    <Text style={styles.menuText}>
                      {"\u9000\u51fa\u7a7a\u95f4"}
                    </Text>
                    <Text style={styles.menuItemSubText}>离开当前同行空间</Text>
                  </View>
                </View>
              </Pressable>
              <Pressable style={styles.menuItem} onPress={onDisband}>
                <View style={styles.menuItemIconRow}>
                  <SoftIconBadge
                    name="trash-outline"
                    tone="violet"
                    size={44}
                    iconSize={19}
                  />
                  <View style={styles.menuItemTextWrap}>
                    <Text style={styles.menuDangerText}>解散空间</Text>
                    <Text style={styles.menuItemSubText}>
                      {"\u8c28\u614e\u64cd\u4f5c\uff0c\u4e0d\u53ef\u6062\u590d"}
                    </Text>
                  </View>
                </View>
              </Pressable>
            </View>
          ) : null}

          <ScrollView
            style={styles.feed}
            contentContainerStyle={styles.feedContent}
            keyboardShouldPersistTaps="handled"
          >
            {dbPosts.length === 0 ? (
              <View style={styles.postCard}>
                <Text style={styles.commentHint}>还没有动态，先发第一条吧</Text>
              </View>
            ) : null}

            {dbPosts.map((post) => {
              const author = users.get(post.posterId);
              const authorName = author?.nickname || "成员";
              const authorAvatar = author?.avatarUrl;

              return (
                <View key={post.id} style={styles.postCard}>
                  <View style={styles.postHeader}>
                    <View style={styles.postAuthorWrap}>
                      <Avatar uri={authorAvatar} name={authorName} />
                      <View>
                        <Text style={styles.author}>{authorName}</Text>
                        <Text style={styles.meta}>
                          {formatTime(post.createdAt)}
                        </Text>
                      </View>
                    </View>
                    <Pressable
                      style={styles.postEditTrigger}
                      onPress={() => openPostEditor(post.id)}
                    >
                      <Text style={styles.postEditTriggerText}>编辑图片</Text>
                    </Pressable>
                  </View>

                  {post.caption ? (
                    <Text style={styles.postText}>{post.caption}</Text>
                  ) : null}

                  {post.images.length > 0 ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                    >
                      {post.images.map((image, idx) => (
                        <Pressable
                          key={`${post.id}-${idx}-${image.id}`}
                          onPress={() => setPreviewImage(image)}
                        >
                          <FeedImage uri={image.uri} />
                        </Pressable>
                      ))}
                    </ScrollView>
                  ) : null}

                  <View style={styles.commentList}>
                    {post.comments.length === 0 ? (
                      <Text style={styles.commentHint}>暂无评论</Text>
                    ) : (
                      post.comments.map((comment) => (
                        <View key={comment.id} style={styles.commentItem}>
                          <Text style={styles.commentAuthor}>
                            {users.get(comment.commenterId)?.nickname || "成员"}
                          </Text>
                          <Text style={styles.commentText}>{comment.text}</Text>
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
                      placeholder="写下评论"
                      value={commentInputs[post.id] ?? ""}
                      onChangeText={(text) =>
                        setCommentInputs((prev) => ({
                          ...prev,
                          [post.id]: text,
                        }))
                      }
                      multiline
                      textAlignVertical="top"
                    />
                    <Pressable
                      style={styles.commentBtn}
                      onPress={() => void onComment(post.id)}
                    >
                      <Text style={styles.commentBtnText}>
                        {"\u53d1\u9001"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
      <Pressable style={styles.lobbyShortcut} onPress={onBackToLobby}>
        <Text style={styles.lobbyShortcutText}>{"\u56de\u5927\u5385"}</Text>
      </Pressable>
      <Modal
        visible={composerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setComposerVisible(false)}
      >
        <View style={styles.composerMask}>
          <KeyboardAvoidingView
            style={styles.composerKeyboardWrap}
            behavior="padding"
            keyboardVerticalOffset={Platform.OS === "ios" ? 18 : 0}
          >
            <View style={[styles.composerSheet, styles.publishSheet]}>
              <View style={styles.composerHeader}>
                <Text style={styles.composerTitle}>
                  {"\u53d1\u5e03\u52a8\u6001"}
                </Text>
                <Pressable
                  style={styles.composerClose}
                  onPress={() => setComposerVisible(false)}
                >
                  <Text style={styles.composerCloseText}>{"\u5173\u95ed"}</Text>
                </Pressable>
              </View>
              <ScrollView
                style={styles.composerBodyScroll}
                contentContainerStyle={styles.composerBodyContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <Pressable
                  style={styles.pickImageBtn}
                  onPress={() => void pickImagesForComposer()}
                >
                  <Text style={styles.pickImageBtnText}>
                    {"\u9009\u62e9\u56fe\u7247"}
                  </Text>
                </Pressable>
                {selectedImageUris.length > 0 ? (
                  <View style={styles.composerPreviewCard}>
                    <Text style={styles.composerPreviewTitle}>
                      {"\u5df2\u9009\u62e9 "}
                      {selectedImageUris.length}
                      {" \u5f20\u56fe\u7247"}
                    </Text>
                    <ScrollView
                      horizontal
                      style={styles.selectedImageRow}
                      showsHorizontalScrollIndicator={false}
                    >
                      {selectedImageUris.map((uri, idx) => (
                        <View
                          key={`${idx}-${uri}`}
                          style={styles.selectedImageCard}
                        >
                          <Pressable
                            onPress={() =>
                              setPreviewImage({
                                id: `draft-${idx}-${uri}`,
                                postId: "draft",
                                uploaderId: currentUser.id,
                                uri,
                              })
                            }
                          >
                            <Image
                              source={{ uri }}
                              style={styles.selectedImage}
                              resizeMode="contain"
                            />
                          </Pressable>
                          <Pressable
                            style={styles.selectedImageRemove}
                            onPress={() => removeSelectedImage(uri)}
                          >
                            <Text style={styles.selectedImageRemoveText}>
                              {"\u79fb\u9664"}
                            </Text>
                          </Pressable>
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                ) : (
                  <View style={styles.composerEmptyCard}>
                    <Text style={styles.composerEmptyText}>
                      {"\u672a\u9009\u62e9\u56fe\u7247"}
                    </Text>
                  </View>
                )}
                <TextInput
                  style={[styles.input, styles.composerInput]}
                  placeholder={
                    "\u5206\u4eab\u8fd9\u6bb5\u65c5\u7a0b\u4e2d\u7684\u89c1\u95fb..."
                  }
                  value={postText}
                  onChangeText={setPostText}
                  multiline
                  textAlignVertical="top"
                />
              </ScrollView>
              <View style={styles.composerFooter}>
                <Pressable
                  style={[
                    styles.mainBtn,
                    publishingPost && styles.mainBtnDisabled,
                  ]}
                  disabled={publishingPost}
                  onPress={() => void onPublishPost()}
                >
                  <Text style={styles.mainBtnText}>
                    {publishingPost
                      ? "\u53d1\u5e03\u4e2d..."
                      : "\u53d1\u5e03\u52a8\u6001"}
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
        <View style={styles.composerMask}>
          <View style={styles.composerKeyboardWrap}>
            <View style={[styles.composerSheet, styles.editorSheet]}>
              <View style={styles.composerContent}>
                <View style={styles.composerHeader}>
                  <Text style={styles.composerTitle}>
                    {"\u7f16\u8f91\u52a8\u6001\u56fe\u7247"}
                  </Text>
                  <Pressable
                    style={styles.composerClose}
                    onPress={() => setEditingPostId(null)}
                  >
                    <Text style={styles.composerCloseText}>
                      {"\u5173\u95ed"}
                    </Text>
                  </Pressable>
                </View>
                {editingPost ? (
                  <Pressable
                    style={[
                      styles.pickImageBtn,
                      updatingPostId === editingPost.id &&
                        styles.mainBtnDisabled,
                    ]}
                    disabled={updatingPostId === editingPost.id}
                    onPress={() => void onAddImagesToPost(editingPost.id)}
                  >
                    <Text style={styles.pickImageBtnText}>
                      {updatingPostId === editingPost.id
                        ? "\u6dfb\u52a0\u4e2d..."
                        : "\u6dfb\u52a0\u56fe\u7247"}
                    </Text>
                  </Pressable>
                ) : null}
                {editingPost?.images.length ? (
                  <View style={styles.composerPreviewCard}>
                    <Text style={styles.composerPreviewTitle}>
                      {"\u5f53\u524d\u5171\u6709 "}
                      {editingPost.images.length}
                      {" \u5f20\u56fe\u7247"}
                    </Text>
                    <ScrollView
                      horizontal
                      style={styles.selectedImageRow}
                      showsHorizontalScrollIndicator={false}
                    >
                      {editingPost.images.map((image) => (
                        <View key={image.id} style={styles.selectedImageCard}>
                          <Pressable onPress={() => setPreviewImage(image)}>
                            <Image
                              source={{ uri: image.uri }}
                              style={styles.selectedImage}
                              resizeMode="contain"
                            />
                          </Pressable>
                          <Pressable
                            style={[
                              styles.selectedImageRemove,
                              deletingImageId === image.id &&
                                styles.mainBtnDisabled,
                            ]}
                            disabled={deletingImageId === image.id}
                            onPress={() =>
                              onDeletePostImage(
                                image,
                                editingPost.images.length,
                              )
                            }
                          >
                            <Text style={styles.selectedImageRemoveText}>
                              {deletingImageId === image.id
                                ? "\u5220\u9664\u4e2d..."
                                : "\u5220\u9664"}
                            </Text>
                          </Pressable>
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                ) : (
                  <View style={styles.composerEmptyCard}>
                    <Text style={styles.composerEmptyText}>
                      {"\u5f53\u524d\u8fd8\u6ca1\u6709\u56fe\u7247"}
                    </Text>
                  </View>
                )}
              </View>
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
              style={styles.previewImg}
              resizeMode="contain"
            />
          ) : null}
          <View style={styles.previewActionRow}>
            <Pressable
              style={styles.previewSaveBtn}
              disabled={savingPreview}
              onPress={() => void onSavePreviewImage()}
            >
              <Text style={styles.previewSaveBtnText}>
                {savingPreview
                  ? "\u4fdd\u5b58\u4e2d..."
                  : "\u4fdd\u5b58\u5230\u7cfb\u7edf\u76f8\u518c"}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#EAF1FA" },
  keyboardWrap: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 12,
  },
  centerWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
  },
  emptyTitle: { fontSize: 22, color: "#1D2B42", fontWeight: "700" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  titleBlock: {
    flex: 1,
  },
  title: { fontSize: 26, fontWeight: "700", color: "#1A2940" },
  subTitle: { fontSize: 13, color: "#5D728F", marginTop: 2 },
  spaceCodeRow: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  menuTrigger: {
    borderRadius: 24,
  },
  menuTriggerText: { color: "#fff", fontSize: 26, marginTop: -2 },
  menuCard: {
    marginTop: 12,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    padding: 10,
    shadowColor: "#C5D3E2",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
    gap: 8,
  },
  menuItem: {
    borderRadius: 18,
    backgroundColor: "#F8FBFF",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  menuItemIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  menuItemTextWrap: {
    flex: 1,
  },
  menuText: { color: "#21314A", fontSize: 15, fontWeight: "700" },
  menuItemSubText: { color: "#7488A0", fontSize: 12, marginTop: 4 },
  menuDangerText: { color: "#BE3535", fontSize: 15, fontWeight: "800" },
  feed: { flex: 1, marginTop: 12 },
  feedContent: { gap: 10, paddingBottom: 12 },
  postCard: { borderRadius: 12, backgroundColor: "#fff", padding: 12 },
  postHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  postAuthorWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  postEditTrigger: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: "#F2F7FF",
    borderWidth: 1,
    borderColor: "#DBE7F6",
  },
  postEditTriggerText: {
    color: "#2A4F95",
    fontSize: 12,
    fontWeight: "700",
  },
  author: { color: "#1E2E45", fontSize: 15, fontWeight: "700" },
  meta: { color: "#667D9A", fontSize: 12, marginTop: 2 },
  postText: { marginTop: 8, color: "#1F2D44", fontSize: 14, lineHeight: 20 },
  postImage: {
    borderRadius: 10,
    marginTop: 8,
    marginRight: 8,
    backgroundColor: "#E8EEF7",
  },
  postImageLandscape: { width: 240 },
  postImagePortrait: { height: 260 },
  commentList: { marginTop: 8, gap: 6 },
  commentItem: {
    borderRadius: 8,
    backgroundColor: "#F2F7FF",
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  commentHint: { marginTop: 8, color: "#7489A3", fontSize: 12 },
  commentAuthor: { color: "#2A4F95", fontWeight: "700", fontSize: 12 },
  commentText: { marginTop: 2, color: "#25334B", fontSize: 12 },
  commentRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  commentInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#D2DDEB",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#F8FBFF",
    minHeight: 40,
    maxHeight: 90,
  },
  commentBtn: {
    borderRadius: 10,
    backgroundColor: "#1F75FF",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  commentBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  composerMask: {
    flex: 1,
    backgroundColor: "rgba(16,24,40,0.36)",
    justifyContent: "flex-end",
  },
  composerKeyboardWrap: {
    flex: 1,
    justifyContent: "flex-end",
  },
  composerSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 18,
    maxHeight: "92%",
    width: "100%",
  },
  publishSheet: {
    minHeight: 460,
    height: "84%",
  },
  editorSheet: {
    minHeight: 340,
    maxHeight: "64%",
  },
  composerContent: {
    gap: 10,
  },
  composerBodyScroll: {
    flex: 1,
    marginTop: 12,
  },
  composerBodyContent: {
    gap: 12,
    paddingBottom: 8,
  },
  composerFooter: {
    paddingTop: 10,
  },
  composerScrollContent: {
    paddingBottom: 4,
  },
  composerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  composerTitle: {
    color: "#1E2E45",
    fontSize: 20,
    fontWeight: "800",
  },
  composerSubTitle: {
    marginTop: 6,
    color: "#6B7E96",
    fontSize: 13,
    lineHeight: 20,
  },
  composerClose: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#F3F7FD",
  },
  composerCloseText: {
    color: "#35537B",
    fontWeight: "700",
    fontSize: 12,
  },
  composerPreviewCard: {
    borderRadius: 16,
    backgroundColor: "#F8FBFF",
    padding: 12,
    borderWidth: 1,
    borderColor: "#E5EDF8",
  },
  composerPreviewTitle: {
    color: "#2B425E",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 10,
  },
  composerEmptyCard: {
    borderRadius: 16,
    backgroundColor: "#F8FBFF",
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "#E5EDF8",
  },
  composerEmptyText: {
    color: "#6E8198",
    fontSize: 13,
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: "#D2DDEB",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: "#F8FBFF",
    minHeight: 60,
    maxHeight: 120,
  },
  composerInput: {
    minHeight: 150,
    maxHeight: 220,
  },
  pickImageBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#89A9DD",
    alignItems: "center",
    paddingVertical: 10,
  },
  pickImageBtnText: { color: "#274F9A", fontWeight: "600", fontSize: 14 },
  selectedHint: { color: "#5A708D", fontSize: 12, marginBottom: 6 },
  selectedImageRow: {
    marginBottom: 2,
  },
  selectedImageCard: {
    marginRight: 10,
    alignItems: "center",
  },
  selectedImage: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: "#E8EEF7",
  },
  selectedImageRemove: {
    marginTop: 8,
    borderRadius: 999,
    backgroundColor: "#B93838",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  selectedImageRemoveText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  editorCaptionCard: {
    borderRadius: 16,
    backgroundColor: "#F7FAFF",
    padding: 12,
    borderWidth: 1,
    borderColor: "#E3ECF8",
    marginBottom: 12,
  },
  editorCaptionLabel: {
    color: "#5874A0",
    fontSize: 12,
    fontWeight: "700",
  },
  editorCaptionText: {
    marginTop: 8,
    color: "#1F2D44",
    fontSize: 14,
    lineHeight: 21,
  },
  editorImageMeta: {
    marginTop: 8,
    color: "#6E8198",
    fontSize: 11,
  },
  mainBtn: {
    borderRadius: 10,
    backgroundColor: "#0A69F5",
    alignItems: "center",
    paddingVertical: 11,
  },
  mainBtnDisabled: {
    opacity: 0.6,
  },
  mainBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#D9E5F4",
  },
  avatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#4F7EDB",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: { color: "#fff", fontWeight: "700" },
  previewMask: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  previewImg: {
    width: "100%",
    height: "65%",
    borderRadius: 12,
    backgroundColor: "#222",
  },
  previewClose: {
    position: "absolute",
    top: 60,
    right: 20,
    zIndex: 2,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  previewCloseText: { color: "#fff", fontWeight: "700" },
  previewActionRow: {
    marginTop: 16,
    width: "100%",
    flexDirection: "row",
    gap: 12,
  },
  previewSaveBtn: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: "#0A69F5",
    alignItems: "center",
    paddingVertical: 11,
  },
  previewSaveBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  lobbyShortcut: {
    position: "absolute",
    right: 12,
    top: "46%",
    transform: [{ translateY: -24 }],
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 14,
    backgroundColor: "#0A69F5",
    shadowColor: "#0A69F5",
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  lobbyShortcutText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
  },
});
