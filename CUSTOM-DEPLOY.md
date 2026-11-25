# 二次开发与生产部署（本 fork 专用）

> 本文件是本仓库（`Endless-zby/ai-native-callcenter`）的运维约定，上游
> `rasonyang/ai-native-callcenter` 没有它。上游的构建/部署文档仍以
> `deploy/README.md` 为准。
>
> **日常改动上线流程**（本地提交 → 生产机构建 → 重启验证）见
> [`CUSTOM-WORKFLOW.md`](CUSTOM-WORKFLOW.md)；流程有变化时更新那份文档。

## 分支模型

| 分支 | 用途 | 规则 |
|---|---|---|
| `main` | 上游镜像 | 只做 fast-forward，永远与 `upstream/main` 相同 |
| `custom` | 我们的二次开发 | 生产部署的分支；定期把 `main` 合并进来 |

首次建立（已完成）：

```sh
git remote -v
# origin   git@github.com:Endless-zby/ai-native-callcenter.git
# upstream https://github.com/rasonyang/ai-native-callcenter.git
```

## 同步上游改动

```sh
scripts/fork-sync.sh            # fetch upstream -> main 快进 -> 合并进 custom -> 推送两个分支
```

冲突只可能出现在 `custom` 合并 `main` 时（上游改了我们改过的同一处）；
按语义解冲突、`go build ./...` + `cd web && npm run build` 通过后再推送。

## 生产环境

| 项 | 值 |
|---|---|
| 主机 | 内网生产机（Ubuntu 24.04，16C/62G），SSH 别名 `aicc` 指向它 |
| SSH | `ssh aicc`（home 用户）、`ssh aicc-root`（root，部署用） |
| 代码 | `/opt/aicc`（生产机自己的 clone，部署分支 `custom`） |
| 部署目录 | `/opt/aicc/deploy`，配置在 `.env`（root 0600） |
| 拓扑 | `docker-compose.yml` + `compose.linux.yml`（app 与 switch 用 host 网络） |
| 入口 | `http://<生产主机>:8080`；SIP **5072**/udp+tcp（5060 已停用，见下）、WS 5066、WSS 7443；RTP 20000-25999（switch）/ 26000-29999（bot） |
| 镜像 | 在**生产机本地**构建（`aicc:local`），switch 用 `rasonyang/freeswitch-aicc:v0.9.1` |
| 模型 | qwen（`AICC_PROVIDER=qwen`，key 在 `deploy/.env`），`AICC_ENABLE_SEARCH=true` |

构建走国内镜像（已写入 `deploy/.env`）：`GOPROXY=https://goproxy.cn,direct`、
`NPM_REGISTRY=https://registry.npmmirror.com/`、`BASE_IMAGE=gcr.m.daocloud.io/distroless/static-debian12:nonroot`，
Docker daemon 配置了 `registry-mirrors`（见 `/etc/docker/daemon.json`）。

## 公网 SIP 端口：5072（绕开边缘 SIP ALG）

公网出口 `220.197.177.220` 后面是一台 Ubuntu 边缘机，它的 conntrack SIP
helper（SIP ALG）会改写 5060 上的 SIP 报文：把 `220.197.177.220` 改写成内网
`10.1.91.56`，并改写 SDP 的媒体端口（受控测试里发出的 `m=audio 5098` 到达
交换机时变成 `5100`）。这会让 RTP 端口错位、双向无声；浏览器坐席走
WebRTC/SRTP，ALG 看不到，所以不受影响。

因此交换机的 internal profile 监听 **5072**，边缘映射：

```
5072/udp → 10.1.91.56:5072
```

5060 不再监听，公网 5060 映射应删除。内网 SIP 话机/软电话需注册到
`10.1.91.56:5072`（当前还没有外部 PBX，暂不受影响）。

持久化用派生镜像（容器重建/主机重启后仍是 5072）：

```sh
cd /opt/aicc/deploy
docker build -t aicc-freeswitch:5072 freeswitch-5072
# deploy/.env 设置：
#   AICC_FS_IMAGE=aicc-freeswitch:5072
docker compose up -d --force-recreate freeswitch
docker compose exec -T freeswitch fs_cli -P 18021 -p "$ESL_PASSWORD" \
  -x "sofia status profile internal"
```

`deploy/freeswitch-5072/Dockerfile` 基于 `rasonyang/freeswitch-aicc:v0.9.1`，
在构建层把 `vars.xml` 的 `internal_sip_port` 改成 5072。**升级 switch 镜像时
要同步改 Dockerfile 的 FROM 并重新构建**，否则端口会回到 5060、公网媒体问题
复发。（不要用 bind mount 覆盖 vars.xml：entrypoint 用 `sed -i` 改写它，单文件
挂载会报 `Device or resource busy`。）

公网软电话注册：

