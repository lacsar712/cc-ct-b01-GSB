# 数控刀补复核台

操作员提交刀具编号与刀补微米值；后台 worker 用 PostgreSQL 行锁（`select_for_update(skip_locked=True)`）认领待复核记录，按绝对值是否不超过 12 微米给出「合格」或「超差」。

仍在排队（待复核、未被 worker 领走）的刀补允许操作员改数后**重投**：服务端在同一把行锁内改数并记下改前值/改后值履历；与 worker 认领若几乎同时撞车只许一种结局——认领先成则改数明确返回 409，改数先成则 worker 当场跳过、下一轮按改后值认领结清，不会出现复核半截被改。已进入复核中或已结清的刀补不能再改，结清结论始终吃改后数字。

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
| machinist | machine123456 | 可提交刀补、可对排队中的刀补改数重投 |
| auditor | audit123456 | 只读：看列表/详情/改数履历，不能改数字 |

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
4. 重投台（machinist 菜单进入）：待改列表只列「待复核」行；选中后在改数区改成新值并「确认重投」，仍为待复核，履历详情出现 改前→改后 记录。
5. 主流程：先交一笔小值（如 5 µm）进待复核，立刻在重投台拉大到超限（如 20 µm），结清后结论应为「超差」，详情履历能对照旧值 5 与新值 20。
6. 撞车/越权：行一旦被领走（复核中）或已结清，改数接口返回 409，前端明确提示失败；auditor 能在详情看履历，但改数接口返回 403。

## 目录

```text
backend/          Django 工程（config/、desk/、worker.py）
frontend/         SolidJS 单页
docker-compose.yml
PRD.md
```
