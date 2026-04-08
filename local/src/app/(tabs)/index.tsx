import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SoftIconBadge } from "@/components/SoftIconBadge";
import {
  ensureCurrentUserProfileInDb,
  getCurrentUserProfileFromDb,
} from "./userDb";
import {
  createSpaceForCurrentUser,
  joinSpaceByCode,
  listJoinedSpacesForCurrentUser,
  type JoinedSpaceSummary,
} from "./mockApp";

// HeaderUser 是大厅头部头像按钮真正需要的最小资料结构。
type HeaderUser = {
  nickname: string;
  avatarUri: string;
};

// formatLobbyTime 把空间最近更新时间转成大厅里更好扫读的短时间。
function formatLobbyTime(ts: number) {
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// FEATURE_ITEMS 是大厅页写死的功能导览卡片，用来快速说明当前旅行空间支持哪些能力。
const FEATURE_ITEMS = [
  {
    title: "动态记录",
    description: "图文发布与评论互动",
    icon: "chatbubble-ellipses-outline" as const,
    tone: "sky" as const,
  },
  {
    title: "轻松记账",
    description: "同行消费一目了然",
    icon: "wallet-outline" as const,
    tone: "peach" as const,
  },
  {
    title: "位置共享",
    description: "实时同步旅伴位置",
    icon: "navigate-outline" as const,
    tone: "mint" as const,
  },
];

// HeaderAvatar 负责渲染大厅页右上角的紧凑头像入口。
function HeaderAvatar({
  avatarUri,
  nickname,
  onPress,
}: {
  avatarUri: string;
  nickname: string;
  onPress: () => void;
}) {
  const fallback = nickname.trim().slice(-1) || "旅";

  return (
    <Pressable style={styles.headerAvatarWrap} onPress={onPress}>
      {avatarUri ? (
        <Image source={{ uri: avatarUri }} style={styles.headerAvatar} />
      ) : (
        <View style={styles.headerAvatarFallback}>
          <Text style={styles.headerAvatarFallbackText}>{fallback}</Text>
        </View>
      )}
    </Pressable>
  );
}

// SpaceLobbyPage 负责在大厅页创建空间或通过口令加入已有空间。
export default function SpaceLobbyPage() {
  // spaceCodeInput 保存用户手动输入或刚创建出来的空间口令。
  const [spaceCodeInput, setSpaceCodeInput] = useState("");
  // latestCreatedCode 用来在创建成功后把最近一次口令回显在大厅页。
  const [latestCreatedCode, setLatestCreatedCode] = useState("");
  // joinedSpaces 是当前用户仍然属于其中的所有旅行空间摘要。
  const [joinedSpaces, setJoinedSpaces] = useState<JoinedSpaceSummary[]>([]);
  // headerUser 用本地持久化资料填充头像按钮的昵称和头像。
  const [headerUser, setHeaderUser] = useState<HeaderUser>({
    nickname: "旅行者",
    avatarUri: "",
  });

  useFocusEffect(
    useCallback(() => {
      // 每次回到大厅都刷新资料和已加入空间，保证跨页面操作后这里仍是最新状态。
      void (async () => {
        await ensureCurrentUserProfileInDb();
        const profile = await getCurrentUserProfileFromDb();
        setHeaderUser({
          nickname: profile.nickname,
          avatarUri: profile.avatarLocalUri || profile.avatarRemoteUrl || "",
        });
        setJoinedSpaces(listJoinedSpacesForCurrentUser());
      })();
    }, []),
  );

  const helperText = useMemo(() => {
    if (latestCreatedCode) {
      return `最近创建的空间口令：${latestCreatedCode}`;
    }
    // 默认提示文案提醒用户：创建空间后口令会在这里回显。
    return "创建空间后，这里会显示最近一次生成的口令。";
  }, [latestCreatedCode]);

  // goSpacePage 统一处理跳转到当前旅行空间页面的逻辑。
  const goSpacePage = (code: string) => {
    router.push({ pathname: "/team", params: { code } });
  };

  // onCreateSpace 创建一个本地 mock 空间，并立即进入该空间。
  const onCreateSpace = () => {
    const space = createSpaceForCurrentUser();
    setLatestCreatedCode(space.code);
    setSpaceCodeInput(space.code);
    Alert.alert("创建成功", `已生成空间口令：${space.code}`);
    goSpacePage(space.code);
  };

  // onJoinSpace 会先校验口令，再尝试加入 mock 空间。
  const onJoinSpace = () => {
    const result = joinSpaceByCode(spaceCodeInput);
    if (!result.ok) {
      Alert.alert("加入失败", result.message);
      return;
    }
    goSpacePage(result.space.code);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroBadge}>
              <SoftIconBadge name="airplane-outline" tone="sky" size={56} />
              <View style={styles.heroBadgeTextWrap}>
                <Text style={styles.heroEyebrow}>极简旅程空间</Text>
                <Text style={styles.heroBadgeTitle}>轻盈协作 · 共同出发</Text>
              </View>
            </View>
            <HeaderAvatar
              avatarUri={headerUser.avatarUri}
              nickname={headerUser.nickname}
              onPress={() => router.push("/profile")}
            />
          </View>

          <Text style={styles.title}>旅行空间大厅</Text>
          <Text style={styles.subtitle}>
            创建属于你们的旅行空间，把动态、记账和位置共享收进同一个极简界面里。
          </Text>

          <View style={styles.featureRow}>
            {FEATURE_ITEMS.map((item) => (
              <View key={item.title} style={styles.featureCard}>
                <SoftIconBadge name={item.icon} tone={item.tone} size={52} />
                <Text style={styles.featureTitle}>{item.title}</Text>
                <Text style={styles.featureDescription}>
                  {item.description}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.commandCard}>
          <View style={styles.commandHeader}>
            <SoftIconBadge name="key-outline" tone="violet" size={50} />
            <View style={styles.commandHeaderTextWrap}>
              <Text style={styles.commandTitle}>输入空间口令</Text>
              <Text style={styles.commandSubtitle}>
                使用口令快速加入旅伴已经创建好的空间。
              </Text>
            </View>
          </View>

          <TextInput
            value={spaceCodeInput}
            onChangeText={(value) => setSpaceCodeInput(value.toUpperCase())}
            autoCapitalize="characters"
            placeholder="例如：01HV6M1S8QK2Y9F4N6R1W7T5V"
            placeholderTextColor="#97A9BC"
            maxLength={26}
            style={styles.input}
          />

          <View style={styles.buttonGroup}>
            <Pressable onPress={onCreateSpace} style={styles.primaryButton}>
              <SoftIconBadge
                name="add-outline"
                tone="aqua"
                size={38}
                iconSize={18}
              />
              <Text style={styles.primaryButtonText}>创建旅行空间</Text>
            </Pressable>

            <Pressable onPress={onJoinSpace} style={styles.secondaryButton}>
              <SoftIconBadge
                name="enter-outline"
                tone="peach"
                size={38}
                iconSize={18}
              />
              <Text style={styles.secondaryButtonText}>加入已有空间</Text>
            </Pressable>
          </View>

          <View style={styles.helperCard}>
            <Text style={styles.helperLabel}>空间提示</Text>
            <Text style={styles.helperText}>{helperText}</Text>
          </View>
        </View>

        <View style={styles.commandCard}>
          <View style={styles.commandHeader}>
            <SoftIconBadge name="albums-outline" tone="mint" size={50} />
            <View style={styles.commandHeaderTextWrap}>
              <Text style={styles.commandTitle}>我加入的旅行空间</Text>
              <Text style={styles.commandSubtitle}>
                可以从这里随时回到曾经加入过的空间，也可以继续新建和加入新的空间。
              </Text>
            </View>
          </View>

          {joinedSpaces.length === 0 ? (
            <View style={styles.emptySpacesCard}>
              <Text style={styles.emptySpacesText}>
                你还没有加入任何旅行空间，先创建一个或输入口令加入吧。
              </Text>
            </View>
          ) : (
            joinedSpaces.map((space) => (
              <Pressable
                key={space.id}
                style={styles.joinedSpaceCard}
                onPress={() => goSpacePage(space.code)}
              >
                <View style={styles.joinedSpaceTopRow}>
                  <View style={styles.joinedSpaceTextWrap}>
                    <Text style={styles.joinedSpaceName}>{space.name}</Text>
                    <Text style={styles.joinedSpaceMeta}>
                      口令：{space.code}
                    </Text>
                  </View>
                  <Text style={styles.joinedSpaceEnter}>进入</Text>
                </View>
                <Text style={styles.joinedSpaceInfo}>
                  {space.memberCount} 位成员 · {space.photoCount} 张图片 ·
                  最近更新 {formatLobbyTime(space.updatedAt)}
                </Text>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F4F7FB",
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 18,
  },
  heroCard: {
    borderRadius: 28,
    backgroundColor: "#FFFFFF",
    padding: 20,
    shadowColor: "#ADC0DD",
    shadowOpacity: 0.14,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 14 },
    elevation: 6,
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  heroBadge: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  heroBadgeTextWrap: {
    flex: 1,
  },
  heroEyebrow: {
    color: "#5A7EC8",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  heroBadgeTitle: {
    marginTop: 4,
    color: "#4D617C",
    fontSize: 13,
  },
  title: {
    marginTop: 22,
    color: "#1E2B3C",
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  subtitle: {
    marginTop: 12,
    color: "#667C97",
    fontSize: 14,
    lineHeight: 22,
  },
  featureRow: {
    marginTop: 22,
    flexDirection: "row",
    gap: 10,
  },
  featureCard: {
    flex: 1,
    borderRadius: 22,
    backgroundColor: "#F9FBFF",
    paddingHorizontal: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#EDF2F8",
    gap: 8,
  },
  featureTitle: {
    color: "#233247",
    fontSize: 14,
    fontWeight: "700",
  },
  featureDescription: {
    color: "#7A8CA3",
    fontSize: 11,
    textAlign: "center",
    lineHeight: 16,
  },
  headerAvatarWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  headerAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#DCE7F5",
  },
  headerAvatarFallback: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#4D7CFE",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#4D7CFE",
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  headerAvatarFallbackText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 18,
  },
  commandCard: {
    borderRadius: 28,
    backgroundColor: "#FFFFFF",
    padding: 20,
    shadowColor: "#C1D0E2",
    shadowOpacity: 0.12,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 5,
  },
  commandHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  commandHeaderTextWrap: {
    flex: 1,
  },
  commandTitle: {
    color: "#203044",
    fontSize: 18,
    fontWeight: "800",
  },
  commandSubtitle: {
    marginTop: 4,
    color: "#70839A",
    fontSize: 13,
    lineHeight: 20,
  },
  input: {
    marginTop: 18,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 15,
    color: "#24364D",
    backgroundColor: "#F7FAFF",
    borderWidth: 1,
    borderColor: "#E6EDF7",
  },
  buttonGroup: {
    marginTop: 16,
    gap: 12,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#4D7CFE",
    borderRadius: 22,
    paddingVertical: 13,
    shadowColor: "#4D7CFE",
    shadowOpacity: 0.24,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 15,
  },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 22,
    paddingVertical: 13,
    backgroundColor: "#F7FAFF",
    borderWidth: 1,
    borderColor: "#E3EAF5",
  },
  secondaryButtonText: {
    color: "#2A3E57",
    fontWeight: "700",
    fontSize: 15,
  },
  helperCard: {
    marginTop: 16,
    borderRadius: 20,
    backgroundColor: "#F8FBFF",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  helperLabel: {
    color: "#5A7EC8",
    fontSize: 12,
    fontWeight: "700",
  },
  helperText: {
    marginTop: 6,
    color: "#6B809A",
    fontSize: 13,
    lineHeight: 20,
  },
  emptySpacesCard: {
    marginTop: 16,
    borderRadius: 20,
    backgroundColor: "#F8FBFF",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  emptySpacesText: {
    color: "#6B809A",
    fontSize: 13,
    lineHeight: 20,
  },
  joinedSpaceCard: {
    marginTop: 14,
    borderRadius: 20,
    backgroundColor: "#F8FBFF",
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderWidth: 1,
    borderColor: "#E4EDF8",
  },
  joinedSpaceTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  joinedSpaceTextWrap: {
    flex: 1,
  },
  joinedSpaceName: {
    color: "#203146",
    fontSize: 16,
    fontWeight: "800",
  },
  joinedSpaceMeta: {
    marginTop: 6,
    color: "#6E8198",
    fontSize: 12,
  },
  joinedSpaceEnter: {
    color: "#3565C9",
    fontSize: 13,
    fontWeight: "800",
  },
  joinedSpaceInfo: {
    marginTop: 10,
    color: "#7387A0",
    fontSize: 12,
    lineHeight: 18,
  },
});
