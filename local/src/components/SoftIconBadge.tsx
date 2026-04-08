import { Ionicons } from "@expo/vector-icons";
import { memo } from "react";
import { StyleSheet, View } from "react-native";

const TONES = {
  sky: {
    wash: "#EEF5FF",
    bubbleTop: "#C9DCFF",
    bubbleBottom: "#DCEBFF",
    icon: "#4C78FF",
    shadow: "#4C78FF",
  },
  aqua: {
    wash: "#ECFBFF",
    bubbleTop: "#B6F2FF",
    bubbleBottom: "#D8FAFF",
    icon: "#27B9DB",
    shadow: "#27B9DB",
  },
  violet: {
    wash: "#F4EEFF",
    bubbleTop: "#DCCFFF",
    bubbleBottom: "#F0E8FF",
    icon: "#8E67F6",
    shadow: "#8E67F6",
  },
  peach: {
    wash: "#FFF2EB",
    bubbleTop: "#FFC9B0",
    bubbleBottom: "#FFE9DD",
    icon: "#FF8357",
    shadow: "#FF8357",
  },
  mint: {
    wash: "#ECFFF7",
    bubbleTop: "#B8F1DB",
    bubbleBottom: "#E1FFF3",
    icon: "#2FB88F",
    shadow: "#2FB88F",
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

// SoftIconBadgeBase 渲染旅行界面里复用的柔和渐变图标徽章。
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
