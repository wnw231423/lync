// 位置共享页：在本地 WebView 中渲染百度地图，并展示当前空间成员的位置状态。
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import WebView, { type WebViewMessageEvent } from "react-native-webview";
import {
  getCurrentUser,
  getSpaceByCode,
  simulateOtherMembersLocation,
  type SpaceData,
} from "@/features/travel/mockApp";

// MapPoint 是位置页真正交给 WebView 地图脚本渲染的点位结构。
type MapPoint = {
  id: string;
  userId: string;
  username: string;
  latitude: number;
  longitude: number;
  battery: number;
  isCurrentUser: boolean;
};

// MapEvent 约定了 WebView 内地图脚本回传给 React Native 宿主的事件类型。
type MapEvent =
  | { type: "ready" }
  | { type: "warning"; message?: string }
  | { type: "error"; message?: string }
  | { type: "timeout"; message?: string };

// 这是本地 WebView 使用的虚拟页面来源，并不对应真实线上域名。
const LOCAL_BAIDU_MAP_PAGE_ORIGIN = "https://travel-map.local";
const LOCAL_BAIDU_MAP_BASE_URL = `${LOCAL_BAIDU_MAP_PAGE_ORIGIN}/`;

const mapPalette = {
  background: "#EFF9F2",
  surface: "rgba(255,255,255,0.72)",
  surfaceStrong: "rgba(255,255,255,0.86)",
  border: "rgba(199,231,211,0.92)",
  text: "#0F172A",
  muted: "#64748B",
  primary: "#60C28E",
  secondary: "#3E9E6C",
  success: "#34D399",
  warning: "#F59E0B",
  shadow: "#BFDCCC",
};

// mapPalette 集中维护位置页使用的玻璃拟态配色。
// 从 Expo 公共环境变量里读取浏览器端百度地图密钥。
function getBaiduAk() {
  return process.env.EXPO_PUBLIC_BAIDU_MAP_AK?.trim() ?? "";
}

