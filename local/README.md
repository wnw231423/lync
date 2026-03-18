# Local part

This is an [Expo](https://expo.dev) project started with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

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
