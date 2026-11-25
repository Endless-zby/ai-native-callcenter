# 日常改动与上线流程（本 fork 专用）

> 本文件是 `custom` 分支的变更上线约定。以后流程有变化，直接更新本文件并提交到
> `custom`，不要把流程散落在聊天记录里。

## 1. 环境事实

| 项 | 值 |
|---|---|
| 本地源码 | `~/Product/aicc-project`（开发、提交、推送） |
| 生产源码 | `/opt/aicc`（生产机自己的 git clone，构建用） |
| `origin` | `git@github.com:Endless-zby/ai-native-callcenter.git`（你的 fork） |
| `upstream` | `https://github.com/rasonyang/ai-native-callcenter.git` |
| `main` | 只镜像上游，fast-forward，不直接改 |
| `custom` | 我们的二次开发，生产部署分支 |

镜像：

- **应用镜像 `aicc:local` 在生产机上构建**（`/opt/aicc` 源码 + `Dockerfile`），
  不经过 registry；多阶段构建里包含前端 `npm run build`；
- **交换机镜像**由 `AICC_FS_IMAGE` 指定，当前是派生镜像
  `aicc-freeswitch:5072`（见 `deploy/freeswitch-5072/Dockerfile`，来自
  基础镜像 `rasonyang/freeswitch-aicc:v0.9.1`，构建时把
  `internal_sip_port` 改成 5072）。

不入库、但 `git reset --hard` 不会删除的部署产物：

- `/opt/aicc/deploy/.env`（生产配置与密钥）
- `/opt/aicc/deploy/flows/`（话术 JSON 留档）
- `/opt/aicc/deploy/.env.bak.*`（改配置前的备份）

## 2. 标准流程（改代码）

### 2.1 本地提交并推送

```sh
cd ~/Product/aicc-project
git checkout custom
# ... 改代码 ...
git add -A
git commit -m "area: what changed and why"
git push origin custom
```

### 2.2 在生产机构建并上线

在本地执行（脚本会 SSH 到 `aicc-root`）：

```sh
scripts/deploy-prod.sh custom
```

脚本做的事：

```sh
cd /opt/aicc
git fetch origin --prune
git checkout custom
git reset --hard origin/custom     # 服务器源码对齐 fork
cd /opt/aicc/deploy
docker compose build aicc           # 在服务器构建（含前端）
docker compose up -d --force-recreate aicc
docker compose exec -T aicc aicc doctor --host-addrs <host-ip>,127.0.0.1 --wait 60s
```

`docker compose up --force-recreate` 是必须的：同 tag 重建时 compose 不一定替换
容器，不强制重建会出现“部署成功但还在跑旧镜像”。脚本只重建 `aicc`，PostgreSQL
和 FreeSWITCH 保持运行。

### 2.3 手工等价命令（脚本不可用时）

```sh
ssh aicc-root 'cd /opt/aicc && git fetch origin && git checkout custom && \
  git reset --hard origin/custom && git log --oneline -1'

ssh aicc-root 'cd /opt/aicc/deploy && docker compose build aicc && \
  docker compose up -d --force-recreate aicc && docker compose ps'

ssh aicc-root 'cd /opt/aicc/deploy && docker compose exec -T aicc aicc doctor \
  --host-addrs 10.1.91.56,127.0.0.1 --wait 60s'
```

### 2.4 验证

```sh
# 容器状态
ssh aicc-root 'cd /opt/aicc/deploy && docker compose ps'

# 应用健康
curl -s -o /dev/null -w '%{http_code}\n' http://10.1.91.56:8080/healthz
# 或经域名：https://aicc.ymtcloud.com/healthz

# 日志
ssh aicc-root 'cd /opt/aicc/deploy && docker compose logs --tail 100 aicc'
```

`aicc doctor` 全 PASS 为正常；`outbound_endpoint` 的 WARN 是还没配运营商 trunk，
已接入外呼中继后才会消失。

## 3. 特殊改动

### 3.1 只改 `.env`（配置、密钥、provider）

不需要重新构建镜像：

```sh
ssh aicc-root 'cd /opt/aicc/deploy && docker compose up -d --force-recreate aicc'
```

### 3.2 只改 `deploy/` 下的编排文件

同样不需要构建，直接重建受影响的服务：

```sh
ssh aicc-root 'cd /opt/aicc/deploy && docker compose up -d --force-recreate <service>'
```

### 3.3 改 FreeSWITCH 配置（含 5072 派生镜像）

`scripts/deploy-prod.sh` **不处理交换机**，需要单独构建并重建：

```sh
ssh aicc-root 'cd /opt/aicc && git fetch origin && git reset --hard origin/custom'
ssh aicc-root 'cd /opt/aicc/deploy && docker build -t aicc-freeswitch:5072 freeswitch-5072'
ssh aicc-root 'cd /opt/aicc/deploy && docker compose up -d --force-recreate freeswitch'
```

升级基础镜像时，要同步修改 `deploy/freeswitch-5072/Dockerfile` 的 `FROM` 并重新
构建，否则 `internal_sip_port` 会回到 5060，公网媒体问题复发。

### 3.4 数据库迁移

迁移在应用启动时自动执行，不需要手工跑。跨版本升级前先备份：

```sh
ssh aicc-root 'cd /opt/aicc/deploy && docker compose exec -T postgres \
  pg_dump -U aicc aicc' > aicc-$(date +%F).sql
```

迁移是单向的：回滚代码前先确认备份可用。

## 4. 回滚

```sh
# 1. 在生产机切到上一个提交
ssh aicc-root 'cd /opt/aicc && git checkout <上一个提交>'

# 2. 重建应用
ssh aicc-root 'cd /opt/aicc/deploy && docker compose build aicc && \
  docker compose up -d --force-recreate aicc'

# 3. 需要时恢复数据库
#    docker compose exec -T postgres psql -U aicc aicc < backup.sql
```

## 5. 常见坑

| 现象 | 原因/处理 |
|---|---|
| 部署后行为没变 | 同 tag 未替换容器，必须 `--force-recreate` |
| 本地构建的镜像跑不起来 | Mac 是 arm64、生产是 amd64；镜像只在生产机构建 |
| `git reset --hard` 会不会删 `.env`/flows | 不会，未跟踪文件保留 |
| 公网软电话注册失败 | 5060 已停用，客户端要注册到 `sip:220.197.177.220:5072`；220 映射 `5072/udp → 10.1.91.56:5072` |
| 交换机重建后注册掉线 | 正常，客户端会自动重连；等几秒再测 |
| doctor 的 outbound WARN | 未配置 `AICC_OUTBOUND_ENDPOINT`，属于预期 |

## 6. 文档维护

流程、分支约定、部署命令有变化时：

1. 更新本文件（或 `CUSTOM-DEPLOY.md` 中对应章节）；
2. 提交到 `custom` 并推送；
3. 下一次部署用 `scripts/deploy-prod.sh custom` 生效。
