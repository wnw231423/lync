// 空间结算页：根据账单记录计算成员之间的最少转账方案。
import { Q } from "@nozbe/watermelondb";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SoftIconBadge } from "@/components/SoftIconBadge";
import { database } from "@/model";
import Expense from "@/model/Expense";
import { syncMockSpaceToDatabase } from "@/features/travel/dbSync";
import { getSpaceByCode, type SpaceData } from "@/features/travel/mockApp";

// LedgerExpense 是结算算法真正需要的最小账单信息。
type LedgerExpense = {
  amountYuan: number;
  payerId: string;
};

// Settlement 描述一笔最终需要执行的转账路径。
type Settlement = {
  fromId: string;
  toId: string;
  amount: number;
};

const statPalette = {
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
  shadow: "#BFDCCC",
};

// calcSettlements 会把所有成员的收支差额压缩成尽量少的转账方案。
function calcSettlements(
  memberIds: string[],
  expenses: LedgerExpense[],
): Settlement[] {
  if (memberIds.length === 0) {
    return [];
  }

  // paid 先汇总每位成员实际垫付了多少钱。
  const paid: Record<string, number> = {};
  memberIds.forEach((memberId) => {
    paid[memberId] = 0;
  });

  const total = expenses.reduce((acc, item) => acc + item.amountYuan, 0);
  expenses.forEach((expense) => {
    paid[expense.payerId] = (paid[expense.payerId] ?? 0) + expense.amountYuan;
  });

  // share 是所有成员理论上应当平均承担的金额。
  const share = total / memberIds.length;
  const creditors: { user: string; amount: number }[] = [];
  const debtors: { user: string; amount: number }[] = [];

  memberIds.forEach((memberId) => {
    const net = Number(((paid[memberId] ?? 0) - share).toFixed(2));
    if (net > 0) {
      creditors.push({ user: memberId, amount: net });
    } else if (net < 0) {
      debtors.push({ user: memberId, amount: Math.abs(net) });
    }
  });

  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const result: Settlement[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debt = debtors[i];
    const credit = creditors[j];
    const amount = Number(Math.min(debt.amount, credit.amount).toFixed(2));

    if (amount > 0) {
      result.push({ fromId: debt.user, toId: credit.user, amount });
    }

    debt.amount = Number((debt.amount - amount).toFixed(2));
    credit.amount = Number((credit.amount - amount).toFixed(2));

    if (debt.amount <= 0.009) {
      i += 1;
    }
    if (credit.amount <= 0.009) {
      j += 1;
    }
  }

  return result;
}

