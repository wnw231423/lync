import { useEffect, useRef, useState } from "react";
import Constants from "expo-constants";
import { ScrollView, Button, Text, View, StyleSheet } from "react-native";

const HTTP_URL = Constants.expoConfig?.extra?.http_api_url;
const WS_URL = Constants.expoConfig?.extra?.ws_url;

export default function test_page() {
  const [http_response, set_http_response] = useState<string>("");
  const [ws_messages, set_ws_messages] = useState<string[]>([]);
  const ws_ref = useRef<WebSocket | null>(null);

  const test_http = async () => {
    try {
      set_http_response("请求中...");
      const response = await fetch(HTTP_URL);
      const data = await response.json();
      set_http_response(JSON.stringify(data));
    } catch (error) {
      set_http_response(`HTTP请求失败: ${error}`);
    }
  };

  const test_ws = () => {
    if (ws_ref.current) {
      ws_ref.current.send("Hello from expo!");
      set_ws_messages((prev) => [...prev, "-> 发送: Hello from Expo!"]);
      return;
    }

    const ws = new WebSocket(WS_URL);
    ws_ref.current = ws;

    ws.onopen = () => {
      set_ws_messages((prev) => [...prev, "websocket已连接"]);
      ws.send("Hello server, I am connected!");
    };

    ws.onmessage = (e) => {
      set_ws_messages((prev) => [...prev, `<- 收到: ${e.data}`]);
    };

    ws.onerror = (e) => {
      set_ws_messages((prev) => [...prev, "发生错误"]);
    };

    ws.onclose = () => {
      set_ws_messages((prev) => [...prev, "websocket已断开"]);
      ws_ref.current = null;
    };
  };

  useEffect(() => {
    return () => {
      if (ws_ref.current) {
        ws_ref.current.close();
      }
    };
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>网络连接测试</Text>

      <View style={styles.section}>
        <Button title="测试 HTTP (GET /hello)" onPress={test_http} />
        <Text style={styles.resultText}>HTTP 结果: {http_response}</Text>
      </View>

      <View style={styles.section}>
        <Button
          title={ws_ref.current ? "发送 WS 消息" : "连接 WebSocket 并发送"}
          onPress={test_ws}
          color="#007AFF"
        />
        <Button
          title="断开 WS"
          onPress={() => ws_ref.current?.close()}
          color="#FF3B30"
        />
        <Text style={styles.resultText}>WS 消息记录:</Text>
        {ws_messages.map((msg, index) => (
          <Text key={index} style={styles.msgText}>
            {msg}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingTop: 50,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 20,
    textAlign: "center",
  },
  section: {
    marginBottom: 30,
    padding: 15,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
  },
  resultText: {
    marginTop: 10,
    fontSize: 16,
    color: "#333",
  },
  msgText: {
    fontSize: 14,
    color: "#666",
    marginTop: 4,
  },
});
