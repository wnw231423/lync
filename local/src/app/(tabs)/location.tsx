import * as Location from "expo-location";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import WebView, { type WebViewMessageEvent } from "react-native-webview";
import {
  configureBaiduNativeLocation,
  getBaiduNativeCurrentPosition,
  isBaiduNativeLocationSupported,
  startBaiduNativeLocationUpdates,
  type BaiduNativeLocationResult,
} from "@/features/travel/baiduLocation";
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

const WEB_LOCATION_REUSE_MS = 5 * 60 * 1000;
const WEB_LOCATION_COOLDOWN_MS = 60 * 1000;
const PUBLISHED_LOCATION_REUSE_MS = 90 * 1000;
const PUBLISHED_LOCATION_REFRESH_GRACE_MS = 30 * 1000;

type PermissionState = "checking" | "prompting" | "granted" | "denied";
type SocketState = "idle" | "connecting" | "connected" | "error";
type CoordinateSystem = "gps" | "bd09";

type MemberMarker = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  coordinateSystem: CoordinateSystem;
  isCurrentUser: boolean;
  updatedAt: number;
};

type SocketLocationPayload = {
  type: "location";
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  coordinate_system?: CoordinateSystem;
  nickname?: string;
  sent_at?: number;
};

type SocketRequestPayload = {
  type: "request_location";
};

type SocketMemberOfflinePayload = {
  type: "member_offline";
  user_id: string;
  sent_at?: number;
};

type WebViewMapReadyPayload = {
  type: "map_ready";
};

type WebViewLocationPayload = {
  type: "web_location";
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  coordinate_system?: CoordinateSystem;
  sent_at?: number;
};

type WebViewLocationErrorPayload = {
  type: "web_location_error";
  message?: string;
};

type WebViewInboundPayload =
  | WebViewMapReadyPayload
  | WebViewLocationPayload
  | WebViewLocationErrorPayload;

type WebViewOutboundPayload =
  | {
      type: "sync_markers";
      markers: {
        id: string;
        name: string;
        latitude: number;
        longitude: number;
        coordinateSystem: CoordinateSystem;
        isCurrentUser: boolean;
      }[];
    }
  | {
      type: "request_web_location";
    };

type WsEnvelope = {
  space_id?: string;
  sender_id?: string;
  message?: string;
  timestamp?: number;
};

type ResolvedLocation = {
  coords: Location.LocationObjectCoords;
  usedLastKnown: boolean;
  source:
    | "native"
    | "last_known"
    | "webview_browser"
    | "webview_baidu"
    | "baidu_native";
  coordinateSystem: CoordinateSystem;
};

type PublishedLocationCache = {
  result: ResolvedLocation;
  resolvedAt: number;
  lastBroadcastAt: number;
};

