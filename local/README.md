# Local part

This is an [Expo](https://expo.dev) project started with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## configuration

// TODO：添加对配置文件的说明

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
