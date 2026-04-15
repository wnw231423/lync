// 个人资料页：负责昵称、头像的本地持久化，以及头像导出到系统相册。
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getCurrentUser } from "@/features/travel/mockApp";
import {
  ensureCurrentUserProfileInDb,
  getCurrentUserProfileFromDb,
  updateCurrentUserAvatarInDb,
  updateCurrentUserNicknameInDb,
  type UserProfileData,
} from "@/features/travel/userDb";
import { saveImageToAlbum } from "@/lib/imageStorage";

type ImagePickerModule = {
  launchImageLibraryAsync: (options: Record<string, unknown>) => Promise<{
    canceled: boolean;
    assets?: { uri: string }[];
  }>;
};

let imagePickerModuleCache: ImagePickerModule | null | undefined;

const profilePalette = {
  background: "#F4FBF6",
  orbPrimary: "rgba(96,194,142,0.16)",
  orbSecondary: "rgba(168,225,192,0.12)",
  surface: "#F3F5FB",
  surfaceRaised: "#FFFFFF",
  border: "#DDEDE3",
  text: "#1E2438",
  muted: "#6F7897",
  softText: "#9AA4C0",
  primary: "#60C28E",
  secondary: "#3E9E6C",
  success: "#34D399",
  shadowDark: "#D3E4DA",
  shadowLight: "#FFFFFF",
};

// profilePalette 统一维护个人资料页的视觉配色和层级。
// 懒加载选图模块，避免测试环境里缺少原生能力时报错。
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

// 头像优先显示图片，失败时退回到昵称最后一个字。
function Avatar({ uri, name }: { uri: string; name: string }) {
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    setLoadFailed(false);
  }, [uri]);
  const fallbackText = name.trim().slice(-1) || "旅";

  if (loadFailed || !uri) {
    return (
      <View style={styles.avatarFallback}>
        <Text style={styles.avatarFallbackText}>{fallbackText}</Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={styles.avatar}
      onError={() => setLoadFailed(true)}
    />
  );
}

