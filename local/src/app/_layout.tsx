import { Stack } from "expo-router";

// RootLayout 把应用放在同一个栈导航里，方便 Tab 页面继续压入详情页。
export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}
