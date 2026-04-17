import { useEffect, useMemo, useState } from "react";
import { Button, FlatList, StyleSheet, Text, View } from "react-native";
import { database } from "@/model";
import Expense from "@/model/Expense";
import { createUlid } from "@/lib/ids";
import { assignModelId } from "@/lib/watermelon";

// 这几组常量都是数据库冒烟测试页专用的假数据，不参与正式业务流程。
const DEMO_SPACE_ID = "demo_space_001";
const DEMO_PAYERS = ["user_a", "user_b", "user_c"];
const DEMO_EXPENSES = ["酒店", "打车", "晚餐", "门票", "咖啡"];

// DatabaseTestScreen 是一个轻量的 WatermelonDB 手动冒烟测试页。
export default function DatabaseTestScreen() {
  // expenses 直接观察 `expenses` 表，方便在测试页实时看到增删结果。
  const [expenses, setExpenses] = useState<Expense[]>([]);

  useEffect(() => {
    const collection = database.collections.get<Expense>("expenses");
    const subscription = collection
      .query()
      .observe()
      .subscribe((records) => setExpenses(records));

    return () => subscription.unsubscribe();
  }, []);

  const total = useMemo(
    () => expenses.reduce((acc, item) => acc + item.amount, 0),
    [expenses],
  );

  // handleAddMockExpense 插入一条随机账单，方便快速检查离线写入是否正常。
  const handleAddMockExpense = async () => {
    const payerId = DEMO_PAYERS[Math.floor(Math.random() * DEMO_PAYERS.length)];
    const description =
      DEMO_EXPENSES[Math.floor(Math.random() * DEMO_EXPENSES.length)];

    await database.write(async () => {
      const collection = database.collections.get<Expense>("expenses");
      await collection.create((expense) => {
        assignModelId(expense, createUlid());
        expense.spaceId = DEMO_SPACE_ID;
        expense.payerId = payerId;
        expense.amount = Math.floor(Math.random() * 5000) + 1000;
        expense.description = `${description}（离线测试）`;
      });
    });
  };

  // handleClearAll 只清空测试数据，不会影响正式业务逻辑。
  const handleClearAll = async () => {
    await database.write(async () => {
      const collection = database.collections.get<Expense>("expenses");
      const allRecords = await collection.query().fetch();
      const deletions = allRecords.map((record) =>
        record.prepareMarkAsDeleted(),
      );
      await database.batch(...deletions);
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>离线数据库测试</Text>
      <Text style={styles.subtitle}>当前记录数：{expenses.length}</Text>
      <Text style={styles.subtitle}>
        总金额（元）：{(total / 100).toFixed(2)}
      </Text>

      <View style={styles.btnGroup}>
        <Button title="新增一笔账单" onPress={handleAddMockExpense} />
        <Button title="清空全部记录" color="red" onPress={handleClearAll} />
      </View>

      <FlatList
        data={expenses}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <View>
              <Text style={styles.desc}>{item.description}</Text>
              <Text style={styles.meta}>付款人：{item.payerId}</Text>
              <Text style={styles.meta}>空间：{item.spaceId}</Text>
            </View>
            <Text style={styles.amount}>
              ¥ {(item.amount / 100).toFixed(2)}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#f9f9f9" },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    textAlign: "center",
    marginVertical: 10,
  },
  subtitle: { textAlign: "center", marginBottom: 8 },
  btnGroup: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: 20,
    marginTop: 8,
  },
  item: {
    padding: 15,
    backgroundColor: "white",
    marginBottom: 10,
    borderRadius: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  desc: { fontWeight: "600", color: "#1f2937" },
  meta: { marginTop: 4, color: "#6b7280", fontSize: 12 },
  amount: { fontWeight: "bold", color: "#e74c3c" },
});