// ProfilePage 负责读取本地资料，并承接昵称、头像相关的编辑动作。
export default function ProfilePage() {
  // current 是 mock 层里的当前用户，用来做本地资料缺失时的兜底展示。
  const current = useMemo(() => getCurrentUser(), []);
  // profile 是 WatermelonDB 里规范化后的用户资料。
  const [profile, setProfile] = useState<UserProfileData | null>(null);
  // nicknameInput 保存昵称输入框的草稿内容。
  const [nicknameInput, setNicknameInput] = useState("");
  // savingProfile 避免重复提交昵称或头像修改。
  const [savingProfile, setSavingProfile] = useState(false);
  // savingAvatarToAlbum 表示“保存头像到相册”动作是否还在进行中。
  const [savingAvatarToAlbum, setSavingAvatarToAlbum] = useState(false);

  const avatarUri = profile?.avatarLocalUri || profile?.avatarRemoteUrl || "";
  const avatarDisplayUri =
    profile?.avatarDisplayUri ||
    profile?.avatarLocalUri ||
    profile?.avatarRemoteUrl ||
    "";
  const displayName = profile?.nickname || current.username;
  const userId = profile?.id || current.id;

  // 读取并刷新当前用户在本地数据库中的资料。
  const loadProfile = useCallback(async () => {
    await ensureCurrentUserProfileInDb();
    const row = await getCurrentUserProfileFromDb();
    setProfile(row);
    setNicknameInput(row.nickname);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadProfile();
    }, [loadProfile]),
  );

  // 保存昵称，并同步更新到空间里依赖昵称展示的地方。
  const onSaveNickname = async () => {
    const clean = nicknameInput.trim();
    if (!clean) {
      Alert.alert("提示", "昵称不能为空。");
      return;
    }

    setSavingProfile(true);
    try {
      const next = await updateCurrentUserNicknameInDb(clean);
      setProfile(next);
      setNicknameInput(next.nickname);
      Alert.alert("已保存", "昵称已经更新。");
    } catch (error) {
      Alert.alert("保存失败", String(error));
    } finally {
      setSavingProfile(false);
    }
  };

  // 从系统相册选择一张图片，并更新当前用户头像。
  const onPickAvatar = async () => {
    const imagePicker = getImagePickerModule();
    if (!imagePicker) {
      Alert.alert(
        "相册不可用",
        "当前构建未包含图片选择模块，请重新构建开发客户端。",
      );
      return;
    }

    try {
      const result = await imagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
        allowsMultipleSelection: false,
        selectionLimit: 1,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      setSavingProfile(true);
      const next = await updateCurrentUserAvatarInDb(result.assets[0].uri);
      setProfile(next);
      Alert.alert("已保存", "头像已经更新。");
    } catch (error) {
      Alert.alert("头像更新失败", String(error));
    } finally {
      setSavingProfile(false);
    }
  };

  // 把当前头像保存到系统相册。
  const onSaveAvatarToAlbum = async () => {
    if (!avatarUri) {
      return;
    }

    setSavingAvatarToAlbum(true);
    try {
      await saveImageToAlbum(avatarUri, "travel-avatar-export");
      Alert.alert("已保存", "头像已经保存到系统相册。");
    } catch (error) {
      Alert.alert("保存失败", String(error));
    } finally {
      setSavingAvatarToAlbum(false);
    }
  };

  // 优先返回上一页；没有返回栈时回到首页。
  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

      <KeyboardAvoidingView
        style={styles.keyboardWrap}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.headerRow}>
            <Pressable style={styles.backButton} onPress={goBack}>
              <Ionicons
                name="chevron-back"
                size={18}
                color={profilePalette.primary}
              />
            </Pressable>
            <Text style={styles.pageTitle}>个人资料</Text>
            <View style={styles.headerPlaceholder} />
          </View>

          <View style={styles.profileCard}>
            <View style={styles.profileMainRow}>
              <Avatar uri={avatarDisplayUri} name={displayName} />

              <View style={styles.profileTextWrap}>
                <Text style={styles.displayName}>{displayName}</Text>
                <Text style={styles.userIdText}>ID号 · {userId}</Text>
              </View>

              <View style={styles.profileActionColumn}>
                <Pressable
                  style={styles.iconButton}
                  onPress={() => void onPickAvatar()}
                  disabled={savingProfile || savingAvatarToAlbum}
                >
                  <Ionicons
                    name="camera-outline"
                    size={18}
                    color={profilePalette.primary}
                  />
                </Pressable>
                <Pressable
                  style={styles.iconButton}
                  onPress={() => void onSaveAvatarToAlbum()}
                  disabled={!avatarUri || savingProfile || savingAvatarToAlbum}
                >
                  <Ionicons
                    name="download-outline"
                    size={18}
                    color={profilePalette.primary}
                  />
                </Pressable>
              </View>
            </View>

            <View style={styles.editorBlock}>
              <TextInput
                value={nicknameInput}
                onChangeText={setNicknameInput}
                placeholder="输入你的昵称"
                placeholderTextColor={profilePalette.softText}
                style={styles.input}
                maxLength={24}
              />

              <Pressable
                style={[
                  styles.saveButton,
                  (savingProfile || savingAvatarToAlbum) &&
                    styles.disabledButton,
                ]}
                onPress={() => void onSaveNickname()}
                disabled={savingProfile || savingAvatarToAlbum}
              >
                <Text style={styles.saveButtonText}>
                  {savingProfile ? "保存中..." : "保存资料"}
                </Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.actionCard}>
            <Pressable
              style={styles.actionRow}
              onPress={() => void onPickAvatar()}
              disabled={savingProfile || savingAvatarToAlbum}
            >
              <View style={styles.actionIconWrap}>
                <Ionicons
                  name="image-outline"
                  size={18}
                  color={profilePalette.primary}
                />
              </View>
              <Text style={styles.actionText}>
                {savingProfile ? "处理中..." : "重新选择头像"}
              </Text>
            </Pressable>

            <Pressable
              style={styles.actionRow}
              onPress={() => void onSaveAvatarToAlbum()}
              disabled={!avatarUri || savingProfile || savingAvatarToAlbum}
            >
              <View style={styles.actionIconWrap}>
                <Ionicons
                  name="download-outline"
                  size={18}
                  color={profilePalette.primary}
                />
              </View>
              <Text style={styles.actionText}>
                {savingAvatarToAlbum ? "保存中..." : "保存头像到相册"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: profilePalette.background,
  },
  backgroundOrbTop: {
    position: "absolute",
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: profilePalette.orbPrimary,
    top: -112,
    right: -90,
  },
  backgroundOrbBottom: {
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: profilePalette.orbSecondary,
    bottom: -130,
    left: -76,
  },
  keyboardWrap: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 36,
    gap: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: profilePalette.surface,
    borderWidth: 1,
    borderColor: profilePalette.border,
    shadowColor: profilePalette.shadowLight,
    shadowOpacity: 0.95,
    shadowRadius: 8,
    shadowOffset: { width: -3, height: -3 },
    elevation: 2,
  },
  pageTitle: {
    color: profilePalette.text,
    fontSize: 20,
    fontWeight: "800",
  },
  headerPlaceholder: {
    width: 40,
    height: 40,
  },
  profileCard: {
    borderRadius: 30,
    backgroundColor: profilePalette.surface,
    borderWidth: 1,
    borderColor: profilePalette.border,
    paddingHorizontal: 18,
    paddingVertical: 18,
    shadowColor: profilePalette.shadowDark,
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 5,
  },
  profileMainRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: profilePalette.surfaceRaised,
  },
  avatarFallback: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: profilePalette.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "800",
  },
  profileTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  displayName: {
    color: profilePalette.text,
    fontSize: 24,
    fontWeight: "800",
  },
  userIdText: {
    marginTop: 8,
    color: profilePalette.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  profileActionColumn: {
    gap: 10,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: profilePalette.surfaceRaised,
    borderWidth: 1,
    borderColor: profilePalette.border,
    shadowColor: profilePalette.shadowDark,
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  editorBlock: {
    marginTop: 18,
    gap: 12,
  },
  input: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: profilePalette.surfaceRaised,
    borderWidth: 1,
    borderColor: profilePalette.border,
    color: profilePalette.text,
    fontSize: 15,
  },
  saveButton: {
    borderRadius: 18,
    backgroundColor: profilePalette.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    shadowColor: profilePalette.primary,
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  actionCard: {
    borderRadius: 28,
    backgroundColor: profilePalette.surface,
    borderWidth: 1,
    borderColor: profilePalette.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
    shadowColor: profilePalette.shadowDark,
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 18,
    backgroundColor: profilePalette.surfaceRaised,
    borderWidth: 1,
    borderColor: profilePalette.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  actionIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: profilePalette.surface,
  },
  actionText: {
    color: profilePalette.text,
    fontSize: 14,
    fontWeight: "700",
  },
  disabledButton: {
    opacity: 0.6,
  },
});
