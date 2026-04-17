// 个人资料页：当前版本只允许修改昵称。
// 头像统一改成“蓝底 + 昵称首字”的文字徽标，不再支持上传或下载头像。
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
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
import {
  ensureCurrentUserProfileInDb,
  getCurrentUserProfileFromDb,
  updateCurrentUserNicknameInDb,
  type UserProfileData,
} from "@/features/travel/userDb";

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
  avatarBlue: "#2563EB",
  shadowDark: "#D3E4DA",
};

function getAvatarText(name: string) {
  return Array.from(name.trim())[0] || "空";
}

function Avatar({ name }: { name: string }) {
  return (
    <View style={styles.avatarFallback}>
      <Text style={styles.avatarFallbackText}>{getAvatarText(name)}</Text>
    </View>
  );
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [nicknameInput, setNicknameInput] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const displayName = useMemo(
    () => profile?.nickname || "空间用户",
    [profile?.nickname],
  );
  const userId = profile?.id || "";

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
              <Avatar name={displayName} />

              <View style={styles.profileTextWrap}>
                <Text style={styles.displayName}>{displayName}</Text>
                <Text style={styles.userIdText}>ID号 · {userId}</Text>
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
                  savingProfile && styles.disabledButton,
                ]}
                onPress={() => void onSaveNickname()}
                disabled={savingProfile}
              >
                <Text style={styles.saveButtonText}>
                  {savingProfile ? "保存中..." : "保存资料"}
                </Text>
              </Pressable>
            </View>
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
  avatarFallback: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: profilePalette.avatarBlue,
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
    elevation: 4,
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  disabledButton: {
    opacity: 0.6,
  },
});