| 字段 | 值 |
|---|---|
| Domain | `220.197.177.220` |
| Registrar URI | `sip:220.197.177.220:5072` |
| Transport | UDP |
| Username / Password | 分机号 / 该分机的 SIP 密码 |

## 发布一次改动

```sh
# 1. 本地：在 custom 上开发、提交、推送
git checkout custom
# ... 改代码 ...
go build ./... && (cd web && npm run build)   # 本地可省略 go 构建，服务器构建会验证
git commit -am "..."; git push origin custom

# 2. 生产机：拉取并重建应用镜像，重启栈
scripts/deploy-prod.sh custom

# 或者手动：
ssh aicc-root 'cd /opt/aicc && git fetch origin && git checkout custom && \
  git reset --hard origin/custom && cd deploy && \
  docker compose build aicc && docker compose up -d --force-recreate aicc'
ssh aicc-root 'cd /opt/aicc/deploy && docker compose exec -T aicc aicc doctor \
  --host-addrs "$(ssh aicc-root 'hostname -I | cut -d" " -f1')",127.0.0.1 --wait 60s'
```

`docker compose up -d --force-recreate aicc` 只重建 `aicc` 应用容器（同 tag 重建时
compose 不一定会自动替换容器，所以强制重建）；PostgreSQL 与 FreeSWITCH 不动，
数据卷保留，数据库迁移在应用启动时自动执行。

## 不随仓库走的部署产物

以下内容在生产机上就地维护，`git reset --hard` 不会删除它们：

| 路径 | 内容 |
|---|---|
| `/opt/aicc/deploy/.env` | 生产配置与密钥（root 0600）：provider key、数据库/ESL 口令、`AICC_ENABLE_SEARCH` 等 |
| `/opt/aicc/deploy/flows/` | 业务话术 JSON（如 `junyue-hotel-flow.json`），导入后即入库，文件只作留档 |

导入/更新一个流程（`flowadd` 会校验、发布，并在号码不存在时创建它）：

```sh
ssh aicc-root 'cd /opt/aicc/deploy && \
  docker compose cp flows/<flow>.json aicc:/tmp/<flow>.json && \
  docker compose exec -T aicc aicc flowadd \
    -file /tmp/<flow>.json -did <号码> -language zh -name "<显示名>"'
```

2026-11-23 已导入：`junyue_hotel`（贵阳观山湖军阅国际酒店前台客服），
DID `8900`（仅呼入，录音开启）指向它，转人工走 `support-zh` 队列。

## 运营商中继（trunk）

入站号码由运营商送到交换机；出站/外呼需要：

1. `deploy/freeswitch/sip_profiles/` 下放网关文件（`<gateway name="…">`），
   并通过 `deploy/docker-compose.override.yml` 挂到
   `conf/sip_profiles/external/`；
2. `deploy/.env` 设 `AICC_OUTBOUND_ENDPOINT=sofia/gateway/<name>/%s`，
   必要时设 `AICC_OUTBOUND_DIAL_FORM`（`E164`/`NATIONAL`）和网关的
   `destination-prefix`；
3. 重建应用与网关：`docker compose up -d --force-recreate aicc`，
   `docker compose exec freeswitch fs_cli -P 18021 -p "$ESL_PASSWORD" -x "sofia profile external rescan"`；
4. `aicc doctor` 应显示 `outbound_endpoint`、`outbound_gateway` 为 PASS。

细节见上游 `deploy/carrier.md`。

## 常用运维

```sh
# 查看状态 / 日志
ssh aicc-root 'cd /opt/aicc/deploy && docker compose ps'
ssh aicc-root 'cd /opt/aicc/deploy && docker compose logs -f --tail 100 aicc'

# 读取演示账号口令（seed 生成的 admin/wei/amy/ben 共用）
ssh aicc-root 'grep AICC_SEED_PASSWORD /opt/aicc/deploy/.env'

# 改配置（例如换 provider key）后只需重建 app 容器
ssh aicc-root 'cd /opt/aicc/deploy && docker compose up -d --force-recreate aicc'

# 清空演示数据（保留表结构，从下一次启动起不再 seed）
#   在 deploy/.env 设 AICC_SEED=fresh 重启一次，再改成 AICC_SEED= 并重启
```

## 备份

数据库在命名卷 `aicc_postgres-data` 中。生产升级前先导出：

```sh
ssh aicc-root 'cd /opt/aicc/deploy && docker compose exec -T postgres \
  pg_dump -U aicc aicc' > aicc-$(date +%F).sql
```

## 回滚

```sh
ssh aicc-root 'cd /opt/aicc && git checkout <上一个提交>'
ssh aicc-root 'cd /opt/aicc/deploy && docker compose build aicc && docker compose up -d'
```

数据库迁移是单向的：跨版本回滚前用上面的 `pg_dump` 备份恢复。
