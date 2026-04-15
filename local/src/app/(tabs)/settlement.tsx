// 空间结算页：根据本地账单和本地分摊设置，计算成员之间最少的转账方案。
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
import { readExpenseSplitSelections } from "@/lib/expenseSplitStore";
import {
  getSpaceSnapshotFromDb,
  type SpaceData,
} from "@/features/travel/spaceDb";
import { ensureCurrentUserProfileInDb } from "@/features/travel/userDb";
import { database } from "@/model";
import Expense from "@/model/Expense";

type LedgerExpense = {
  id: string;
  amountYuan: number;
  payerId: string;
  participantIds: string[];
};

type Settlement = {
  fromId: string;
  toId: string;
  amount: number;
};

const statPalette = {
  background: "#F4FBF6",
  surface: "rgba(255,255,255,0.78)",
  panel: "#FFFFFF",
  border: "#DDEDE3",
  text: "#1E2438",
  muted: "#6F7897",
  primary: "#60C28E",
  shadow: "#BFDCCC",
};

// calcSettlements 会先计算每个人“实际支付”和“应承担”的差额，再压缩成最少转账方案。
function calcSettlements(
  memberIds: string[],
  expenses: LedgerExpense[],
): Settlement[] {
  if (memberIds.length === 0) {
    return [];
  }

  const paid: Record<string, number> = {};
  const owed: Record<string, number> = {};
  memberIds.forEach((memberId) => {
    paid[memberId] = 0;
    owed[memberId] = 0;
  });

  expenses.forEach((expense) => {
    if (!expense.payerId || !memberIds.includes(expense.payerId)) {
      return;
    }

    paid[expense.payerId] = (paid[expense.payerId] ?? 0) + expense.amountYuan;
    const participants = expense.participantIds.filter((id) =>
      memberIds.includes(id),
    );
    const finalParticipants =
      participants.length > 0 ? participants : [...memberIds];
    const share = expense.amountYuan / finalParticipants.length;

    finalParticipants.forEach((participantId) => {
      owed[participantId] = Number(
        ((owed[participantId] ?? 0) + share).toFixed(2),
      );
    });
  });

  const creditors: { user: string; amount: number }[] = [];
  const debtors: { user: string; amount: number }[] = [];

  memberIds.forEach((memberId) => {
    const net = Number(
      ((paid[memberId] ?? 0) - (owed[memberId] ?? 0)).toFixed(2),
    );
    if (net > 0) {
      creditors.push({ user: memberId, amount: net });
    } else if (net < 0) {
      debtors.push({ user: memberId, amount: Math.abs(net) });
    }
  });

  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const result: Settlement[] = [];
  let debtIndex = 0;
  let creditIndex = 0;

  while (debtIndex < debtors.length && creditIndex < creditors.length) {
    const debt = debtors[debtIndex];
    const credit = creditors[creditIndex];
    const amount = Number(Math.min(debt.amount, credit.amount).toFixed(2));

    if (amount > 0) {
      result.push({ fromId: debt.user, toId: credit.user, amount });
    }

    debt.amount = Number((debt.amount - amount).toFixed(2));
    credit.amount = Number((credit.amount - amount).toFixed(2));

    if (debt.amount <= 0.009) {
      debtIndex += 1;
    }
    if (credit.amount <= 0.009) {
      creditIndex += 1;
    }
  }

  return result;
}

export default function SettlementPage() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const spaceCode = typeof code === "string" ? code : "";

  const [space, setSpace] = useState<SpaceData | null>(null);
  const [dbExpenses, setDbExpenses] = useState<LedgerExpense[]>([]);

  const loadDbExpenses = useCallback(async (spaceId: string) => {
    const collection = database.collections.get<Expense>("expenses");
    const [records, splitMap] = await Promise.all([
      collection
        .query(Q.where("space_id", spaceId), Q.sortBy("created_at", Q.desc))
        .fetch(),
      readExpenseSplitSelections(spaceId),
    ]);

    setDbExpenses(
      records.map((item) => ({
        id: item.id,
        amountYuan: item.amount / 100,
        payerId: item.payerId || "",
        participantIds: splitMap[item.id] ?? [],
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

      void (async () => {
        await ensureCurrentUserProfileInDb();
        const nextSpace = await getSpaceSnapshotFromDb(spaceCode);
        setSpace(nextSpace);
        if (nextSpace) {
          await loadDbExpenses(nextSpace.id);
        } else {
          setDbExpenses([]);
        }
      })();
    }, [spaceCode, loadDbExpenses]),
  );

  const memberUsers = useMemo(() => {
    if (!space) {
      return [];
    }

    const memberIds = new Set(space.spaceMembers.map((item) => item.user_id));
    return space.users.filter((user) => memberIds.has(user.id));
  }, [space]);

  const memberIds = useMemo(
    () => memberUsers.map((user) => user.id),
    [memberUsers],
  );

  const userNameById = useMemo(
    () =>
      new Map(
        memberUsers.map((user) => [user.id, user.nickname || "未命名成员"]),
      ),
    [memberUsers],
  );

  const settlements = useMemo(
    () => calcSettlements(memberIds, dbExpenses),
    [dbExpenses, memberIds],
  );

  const totalTransfer = useMemo(
    () => settlements.reduce((sum, item) => sum + item.amount, 0),
    [settlements],
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
              根据本地账单和分摊设置，计算当前空间的结算结果。
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
              目前的账单已经平衡，或者还没有形成需要结算的记录。
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
                    这条结果已经把本地设置的“部分成员AA”一起考虑进来了。
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
    maxWidth: 260,
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
    gap: 12,
  },
  summaryItem: {
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.92)",
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: statPalette.border,
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
    color: statPalette.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  summaryValue: {
    color: statPalette.text,
    fontSize: 16,
    fontWeight: "800",
  },
  emptyCard: {
    borderRadius: 28,
    backgroundColor: statPalette.surface,
    paddingHorizontal: 18,
    paddingVertical: 22,
    borderWidth: 1,
    borderColor: statPalette.border,
    alignItems: "center",
    gap: 12,
    shadowColor: statPalette.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  emptyTitle: {
    color: statPalette.text,
    fontSize: 20,
    fontWeight: "800",
  },
  emptyText: {
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
    gap: 16,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  cardTextWrap: { flex: 1 },
  mainText: {
    color: statPalette.text,
    fontSize: 17,
    fontWeight: "700",
    lineHeight: 26,
  },
  subText: {
    marginTop: 8,
    color: statPalette.muted,
    fontSize: 13,
    lineHeight: 20,
  },
  amountText: {
    color: statPalette.primary,
    fontSize: 28,
    fontWeight: "800",
  },
});
