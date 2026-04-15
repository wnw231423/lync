// 空间记账页：负责新增账单、查看历史账单，并跳转到结算页。
import { Q } from "@nozbe/watermelondb";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
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
import Expense from "@/model/Expense";
import { createUlid } from "@/lib/ids";
import { assignModelId, dateToTimestamp } from "@/lib/watermelon";
import { syncMockSpaceToDatabase } from "@/features/travel/dbSync";
import {
  getCurrentUser,
  getSpaceByCode,
  type SpaceData,
} from "@/features/travel/mockApp";

// LedgerExpense 是账单页渲染用的轻量视图模型，金额已经提前换算成“元”。
type LedgerExpense = {
  id: string;
  amountYuan: number;
  description: string;
  payerId: string;
  createdAt: number;
};

// formatAmount 统一账单页里的金额展示格式。
function formatAmount(amount: number) {
  return `${amount.toFixed(2)} 元`;
}

// formatDate 把账单时间格式化成更适合旅途场景阅读的短文案。
function formatDate(ts: number) {
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ledgerPalette = {
  background: "#F4FBF6",
  surface: "rgba(255,255,255,0.78)",
  panel: "#FFFFFF",
  panelSoft: "#F7FCF9",
  border: "#DDEDE3",
  borderStrong: "#C8DDCF",
  text: "#1E2438",
  muted: "#6F7897",
  softText: "#9AA4C0",
  primary: "#60C28E",
  secondary: "#3E9E6C",
  success: "#34D399",
  pink: "#A8E1C0",
  shadow: "#BFDCCC",
};

// ledgerPalette 统一维护记账页使用的颜色，便于后续整页换肤。
// BookkeepingPage 负责记录账单，并从 WatermelonDB 读回历史数据。
export default function BookkeepingPage() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const spaceCode = typeof code === "string" ? code : "";

  const currentUser = getCurrentUser();
  // space 保存当前激活的空间快照，来源于 mock 领域层。
  const [space, setSpace] = useState<SpaceData | null>(() =>
    spaceCode ? getSpaceByCode(spaceCode) : null,
  );
  // dbExpenses 保存从本地数据库读取并整理后的账单列表。
  const [dbExpenses, setDbExpenses] = useState<LedgerExpense[]>([]);
  // title 保存待新增账单的项目名称输入。
  const [title, setTitle] = useState("");
  // amount 保存待新增账单的金额输入，保持字符串可避免输入中的中间态被截断。
  const [amount, setAmount] = useState("");

  // loadDbExpenses 会按当前空间重新加载本地账单数据。
  const loadDbExpenses = useCallback(async (spaceId: string) => {
    const collection = database.collections.get<Expense>("expenses");
    const records = await collection
      .query(Q.where("space_id", spaceId), Q.sortBy("created_at", Q.desc))
      .fetch();

    setDbExpenses(
      records.map((item) => ({
        id: item.id,
        amountYuan: item.amount / 100,
        description: item.description,
        payerId: item.payerId || "",
        createdAt: dateToTimestamp(item.createdAt),
      })),
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!spaceCode) {
        setSpace(null);
        setDbExpenses([]);
        return;
      }

      const nextSpace = getSpaceByCode(spaceCode);
      setSpace(nextSpace);
      if (nextSpace) {
        void (async () => {
          await syncMockSpaceToDatabase(nextSpace);
          await loadDbExpenses(nextSpace.id);
        })();
      } else {
        setDbExpenses([]);
      }
    }, [spaceCode, loadDbExpenses]),
  );

  const allExpenses = useMemo(
    () => [...dbExpenses].sort((a, b) => b.createdAt - a.createdAt),
    [dbExpenses],
  );

  // memberUsers 只保留当前空间中仍处于活跃状态的成员资料。
  const memberUsers = useMemo(() => {
    if (!space) {
      return [];
    }

    const memberIds = new Set(space.spaceMembers.map((item) => item.user_id));

    return space.users.filter((user) => memberIds.has(user.id));
  }, [space]);

  // userNameById 让账单列表能用 payerId 快速映射出昵称。
  const userNameById = useMemo(
    () =>
      new Map(
        memberUsers.map((user) => [user.id, user.nickname || "未命名成员"]),
      ),
    [memberUsers],
  );

  // onAddBill 负责校验表单，并以“分”为单位保存新账单。
  const onAddBill = async () => {
    if (!space) {
      return;
    }

    const cleanTitle = title.trim();
    const parsed = Number(amount);
    if (!cleanTitle) {
      Alert.alert("添加失败", "请输入账单名称。");
      return;
    }
    if (!Number.isFinite(parsed) || parsed <= 0) {
      Alert.alert("添加失败", "金额必须大于 0。");
      return;
    }

    // amountInCent 把输入的“元”转换为数据库约定的“分”。
    const amountInCent = Math.round(parsed * 100);
    await database.write(async () => {
      const collection = database.collections.get<Expense>("expenses");
      await collection.create((expense) => {
        assignModelId(expense, createUlid());
        expense.spaceId = space.id;
        expense.payerId = currentUser.id;
        expense.amount = amountInCent;
        expense.description = cleanTitle;
      });
    });

    await loadDbExpenses(space.id);
    setTitle("");
    setAmount("");
  };

  // onSettle 跳转到同一空间下的结算汇总页。
  const onSettle = () => {
    if (!space) {
      return;
    }
    router.push({ pathname: "/settlement", params: { code: spaceCode } });
  };

  if (!space) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>记账页暂时不可用</Text>
          <Pressable
            style={styles.backButton}
            onPress={() => router.replace("/")}
          >
            <Text style={styles.backButtonText}>返回首页</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>空间记账</Text>
          </View>
          <Pressable
            style={styles.backButton}
            onPress={() =>
              router.replace({ pathname: "/team", params: { code: spaceCode } })
            }
          >
            <Text style={styles.backButtonText}>返回</Text>
          </Pressable>
        </View>

        <View style={styles.editorCard}>
          <View style={styles.sectionHeader}>
            <SoftIconBadge
              name="create-outline"
              tone="aqua"
              size={50}
              iconSize={20}
            />
            <View style={styles.sectionHeaderTextWrap}>
              <Text style={styles.sectionTitle}>添加账单</Text>
              <Text style={styles.sectionSubtitle}>
                输入项目和金额，新的记录会立即进入清单。
              </Text>
            </View>
          </View>

          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="例如：午餐、门票、打车"
            placeholderTextColor={ledgerPalette.softText}
            style={styles.input}
          />
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="金额"
            keyboardType="decimal-pad"
            placeholderTextColor={ledgerPalette.softText}
            style={styles.input}
          />

          <View style={styles.buttonRow}>
            <Pressable style={styles.secondaryButton} onPress={onSettle}>
              <Text style={styles.secondaryButtonText}>查看结算</Text>
            </Pressable>
            <Pressable
              style={styles.primaryButton}
              onPress={() => void onAddBill()}
            >
              <Text style={styles.primaryButtonText}>保存账单</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.listCard}>
          <View style={styles.sectionHeader}>
            <SoftIconBadge
              name="receipt-outline"
              tone="sky"
              size={50}
              iconSize={20}
            />
            <View style={styles.sectionHeaderTextWrap}>
              <Text style={styles.sectionTitle}>历史账单</Text>
              <Text style={styles.sectionSubtitle}>
                所有记录按时间倒序展示，查看起来更直接。
              </Text>
            </View>
          </View>

          {allExpenses.length === 0 ? (
            <View style={styles.emptyListCard}>
              <Text style={styles.emptyListText}>
                还没有账单，先记下第一笔空间消费吧。
              </Text>
            </View>
          ) : (
            allExpenses.map((item) => (
              <View key={item.id} style={styles.listItem}>
                <View style={styles.listItemTop}>
                  <Text style={styles.listTitle}>{item.description}</Text>
                  <Text style={styles.listAmount}>
                    {formatAmount(item.amountYuan)}
                  </Text>
                </View>
                <Text style={styles.listMeta}>
                  付款人：{userNameById.get(item.payerId) || "未知成员"}
                </Text>
                <Text style={styles.listTime}>
                  {formatDate(item.createdAt)}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: ledgerPalette.background },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 18,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    color: ledgerPalette.text,
    fontSize: 30,
    fontWeight: "800",
  },
  subtitle: {
    marginTop: 10,
    color: ledgerPalette.muted,
    fontSize: 14,
    lineHeight: 22,
    maxWidth: 260,
  },
  backButton: {
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.84)",
    borderWidth: 1,
    borderColor: ledgerPalette.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: ledgerPalette.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  backButtonText: {
    color: ledgerPalette.primary,
    fontSize: 14,
    fontWeight: "700",
  },
  summaryCard: {
    borderRadius: 28,
    backgroundColor: ledgerPalette.surface,
    padding: 20,
    borderWidth: 1,
    borderColor: ledgerPalette.border,
    shadowColor: ledgerPalette.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 5,
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  summaryHeaderTextWrap: { flex: 1 },
  summaryTitle: {
    color: ledgerPalette.text,
    fontSize: 18,
    fontWeight: "800",
  },
  summarySubtitle: {
    marginTop: 4,
    color: ledgerPalette.muted,
    fontSize: 13,
  },
  summaryGrid: {
    marginTop: 18,
    gap: 12,
  },
  summaryItem: {
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.92)",
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: ledgerPalette.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowColor: "#FFFFFF",
    shadowOpacity: 0.9,
    shadowRadius: 10,
    shadowOffset: { width: -4, height: -4 },
    elevation: 2,
  },
  summaryLabel: {
    flex: 1,
    color: ledgerPalette.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  summaryValue: {
    color: ledgerPalette.text,
    fontSize: 16,
    fontWeight: "800",
  },
  summaryValueSmall: {
    color: ledgerPalette.text,
    fontSize: 15,
    fontWeight: "700",
  },
  editorCard: {
    borderRadius: 28,
    backgroundColor: ledgerPalette.surface,
    padding: 20,
    borderWidth: 1,
    borderColor: ledgerPalette.border,
    shadowColor: ledgerPalette.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sectionHeaderTextWrap: { flex: 1 },
  sectionTitle: {
    color: ledgerPalette.text,
    fontSize: 18,
    fontWeight: "800",
  },
  sectionSubtitle: {
    marginTop: 4,
    color: ledgerPalette.muted,
    fontSize: 13,
    lineHeight: 20,
  },
  input: {
    marginTop: 16,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: ledgerPalette.panelSoft,
    borderWidth: 1,
    borderColor: ledgerPalette.borderStrong,
    color: ledgerPalette.text,
    fontSize: 15,
    shadowColor: "#FFFFFF",
    shadowOpacity: 0.8,
    shadowRadius: 8,
    shadowOffset: { width: -3, height: -3 },
  },
  buttonRow: {
    marginTop: 18,
    flexDirection: "row",
    gap: 12,
  },
  primaryButton: {
    flex: 1,
    borderRadius: 22,
    backgroundColor: ledgerPalette.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    shadowColor: ledgerPalette.primary,
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.84)",
    borderWidth: 1,
    borderColor: ledgerPalette.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: ledgerPalette.text,
    fontSize: 15,
    fontWeight: "700",
  },
  listCard: {
    borderRadius: 28,
    backgroundColor: ledgerPalette.surface,
    padding: 20,
    borderWidth: 1,
    borderColor: ledgerPalette.border,
    shadowColor: ledgerPalette.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  emptyListCard: {
    marginTop: 18,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 18,
    backgroundColor: ledgerPalette.panelSoft,
    borderWidth: 1,
    borderColor: ledgerPalette.border,
  },
  emptyListText: {
    color: ledgerPalette.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  listItem: {
    marginTop: 16,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.96)",
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderWidth: 1,
    borderColor: ledgerPalette.border,
    shadowColor: "#FFFFFF",
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: -3, height: -3 },
  },
  listItemTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
  },
  listTitle: {
    flex: 1,
    color: ledgerPalette.text,
    fontSize: 15,
    fontWeight: "700",
  },
  listAmount: {
    color: ledgerPalette.primary,
    fontSize: 15,
    fontWeight: "800",
  },
  listMeta: {
    marginTop: 8,
    color: ledgerPalette.muted,
    fontSize: 13,
  },
  listTime: {
    marginTop: 4,
    color: ledgerPalette.softText,
    fontSize: 12,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: ledgerPalette.text,
    fontWeight: "800",
    fontSize: 24,
  },
});
