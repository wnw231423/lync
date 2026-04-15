// 位置共享页：进入页面后先征求定位授权，拿到当前用户坐标后通过 WebSocket 广播。
// 其他成员的位置消息同样通过 `/api/v1/ws` 接收，并渲染到本地地图上。
import * as Location from "expo-location";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import WebView from "react-native-webview";
import {
  getSpaceSnapshotFromDb,
  type SpaceData,
} from "@/features/travel/spaceDb";
import {
  ensureCurrentUserProfileInDb,
  type UserProfileData,
} from "@/features/travel/userDb";
import { getWebSocketBaseUrl } from "@/sync/api";

const mapPalette = {
  background: "#EFF9F2",
  surface: "rgba(255,255,255,0.9)",
  border: "rgba(199,231,211,0.92)",
  text: "#0F172A",
  muted: "#64748B",
  primary: "#60C28E",
  primaryStrong: "#3E9E6C",
  selfMarker: "#10B981",
  otherMarker: "#2563EB",
  shadow: "#BFDCCC",
};

type PermissionState = "checking" | "prompting" | "granted" | "denied";
type SocketState = "idle" | "connecting" | "connected" | "error";

type MemberMarker = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  isCurrentUser: boolean;
  updatedAt: number;
};

type SocketLocationPayload = {
  type: "location";
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  nickname?: string;
  sent_at?: number;
};

type SocketRequestPayload = {
  type: "request_location";
};

type WsEnvelope = {
  space_id?: string;
  sender_id?: string;
  message?: string;
  timestamp?: number;
};

function buildMapHtml(markers: MemberMarker[], baiduMapAk: string) {
  const safeMarkers = JSON.stringify(markers);
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
    />
    <style>
      html, body, #map {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        background: #eef8f1;
      }
      #map {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script src="https://api.map.baidu.com/api?v=3.0&ak=${baiduMapAk}"></script>
    <script>
      const markers = ${safeMarkers};
      const fallbackPoint = new BMap.Point(121.4737, 31.2304);
      const map = new BMap.Map("map", { enableMapClick: false });
      map.centerAndZoom(fallbackPoint, 12);
      map.enableScrollWheelZoom(true);
      map.setMapStyleV2({
        styleJson: [
          { featureType: "water", elementType: "all", stylers: { color: "#d7f4e1" } },
          { featureType: "land", elementType: "all", stylers: { color: "#f5fbf7" } },
          { featureType: "highway", elementType: "all", stylers: { color: "#c7ead4" } },
          { featureType: "arterial", elementType: "all", stylers: { color: "#ffffff" } },
          { featureType: "local", elementType: "all", stylers: { color: "#ffffff" } },
          { featureType: "building", elementType: "all", stylers: { color: "#edf7f0" } },
          { featureType: "label", elementType: "all", stylers: { color: "#475569" } }
        ]
      });

      function addMarkers(convertedMarkers) {
        if (!convertedMarkers.length) {
          return;
        }

        const viewportPoints = [];
        convertedMarkers.forEach((marker) => {
          const point = new BMap.Point(marker.longitude, marker.latitude);
          viewportPoints.push(point);

          const markerNode = new BMap.Marker(point);
          map.addOverlay(markerNode);

          const label = new BMap.Label(
            marker.name + (marker.isCurrentUser ? "（我）" : ""),
            {
              position: point,
              offset: new BMap.Size(12, -26),
            }
          );
          label.setStyle({
            color: "#0F172A",
            border: "1px solid #DDEDE3",
            borderRadius: "999px",
            backgroundColor: "#FFFFFF",
            padding: "4px 8px",
            fontSize: "12px",
            fontWeight: "600",
            boxShadow: "0 8px 18px rgba(15, 23, 42, 0.12)",
          });
          map.addOverlay(label);

          const circle = new BMap.Circle(point, 55, {
            strokeColor: marker.isCurrentUser ? "#10B981" : "#2563EB",
            strokeWeight: 3,
            strokeOpacity: 0.85,
            fillColor: marker.isCurrentUser ? "#10B981" : "#2563EB",
            fillOpacity: 0.18,
          });
          map.addOverlay(circle);
        });

        if (viewportPoints.length === 1) {
          map.centerAndZoom(viewportPoints[0], 15);
        } else {
          map.setViewport(viewportPoints, { margins: [52, 52, 52, 52] });
        }
      }

      if (markers.length) {
        const gpsPoints = markers.map(
          (marker) => new BMap.Point(marker.longitude, marker.latitude)
        );
        const convertor = new BMap.Convertor();
        convertor.translate(gpsPoints, 1, 5, function (data) {
          if (!data || data.status !== 0 || !Array.isArray(data.points)) {
            addMarkers(markers);
            return;
          }

          const convertedMarkers = markers.map((marker, index) => ({
            ...marker,
            longitude: data.points[index]?.lng ?? marker.longitude,
            latitude: data.points[index]?.lat ?? marker.latitude,
          }));
          addMarkers(convertedMarkers);
        });
      }
    </script>
  </body>