// SettlementPage 用来展示当前空间里谁该向谁转账结算。
export default function SettlementPage() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const spaceCode = typeof code === "string" ? code : "";

  // space 保存当前空间快照，用来拿成员关系和用户昵称。
  const [space, setSpace] = useState<SpaceData | null>(() =>
    spaceCode ? getSpaceByCode(spaceCode) : null,
  );
  // dbExpenses 是从本地数据库读取出的结算输入数据。
  const [dbExpenses, setDbExpenses] = useState<LedgerExpense[]>([]);

  // loadDbExpenses 读取规范化账单数据，供结算算法计算使用。
  const loadDbExpenses = useCallback(async (spaceId: string) => {
    const collection = database.collections.get<Expense>("expenses");
    const records = await collection
      .query(Q.where("space_id", spaceId), Q.sortBy("created_at", Q.desc))
      .fetch();

    setDbExpenses(
      records.map((item) => ({
        amountYuan: item.amount / 100,
        payerId: item.payerId || "",
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

  // settlements 是经算法压缩后的最少转账方案。
  const settlements = useMemo(() => {
    if (!space) {
      return [];
    }

    const memberIds = space.spaceMembers.map((item) => item.user_id);
    return calcSettlements(memberIds, dbExpenses);
  }, [space, dbExpenses]);

  // totalTransfer 方便页面顶部快速展示总共需要转账多少金额。
  const totalTransfer = useMemo(
    () => settlements.reduce((sum, item) => sum + item.amount, 0),
    [settlements],
  );

  // memberUsers 用来把结算结果里的用户 id 映射回可读昵称。
  const memberUsers = useMemo(() => {
    if (!space) {
      return [];
    }

    const memberIds = new Set(space.spaceMembers.map((item) => item.user_id));

    return space.users.filter((user) => memberIds.has(user.id));
  }, [space]);

  const userNameById = useMemo(
    () =>
      new Map(
        memberUsers.map((user) => [user.id, user.nickname || "未命名成员"]),
      ),
    [memberUsers],
  );

  const memberCount = memberUsers.length;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>平摊结算</Text>
            <Text style={styles.subtitle}>
              用最少的转账次数完成当前空间的费用结清。
            </Text>
          </View>
          <Pressable
            style={styles.backButton}
            onPress={() =>
              router.replace({
                pathname: "/bookkeeping",
                params: { code: spaceCode },
              })
            }
          >
            <Text style={styles.backButtonText}>返回记账</Text>
          </Pressable>
        </View>

        <View style={styles.summaryCard}>
          <View style={styles.summaryHeader}>
            <SoftIconBadge
              name="swap-horizontal-outline"
              tone="mint"
              size={54}
            />
            <View style={styles.summaryHeaderTextWrap}>
              <Text style={styles.summaryTitle}>结算概览</Text>
              <Text style={styles.summarySubtitle}>
                {space?.name || "共享空间"} · {memberCount} 位成员
              </Text>
            </View>
          </View>

          <View style={styles.summaryGrid}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>需要转账</Text>
              <Text style={styles.summaryValue}>{settlements.length} 笔</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>待结金额</Text>
              <Text style={styles.summaryValue}>
                {totalTransfer.toFixed(2)} 元
              </Text>
            </View>
          </View>
        </View>

        {settlements.length === 0 ? (
          <View style={styles.emptyCard}>
            <SoftIconBadge
              name="checkmark-done-outline"
              tone="aqua"
              size={54}
            />
            <Text style={styles.emptyTitle}>当前无需转账</Text>
            <Text style={styles.emptyText}>
              账目已经平衡，大家可以轻松继续协作。
            </Text>
          </View>
        ) : (
          settlements.map((item, idx) => (
            <View
              key={`${item.fromId}-${item.toId}-${idx}`}
              style={styles.card}
            >
              <View style={styles.cardTop}>
                <SoftIconBadge
                  name="card-outline"
                  tone="peach"
                  size={48}
                  iconSize={20}
                />
                <View style={styles.cardTextWrap}>
                  <Text style={styles.mainText}>
                    {userNameById.get(item.fromId) || "成员"} 需要支付给{" "}
                    {userNameById.get(item.toId) || "成员"}
                  </Text>
                  <Text style={styles.subText}>
                    建议当面确认或备注本次空间结算。
                  </Text>
                </View>
              </View>
              <Text style={styles.amountText}>{item.amount.toFixed(2)} 元</Text>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: statPalette.background },
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
    color: statPalette.text,
    fontSize: 30,
    fontWeight: "800",
  },
  subtitle: {
    marginTop: 10,
    color: statPalette.muted,
    fontSize: 14,
    lineHeight: 22,
    maxWidth: 250,
  },
  backButton: {
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.84)",
    borderWidth: 1,
    borderColor: statPalette.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: statPalette.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  backButtonText: {
    color: statPalette.primary,
    fontSize: 14,
    fontWeight: "700",
  },
  summaryCard: {
    borderRadius: 28,
    backgroundColor: statPalette.surface,
    padding: 20,
    borderWidth: 1,
    borderColor: statPalette.border,
    shadowColor: statPalette.shadow,
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
    color: statPalette.text,
    fontSize: 18,
    fontWeight: "800",
  },
  summarySubtitle: {
    marginTop: 4,
    color: statPalette.muted,
    fontSize: 13,
  },
  summaryGrid: {
    marginTop: 18,
    flexDirection: "row",
    gap: 12,
  },
  summaryItem: {
    flex: 1,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.92)",
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: statPalette.border,
    shadowColor: "#FFFFFF",
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: -3, height: -3 },
  },
  summaryLabel: {
    color: statPalette.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  summaryValue: {
    marginTop: 8,
    color: statPalette.text,
    fontSize: 20,
    fontWeight: "800",
  },
  emptyCard: {
    borderRadius: 28,
    backgroundColor: statPalette.surface,
    paddingHorizontal: 22,
    paddingVertical: 30,
    alignItems: "center",
    borderWidth: 1,
    borderColor: statPalette.border,
    shadowColor: statPalette.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  emptyTitle: {
    marginTop: 16,
    color: statPalette.text,
    fontSize: 22,
    fontWeight: "800",
  },
  emptyText: {
    marginTop: 8,
    color: statPalette.muted,
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
  },
  card: {
    borderRadius: 28,
    backgroundColor: statPalette.surface,
    padding: 20,
    borderWidth: 1,
    borderColor: statPalette.border,
    shadowColor: statPalette.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  cardTop: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },
  cardTextWrap: {
    flex: 1,
  },
  mainText: {
    color: statPalette.text,
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 24,
  },
  subText: {
    marginTop: 6,
    color: statPalette.muted,
    fontSize: 13,
    lineHeight: 20,
  },
  amountText: {
    marginTop: 18,
    color: statPalette.primary,
    fontSize: 24,
    fontWeight: "800",
  },
});
