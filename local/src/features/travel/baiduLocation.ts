import { NativeEventEmitter, NativeModules, Platform } from "react-native";

export type BaiduNativeLocationResult = {
  accuracy?: number | null;
  coordinateSystem: "gps" | "bd09";
  coordinateType?: string;
  latitude: number;
  locType?: number;
  locTypeDescription?: string;
  longitude: number;
  networkLocationType?: string | null;
  timestamp?: number;
};

type BaiduNativeLocationError = {
  code?: string;
  message?: string;
};

type BaiduLocationModuleShape = {
  addListener(eventName: string): void;
  removeListeners(count: number): void;
  configure(apiKey: string): Promise<boolean>;
  getCurrentPosition(options?: {
    timeoutMs?: number;
  }): Promise<BaiduNativeLocationResult>;
  isSupported(): Promise<boolean>;
  startWatching(options?: { intervalMs?: number }): Promise<boolean>;
  stopWatching(): void;
};

const nativeModule = NativeModules.BaiduLocation as
  | BaiduLocationModuleShape
  | undefined;
const nativeEmitter =
  Platform.OS === "android" && nativeModule
    ? new NativeEventEmitter(nativeModule)
    : null;

function ensureModule() {
  if (Platform.OS !== "android" || !nativeModule) {
    throw new Error("Baidu native location is not available on this platform.");
  }

  return nativeModule;
}

function sanitizeNumber(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeLocationResult(
  payload: BaiduNativeLocationResult,
): BaiduNativeLocationResult {
  return {
    accuracy: sanitizeNumber(payload.accuracy),
    coordinateSystem: payload.coordinateSystem === "bd09" ? "bd09" : "gps",
    coordinateType:
      typeof payload.coordinateType === "string" ? payload.coordinateType : "",
    latitude: payload.latitude,
    locType: typeof payload.locType === "number" ? payload.locType : undefined,
    locTypeDescription:
      typeof payload.locTypeDescription === "string"
        ? payload.locTypeDescription
        : "",
    longitude: payload.longitude,
    networkLocationType:
      typeof payload.networkLocationType === "string"
        ? payload.networkLocationType
        : null,
    timestamp:
      typeof payload.timestamp === "number" &&
      Number.isFinite(payload.timestamp)
        ? payload.timestamp
        : Date.now(),
  };
}

export async function isBaiduNativeLocationSupported() {
  if (Platform.OS !== "android" || !nativeModule) {
    return false;
  }

  return nativeModule.isSupported();
}

export async function configureBaiduNativeLocation(apiKey: string) {
  const module = ensureModule();
  await module.configure(apiKey);
}

export async function getBaiduNativeCurrentPosition(options?: {
  timeoutMs?: number;
}) {
  const module = ensureModule();
  const payload = await module.getCurrentPosition(options);
  return normalizeLocationResult(payload);
}

export async function startBaiduNativeLocationUpdates(
  options: {
    intervalMs?: number;
  },
  onLocation: (payload: BaiduNativeLocationResult) => void,
  onError?: (error: Error) => void,
) {
  const module = ensureModule();
  const emitter = nativeEmitter;
  if (!emitter) {
    throw new Error("Baidu native location updates are not available.");
  }

  const locationSubscription = emitter.addListener(
    "baiduLocationUpdated",
    (payload: BaiduNativeLocationResult) => {
      onLocation(normalizeLocationResult(payload));
    },
  );
  const errorSubscription = emitter.addListener(
    "baiduLocationError",
    (payload: BaiduNativeLocationError) => {
      onError?.(
        new Error(payload.message || "Baidu native location update failed."),
      );
    },
  );

  try {
    await module.startWatching(options);
  } catch (error) {
    locationSubscription.remove();
    errorSubscription.remove();
    throw error;
  }

  return () => {
    locationSubscription.remove();
    errorSubscription.remove();
    module.stopWatching();
  };
}