</html>`;
}

function formatTime(ts: number) {
  if (!ts) {
    return "刚刚";
  }
  return new Date(ts).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseIncomingLocation(message: string): SocketLocationPayload | null {
  try {
    const parsed = JSON.parse(message) as Partial<
      SocketLocationPayload | SocketRequestPayload
    >;
    if (parsed.type !== "location") {
      return null;
    }
    if (
      typeof parsed.latitude !== "number" ||
      typeof parsed.longitude !== "number"
    ) {
      return null;
    }
    return {
      type: "location",
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      accuracy:
        typeof parsed.accuracy === "number" ? parsed.accuracy : undefined,
      nickname: typeof parsed.nickname === "string" ? parsed.nickname : "",
      sent_at: typeof parsed.sent_at === "number" ? parsed.sent_at : Date.now(),
    };
  } catch {
    return null;
  }
}

function isLocationRequestMessage(message: string) {
  try {
    const parsed = JSON.parse(message) as Partial<SocketRequestPayload>;
    return parsed.type === "request_location";
  } catch {
    return false;
  }
}

export default function LocationPage() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const spaceCode = typeof code === "string" ? code : "";

  const [space, setSpace] = useState<SpaceData | null>(null);
  const [currentProfile, setCurrentProfile] = useState<UserProfileData | null>(
    null,
  );
  const [permissionState, setPermissionState] =
    useState<PermissionState>("checking");
  const [socketState, setSocketState] = useState<SocketState>("idle");
  const [markersById, setMarkersById] = useState<Record<string, MemberMarker>>(
    {},
  );
  const baiduMapAk = process.env.EXPO_PUBLIC_BAIDU_MAP_AK?.trim() || "";
  const baiduMapOrigin =
    process.env.EXPO_PUBLIC_BAIDU_MAP_WEB_ORIGIN?.trim() ||
    "https://travel-map.local";

  const wsRef = useRef<WebSocket | null>(null);
  const promptShownRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!spaceCode) {
        setSpace(null);
        return;
      }

      void (async () => {
        const profile = await ensureCurrentUserProfileInDb();
        setCurrentProfile(profile);
        const nextSpace = await getSpaceSnapshotFromDb(spaceCode, profile);
        setSpace(nextSpace);
      })();
    }, [spaceCode]),
  );

  const memberMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of space?.users ?? []) {
      map.set(user.id, user.nickname || "成员");
    }
    if (currentProfile) {
      map.set(currentProfile.id, currentProfile.nickname || "我");
    }
    return map;
  }, [currentProfile, space?.users]);

  const syncOwnLocationToState = useCallback(
    (coords: Location.LocationObjectCoords) => {
      if (!currentProfile) {
        return;
      }

      setMarkersById((prev) => ({
        ...prev,
        [currentProfile.id]: {
          id: currentProfile.id,
          name: currentProfile.nickname || "我",
          latitude: coords.latitude,
          longitude: coords.longitude,
          isCurrentUser: true,
          updatedAt: Date.now(),
        },
      }));
    },
    [currentProfile],
  );

  const sendSocketPayload = useCallback((payload: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const publishCurrentLocation = useCallback(async () => {
    if (!currentProfile) {
      return;
    }
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    syncOwnLocationToState(position.coords);
    sendSocketPayload({
      type: "location",
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      nickname: currentProfile.nickname,
      sent_at: Date.now(),
    } satisfies SocketLocationPayload);
  }, [currentProfile, sendSocketPayload, syncOwnLocationToState]);

  const requestPermissionFlow = useCallback(() => {
    if (promptShownRef.current) {
      return;
    }
    promptShownRef.current = true;
    setPermissionState("prompting");

    Alert.alert(
      "启用定位服务",
      "位置共享需要获取你的当前坐标，并通过 WebSocket 接收其他成员位置。你是否同意开启定位服务？",
      [
        {
          text: "暂不同意",
          style: "cancel",
          onPress: () => {
            setPermissionState("denied");
          },
        },
        {
          text: "同意",
          onPress: () => {
            void (async () => {
              const permission =
                await Location.requestForegroundPermissionsAsync();
              if (!permission.granted) {
                setPermissionState("denied");
                return;
              }
              setPermissionState("granted");
            })();
          },
        },
      ],
    );
  }, []);

  useEffect(() => {
    if (!space || !currentProfile) {
      return;
    }

    void (async () => {
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.granted) {
        setPermissionState("granted");
        return;
      }
      requestPermissionFlow();
    })();
  }, [currentProfile, requestPermissionFlow, space]);

  useEffect(() => {
    if (permissionState !== "granted" || !space || !currentProfile) {
      return;
    }

    let cancelled = false;
    setSocketState("connecting");

    const socketUrl = `${getWebSocketBaseUrl()}/api/v1/ws?space_id=${encodeURIComponent(
      space.id,
    )}&user_id=${encodeURIComponent(currentProfile.id)}`;

    const socket = new WebSocket(socketUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      if (cancelled) {
        return;
      }
      setSocketState("connected");
      void publishCurrentLocation().catch(() => {
        setSocketState("error");
      });
      sendSocketPayload({
        type: "request_location",
      } satisfies SocketRequestPayload);
    };

    socket.onmessage = (event) => {
      if (cancelled) {
        return;
      }

      let envelope: WsEnvelope | null = null;
      try {
        envelope = JSON.parse(event.data as string) as WsEnvelope;
      } catch {
        envelope = null;
      }
      if (!envelope?.message) {
        return;
      }

      if (isLocationRequestMessage(envelope.message)) {
        void publishCurrentLocation().catch(() => {
          setSocketState("error");
        });
        return;
      }

      const payload = parseIncomingLocation(envelope.message);
      if (!payload || !envelope.sender_id) {
        return;
      }

      const memberName =
        payload.nickname?.trim() || memberMap.get(envelope.sender_id) || "成员";

      setMarkersById((prev) => ({
        ...prev,
        [envelope.sender_id as string]: {
          id: envelope.sender_id as string,
          name: memberName,
          latitude: payload.latitude,
          longitude: payload.longitude,
          isCurrentUser: envelope.sender_id === currentProfile.id,
          updatedAt: envelope.timestamp ?? payload.sent_at ?? Date.now(),
        },
      }));
    };

    socket.onerror = () => {
      if (!cancelled) {
        setSocketState("error");
      }
    };

    socket.onclose = () => {
      if (!cancelled) {
        setSocketState("idle");
      }
    };

    return () => {
      cancelled = true;
      if (wsRef.current === socket) {
        wsRef.current = null;
      }
      socket.close();
    };
  }, [
    currentProfile,
    memberMap,
    permissionState,
    publishCurrentLocation,
    sendSocketPayload,
    space,
  ]);

  const markers = useMemo(
    () =>
      Object.values(markersById).sort((left, right) => {
        if (left.isCurrentUser) {
          return -1;
        }
        if (right.isCurrentUser) {
          return 1;
        }
        return right.updatedAt - left.updatedAt;
      }),
    [markersById],
  );

  const onRefreshLocations = () => {
    if (permissionState !== "granted") {
      requestPermissionFlow();
      return;
    }

    void (async () => {
      try {
        await publishCurrentLocation();
        sendSocketPayload({
          type: "request_location",
        } satisfies SocketRequestPayload);
      } catch (error) {
        Alert.alert("刷新失败", String(error));
      }
    })();
  };

  if (!space) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>位置共享暂不可用</Text>
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

  const mapHtml = buildMapHtml(markers, baiduMapAk);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerTextWrap}>
            <Text style={styles.title}>位置共享</Text>
            <Text style={styles.subtitle}>
              {permissionState === "granted"
                ? "进入页面后会连接 WebSocket，同步成员当前位置。"
                : "同意定位服务后，才能使用空间位置共享。"}
            </Text>
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

        {!baiduMapAk ? (
          <View style={styles.permissionCard}>
            <Text style={styles.permissionTitle}>缺少百度地图 AK</Text>
            <Text style={styles.permissionText}>
              请先在 local/.env 中配置
              EXPO_PUBLIC_BAIDU_MAP_AK，然后重新启动应用。
            </Text>
          </View>
        ) : permissionState === "denied" ? (
          <View style={styles.permissionCard}>
            <Text style={styles.permissionTitle}>未开启定位权限</Text>
            <Text style={styles.permissionText}>
              你没有同意定位服务，因此当前位置和其他成员位置都无法显示。
            </Text>
            <Pressable
              style={styles.primaryButton}
              onPress={() => {
                promptShownRef.current = false;
                requestPermissionFlow();
              }}
            >
              <Text style={styles.primaryButtonText}>重新申请定位权限</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.mapCard}>
              <WebView
                originWhitelist={["*"]}
                source={{ html: mapHtml, baseUrl: baiduMapOrigin }}
                style={styles.webview}
                javaScriptEnabled
                domStorageEnabled
                scrollEnabled={false}
              />
            </View>

            <View style={styles.toolbarCard}>
              <View style={styles.statusWrap}>
                <Text style={styles.statusLabel}>连接状态</Text>
                <Text style={styles.statusText}>
                  {socketState === "connected"
                    ? "已连接"
                    : socketState === "connecting"
                      ? "连接中"
                      : socketState === "error"
                        ? "连接失败"
                        : "未连接"}
                </Text>
              </View>
              <Pressable
                style={styles.primaryButton}
                onPress={onRefreshLocations}
              >
                <Text style={styles.primaryButtonText}>刷新位置</Text>
              </Pressable>
            </View>

            <View style={styles.memberListCard}>
              <Text style={styles.memberListTitle}>当前已收到的位置</Text>
              {markers.length === 0 ? (
                <Text style={styles.memberEmptyText}>
                  还没有收到成员坐标。进入页面后会先广播自己的位置，再等待其他成员回传。
                </Text>
              ) : (
                markers.map((marker) => (
                  <View key={marker.id} style={styles.memberRow}>
                    <View style={styles.markerColorWrap}>
                      <View
                        style={[
                          styles.markerColorDot,
                          {
                            backgroundColor: marker.isCurrentUser
                              ? mapPalette.selfMarker
                              : mapPalette.otherMarker,
                          },
                        ]}
                      />
                    </View>
                    <View style={styles.memberTextWrap}>
                      <Text style={styles.memberName}>
                        {marker.name}
                        {marker.isCurrentUser ? "（我）" : ""}
                      </Text>
                      <Text style={styles.memberMeta}>
                        {marker.latitude.toFixed(5)},{" "}
                        {marker.longitude.toFixed(5)}
                      </Text>
                    </View>
                    <Text style={styles.memberTime}>
                      {formatTime(marker.updatedAt)}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: mapPalette.background },
  container: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 20,
    gap: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  headerTextWrap: {
    flex: 1,
  },
  title: {
    fontSize: 30,
    fontWeight: "800",
    color: mapPalette.text,
  },
  subtitle: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 20,
    color: mapPalette.muted,
    maxWidth: 260,
  },
  backButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: mapPalette.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: mapPalette.surface,
    shadowColor: mapPalette.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  backButtonText: {
    color: mapPalette.primaryStrong,
    fontWeight: "700",
    fontSize: 13,
  },
  mapCard: {
    flex: 1,
    minHeight: 280,
    borderRadius: 28,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: mapPalette.border,
    backgroundColor: "#FFFFFF",
    shadowColor: mapPalette.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  webview: {
    flex: 1,
    backgroundColor: "transparent",
  },
  toolbarCard: {
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: mapPalette.border,
    backgroundColor: mapPalette.surface,
    shadowColor: mapPalette.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  statusWrap: {
    flex: 1,
  },
  statusLabel: {
    color: mapPalette.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  statusText: {
    marginTop: 4,
    color: mapPalette.text,
    fontSize: 16,
    fontWeight: "800",
  },
  primaryButton: {
    borderRadius: 16,
    backgroundColor: mapPalette.primary,
    paddingHorizontal: 16,
    paddingVertical: 11,
    shadowColor: mapPalette.primary,
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  permissionCard: {
    borderRadius: 28,
    backgroundColor: mapPalette.surface,
    borderWidth: 1,
    borderColor: mapPalette.border,
    padding: 22,
    gap: 12,
    shadowColor: mapPalette.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  permissionTitle: {
    color: mapPalette.text,
    fontSize: 22,
    fontWeight: "800",
  },
  permissionText: {
    color: mapPalette.muted,
    fontSize: 14,
    lineHeight: 22,
  },
  memberListCard: {
    borderRadius: 24,
    backgroundColor: mapPalette.surface,
    borderWidth: 1,
    borderColor: mapPalette.border,
    padding: 16,
    gap: 12,
    shadowColor: mapPalette.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  memberListTitle: {
    color: mapPalette.text,
    fontSize: 16,
    fontWeight: "800",
  },
  memberEmptyText: {
    color: mapPalette.muted,
    fontSize: 13,
    lineHeight: 20,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  markerColorWrap: {
    width: 18,
    alignItems: "center",
  },
  markerColorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  memberTextWrap: {
    flex: 1,
  },
  memberName: {
    color: mapPalette.text,
    fontSize: 14,
    fontWeight: "700",
  },
  memberMeta: {
    marginTop: 4,
    color: mapPalette.muted,
    fontSize: 12,
  },
  memberTime: {
    color: mapPalette.muted,
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
    color: mapPalette.text,
    fontWeight: "800",
    fontSize: 24,
  },
});
