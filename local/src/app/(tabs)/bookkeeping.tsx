// 空间记账页：负责新增账单、查看历史账单，并维护仅保存在本地的分摊设置。
import { Ionicons } from "@expo/vector-icons";
import { Q } from "@nozbe/watermelondb";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Modal,
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
  deleteExpenseSplitSelection,
  readExpenseSplitSelections,
  saveExpenseSplitSelection,
  type ExpenseSplitMap,
} from "@/lib/expenseSplitStore";
import { createUlid } from "@/lib/ids";
import { assignModelId, dateToTimestamp } from "@/lib/watermelon";
import {
  deleteExpenseLocally,
  getSpaceSnapshotFromDb,
  type SpaceData,
} from "@/features/travel/spaceDb";
import {
  ensureCurrentUserProfileInDb,
  type UserProfileData,
} from "@/features/travel/userDb";
import { database } from "@/model";
import Expense from "@/model/Expense";

// LedgerExpense 是记账页渲染账单列表时使用的轻量视图模型。
type LedgerExpense = {
  id: string;
  amountYuan: number;
  description: string;
  payerId: string;
  createdAt: number;
};

type SplitMode = "all" | "partial";

function formatAmount(amount: number) {
  return `${amount.toFixed(2)} 元`;
}

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
  shadow: "#BFDCCC",
  overlay: "rgba(19, 31, 25, 0.22)",
};

