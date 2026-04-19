# Local part

This is an [Expo](https://expo.dev) project started with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## configuration

百度地图相关配置放在本地 `.env` 中，示例见 `.env.example`。不把真实 AK 提交到仓库。

- `EXPO_PUBLIC_BAIDU_MAP_AK`: 百度地图 JavaScript API 的浏览器端 AK，用于位置页 WebView 内的百度地图底图、标记点渲染和网页兼容定位。
- `EXPO_PUBLIC_BAIDU_LOCATION_ANDROID_AK`: 百度 Android 定位 SDK 的原生定位 AK，用于 Android 设备优先走百度原生定位链路。这个 AK 需要在百度开放平台按 Android 包名和 SHA1 配置；首次接入或原生代码变更后需要重建 Android 开发壳。
- `EXPO_PUBLIC_BAIDU_MAP_WEB_ORIGIN`: WebView 中加载百度地图 JS API 时使用的页面来源域名，需要和百度开放平台里为 `EXPO_PUBLIC_BAIDU_MAP_AK` 配置的浏览器端来源限制保持一致。

## fmt&lint standard

如果使用`vscoce`, 推荐安装以下插件:

- eslint
- prettier

除此之外, 可以使用以下命令进行lint&fmt:

```bash
npx expo lint
npx prettier . --write
```

本项目添加了pre-commit hook，在git commit前会进行强制检查，遇到prettier无法自动修复的fmt问题或者lint问题会报错。

## Unit tests

本项目使用`jest`单元测试框架，可通过`npm run test`执行测试。建议在每次遇到错误需要debug时，马上写一个单元测试，然后再开始debug。
