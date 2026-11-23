# 二次开发与生产部署（本 fork 专用）

> 本文件是本仓库（`Endless-zby/ai-native-callcenter`）的运维约定，上游
> `rasonyang/ai-native-callcenter` 没有它。上游的构建/部署文档仍以
> `deploy/README.md` 为准。

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
| 入口 | `http://<生产主机>:8080`；SIP 5060/udp+tcp、WS 5066、WSS 7443；RTP 20000-25999（switch）/ 26000-29999（bot） |
| 镜像 | 在**生产机本地**构建（`aicc:local`），switch 用 `rasonyang/freeswitch-aicc:v0.9.1` |
| 模型 | qwen（`AICC_PROVIDER=qwen`，key 在 `deploy/.env`），`AICC_ENABLE_SEARCH=true` |

构建走国内镜像（已写入 `deploy/.env`）：`GOPROXY=https://goproxy.cn,direct`、
`NPM_REGISTRY=https://registry.npmmirror.com/`、`BASE_IMAGE=gcr.m.daocloud.io/distroless/static-debian12:nonroot`，
Docker daemon 配置了 `registry-mirrors`（见 `/etc/docker/daemon.json`）。

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