function buildMapHtml(baiduMapAk: string) {
  return `<!DOCTYPE html>
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

      let markerOverlays = [];
      const convertedMarkerCache = new Map();
      let latestWebLocation = null;
      let browserWatchStarted = false;
      const browserLocationReuseMs = 120000;
      const baiduLocationReuseMs = 60000;
      const baiduLocationMaxAccuracyMeters = 1000;

      function postToApp(payload) {
        if (
          window.ReactNativeWebView &&
          typeof window.ReactNativeWebView.postMessage === "function"
        ) {
          window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        }
      }

      function clearMarkerOverlays() {
        markerOverlays.forEach((overlay) => map.removeOverlay(overlay));
        markerOverlays = [];
      }

      function buildMarkerCacheKey(marker) {
        return (
          String(marker.id || "") +
          ":" +
          Number(marker.latitude).toFixed(6) +
          ":" +
          Number(marker.longitude).toFixed(6)
        );
      }

      function buildLabelText(marker) {
        return marker.isCurrentUser ? marker.name + "（我）" : marker.name;
      }

      function appendMarkerOverlays(renderedMarkers) {
        clearMarkerOverlays();

        if (!renderedMarkers.length) {
          map.centerAndZoom(fallbackPoint, 12);
          return;
        }

        const viewportPoints = [];
        renderedMarkers.forEach((marker) => {
          const point = new BMap.Point(marker.longitude, marker.latitude);
          viewportPoints.push(point);

          const markerNode = new BMap.Marker(point);
          map.addOverlay(markerNode);
          markerOverlays.push(markerNode);

          const label = new BMap.Label(buildLabelText(marker), {
            position: point,
            offset: new BMap.Size(12, -26),
          });
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
          markerOverlays.push(label);

          const circle = new BMap.Circle(point, 55, {
            strokeColor: marker.isCurrentUser ? "#10B981" : "#2563EB",
            strokeWeight: 3,
            strokeOpacity: 0.85,
            fillColor: marker.isCurrentUser ? "#10B981" : "#2563EB",
            fillOpacity: 0.18,
          });
          map.addOverlay(circle);
          markerOverlays.push(circle);
        });

        if (viewportPoints.length === 1) {
          map.centerAndZoom(viewportPoints[0], 15);
        } else {
          map.setViewport(viewportPoints, { margins: [52, 52, 52, 52] });
        }
      }

      function renderMarkers(markers) {
        if (!Array.isArray(markers) || !markers.length) {
          appendMarkerOverlays([]);
          return;
        }

        const bd09Markers = markers
          .filter((marker) => marker.coordinateSystem === "bd09")
          .map((marker) => ({ ...marker }));
        const gpsMarkers = markers.filter(
          (marker) => marker.coordinateSystem !== "bd09"
        );

        if (!gpsMarkers.length) {
          appendMarkerOverlays(bd09Markers);
          return;
        }

        const cachedConvertedMarkers = [];
        const pendingGpsMarkers = [];

        gpsMarkers.forEach((marker) => {
          const cacheKey = buildMarkerCacheKey(marker);
          const cachedPoint = convertedMarkerCache.get(cacheKey);
          if (cachedPoint) {
            cachedConvertedMarkers.push({
              ...marker,
              longitude: cachedPoint.lng,
              latitude: cachedPoint.lat,
            });
            return;
          }

          pendingGpsMarkers.push(marker);
        });

        if (!pendingGpsMarkers.length) {
          appendMarkerOverlays(bd09Markers.concat(cachedConvertedMarkers));
          return;
        }

        appendMarkerOverlays(
          bd09Markers.concat(cachedConvertedMarkers).concat(pendingGpsMarkers)
        );

        const gpsPoints = pendingGpsMarkers.map(
          (marker) => new BMap.Point(marker.longitude, marker.latitude)
        );
        const convertor = new BMap.Convertor();
        convertor.translate(gpsPoints, 1, 5, function (data) {
          if (!data || data.status !== 0 || !Array.isArray(data.points)) {
            appendMarkerOverlays(
              bd09Markers.concat(
                cachedConvertedMarkers,
                pendingGpsMarkers.map((marker) => ({
                  ...marker,
                }))
              )
            );
            return;
          }

          const convertedMarkers = pendingGpsMarkers.map((marker, index) => {
            const nextMarker = {
              ...marker,
              longitude: data.points[index]?.lng ?? marker.longitude,
              latitude: data.points[index]?.lat ?? marker.latitude,
            };
            convertedMarkerCache.set(buildMarkerCacheKey(marker), {
              lng: nextMarker.longitude,
              lat: nextMarker.latitude,
            });
            return nextMarker;
          });

          appendMarkerOverlays(
            bd09Markers.concat(cachedConvertedMarkers).concat(convertedMarkers)
          );
        });
      }

      function postWebLocation(payload) {
        latestWebLocation = payload;
        postToApp(payload);
      }

      function isFreshLocation(payload, maxAgeMs) {
        return (
          payload &&
          typeof payload.sent_at === "number" &&
          Date.now() - payload.sent_at < maxAgeMs
        );
      }

      function isReliableBaiduWebLocation(payload) {
        return (
          payload &&
          payload.coordinate_system === "bd09" &&
          typeof payload.accuracy === "number" &&
          isFinite(payload.accuracy) &&
          payload.accuracy > 0 &&
          payload.accuracy <= baiduLocationMaxAccuracyMeters
        );
      }

      function requestBaiduWebLocation(previousMessage) {
        if (
          isReliableBaiduWebLocation(latestWebLocation) &&
          isFreshLocation(latestWebLocation, baiduLocationReuseMs)
        ) {
          postToApp(latestWebLocation);
          return;
        }

        if (!BMap.Geolocation) {
          postToApp({
            type: "web_location_error",
            message:
              previousMessage ||
              "当前设备无法使用百度网页定位，请检查定位服务和网络连接。",
          });
          return;
        }

        const geolocation = new BMap.Geolocation();
        if (typeof geolocation.enableSDKLocation === "function") {
          try {
            geolocation.enableSDKLocation();
          } catch (error) {
            // WebView 没有启用 SDK 辅助定位时会静默退回网页定位。
          }
        }

        geolocation.getCurrentPosition(
          function (result) {
            const status = typeof this.getStatus === "function" ? this.getStatus() : -1;
            const accuracy =
              result && typeof result.accuracy === "number" && isFinite(result.accuracy)
                ? result.accuracy
                : null;
            if (
              (status === 0 || status === window.BMAP_STATUS_SUCCESS) &&
              result &&
              result.point &&
              accuracy !== null &&
              accuracy > 0 &&
              accuracy <= baiduLocationMaxAccuracyMeters
            ) {
              postWebLocation({
                type: "web_location",
                latitude: result.point.lat,
                longitude: result.point.lng,
                accuracy,
                coordinate_system: "bd09",
                sent_at: Date.now(),
              });
              return;
            }

            if (
              (status === 0 || status === window.BMAP_STATUS_SUCCESS) &&
              result &&
              result.point
            ) {
              postToApp({
                type: "web_location_error",
                message:
                  "百度兼容定位当前只返回了城市级估算位置，精度不足，已放弃使用该结果。",
              });
              return;
            }

            postToApp({
              type: "web_location_error",
              message:
                previousMessage ||
                "百度网页定位未能返回坐标，请检查系统定位和网络连接。",
            });
          },
          {
            enableHighAccuracy: true,
          }
        );
      }

      function startBrowserWatch() {
        if (!navigator.geolocation || browserWatchStarted) {
          return;
        }

        browserWatchStarted = true;
        navigator.geolocation.watchPosition(
          function (position) {
            postWebLocation({
              type: "web_location",
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy || null,
              coordinate_system: "gps",
              sent_at: Date.now(),
            });
          },
          function () {
            // 某些设备会拒绝持续监听，这里静默处理，保留一次性定位回退。
          },
          {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 20000,
          }
        );
      }

      function requestBrowserLocation() {
        if (!navigator.geolocation) {
          requestBaiduWebLocation("当前设备的 WebView 不支持浏览器定位。");
          return;
        }

        if (
          latestWebLocation &&
          latestWebLocation.coordinate_system === "gps" &&
          isFreshLocation(latestWebLocation, browserLocationReuseMs)
        ) {
          postToApp(latestWebLocation);
          return;
        }

        navigator.geolocation.getCurrentPosition(
          function (position) {
            postWebLocation({
              type: "web_location",
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy || null,
              coordinate_system: "gps",
              sent_at: Date.now(),
            });
          },
          function (error) {
            requestBaiduWebLocation(
              error && error.message
                ? error.message
                : "浏览器定位失败，正在切换到百度兼容定位。"
            );
          },
          {
            enableHighAccuracy: true,
            timeout: 12000,
            maximumAge: 0,
          }
        );
      }

      function handleBridgeMessage(event) {
        try {
          const parsed = JSON.parse(String(event.data || ""));
          if (parsed.type === "sync_markers") {
            renderMarkers(Array.isArray(parsed.markers) ? parsed.markers : []);
            return;
          }
          if (parsed.type === "request_web_location") {
            requestBrowserLocation();
          }
        } catch (error) {
          // 忽略格式不正确的桥接消息。
        }
      }

      document.addEventListener("message", handleBridgeMessage);
      window.addEventListener("message", handleBridgeMessage);
      postToApp({ type: "map_ready" });
    </script>
  </body>
</html>`;
}

