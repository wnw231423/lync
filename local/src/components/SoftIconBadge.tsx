// SoftIconBadge 是各个页面复用的小型图标徽章，主要用于分区标题和功能卡片。
import { Ionicons } from "@expo/vector-icons";
import { memo } from "react";
import { StyleSheet, View } from "react-native";

// TONES 约定不同徽章色调的底色、光斑和图标颜色。
const TONES = {
  sky: {
    wash: "#ECFDF5",
    bubbleTop: "#A7F3D0",
    bubbleBottom: "#D1FAE5",
    icon: "#60C28E",
    shadow: "#60C28E",
  },
  aqua: {
    wash: "#EFFBF4",
    bubbleTop: "#BFEBCF",
    bubbleBottom: "#DDF6E7",
    icon: "#4FB27A",
    shadow: "#4FB27A",
  },
  violet: {
    wash: "#F0FBF4",
    bubbleTop: "#C7EFD6",
    bubbleBottom: "#E1F7E9",
    icon: "#57B884",
    shadow: "#57B884",
  },
  peach: {
    wash: "#F1FBF5",
    bubbleTop: "#CDEFD9",
    bubbleBottom: "#E4F8EB",
    icon: "#68BE90",
    shadow: "#68BE90",
  },
  mint: {
    wash: "#ECFDF5",
    bubbleTop: "#A7F3D0",
    bubbleBottom: "#D1FAE5",
    icon: "#34D399",
    shadow: "#34D399",
  },
} as const;

type ToneName = keyof typeof TONES;
type IconName = React.ComponentProps<typeof Ionicons>["name"];

type SoftIconBadgeProps = {
  name: IconName;
  tone?: ToneName;
  size?: number;
  iconSize?: number;
};

// SoftIconBadgeBase 渲染空间界面里复用的柔和渐变图标徽章。
function SoftIconBadgeBase({
  name,
  tone = "sky",
  size = 58,
  iconSize = 24,
}: SoftIconBadgeProps) {
  const palette = TONES[tone];

  return (
    <View
      style={[
        styles.shell,
        {
          width: size,
          height: size,
          borderRadius: size * 0.34,
          backgroundColor: palette.wash,
          shadowColor: palette.shadow,
        },
      ]}
    >
      <View
        style={[
          styles.bubble,
          styles.bubbleTop,
          {
            backgroundColor: palette.bubbleTop,
            width: size * 0.52,
            height: size * 0.52,
            borderRadius: size * 0.26,
          },
        ]}
      />
      <View
        style={[
          styles.bubble,
          styles.bubbleBottom,
          {
            backgroundColor: palette.bubbleBottom,
            width: size * 0.38,
            height: size * 0.38,
            borderRadius: size * 0.19,
          },
        ]}
      />
      <View style={styles.highlight} />
      <Ionicons name={name} size={iconSize} color={palette.icon} />
    </View>
  );
}

export const SoftIconBadge = memo(SoftIconBadgeBase);

const styles = StyleSheet.create({
  shell: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    overflow: "hidden",
    shadowOpacity: 0.15,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  bubble: {
    position: "absolute",
    opacity: 0.95,
  },
  bubbleTop: {
    top: 8,
    left: 10,
  },
  bubbleBottom: {
    right: 8,
    bottom: 9,
  },
  highlight: {
    position: "absolute",
    top: 6,
    left: 10,
    right: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
});
