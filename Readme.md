# Lync Space

A **local first** space APP for recording your memories. You can also share spaces with other people using our **sync** service.

## How to start?

### local part

1. 安装`nodejs`，然后安装依赖(可能需要配置代理或镜像源)：

```bash
cd local
npm install
```

2. 如需使用服务器端的网络服务以及一些联网便利功能，你需要配置环境变量：

```bash
cp .env.example .env
```

然后修改`.env`文件

3. 启动项目：

```bash
npx expo start
```

### server part

1. 安装`go`, 然后你可能需要配置代理：

```bash
go env -w GO111MODULE=on
go env -w GOPROXY=https://goproxy.cn,direct
```

2. 直接启动项目或者构建可执行文件

```bash
cd server
# 启动
go run main.go
# 或者构建
go build main.go
```

3. 默认端口为8088，如有端口冲突，可自行更改配置，配置文件位于`internal/config/config.yaml`

### What's more

如果你在本地电脑开发调试，你可能需要：

1. 想验证客户端与服务器端的数据同步，需要开启服务器端的数据库，你可以通过我们提供的docker-compose文件开启一个postgreSQL容器，数据库配置与端口配置可自行修改，需保证docker-compose中的配置与server端的配置文件一致；或者自行连接你已有的数据库。

2. 想验证客户端与服务器端的文件传输，服务器端提供了静态文件托管服务，你可以通过修改server端的配置文件，从而让客户端可以访问你的服务器端的静态文件；或者自行使用你已有的OSS服务。