function formatTime(timestamp: number) {
  if (!timestamp) {
    return "刚刚";
  }

  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseIncomingLocation(message: string): SocketLocationPayload | null {
  try {
    const parsed = JSON.parse(message) as Partial<SocketLocationPayload>;
    if (
      parsed.type !== "location" ||
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
      coordinate_system: parsed.coordinate_system === "bd09" ? "bd09" : "gps",
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

function parseMemberOfflineMessage(
  message: string,
): SocketMemberOfflinePayload | null {
  try {
    const parsed = JSON.parse(message) as Partial<SocketMemberOfflinePayload>;
    if (
      parsed.type !== "member_offline" ||
      typeof parsed.user_id !== "string"
    ) {
      return null;
    }

    return {
      type: "member_offline",
      user_id: parsed.user_id,
      sent_at: typeof parsed.sent_at === "number" ? parsed.sent_at : Date.now(),
    };
  } catch {
    return null;
  }
}

function parseWebViewMessage(rawMessage: string): WebViewInboundPayload | null {
  try {
    const parsed = JSON.parse(rawMessage) as Partial<WebViewInboundPayload>;

    if (parsed.type === "map_ready") {
      return { type: "map_ready" };
    }

    if (
      parsed.type === "web_location" &&
      typeof parsed.latitude === "number" &&
      typeof parsed.longitude === "number"
    ) {
      return {
        type: "web_location",
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        accuracy:
          typeof parsed.accuracy === "number" ? parsed.accuracy : undefined,
        coordinate_system: parsed.coordinate_system === "bd09" ? "bd09" : "gps",
        sent_at:
          typeof parsed.sent_at === "number" ? parsed.sent_at : Date.now(),
      };
    }

    if (parsed.type === "web_location_error") {
      return {
        type: "web_location_error",
        message: typeof parsed.message === "string" ? parsed.message : "",
      };
    }

    return null;
  } catch {
    return null;
  }
}

function buildCoords(
  latitude: number,
  longitude: number,
  accuracy?: number | null,
): Location.LocationObjectCoords {
  return {
    latitude,
    longitude,
    accuracy: typeof accuracy === "number" ? accuracy : null,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
  };
}

function getAccuracyValue(accuracy?: number | null) {
  if (typeof accuracy !== "number" || !Number.isFinite(accuracy)) {
    return Number.POSITIVE_INFINITY;
  }
  return accuracy;
}

function isUnsupportedAndroidLocationError(error: unknown) {
  const rawMessage =
    error instanceof Error ? error.message : String(error ?? "");
  const lowerMessage = rawMessage.toLowerCase();

  return (
    lowerMessage.includes("locationservices.api") ||
    lowerMessage.includes("service_invalid") ||
    lowerMessage.includes("connectionresult") ||
    lowerMessage.includes("api is not available on this device") ||
    lowerMessage.includes("google play")
  );
}

function getFriendlyLocationErrorMessage(error: unknown) {
  const rawMessage =
    error instanceof Error ? error.message : String(error ?? "未知错误");
  const lowerMessage = rawMessage.toLowerCase();

  if (
    lowerMessage.includes("permission") ||
    lowerMessage.includes("denied") ||
    lowerMessage.includes("not granted")
  ) {
    return "还没有获得定位权限，请在系统设置中允许应用访问定位后再试。";
  }

  if (
    lowerMessage.includes("locationservices.api") ||
    lowerMessage.includes("service_invalid") ||
    lowerMessage.includes("connectionresult") ||
    lowerMessage.includes("google play") ||
    lowerMessage.includes("webview") ||
    lowerMessage.includes("browser") ||
    lowerMessage.includes("geolocation")
  ) {
    return "当前设备的定位组件兼容性有限，系统已经自动切换到兼容定位链路。请确认系统定位、网络连接和 WebView 权限都已开启。";
  }

  if (
    lowerMessage.includes("城市级估算") ||
    lowerMessage.includes("估算位置") ||
    lowerMessage.includes("精度不足")
  ) {
    return "百度兼容定位当前只返回了城市级估算位置，系统已经放弃使用这个结果。请优先开启系统定位和 WebView 定位权限，尽量改用浏览器兼容或原生定位。";
  }

  if (
    lowerMessage.includes("location services") ||
    lowerMessage.includes("current location is unavailable") ||
    lowerMessage.includes("provider") ||
    lowerMessage.includes("gps")
  ) {
    return "当前设备暂时无法获取实时定位，请确认系统定位服务已经开启，并尽量在室外或靠近窗边后重试。";
  }

  if (lowerMessage.includes("timeout")) {
    return "定位超时了，请确认当前网络环境和系统定位服务都可用后再试。";
  }

  return `获取定位失败：${rawMessage}`;
}

function shouldSuggestOpeningSettings(message: string) {
  return (
    message.includes("系统定位") ||
    message.includes("权限") ||
    message.includes("WebView")
  );
}

function getSocketStatusLabel(socketState: SocketState) {
  if (socketState === "connected") {
    return "已连接";
  }
  if (socketState === "connecting") {
    return "连接中";
  }
  if (socketState === "error") {
    return "连接异常";
  }
  return "未连接";
}

function chooseBetterLocation(
  nativeLocation: ResolvedLocation,
  webLocation: ResolvedLocation | null,
) {
  if (!webLocation) {
    return nativeLocation;
  }

  const nativeAccuracy = getAccuracyValue(nativeLocation.coords.accuracy);
  const webAccuracy = getAccuracyValue(webLocation.coords.accuracy);
  if (
    nativeAccuracy > 300 &&
    Number.isFinite(webAccuracy) &&
    webAccuracy + 80 < nativeAccuracy
  ) {
    return webLocation;
  }

  return nativeLocation;
}

function createResolvedBaiduNativeLocation(
  payload: BaiduNativeLocationResult,
): ResolvedLocation {
  return {
    coords: buildCoords(payload.latitude, payload.longitude, payload.accuracy),
    usedLastKnown: false,
    source: "baidu_native",
    coordinateSystem: payload.coordinateSystem === "bd09" ? "bd09" : "gps",
  };
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
  const [locationNotice, setLocationNotice] = useState("");
  const [socketRetryTick, setSocketRetryTick] = useState(0);

  const baiduMapAk = process.env.EXPO_PUBLIC_BAIDU_MAP_AK?.trim() || "";
  const baiduNativeAk =
    process.env.EXPO_PUBLIC_BAIDU_LOCATION_ANDROID_AK?.trim() || "";
  const baiduMapOrigin =
    process.env.EXPO_PUBLIC_BAIDU_MAP_WEB_ORIGIN?.trim() ||
    "https://travel-map.local";

  const wsRef = useRef<WebSocket | null>(null);
  const mapWebViewRef = useRef<WebView | null>(null);
  const promptShownRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webLocationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const webLocationResolveRef = useRef<
    ((value: ResolvedLocation) => void) | null
  >(null);
  const webLocationRejectRef = useRef<((reason?: unknown) => void) | null>(
    null,
  );
  const mapReadyRef = useRef(false);
  const latestWebLocationRef = useRef<ResolvedLocation | null>(null);
  const latestWebLocationAtRef = useRef(0);
  const webLocationRequestStartedAtRef = useRef(0);
  const webLocationPromiseRef = useRef<Promise<ResolvedLocation> | null>(null);
  const latestPublishedLocationRef = useRef<PublishedLocationCache | null>(
    null,
  );
  const latestMarkersRef = useRef<MemberMarker[]>([]);
  const networkProviderSupportedRef = useRef(true);
  const baiduNativeConfiguredRef = useRef(false);
  const baiduNativeWatchStartedRef = useRef(false);

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
    const result = new Map<string, string>();
    for (const user of space?.users ?? []) {
      result.set(user.id, user.nickname || "成员");
    }
    if (currentProfile) {
      result.set(currentProfile.id, currentProfile.nickname || "我");
    }
    return result;
  }, [currentProfile, space?.users]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const clearPendingWebLocationRequest = useCallback(() => {
    if (webLocationTimeoutRef.current) {
      clearTimeout(webLocationTimeoutRef.current);
      webLocationTimeoutRef.current = null;
    }
    webLocationResolveRef.current = null;
    webLocationRejectRef.current = null;
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      return;
    }

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      setSocketRetryTick((value) => value + 1);
    }, 2200);
  }, []);

  const sendSocketPayload = useCallback((payload: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const syncOwnLocationToState = useCallback(
    (
      coords: Location.LocationObjectCoords,
      coordinateSystem: CoordinateSystem,
    ) => {
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
          coordinateSystem,
          isCurrentUser: true,
          updatedAt: Date.now(),
        },
      }));
    },
    [currentProfile],
  );

  const syncMarkersToWebView = useCallback((markers: MemberMarker[]) => {
    latestMarkersRef.current = markers;
    if (!mapReadyRef.current || !mapWebViewRef.current) {
      return;
    }

    const payload: WebViewOutboundPayload = {
      type: "sync_markers",
      markers: markers.map((marker) => ({
        id: marker.id,
        name: marker.name,
        latitude: marker.latitude,
        longitude: marker.longitude,
        coordinateSystem: marker.coordinateSystem,
        isCurrentUser: marker.isCurrentUser,
      })),
    };
    mapWebViewRef.current.postMessage(JSON.stringify(payload));
  }, []);

  const getReusablePublishedLocation = useCallback((maxAgeMs: number) => {
    const cachedLocation = latestPublishedLocationRef.current;
    if (!cachedLocation) {
      return null;
    }

    if (Date.now() - cachedLocation.resolvedAt > maxAgeMs) {
      return null;
    }

    return cachedLocation.result;
  }, []);

  const ensureBaiduNativeReady = useCallback(async () => {
    if (Platform.OS !== "android" || !baiduNativeAk) {
      return false;
    }

    const supported = await isBaiduNativeLocationSupported().catch(() => false);
    if (!supported) {
      return false;
    }

    if (baiduNativeConfiguredRef.current) {
      return true;
    }

    await configureBaiduNativeLocation(baiduNativeAk);
    baiduNativeConfiguredRef.current = true;
    return true;
  }, [baiduNativeAk]);

  const requestBaiduNativeLocation = useCallback(
    async (preferFresh: boolean): Promise<ResolvedLocation | null> => {
      if (!(await ensureBaiduNativeReady())) {
        return null;
      }

      const nativePayload = await getBaiduNativeCurrentPosition({
        timeoutMs: preferFresh ? 15000 : 12000,
      }).catch(() => null);
      if (!nativePayload) {
        return null;
      }

      return createResolvedBaiduNativeLocation(nativePayload);
    },
    [ensureBaiduNativeReady],
  );

  const requestWebViewLocation = useCallback(
    async (preferFresh: boolean): Promise<ResolvedLocation> => {
      const now = Date.now();
      const latestWebLocation = latestWebLocationRef.current;

      if (latestWebLocation) {
        const webLocationAge = now - latestWebLocationAtRef.current;
        if (!preferFresh && webLocationAge < WEB_LOCATION_REUSE_MS) {
          return latestWebLocation;
        }
        if (webLocationAge < WEB_LOCATION_COOLDOWN_MS) {
          return latestWebLocation;
        }
      }

      if (webLocationPromiseRef.current) {
        return webLocationPromiseRef.current;
      }

      if (
        now - webLocationRequestStartedAtRef.current <
        WEB_LOCATION_COOLDOWN_MS
      ) {
        const cachedPublishedLocation = getReusablePublishedLocation(
          WEB_LOCATION_REUSE_MS,
        );
        if (cachedPublishedLocation) {
          return cachedPublishedLocation;
        }
      }

      const waitUntilReady = async () => {
        if (mapReadyRef.current) {
          return;
        }

        await new Promise<void>((resolve, reject) => {
          const startedAt = Date.now();
          const timer = setInterval(() => {
            if (mapReadyRef.current) {
              clearInterval(timer);
              resolve();
              return;
            }

            if (Date.now() - startedAt > 5000) {
              clearInterval(timer);
              reject(new Error("地图尚未准备好，暂时无法使用兼容定位。"));
            }
          }, 180);
        });
      };

      await waitUntilReady();
      clearPendingWebLocationRequest();

      if (!mapWebViewRef.current) {
        throw new Error("地图组件尚未加载完成。");
      }

      webLocationRequestStartedAtRef.current = Date.now();

      const requestPromise = new Promise<ResolvedLocation>(
        (resolve, reject) => {
          webLocationResolveRef.current = resolve;
          webLocationRejectRef.current = reject;
          webLocationTimeoutRef.current = setTimeout(() => {
            clearPendingWebLocationRequest();
            reject(
              new Error(
                "兼容定位超时，请确认设备的定位服务与网络连接都已开启。",
              ),
            );
          }, 12000);

          const payload: WebViewOutboundPayload = {
            type: "request_web_location",
          };
          mapWebViewRef.current?.postMessage(JSON.stringify(payload));
        },
      );

      webLocationPromiseRef.current = requestPromise.finally(() => {
        if (webLocationPromiseRef.current === requestPromise) {
          webLocationPromiseRef.current = null;
        }
      });

      return webLocationPromiseRef.current;
    },
    [clearPendingWebLocationRequest, getReusablePublishedLocation],
  );

  const broadcastResolvedLocation = useCallback(
    (
      result: ResolvedLocation,
      options?: {
        updateNotice?: boolean;
        resolvedAt?: number;
      },
    ) => {
      if (!currentProfile) {
        return;
      }

      latestPublishedLocationRef.current = {
        result,
        resolvedAt: options?.resolvedAt ?? Date.now(),
        lastBroadcastAt: Date.now(),
      };
      syncOwnLocationToState(result.coords, result.coordinateSystem);

      if (options?.updateNotice !== false) {
        if (result.source === "webview_browser") {
          setLocationNotice(
            "当前设备正在使用浏览器兼容定位，首次授权后后续刷新不会反复弹出定位确认。",
          );
        } else if (result.source === "webview_baidu") {
          setLocationNotice(
            "当前设备正在使用百度兼容定位，定位精度会受到网络环境和地图服务影响。",
          );
        } else if (result.source === "baidu_native") {
          setLocationNotice(
            "当前设备正在使用百度原生定位，位置共享会优先走原生链路，响应和稳定性会更好。",
          );
        } else if (result.usedLastKnown) {
          setLocationNotice("当前使用的是最近一次可用定位，精度可能略低。");
        } else {
          setLocationNotice("");
        }
      }

      sendSocketPayload({
        type: "location",
        latitude: result.coords.latitude,
        longitude: result.coords.longitude,
        accuracy: result.coords.accuracy,
        coordinate_system: result.coordinateSystem,
        nickname: currentProfile.nickname,
        sent_at: Date.now(),
      } satisfies SocketLocationPayload);
    },
    [currentProfile, sendSocketPayload, syncOwnLocationToState],
  );

  const handleMapMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const payload = parseWebViewMessage(event.nativeEvent.data);
      if (!payload) {
        return;
      }

      if (payload.type === "map_ready") {
        mapReadyRef.current = true;
        syncMarkersToWebView(latestMarkersRef.current);
        return;
      }

      if (payload.type === "web_location") {
        const resolved: ResolvedLocation = {
          coords: buildCoords(
            payload.latitude,
            payload.longitude,
            payload.accuracy,
          ),
          usedLastKnown: false,
          source:
            payload.coordinate_system === "bd09"
              ? "webview_baidu"
              : "webview_browser",
          coordinateSystem:
            payload.coordinate_system === "bd09" ? "bd09" : "gps",
        };
        latestWebLocationRef.current = resolved;
        latestWebLocationAtRef.current = Date.now();

        const resolve = webLocationResolveRef.current;
        clearPendingWebLocationRequest();
        resolve?.(resolved);
        return;
      }

      const reject = webLocationRejectRef.current;
      clearPendingWebLocationRequest();
      reject?.(new Error(payload.message || "兼容定位失败。"));
    },
    [clearPendingWebLocationRequest, syncMarkersToWebView],
  );

  const resolveCurrentLocation = useCallback(
    async (preferFresh: boolean): Promise<ResolvedLocation> => {
      const baiduNativeLocation =
        Platform.OS === "android"
          ? await requestBaiduNativeLocation(preferFresh).catch(() => null)
          : null;

      if (
        baiduNativeLocation &&
        getAccuracyValue(baiduNativeLocation.coords.accuracy) <= 120
      ) {
        return baiduNativeLocation;
      }

      if (Platform.OS === "android" && networkProviderSupportedRef.current) {
        await Location.enableNetworkProviderAsync().catch(() => {
          networkProviderSupportedRef.current = false;
        });
      }

      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        throw new Error("Location services are disabled.");
      }

      try {
        const nativeLocation = await Location.getCurrentPositionAsync({
          accuracy:
            Platform.OS === "ios"
              ? Location.Accuracy.BestForNavigation
              : preferFresh
                ? Location.Accuracy.Highest
                : Location.Accuracy.High,
        });

        const resolvedNative: ResolvedLocation = {
          coords: nativeLocation.coords,
          usedLastKnown: false,
          source: "native",
          coordinateSystem: "gps",
        };

        if (baiduNativeLocation) {
          return chooseBetterLocation(baiduNativeLocation, resolvedNative);
        }

        if (getAccuracyValue(nativeLocation.coords.accuracy) <= 120) {
          return resolvedNative;
        }

        const webLocation = await requestWebViewLocation(preferFresh).catch(
          () => null,
        );
        return chooseBetterLocation(resolvedNative, webLocation);
      } catch (error) {
        if (baiduNativeLocation) {
          return baiduNativeLocation;
        }

        const webLocation = await requestWebViewLocation(preferFresh).catch(
          () => null,
        );
        if (webLocation) {
          return webLocation;
        }

        if (
          Platform.OS === "android" &&
          isUnsupportedAndroidLocationError(error)
        ) {
          throw new Error(
            "当前设备的系统定位组件不可用，兼容定位也没有成功。请确认定位权限、网络连接和 WebView 权限都已开启后再试。",
          );
        }

        const lastKnown = await Location.getLastKnownPositionAsync({
          maxAge: 10 * 60 * 1000,
          requiredAccuracy: 500,
        }).catch(() => null);

        if (lastKnown?.coords) {
          return {
            coords: lastKnown.coords,
            usedLastKnown: true,
            source: "last_known",
            coordinateSystem: "gps",
          };
        }

        throw error;
      }
    },
    [requestBaiduNativeLocation, requestWebViewLocation],
  );

  const publishCurrentLocation = useCallback(
    async (preferFresh: boolean) => {
      if (!currentProfile) {
        return null;
      }

      const result = await resolveCurrentLocation(preferFresh);
      broadcastResolvedLocation(result);
      return result;
      /*

      if (result.source === "webview_browser") {
        setLocationNotice(
          "当前设备正在使用浏览器兼容定位，授权一次后后续刷新不会反复弹出定位确认。",
        );
      } else if (result.source === "webview_baidu") {
        setLocationNotice(
          "当前设备正在使用百度兼容定位，定位精度会受到网络环境和地图服务影响。",
        );
      } else if (result.usedLastKnown) {
        setLocationNotice("当前使用的是最近一次可用定位，精度可能略低。");
      } else {
        setLocationNotice("");
      }

      sendSocketPayload({
        type: "location",
        latitude: result.coords.latitude,
        longitude: result.coords.longitude,
        accuracy: result.coords.accuracy,
        coordinate_system: result.coordinateSystem,
        nickname: currentProfile.nickname,
        sent_at: Date.now(),
      } satisfies SocketLocationPayload);
      */
    },
    [broadcastResolvedLocation, currentProfile, resolveCurrentLocation],
  );

  const handleLocationFailure = useCallback((error: unknown) => {
    setLocationNotice(getFriendlyLocationErrorMessage(error));
  }, []);

  const openSystemSettings = useCallback(() => {
    void Linking.openSettings().catch(() => {
      Alert.alert("打开设置失败", "请手动到系统设置中开启定位服务或定位权限。");
    });
  }, []);

  const requestPermissionFlow = useCallback(() => {
    if (promptShownRef.current) {
      return;
    }

    promptShownRef.current = true;
    setPermissionState("prompting");

    Alert.alert(
      "启用定位服务",
      "位置共享需要获取你当前的坐标，并通过 WebSocket 接收其他成员位置。你是否同意开启定位服务？",
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
    return () => {
      clearReconnectTimer();
      clearPendingWebLocationRequest();
    };
  }, [clearPendingWebLocationRequest, clearReconnectTimer]);

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
    if (
      permissionState !== "granted" ||
      !space ||
      !currentProfile ||
      Platform.OS !== "android" ||
      baiduNativeWatchStartedRef.current
    ) {
      return;
    }

    let cancelled = false;
    let stopWatching: (() => void) | null = null;

    void (async () => {
      try {
        if (!(await ensureBaiduNativeReady())) {
          return;
        }

        baiduNativeWatchStartedRef.current = true;
        stopWatching = await startBaiduNativeLocationUpdates(
          {
            intervalMs: 3000,
          },
          (payload) => {
            if (cancelled) {
              return;
            }

            const resolved = createResolvedBaiduNativeLocation(payload);
            broadcastResolvedLocation(resolved);
          },
          (error) => {
            if (!cancelled) {
              console.log(error);
            }
          },
        );
        if (cancelled) {
          stopWatching?.();
          stopWatching = null;
        }
      } catch (error) {
        if (!cancelled) {
          console.log(error);
        }
      }
    })();

    return () => {
      cancelled = true;
      baiduNativeWatchStartedRef.current = false;
      stopWatching?.();
    };
  }, [
    broadcastResolvedLocation,
    currentProfile,
    ensureBaiduNativeReady,
    permissionState,
    space,
  ]);

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

      clearReconnectTimer();
      setSocketState("connected");
      const reusableLocation = getReusablePublishedLocation(
        PUBLISHED_LOCATION_REUSE_MS,
      );
      const cachedPublishedLocation = latestPublishedLocationRef.current;
      if (reusableLocation) {
        broadcastResolvedLocation(reusableLocation, {
          updateNotice: false,
          resolvedAt: cachedPublishedLocation?.resolvedAt,
        });
      }
      if (!getReusablePublishedLocation(PUBLISHED_LOCATION_REFRESH_GRACE_MS)) {
        void publishCurrentLocation(false).catch(handleLocationFailure);
      }
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
        envelope = JSON.parse(String(event.data)) as WsEnvelope;
      } catch {
        envelope = null;
      }

      if (!envelope?.message) {
        return;
      }

      if (isLocationRequestMessage(envelope.message)) {
        const reusableLocation = getReusablePublishedLocation(
          PUBLISHED_LOCATION_REUSE_MS,
        );
        const cachedPublishedLocation = latestPublishedLocationRef.current;
        if (reusableLocation) {
          broadcastResolvedLocation(reusableLocation, {
            updateNotice: false,
            resolvedAt: cachedPublishedLocation?.resolvedAt,
          });
          if (
            getReusablePublishedLocation(PUBLISHED_LOCATION_REFRESH_GRACE_MS)
          ) {
            return;
          }
        }
        void publishCurrentLocation(false).catch(handleLocationFailure);
        return;
      }

      const offlinePayload = parseMemberOfflineMessage(envelope.message);
      if (offlinePayload) {
        setMarkersById((prev) => {
          if (!prev[offlinePayload.user_id]) {
            return prev;
          }

          const next = { ...prev };
          delete next[offlinePayload.user_id];
          return next;
        });
        return;
      }

      const payload = parseIncomingLocation(envelope.message);
      if (!payload || !envelope.sender_id) {
        return;
      }

      const senderId = envelope.sender_id;
      if (senderId === currentProfile.id) {
        return;
      }
      const memberName =
        payload.nickname?.trim() || memberMap.get(senderId) || "成员";

      const nextUpdatedAt = envelope.timestamp ?? payload.sent_at ?? Date.now();

      setMarkersById((prev) => {
        const existingMarker = prev[senderId];
        if (existingMarker && nextUpdatedAt <= existingMarker.updatedAt) {
          return prev;
        }

        return {
          ...prev,
          [senderId]: {
            id: senderId,
            name: memberName,
            latitude: payload.latitude,
            longitude: payload.longitude,
            coordinateSystem:
              payload.coordinate_system === "bd09" ? "bd09" : "gps",
            isCurrentUser: false,
            updatedAt: nextUpdatedAt,
          },
        };
      });
    };

    socket.onerror = () => {
      if (!cancelled) {
        setSocketState("error");
        setLocationNotice(
          (prev) => prev || "位置通道连接异常，系统会稍后自动重连。",
        );
      }
    };

    socket.onclose = () => {
      if (!cancelled) {
        setSocketState("idle");
        scheduleReconnect();
      }
    };

    return () => {
      cancelled = true;
      clearReconnectTimer();
      if (wsRef.current === socket) {
        wsRef.current = null;
      }
      socket.close();
    };
  }, [
    broadcastResolvedLocation,
    clearReconnectTimer,
    currentProfile,
    getReusablePublishedLocation,
    handleLocationFailure,
    memberMap,
    permissionState,
    publishCurrentLocation,
    scheduleReconnect,
    sendSocketPayload,
    socketRetryTick,
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

  useEffect(() => {
    syncMarkersToWebView(markers);
  }, [markers, syncMarkersToWebView]);

  const onRefreshLocations = useCallback(() => {
    if (permissionState !== "granted") {
      requestPermissionFlow();
      return;
    }

    void (async () => {
      try {
        const reusableLocation = getReusablePublishedLocation(
          PUBLISHED_LOCATION_REFRESH_GRACE_MS,
        );
        if (reusableLocation) {
          broadcastResolvedLocation(reusableLocation, {
            updateNotice: false,
          });
        } else {
          await publishCurrentLocation(true);
        }
        if (wsRef.current?.readyState !== WebSocket.OPEN) {
          setSocketState("connecting");
          setSocketRetryTick((value) => value + 1);
          setLocationNotice("位置通道正在重连，稍后会继续同步其他成员位置。");
          return;
        }

        sendSocketPayload({
          type: "request_location",
        } satisfies SocketRequestPayload);
      } catch (error) {
        const friendlyMessage = getFriendlyLocationErrorMessage(error);
        setLocationNotice(friendlyMessage);
        Alert.alert(
          "刷新失败",
          friendlyMessage,
          shouldSuggestOpeningSettings(friendlyMessage)
            ? [
                { text: "取消", style: "cancel" },
                { text: "打开设置", onPress: openSystemSettings },
              ]
            : [{ text: "知道了", style: "default" }],
        );
      }
    })();
  }, [
    broadcastResolvedLocation,
    getReusablePublishedLocation,
    openSystemSettings,
    permissionState,
    publishCurrentLocation,
    requestPermissionFlow,
    sendSocketPayload,
  ]);

  const mapHtml = useMemo(() => buildMapHtml(baiduMapAk), [baiduMapAk]);

  if (!space) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>位置共享暂时不可用</Text>
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
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerTextWrap}>
            <Text style={styles.title}>位置共享</Text>
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
              请先在 `local/.env` 中配置
              `EXPO_PUBLIC_BAIDU_MAP_AK`，然后重启应用。
            </Text>
          </View>
        ) : permissionState === "denied" ? (
          <View style={styles.permissionCard}>
            <Text style={styles.permissionTitle}>还没有开启定位权限</Text>
            <Text style={styles.permissionText}>
              你还没有同意定位服务，因此无法共享自己的位置，也无法进入位置共享页。
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
                ref={mapWebViewRef}
                originWhitelist={["*"]}
                source={{ html: mapHtml, baseUrl: baiduMapOrigin }}
                style={styles.webview}
                javaScriptEnabled
                domStorageEnabled
                cacheEnabled
                geolocationEnabled
                scrollEnabled={false}
                onMessage={handleMapMessage}
              />
            </View>

            <View style={styles.toolbarCard}>
              <View style={styles.statusWrap}>
                <Text style={styles.statusLabel}>连接状态</Text>
                <Text style={styles.statusText}>
                  {getSocketStatusLabel(socketState)}
                </Text>
                {locationNotice ? (
                  <Text style={styles.statusHelperText}>{locationNotice}</Text>
                ) : (
                  <Text style={styles.statusHelperText}>
                    刷新位置会重新广播自己的坐标，并请求其他成员回传位置。
                  </Text>
                )}
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
  statusHelperText: {
    marginTop: 6,
    color: mapPalette.muted,
    fontSize: 12,
    lineHeight: 18,
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
