import { useEffect, useRef, useState } from "react";
import { Button, ScrollView, StyleSheet, Text, View } from "react-native";

// HTTP_URL 来自 Expo 环境变量，指向本地 Go 服务的调试地址。
const HTTP_URL = process.env.EXPO_PUBLIC_API_URL;
const HELLO_API = HTTP_URL ? `${HTTP_URL}/hello` : "";
const WS_URL = HTTP_URL ? `${HTTP_URL}/ws` : "";

// NetworkTestPage 用来在 Expo 里手动验证 Go 服务的 HTTP 和 WebSocket 接口。
export default function NetworkTestPage() {
  // httpResponse 保存最近一次 HTTP 健康检查的展示文本。
  const [httpResponse, setHttpResponse] = useState("");
  // wsMessages 按时间顺序记录当前会话里的 WebSocket 收发日志。
  const [wsMessages, setWsMessages] = useState<string[]>([]);
  // wsRef 保存当前活动连接，方便页面复用并在退出时安全关闭。
  const wsRef = useRef<WebSocket | null>(null);

  // testHttp 请求 `/hello` 接口，并把返回的 JSON 结果展示到页面上。
  const testHttp = async () => {
    if (!HELLO_API) {
      setHttpResponse("请先设置 EXPO_PUBLIC_API_URL");
      return;
    }

    try {
      setHttpResponse("请求中...");
      const response = await fetch(HELLO_API);
      const data = await response.json();
      setHttpResponse(JSON.stringify(data));
    } catch (error) {
      setHttpResponse(`HTTP 请求失败：${String(error)}`);
    }
  };

  // testWs 首次点击时建立回声连接，后续点击则继续复用连接发消息。
  const testWs = () => {
    if (!WS_URL) {
      setWsMessages((prev) => [...prev, "请先设置 EXPO_PUBLIC_API_URL"]);
      return;
    }

    if (wsRef.current) {
      wsRef.current.send("来自 Expo 的问候");
      setWsMessages((prev) => [...prev, "-> 已发送：来自 Expo 的问候"]);
      return;
    }

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsMessages((prev) => [...prev, "WebSocket 已连接"]);
      ws.send("你好，服务器，我已经连接成功。");
    };

    ws.onmessage = (event) => {
      setWsMessages((prev) => [...prev, `<- 收到：${event.data}`]);
    };

    ws.onerror = () => {
      setWsMessages((prev) => [...prev, "WebSocket 出现错误"]);
    };

    ws.onclose = () => {
      setWsMessages((prev) => [...prev, "WebSocket 已关闭"]);
      wsRef.current = null;
    };
  };

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>网络连接测试</Text>

      <View style={styles.section}>
        <Button title="测试 HTTP（GET /hello）" onPress={testHttp} />
        <Text style={styles.resultText}>HTTP 结果：{httpResponse}</Text>
      </View>

      <View style={styles.section}>
        <Button
          title={
            wsRef.current ? "发送一条 WS 消息" : "连接 WebSocket 并发送消息"
          }
          onPress={testWs}
          color="#007AFF"
        />
        <Button
          title="断开 WebSocket"
          onPress={() => wsRef.current?.close()}
          color="#FF3B30"
        />
        <Text style={styles.resultText}>WS 消息记录：</Text>
        {wsMessages.map((msg, index) => (
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
    gap: 10,
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
