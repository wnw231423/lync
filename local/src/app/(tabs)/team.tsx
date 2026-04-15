import { useLocalSearchParams } from "expo-router";
import { SpaceWorkspaceScreen } from "@/features/travel/SpaceWorkspaceScreen";

// TeamPage 保留旧路由名，方便其他页面继续按原路径返回当前空间。
export default function TeamPage() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  return (
    <SpaceWorkspaceScreen initialCode={typeof code === "string" ? code : ""} />
  );
}
