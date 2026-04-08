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
import { syncMockSpaceToDatabase } from "./dbSync";
import { getCurrentUser, getSpaceByCode, type SpaceData } from "./mockApp";

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

// BookkeepingPage 负责记录账单，并从 WatermelonDB 读回历史数据。
export default function BookkeepingPage() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const spaceCode = typeof code === "string" ? code : "";

  const currentUser = getCurrentUser();
  // space 保存当前激活的旅行空间快照，来源于 mock 领域层。
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
      records
        .filter((item) => !item.deletedAt)
        .map((item) => ({
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

    const memberIds = new Set(
      space.spaceMembers
        .filter((item) => !item.deleted_at)
        .map((item) => item.user_id),
    );

    return space.users.filter(
      (user) => !user.deleted_at && memberIds.has(user.id),
    );
  }, [space]);

  // userNameById 让账单列表能用 payerId 快速映射出昵称。
  const userNameById = useMemo(
    () =>
      new Map(
        memberUsers.map((user) => [user.id, user.nickname || "未命名成员"]),
      ),
    [memberUsers],
  );

  // summary 汇总总支出和人均支出，供顶部统计卡片展示。
  const summary = useMemo(() => {
    const total = allExpenses.reduce((acc, item) => acc + item.amountYuan, 0);
    const avg = memberUsers.length ? total / memberUsers.length : 0;
    return { total, avg };
  }, [allExpenses, memberUsers.length]);

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
        expense.deletedAt = null;
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
            <Text style={styles.title}>旅行记账</Text>
            <Text style={styles.subtitle}>
              把每一笔旅途中消费都整理成轻盈好读的账单。
            </Text>
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

        <View style={styles.summaryCard}>
          <View style={styles.summaryHeader}>
            <SoftIconBadge name="wallet-outline" tone="peach" size={54} />
            <View style={styles.summaryHeaderTextWrap}>
              <Text style={styles.summaryTitle}>旅途总览</Text>
              <Text style={styles.summarySubtitle}>
                {space.name} · {memberUsers.length} 人同行
              </Text>
            </View>
          </View>

          <View style={styles.summaryGrid}>
            <View style={styles.summaryItem}>
              <SoftIconBadge
                name="logo-yen"
                tone="sky"
                size={46}
                iconSize={20}
              />
              <Text style={styles.summaryLabel}>总金额</Text>
              <Text style={styles.summaryValue}>
                {formatAmount(summary.total)}
              </Text>
            </View>
            <View style={styles.summaryItem}>
              <SoftIconBadge
                name="people-outline"
                tone="mint"
                size={46}
                iconSize={20}
              />
              <Text style={styles.summaryLabel}>人均分摊</Text>
              <Text style={styles.summaryValue}>
                {formatAmount(summary.avg)}
              </Text>
            </View>
            <View style={styles.summaryItem}>
              <SoftIconBadge
                name="card-outline"
                tone="violet"
                size={46}
                iconSize={20}
              />
              <Text style={styles.summaryLabel}>默认付款人</Text>
              <Text style={styles.summaryValueSmall}>
                {currentUser.username}
              </Text>
            </View>
          </View>
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
            placeholderTextColor="#97A9BC"
            style={styles.input}
          />
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="金额"
            keyboardType="decimal-pad"
            placeholderTextColor="#97A9BC"
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
                还没有账单，先记下第一笔旅行消费吧。
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
  safeArea: { flex: 1, backgroundColor: "#F4F7FB" },
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
    color: "#1D2C40",
    fontSize: 30,
    fontWeight: "800",
  },
  subtitle: {
    marginTop: 10,
    color: "#6E8198",
    fontSize: 14,
    lineHeight: 22,
    maxWidth: 260,
  },
  backButton: {
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5ECF6",
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: "#CDD8E7",
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  backButtonText: {
    color: "#2E4463",
    fontSize: 14,
    fontWeight: "700",
  },
  summaryCard: {
    borderRadius: 28,
    backgroundColor: "#FFFFFF",
    padding: 20,
    shadowColor: "#C5D3E2",
    shadowOpacity: 0.14,
    shadowRadius: 22,
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
    color: "#203044",
    fontSize: 18,
    fontWeight: "800",
  },
  summarySubtitle: {
    marginTop: 4,
    color: "#7588A0",
    fontSize: 13,
  },
  summaryGrid: {
    marginTop: 18,
    gap: 12,
  },
  summaryItem: {
    borderRadius: 22,
    backgroundColor: "#F8FBFF",
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "#EEF2F8",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  summaryLabel: {
    flex: 1,
    color: "#6B7E96",
    fontSize: 13,
    fontWeight: "600",
  },
  summaryValue: {
    color: "#22364E",
    fontSize: 16,
    fontWeight: "800",
  },
  summaryValueSmall: {
    color: "#22364E",
    fontSize: 15,
    fontWeight: "700",
  },
  editorCard: {
    borderRadius: 28,
    backgroundColor: "#FFFFFF",
    padding: 20,
    shadowColor: "#C5D3E2",
    shadowOpacity: 0.12,
    shadowRadius: 20,
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
    color: "#203044",
    fontSize: 18,
    fontWeight: "800",
  },
  sectionSubtitle: {
    marginTop: 4,
    color: "#7387A0",
    fontSize: 13,
    lineHeight: 20,
  },
  input: {
    marginTop: 16,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "#F8FBFF",
    borderWidth: 1,
    borderColor: "#E6EDF7",
    color: "#24364D",
    fontSize: 15,
  },
  buttonRow: {
    marginTop: 18,
    flexDirection: "row",
    gap: 12,
  },
  primaryButton: {
    flex: 1,
    borderRadius: 22,
    backgroundColor: "#4D7CFE",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    shadowColor: "#4D7CFE",
    shadowOpacity: 0.24,
    shadowRadius: 20,
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
    backgroundColor: "#F7FAFF",
    borderWidth: 1,
    borderColor: "#E4EBF5",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: "#2A3E57",
    fontSize: 15,
    fontWeight: "700",
  },
  listCard: {
    borderRadius: 28,
    backgroundColor: "#FFFFFF",
    padding: 20,
    shadowColor: "#C5D3E2",
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  emptyListCard: {
    marginTop: 18,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 18,
    backgroundColor: "#F8FBFF",
    borderWidth: 1,
    borderColor: "#EEF2F8",
  },
  emptyListText: {
    color: "#7588A0",
    fontSize: 14,
    lineHeight: 20,
  },
  listItem: {
    marginTop: 16,
    borderRadius: 22,
    backgroundColor: "#F9FBFF",
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderWidth: 1,
    borderColor: "#EEF2F8",
  },
  listItemTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
  },
  listTitle: {
    flex: 1,
    color: "#203146",
    fontSize: 15,
    fontWeight: "700",
  },
  listAmount: {
    color: "#4D7CFE",
    fontSize: 15,
    fontWeight: "800",
  },
  listMeta: {
    marginTop: 8,
    color: "#6C8098",
    fontSize: 13,
  },
  listTime: {
    marginTop: 4,
    color: "#94A4B8",
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
    color: "#1D2B42",
    fontWeight: "800",
    fontSize: 24,
  },
});
