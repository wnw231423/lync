// model/index 把 schema、migrations 和模型类组装成同一个 Watermelon 数据库实例。
import { Database } from "@nozbe/watermelondb";
import SQLiteAdapter from "@nozbe/watermelondb/adapters/sqlite";
import LokiJSAdapter from "@nozbe/watermelondb/adapters/lokijs";

import schema from "../model/schema";
import migrations from "../model/migrations";

import Comment from "@/model/Comment";
import Expense from "@/model/Expense";
import Photo from "@/model/Photo";
import Post from "@/model/Post";
import Space from "@/model/Space";
import SpaceMember from "@/model/SpaceMember";
import User from "@/model/User";

// isTestEnv 用来区分 Jest 测试和真机/模拟器运行环境。
const isTestEnv = process.env.NODE_ENV === "test";
// 测试环境使用 LokiJS，应用运行时则在设备上使用 SQLite。
const adapter = isTestEnv
  ? new LokiJSAdapter({
      schema,
      migrations,
      // 测试环境里不需要额外 worker，保持配置尽量简单可控。
      useWebWorker: false,
      useIncrementalIndexedDB: false,
    })
  : new SQLiteAdapter({
      schema,
      // 开发阶段如果需要，也可以临时注释 migrations，具体可参考迁移文档。
      migrations,
      // 可选：自定义数据库名称或文件路径。
      // dbName: "myapp",
      // 推荐开启 jsi；它在 iOS 上通常开箱即用，Android 若遇到问题可暂时关闭。
      jsi: true /* Platform.OS === 'ios' */,
      // 可选：建议实现数据库初始化失败时的兜底处理。
      onSetUpError: (error) => {
        // 数据库初始化失败时，可以在这里提示用户重试、重载或退出登录。
      },
    });

// database 是整个应用共用的本地数据库单例。
export const database = new Database({
  adapter,
  modelClasses: [Comment, Expense, Photo, Post, Space, SpaceMember, User],
});
