# Local part

This is an [Expo](https://expo.dev) project started with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Code reading guide

如果你想系统读懂 `local/` 里的页面、数据层和数据库实现，建议先看：

- [`../docs/local-code-guide.md`](../docs/local-code-guide.md)

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
