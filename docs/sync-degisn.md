# Sync design

本文详细讲述项目的同步机制。

## watermelonDB提供了什么？

1. 软删除，根据[官方文档](https://watermelondb.dev/docs/CRUD#delete-a-record)，由于涉及同步，需要调用`await somePost.markAsDeleted()`实现软删除。
2. `synchronize()`函数，这个函数中有两个*callback*函数，`pullChanges`和`pushChanges`，前端可以：
    1. 实现*callback*函数中调用API的逻辑
    2. 定义一个`MyFunc()`，调用实现了*callback*的`synchronize()`函数。然后在需要的场景，例如按了一个按钮后，触发`MyFunc()`
3. API规范
4. 实现*callback*函数中调用API的逻辑
5. 定义一个`MyFunc()`，调用实现了*callback*的`synchronize()`函数。然后在需要的场景，例如按了一个按钮后，触发`MyFunc()`
6. API规范

## 需要注意什么？

本地和服务器的数据库表，定义会不一样。这些字段需要理解：

- `created_at`/`updated_at`：用户视角的数据元信息，服务器和本地数据库都有，由客户端通过watermelon的装饰器自动填入
- `deleted_at`：
    - 本地watermelonDB没有这个字段，因为它有软删除机制，通过其隐藏的`_status`字段标记已删除
    - 服务器端需要有这个字段，因为服务器端是通用数据库，需要一个`deleted_at`做显式删除标记，而不能直接删除。标记删除后等客户端拉取更新，就要把该记录放到API回复中的delete里。
- `last_modified`/`server_created_at`:
    - 本地没有这个字段，只有服务器端有
    - 这两个字段是用于辅助同步的，当客户端pull时，比对客户端调用API里传来的last_pulled_at参数
        - server_created_at > last_pulled_at: 说明对客户端来说是新建的，塞到API回复的created中
        - last_modified > last_pulled_at: 说明对客户端来说是修改过的，塞到API回复的updated中
    - 需要区分`created_at`/`updated_at`

## 同步过程

假设以空间为同步单位，用户点击"同步"后，同步过程如下：

1. 客户端 `POST spaces`，参数userid和spaceid
2. 客户端 `GET sync`, 参数user_id, space_id, last_pulled_at.
3. 服务器的处理方式如下：
    1. 对于user，space, space_members表：
        - 先根据space_id做筛选，选出space内的user，space，space_members
        - 直接把筛选出来的数据塞到changes的updated里.
    2. 对于其他数据表：
        - 先根据space_id做筛选，选出space内的数据
        - 根据last_pulled_at分别往changes里塞相应的created，updated，deleted
    3. 返回此回复。注意服务器要把客户端没有的字段删去。
4. 客户端接收到回复，watermelonDB处理此回复
5. 客户端 `POST sync`，
    - // TODO： 重写一下这段文档
6. 客户端 检查photos（检查所有记录，不要按照space_id筛选，因为可能有其他空间本地照片post失败的情况）：
    - `remote_url` 为空，且 `${App存储目录}/photos/${photo_id}.jpg` 存在：说明这是本地新建、尚未上传二进制的图片。前端需调用 `POST /api/v1/photos` 做上传补偿；服务端写入 `remote_url` 后，客户端下次 sync 会拉到它。
    - `remote_url` 非空，且 `${App存储目录}/photos/${photo_id}.jpg` 不存在：说明 photo 元数据已经同步到本地，但图片文件本身还没落到设备上。前端应在 sync 完成后把图片下载到这个固定路径，供后续显示与离线访问。
    - `remote_url` 非空，且 `${App存储目录}/photos/${photo_id}.jpg` 已存在：说明这条 photo 已经是完整状态，不需要额外处理。
    - `remote_url` 为空，且 `${App存储目录}/photos/${photo_id}.jpg` 也不存在：说明这是异常记录。客户端无法自动恢复，应在 sync 中跳过且不影响整体成功；前端展示时不显示这张图片。
    - 这意味着，事实上 photo 的同步补偿只围绕“上传缺失的二进制”和“下载缺失的二进制”展开，不存在单独的 photo update 文件同步逻辑。
