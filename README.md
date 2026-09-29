# 数控刀补复核台

操作员提交刀具编号与刀补微米值；后台 worker 用 PostgreSQL 行锁（`select_for_update(skip_locked=True)`）认领待复核记录，按绝对值是否不超过 12 微米给出「合格」或「超差」。

仍在排队（待复核）的刀补可在「重投台」改数重投：改数与 worker 认领共用同一行锁互斥，只有一种结局——认领先成则改数明确失败（409），改数先成则该行不会被领成「复核中」半截，结清时必吃改后的最新数字。每次改数与结清都写入履历，旧值、新值与最终结论可对照。

## 技术栈

| 层 | 选型 |
|----|------|
| 后端 | Django 5 + django-ninja（ASGI / uvicorn） |
| 前端 | SolidJS + Vite，nginx 反代 `/api` |
| 数据库 | PostgreSQL 16 |
| 鉴权 | JWT（python-jose），令牌存浏览器 localStorage |

## 端口

| 服务 | 地址 |
|------|------|
| 页面 | http://localhost:3196 |
| 接口 | http://localhost:8196 |
| PostgreSQL | localhost:54396（库名 `cncoffset`） |

## 账号

| 用户 | 密码 | 权限 |
|------|------|------|
| machinist | machine123456 | 可提交刀补 |
| auditor | audit123456 | 只读列表 |

## 启动

```bash
cd projects/17-cnc-tool-offset-desk
docker compose up --build
```

健康检查：`GET http://localhost:8196/api/health` → `{"status":"ok"}`

## 验收

1. machinist 登录后，种子数据应显示刀具 T01 合格（刀补 5 µm）、T09 超差（刀补 20 µm）。
2. 提交一条新刀补后，状态先为「待复核」，数秒内 worker 处理为「已完成」并给出结论。
3. auditor 登录后只能看列表，没有提交表单。

### 重投台改数重投

1. machinist 登录，菜单进「重投台」，先在总览提交一笔小刀补（如 5 µm），该笔出现在重投台「待改列表」。
2. 选中该行，在「改数区」把刀补拉大到超限（如 20 µm）后「确认改数并重投」，提示改数成功且仍为待复核。
3. 数秒内 worker 结清为「已完成 / 超差」；「履历详情」可见 `5 µm → 20 µm` 的改数记录，以及一条按 `20 µm` 结清为「超差」的记录，旧值、新值与结论可对照。
4. 复核中 / 已完成的行不出现在待改列表，直接调接口改数返回 409 明确失败。
5. auditor 进重投台只能看待改列表与只读履历，没有任何改数输入框（接口层改数亦返回 403）。

## 目录

```text
backend/          Django 工程（config/、desk/、worker.py）
frontend/         SolidJS 单页
docker-compose.yml
PRD.md
```
