import { Stack } from "expo-router";

// TabLayout 负责注册 Tab 范围内的页面，并统一关闭默认导航栏。
export default function TabLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="team" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="bookkeeping" />
      <Stack.Screen name="settlement" />
      <Stack.Screen name="location" />
    </Stack>
  );
}