export default function BookkeepingPage() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const spaceCode = typeof code === "string" ? code : "";

  // space 保存当前空间快照，包含成员和用户信息。
  const [space, setSpace] = useState<SpaceData | null>(null);
  // currentProfile 用来标记当前设备上的本地用户。
  const [currentProfile, setCurrentProfile] = useState<UserProfileData | null>(
    null,
  );
  // dbExpenses 保存本地数据库中的历史账单。
  const [dbExpenses, setDbExpenses] = useState<LedgerExpense[]>([]);
  // expenseSplits 保存每条账单对应的本地分摊参与人，不写入数据库。
  const [expenseSplits, setExpenseSplits] = useState<ExpenseSplitMap>({});
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [splitEditorVisible, setSplitEditorVisible] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [splitMode, setSplitMode] = useState<SplitMode>("all");
  const [draftParticipantIds, setDraftParticipantIds] = useState<string[]>([]);

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

  const loadExpenseSplits = useCallback(async (spaceId: string) => {
    const splitMap = await readExpenseSplitSelections(spaceId);
    setExpenseSplits(splitMap);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!spaceCode) {
        setSpace(null);
        setDbExpenses([]);
        setExpenseSplits({});
        return;
      }

      void (async () => {
        const profile = await ensureCurrentUserProfileInDb();
        setCurrentProfile(profile);
        const nextSpace = await getSpaceSnapshotFromDb(spaceCode);
        setSpace(nextSpace);
        if (nextSpace) {
          await Promise.all([
            loadDbExpenses(nextSpace.id),
            loadExpenseSplits(nextSpace.id),
          ]);
        } else {
          setDbExpenses([]);
          setExpenseSplits({});
        }
      })();
    }, [spaceCode, loadDbExpenses, loadExpenseSplits]),
  );

  const allExpenses = useMemo(
    () => [...dbExpenses].sort((a, b) => b.createdAt - a.createdAt),
    [dbExpenses],
  );

  // memberUsers 只保留当前仍在空间中的成员，方便分摊设置和显示昵称。
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

  const resolveParticipantIds = useCallback(
    (expenseId: string) => {
      const localParticipants = (expenseSplits[expenseId] ?? []).filter((id) =>
        memberIds.includes(id),
      );
      return localParticipants.length > 0 ? localParticipants : memberIds;
    },
    [expenseSplits, memberIds],
  );

  const buildSplitSummary = useCallback(
    (expenseId: string) => {
      const participantIds = resolveParticipantIds(expenseId);
      if (
        participantIds.length === 0 ||
        participantIds.length === memberIds.length
      ) {
        return "所有成员AA";
      }

      const names = participantIds
        .map((id) => userNameById.get(id) || "未命名成员")
        .slice(0, 3);
      const suffix =
        participantIds.length > names.length
          ? ` 等${participantIds.length}人`
          : "";
      return `部分成员AA：${names.join("、")}${suffix}`;
    },
    [memberIds.length, resolveParticipantIds, userNameById],
  );

  const resetSplitEditor = useCallback(() => {
    setSplitEditorVisible(false);
    setEditingExpenseId(null);
    setSplitMode("all");
    setDraftParticipantIds([]);
  }, []);

  const openSplitEditor = useCallback(
    (expenseId: string) => {
      const participantIds = resolveParticipantIds(expenseId);
      const nextMode: SplitMode =
        participantIds.length === 0 ||
        participantIds.length === memberIds.length
          ? "all"
          : "partial";
      setEditingExpenseId(expenseId);
      setSplitMode(nextMode);
      setDraftParticipantIds(
        nextMode === "all" ? [...memberIds] : [...participantIds],
      );
      setSplitEditorVisible(true);
    },
    [memberIds, resolveParticipantIds],
  );

  const toggleDraftParticipant = useCallback((userId: string) => {
    setDraftParticipantIds((current) =>
      current.includes(userId)
        ? current.filter((item) => item !== userId)
        : [...current, userId],
    );
  }, []);

  const onSaveSplit = useCallback(async () => {
    if (!space || !editingExpenseId) {
      return;
    }

    const participantIds =
      splitMode === "all"
        ? memberIds
        : draftParticipantIds.filter((id) => memberIds.includes(id));

    if (participantIds.length === 0) {
      Alert.alert("保存失败", "部分成员AA时，至少需要选择一位成员。");
      return;
    }

    await saveExpenseSplitSelection({
      spaceId: space.id,
      expenseId: editingExpenseId,
      participantIds,
    });
    await loadExpenseSplits(space.id);
    resetSplitEditor();
  }, [
    draftParticipantIds,
    editingExpenseId,
    loadExpenseSplits,
    memberIds,
    resetSplitEditor,
    space,
    splitMode,
  ]);

  const onAddBill = async () => {
    if (!space || !currentProfile) {
      return;
    }

    const cleanTitle = title.trim();
    const parsedAmount = Number(amount);
    if (!cleanTitle) {
      Alert.alert("添加失败", "请输入账单名称。");
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Alert.alert("添加失败", "金额必须大于 0。");
      return;
    }

    const amountInCent = Math.round(parsedAmount * 100);
    await database.write(async () => {
      const collection = database.collections.get<Expense>("expenses");
      await collection.create((expense) => {
        assignModelId(expense, createUlid());
        expense.spaceId = space.id;
        expense.payerId = currentProfile.id;
        expense.amount = amountInCent;
        expense.description = cleanTitle;
      });
    });

    await loadDbExpenses(space.id);
    setTitle("");
    setAmount("");
  };

  const onSettle = () => {
    if (!space) {
      return;
    }
    router.push({ pathname: "/settlement", params: { code: spaceCode } });
  };

  const onDeleteBill = (expenseId: string) => {
    if (!space) {
      return;
    }

    Alert.alert(
      "删除账单",
      "这笔账单会先从本地删除，之后是否同步由你手动决定。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "删除",
          style: "destructive",
          onPress: () => {
            void (async () => {
              const ok = await deleteExpenseLocally(expenseId);
              if (!ok) {
                Alert.alert("删除失败", "没有找到这笔本地账单。");
                return;
              }
              await deleteExpenseSplitSelection(space.id, expenseId);
              await Promise.all([
                loadDbExpenses(space.id),
                loadExpenseSplits(space.id),
              ]);
            })();
          },
        },
      ],
    );
  };

  const editingExpense = useMemo(
    () => allExpenses.find((item) => item.id === editingExpenseId) ?? null,
    [allExpenses, editingExpenseId],
  );

  if (!space) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>记账页面暂时不可用</Text>
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
                输入项目和金额，新的记录会立刻进入清单。
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
                这里可以为每笔账单设置“所有成员AA”或“部分成员AA”，只影响本地结算计算。
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
                  <View style={styles.listTitleWrap}>
                    <Text style={styles.listTitle}>{item.description}</Text>
                    <Text style={styles.listAmount}>
                      {formatAmount(item.amountYuan)}
                    </Text>
                  </View>
                  <Pressable
                    style={styles.deleteBillButton}
                    onPress={() => onDeleteBill(item.id)}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={16}
                      color={ledgerPalette.muted}
                    />
                    <Text style={styles.deleteBillButtonText}>删除</Text>
                  </Pressable>
                </View>
                <Text style={styles.listMeta}>
                  付款人：{userNameById.get(item.payerId) || "未知成员"}
                </Text>
                <Text style={styles.listSplitText}>
                  分摊方式：{buildSplitSummary(item.id)}
                </Text>
                <Text style={styles.listTime}>
                  {formatDate(item.createdAt)}
                </Text>

                <View style={styles.listActionRow}>
                  <Pressable
                    style={styles.splitButton}
                    onPress={() => openSplitEditor(item.id)}
                  >
                    <Ionicons
                      name="people-outline"
                      size={16}
                      color={ledgerPalette.secondary}
                    />
                    <Text style={styles.splitButtonText}>分摊设置</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <Modal
        visible={splitEditorVisible}
        transparent
        animationType="fade"
        onRequestClose={resetSplitEditor}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={resetSplitEditor} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>设置分摊成员</Text>
            <Text style={styles.modalSubtitle}>
              {editingExpense
                ? `当前账单：${editingExpense.description}`
                : "为这笔账单设置本地分摊方式。"}
            </Text>
            <Text style={styles.modalHint}>
              这里只影响“查看结算”的本地计算，不会写入数据库。
            </Text>

            <View style={styles.modeRow}>
              <Pressable
                style={[
                  styles.modeButton,
                  splitMode === "all" && styles.modeButtonActive,
                ]}
                onPress={() => {
                  setSplitMode("all");
                  setDraftParticipantIds([...memberIds]);
                }}
              >
                <Text
                  style={[
                    styles.modeButtonText,
                    splitMode === "all" && styles.modeButtonTextActive,
                  ]}
                >
                  所有成员AA
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modeButton,
                  splitMode === "partial" && styles.modeButtonActive,
                ]}
                onPress={() => {
                  setSplitMode("partial");
                  setDraftParticipantIds((current) =>
                    current.length > 0 ? current : [...memberIds],
                  );
                }}
              >
                <Text
                  style={[
                    styles.modeButtonText,
                    splitMode === "partial" && styles.modeButtonTextActive,
                  ]}
                >
                  部分成员AA
                </Text>
              </Pressable>
            </View>

            {splitMode === "partial" ? (
              <View style={styles.memberChipWrap}>
                {memberUsers.map((user) => {
                  const selected = draftParticipantIds.includes(user.id);
                  return (
                    <Pressable
                      key={user.id}
                      style={[
                        styles.memberChip,
                        selected && styles.memberChipSelected,
                      ]}
                      onPress={() => toggleDraftParticipant(user.id)}
                    >
                      <Text
                        style={[
                          styles.memberChipText,
                          selected && styles.memberChipTextSelected,
                        ]}
                      >
                        {user.nickname || "未命名成员"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View style={styles.allSelectedCard}>
                <Text style={styles.allSelectedText}>
                  当前设置为：所有成员共同承担这笔账单。
                </Text>
              </View>
            )}

            <View style={styles.modalButtonRow}>
              <Pressable
                style={styles.modalSecondaryButton}
                onPress={resetSplitEditor}
              >
                <Text style={styles.modalSecondaryButtonText}>取消</Text>
              </Pressable>
              <Pressable
                style={styles.modalPrimaryButton}
                onPress={() => void onSaveSplit()}
              >
                <Text style={styles.modalPrimaryButtonText}>保存设置</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  listTitleWrap: {
    flex: 1,
    gap: 6,
  },
  listTitle: {
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
  listSplitText: {
    marginTop: 6,
    color: ledgerPalette.secondary,
    fontSize: 13,
    fontWeight: "700",
  },
  listTime: {
    marginTop: 4,
    color: ledgerPalette.softText,
    fontSize: 12,
  },
  listActionRow: {
    marginTop: 12,
    flexDirection: "row",
  },
  splitButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: ledgerPalette.borderStrong,
    backgroundColor: ledgerPalette.panelSoft,
  },
  splitButtonText: {
    color: ledgerPalette.secondary,
    fontSize: 12,
    fontWeight: "800",
  },
  deleteBillButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: ledgerPalette.border,
    backgroundColor: "rgba(255,255,255,0.78)",
  },
  deleteBillButtonText: {
    color: ledgerPalette.muted,
    fontSize: 12,
    fontWeight: "700",
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
  modalRoot: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: ledgerPalette.overlay,
  },
  modalCard: {
    borderRadius: 28,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: ledgerPalette.border,
    padding: 20,
    shadowColor: ledgerPalette.shadow,
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  },
  modalTitle: {
    color: ledgerPalette.text,
    fontSize: 20,
    fontWeight: "800",
  },
  modalSubtitle: {
    marginTop: 10,
    color: ledgerPalette.text,
    fontSize: 14,
    fontWeight: "600",
  },
  modalHint: {
    marginTop: 8,
    color: ledgerPalette.muted,
    fontSize: 13,
    lineHeight: 20,
  },
  modeRow: {
    marginTop: 18,
    flexDirection: "row",
    gap: 10,
  },
  modeButton: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: ledgerPalette.borderStrong,
    backgroundColor: ledgerPalette.panelSoft,
    paddingVertical: 12,
    alignItems: "center",
  },
  modeButtonActive: {
    backgroundColor: "rgba(96,194,142,0.16)",
    borderColor: ledgerPalette.primary,
  },
  modeButtonText: {
    color: ledgerPalette.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  modeButtonTextActive: {
    color: ledgerPalette.secondary,
  },
  memberChipWrap: {
    marginTop: 18,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  memberChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: ledgerPalette.borderStrong,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  memberChipSelected: {
    backgroundColor: "rgba(96,194,142,0.16)",
    borderColor: ledgerPalette.primary,
  },
  memberChipText: {
    color: ledgerPalette.text,
    fontSize: 13,
    fontWeight: "700",
  },
  memberChipTextSelected: {
    color: ledgerPalette.secondary,
  },
  allSelectedCard: {
    marginTop: 18,
    borderRadius: 18,
    backgroundColor: ledgerPalette.panelSoft,
    borderWidth: 1,
    borderColor: ledgerPalette.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  allSelectedText: {
    color: ledgerPalette.muted,
    fontSize: 13,
    lineHeight: 20,
  },
  modalButtonRow: {
    marginTop: 22,
    flexDirection: "row",
    gap: 12,
  },
  modalSecondaryButton: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: ledgerPalette.borderStrong,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
  },
  modalSecondaryButtonText: {
    color: ledgerPalette.text,
    fontSize: 14,
    fontWeight: "700",
  },
  modalPrimaryButton: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: ledgerPalette.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
  },
  modalPrimaryButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
});