// 把数据安全序列化进内联脚本，避免用户文本打断 HTML 结构。
function serializeInlineScriptValue(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// 检查经纬度是否仍在合法范围内，避免异常点位拖垮地图渲染。
function isValidCoordinate(latitude: number, longitude: number) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

// 直接在本地 WebView 中构造百度地图宿主页，不再经过自建服务器转发。
function buildLocalMapHtml(ak: string, points: MapPoint[]) {
  if (!ak || points.length === 0) {
    return "";
  }

  const akJson = serializeInlineScriptValue(ak);
  const pointsJson = serializeInlineScriptValue(points);
  const localOriginJson = serializeInlineScriptValue(
    LOCAL_BAIDU_MAP_PAGE_ORIGIN,
  );

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
    />
    <style>
      html,
      body,
      #map {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        background: #eef2ff;
        overflow: hidden;
      }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script>
      const BAIDU_AK = ${akJson};
      const MAP_POINTS = ${pointsJson};
      const MAP_PAGE_ORIGIN =
        window.location.origin || window.location.href || ${localOriginJson};
      const MAP_LOAD_TIMEOUT = 15000;
      const SDK_READY_CALLBACK = "__baiduMapSdkReady__";
      const MAP_TRANSLATE_BATCH_SIZE = 10;
      let hasMounted = false;

      function postMessage(payload) {
        if (
          window.ReactNativeWebView &&
          typeof window.ReactNativeWebView.postMessage === "function"
        ) {
          window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        }
      }

      function formatInfo(item) {
        return (
          '<div style="min-width:180px;color:#0f172a;font-size:13px;line-height:1.65;">' +
          '<div style="font-weight:700;font-size:14px;margin-bottom:4px;">' +
          item.username +
          (item.isCurrentUser ? "（我）" : "") +
          "</div>" +
          "<div>电量：" +
          item.battery +
          "%</div>" +
          "<div>纬度：" +
          item.latitude.toFixed(6) +
          "</div>" +
          "<div>经度：" +
          item.longitude.toFixed(6) +
          "</div>" +
          "</div>"
        );
      }

      function toErrorMessage(error, fallbackMessage) {
        if (error && typeof error.message === "string") {
          return error.message;
        }
        if (typeof error === "string") {
          return error;
        }
        return fallbackMessage;
      }

      function chunkArray(items, size) {
        const chunks = [];
        for (let index = 0; index < items.length; index += size) {
          chunks.push(items.slice(index, index + size));
        }
        return chunks;
      }

      // 批量把原始经纬度转换成百度地图坐标。
      function translateBatch(batch) {
        return new Promise((resolve, reject) => {
          try {
            if (!window.BMap || !window.BMap.Convertor) {
              resolve(batch);
              return;
            }

            const convertor = new window.BMap.Convertor();
            const pointList = batch.map(
              (item) => new window.BMap.Point(item.longitude, item.latitude),
            );

            convertor.translate(pointList, 1, 5, function (data) {
              if (
                !data ||
                data.status !== 0 ||
                !Array.isArray(data.points) ||
                data.points.length !== batch.length
              ) {
                reject(new Error("百度坐标转换失败。"));
                return;
              }

              resolve(
                batch.map((item, index) => ({
                  ...item,
                  longitude: data.points[index].lng,
                  latitude: data.points[index].lat,
                })),
              );
            });
          } catch (error) {
            reject(error);
          }
        });
      }

      // 分批转换点位，避免一次性转换过多点时不稳定。
      async function translatePoints(points) {
        if (!Array.isArray(points) || points.length === 0) {
          return [];
        }

        if (!window.BMap || !window.BMap.Convertor) {
          return points;
        }

        const translated = [];
        const batches = chunkArray(points, MAP_TRANSLATE_BATCH_SIZE);

        for (const batch of batches) {
          try {
            const converted = await translateBatch(batch);
            translated.push(...converted);
          } catch {
            translated.push(...batch);
          }
        }

        return translated;
      }

      // SDK 就绪后渲染标记点、标签和信息窗。
      function renderMap(points) {
        if (!window.BMap) {
          throw new Error(
            "百度地图脚本已加载，但 BMap 不可用，请检查浏览器端密钥白名单是否允许当前来源访问：" +
              MAP_PAGE_ORIGIN,
          );
        }

        if (!Array.isArray(points) || points.length === 0) {
          throw new Error("暂无可展示的位置数据。");
        }

        const map = new window.BMap.Map("map");
        const viewPoints = [];

        map.enableScrollWheelZoom(true);
        map.enableContinuousZoom();
        map.enableInertialDragging();
        map.addControl(new window.BMap.NavigationControl());
        map.addControl(new window.BMap.ScaleControl());

        points.forEach((item) => {
          const point = new window.BMap.Point(item.longitude, item.latitude);
          const marker = new window.BMap.Marker(point);
          if (item.isCurrentUser) {
            const icon = new window.BMap.Symbol(window.BMap_Symbol_SHAPE_POINT, {
              scale: 1.3,
              fillColor: "#60C28E",
              fillOpacity: 1,
              strokeColor: "#FFFFFF",
              strokeWeight: 3,
            });
            marker.setIcon(icon);
          }

          const label = new window.BMap.Label(
            item.username +
              (item.isCurrentUser ? "（我）" : "") +
              " | 电量 " +
              item.battery +
              "%",
            {
              offset: new window.BMap.Size(18, -10),
            },
          );

          label.setStyle({
            color: "#0f172a",
            backgroundColor: "rgba(255,255,255,0.92)",
            border: "1px solid rgba(199,231,211,0.92)",
            borderRadius: "999px",
            padding: "4px 8px",
            fontSize: "12px",
            fontWeight: "600",
            boxShadow: "0 10px 24px rgba(96,194,142,0.16)",
          });

          marker.setLabel(label);
          marker.addEventListener("click", function () {
            map.openInfoWindow(new window.BMap.InfoWindow(formatInfo(item)), point);
          });

          map.addOverlay(marker);
          viewPoints.push(point);
        });

        if (viewPoints.length === 1) {
          map.centerAndZoom(viewPoints[0], 15);
        } else {
          map.setViewport(viewPoints);
        }
      }

      // 地图的单次挂载入口，负责转换点位并完成首次绘制。
      async function mountMap() {
        if (hasMounted) {
          return;
        }

        const translatedPoints = await translatePoints(MAP_POINTS);
        renderMap(translatedPoints);
        hasMounted = true;
        postMessage({ type: "ready" });
      }

      window.addEventListener("error", function (event) {
        const filename =
          event && typeof event.filename === "string" ? event.filename : "";
        const message =
          event && typeof event.message === "string"
            ? event.message
            : "未知脚本错误";

        if (message === "Script error." || /api\\.map\\.baidu\\.com/i.test(filename)) {
          postMessage({
            type: "error",
            message:
              "百度地图脚本触发跨域错误，请检查浏览器端密钥白名单是否允许当前页面来源：" +
              MAP_PAGE_ORIGIN,
          });
          return;
        }

        postMessage({
          type: "error",
          message: message + (filename ? " @ " + filename : ""),
        });
      });

      window.addEventListener("unhandledrejection", function (event) {
        postMessage({
          type: "error",
          message: toErrorMessage(event && event.reason, "未处理的 Promise 异常"),
        });
      });

      // 负责在本地 WebView 中加载百度地图 SDK，并把初始化状态回传给 React Native。
      (function bootstrap() {
        if (!BAIDU_AK) {
          postMessage({ type: "error", message: "缺少百度地图密钥。" });
          return;
        }

        const timeoutId = window.setTimeout(function () {
          postMessage({
            type: "timeout",
            message:
              "加载百度实时地图超时，请检查设备网络以及浏览器端密钥白名单是否允许当前页面来源：" +
              MAP_PAGE_ORIGIN,
          });
        }, MAP_LOAD_TIMEOUT);

        window[SDK_READY_CALLBACK] = function () {
          window.clearTimeout(timeoutId);
          Promise.resolve()
            .then(mountMap)
            .catch(function (error) {
              postMessage({
                type: "error",
                message: toErrorMessage(error, "实时地图初始化失败。"),
              });
            });
        };

        const script = document.createElement("script");
        script.src =
          "https://api.map.baidu.com/api?v=3.0&ak=" +
          encodeURIComponent(BAIDU_AK) +
          "&callback=" +
          encodeURIComponent(SDK_READY_CALLBACK);
        script.async = true;
        script.onerror = function () {
          window.clearTimeout(timeoutId);
          postMessage({
            type: "error",
            message:
              "百度地图脚本加载失败，请检查设备网络以及浏览器端密钥是否已启用。",
          });
        };
        document.head.appendChild(script);
      })();
    </script>
  </body>
</html>`;
}

// 点位变化后强制重建 WebView，保证百度地图脚本重新读取最新数据。
// buildMapKey 根据点位内容生成稳定 key，用来强制 WebView 在数据变化时重新装载。
function buildMapKey(space: SpaceData | null) {
  if (!space) {
    return "none";
  }

  return `${space.id}:${space.locations
    .map(
      (item) =>
        `${item.id}:${item.latitude.toFixed(6)}:${item.longitude.toFixed(6)}:${item.battery}`,
    )
    .join("|")}`;
}

// 位置页负责展示百度实时地图和当前空间的成员位置列表。
export default function LocationPage() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const spaceCode = typeof code === "string" ? code : "";
  const currentUser = getCurrentUser();
  const baiduAk = getBaiduAk();

  // space 保存当前空间在前端 mock 层里的完整快照。
  const [space, setSpace] = useState<SpaceData | null>(() =>
    spaceCode ? getSpaceByCode(spaceCode) : null,
  );
  // mapStatus 控制地图加载中、就绪和失败时的蒙层展示。
  const [mapStatus, setMapStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  // mapErrorText 保存地图彻底加载失败时要展示给用户的错误文案。
  const [mapErrorText, setMapErrorText] = useState("");
  // mapWarningText 保存非致命问题，例如部分点位失效或转换失败。
  const [mapWarningText, setMapWarningText] = useState("");

  useFocusEffect(
    useCallback(() => {
      if (!spaceCode) {
        setSpace(null);
        return;
      }

      setSpace(getSpaceByCode(spaceCode));
    }, [spaceCode]),
  );

  // mapPoints 会把 mock 位置记录转换成前端地图脚本需要的扁平数据。
  const mapPoints = useMemo<MapPoint[]>(() => {
    if (!space) {
      return [];
    }

    return space.locations.map((item) => ({
      id: item.id,
      userId: item.user_id,
      username: item.username,
      latitude: item.latitude,
      longitude: item.longitude,
      battery: item.battery,
      isCurrentUser: item.user_id === currentUser.id,
    }));
  }, [currentUser.id, space]);

  const safeMapPoints = useMemo(
    () =>
      mapPoints.filter((item) =>
        isValidCoordinate(item.latitude, item.longitude),
      ),
    [mapPoints],
  );

  const mapKey = useMemo(() => buildMapKey(space), [space]);

  const localMapHtml = useMemo(
    () => buildLocalMapHtml(baiduAk, safeMapPoints),
    [baiduAk, safeMapPoints],
  );

  useEffect(() => {
    if (!localMapHtml) {
      setMapStatus("idle");
      setMapErrorText("");
      setMapWarningText("");
      return;
    }

    setMapStatus("loading");
    setMapErrorText("");
    setMapWarningText("");
  }, [localMapHtml, mapKey]);

  // 刷新按钮会重新模拟成员坐标，方便开发阶段验证地图变化。
  const onRefresh = useCallback(() => {
    if (!spaceCode) {
      return;
    }

    const result = simulateOtherMembersLocation(spaceCode);
    if (!result.ok) {
      return;
    }

    setSpace(result.space);
    setMapStatus("loading");
    setMapErrorText("");
    setMapWarningText("");
  }, [spaceCode]);

  // 处理 WebView 地图页主动回传的 ready、warning 和 error 事件。
  const onMapMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const payload = JSON.parse(event.nativeEvent.data) as MapEvent;

      if (payload.type === "ready") {
        setMapStatus("ready");
        setMapErrorText("");
        return;
      }

      if (payload.type === "warning") {
        setMapWarningText(
          payload.message ?? "地图已加载，但存在部分异常点位。",
        );
        return;
      }

      if (payload.type === "error" || payload.type === "timeout") {
        setMapStatus("error");
        setMapErrorText(payload.message ?? "实时地图加载失败，请稍后重试。");
      }
    } catch {
      setMapStatus("error");
      setMapErrorText("实时地图返回了无法识别的数据。");
    }
  }, []);

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

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>位置共享</Text>
          <Pressable
            style={styles.backButton}
            onPress={() =>
              router.replace({ pathname: "/team", params: { code: spaceCode } })
            }
          >
            <Text style={styles.backButtonText}>返回</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {!baiduAk ? (
            <View style={styles.noticeCard}>
              <Text style={styles.noticeTitle}>缺少百度地图密钥</Text>
              <Text style={styles.noticeText}>
                请先在 `.env` 中配置 `EXPO_PUBLIC_BAIDU_MAP_AK`。
              </Text>
            </View>
          ) : null}

          {mapPoints.length > safeMapPoints.length ? (
            <View style={styles.noticeCard}>
              <Text style={styles.noticeTitle}>已忽略异常坐标</Text>
              <Text style={styles.noticeText}>
                当前有 {mapPoints.length - safeMapPoints.length}{" "}
                个点位坐标不合法， 地图已自动跳过这些记录。
              </Text>
            </View>
          ) : null}

          <View style={styles.mapCard}>
            <View style={styles.mapCardHeader}>
              <Text style={styles.mapTitle}>实时地图</Text>
              <Text style={styles.mapHint}>可拖动、缩放查看成员位置</Text>
            </View>

            <View style={styles.mapViewport}>
              {localMapHtml ? (
                <WebView
                  key={mapKey}
                  source={{
                    html: localMapHtml,
                    baseUrl: LOCAL_BAIDU_MAP_BASE_URL,
                  }}
                  style={styles.map}
                  originWhitelist={["*"]}
                  javaScriptEnabled
                  domStorageEnabled
                  mixedContentMode="always"
                  setSupportMultipleWindows={false}
                  scrollEnabled={false}
                  onLoadStart={() => {
                    setMapStatus("loading");
                    setMapErrorText("");
                  }}
                  onMessage={onMapMessage}
                  onError={(event) => {
                    setMapStatus("error");
                    setMapErrorText(
                      event.nativeEvent.description ||
                        "本地地图页面在 WebView 中加载失败。",
                    );
                  }}
                />
              ) : (
                <View style={styles.mapFallback}>
                  <Text style={styles.mapFallbackTitle}>实时地图暂不可用</Text>
                  <Text style={styles.mapFallbackText}>
                    请检查百度地图密钥以及当前空间是否存在有效坐标数据。
                  </Text>
                </View>
              )}

              {localMapHtml && mapStatus === "loading" ? (
                <View style={styles.loadingMask}>
                  <ActivityIndicator size="small" color={mapPalette.primary} />
                  <Text style={styles.loadingText}>正在加载实时地图...</Text>
                </View>
              ) : null}
            </View>

            {mapWarningText ? (
              <Text style={styles.warningText}>{mapWarningText}</Text>
            ) : null}

            {mapStatus === "error" && mapErrorText ? (
              <Text style={styles.errorText}>{mapErrorText}</Text>
            ) : null}
          </View>

          <View style={styles.memberHeader}>
            <Text style={styles.memberTitle}>空间成员</Text>
            <Text style={styles.memberCount}>
              共 {space.locations.length} 人
            </Text>
          </View>

          {space.locations.map((member) => {
            const isCurrentUser = member.user_id === currentUser.id;

            return (
              <View key={member.id} style={styles.memberCard}>
                <View style={styles.memberCardHeader}>
                  <Text style={styles.memberName}>
                    {member.username}
                    {isCurrentUser ? "（我）" : ""}
                  </Text>
                  <View
                    style={isCurrentUser ? styles.selfTag : styles.memberTag}
                  >
                    <Text
                      style={
                        isCurrentUser
                          ? styles.selfTagText
                          : styles.memberTagText
                      }
                    >
                      {isCurrentUser ? "当前设备" : "空间成员"}
                    </Text>
                  </View>
                </View>
                <Text style={styles.memberInfo}>
                  电量 {member.battery}% | 纬度 {member.latitude.toFixed(6)} |
                  经度 {member.longitude.toFixed(6)}
                </Text>
              </View>
            );
          })}

          <Pressable style={styles.refreshButton} onPress={onRefresh}>
            <Text style={styles.refreshButtonText}>刷新位置</Text>
          </Pressable>
        </ScrollView>
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
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  title: { fontSize: 28, fontWeight: "800", color: mapPalette.text },
  backButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: mapPalette.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: mapPalette.surfaceStrong,
    shadowColor: mapPalette.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  backButtonText: {
    color: mapPalette.primary,
    fontWeight: "700",
    fontSize: 13,
  },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 18 },
  noticeCard: {
    borderRadius: 20,
    backgroundColor: mapPalette.surface,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: mapPalette.border,
    shadowColor: mapPalette.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  noticeTitle: { color: mapPalette.text, fontWeight: "700", fontSize: 14 },
  noticeText: {
    marginTop: 6,
    color: mapPalette.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  mapCard: {
    borderRadius: 28,
    backgroundColor: mapPalette.surface,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: mapPalette.border,
    shadowColor: mapPalette.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  mapCardHeader: { marginBottom: 12 },
  mapTitle: { color: mapPalette.text, fontSize: 18, fontWeight: "800" },
  mapHint: { marginTop: 6, color: mapPalette.muted, fontSize: 13 },
  mapViewport: {
    height: 430,
    borderRadius: 22,
    overflow: "hidden",
    backgroundColor: "#EAF7EF",
    position: "relative",
  },
  map: {
    width: "100%",
    height: "100%",
    backgroundColor: "#EAF7EF",
  },
  mapFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  mapFallbackTitle: {
    color: mapPalette.text,
    fontSize: 16,
    fontWeight: "700",
  },
  mapFallbackText: {
    marginTop: 8,
    color: mapPalette.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  loadingMask: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(248,250,252,0.64)",
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: 8,
    color: mapPalette.primary,
    fontSize: 13,
    fontWeight: "600",
  },
  errorText: {
    marginTop: 10,
    color: "#E11D48",
    fontSize: 12,
    lineHeight: 18,
  },
  warningText: {
    marginTop: 10,
    color: mapPalette.warning,
    fontSize: 12,
    lineHeight: 18,
  },
  memberHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  memberTitle: { color: mapPalette.text, fontSize: 16, fontWeight: "800" },
  memberCount: { color: mapPalette.muted, fontSize: 12, fontWeight: "600" },
  memberCard: {
    borderRadius: 22,
    backgroundColor: mapPalette.surface,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: mapPalette.border,
    shadowColor: mapPalette.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  memberCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  memberName: { color: mapPalette.text, fontSize: 15, fontWeight: "700" },
  memberInfo: {
    marginTop: 8,
    color: mapPalette.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  memberTag: {
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.78)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: mapPalette.border,
  },
  memberTagText: { color: mapPalette.muted, fontSize: 12, fontWeight: "700" },
  selfTag: {
    borderRadius: 999,
    backgroundColor: "rgba(52,211,153,0.14)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.3)",
  },
  selfTagText: { color: mapPalette.success, fontSize: 12, fontWeight: "700" },
  refreshButton: {
    marginTop: 10,
    borderRadius: 18,
    backgroundColor: mapPalette.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    shadowColor: mapPalette.primary,
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  refreshButtonText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: mapPalette.text,
    fontWeight: "700",
    fontSize: 22,
    marginBottom: 14,
  },
});
