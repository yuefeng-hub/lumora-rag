# Lumora 企业知识库问答

Lumora 是一个基于 Flask、SQLite 和 React 的私有文档问答应用。界面默认使用中文，并记住用户选择的语言。用户通过邮箱验证码注册，登录后可访问管理员授权的知识库。

## 在 Windows 上启动

在项目根目录执行以下命令。首次安装需要 Python 和 Node.js。

```powershell
py -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt
npm install
npm run build
.\venv\Scripts\python.exe app.py
```

在浏览器打开 `http://127.0.0.1:5000`。开发前端时，保持 Flask 运行，在另一个终端执行 `npm run dev`，打开 `http://127.0.0.1:5173`。Vite 会将 `/api` 请求转发到 5000 端口。

### PyCharm 启动

打开项目根目录，在 **Settings → Project → Python Interpreter** 将项目解释器设为 `$PROJECT_DIR$/venv/Scripts/python.exe`。如果 `venv` 尚未创建，先在 PyCharm 终端运行上述 Python 创建与依赖安装命令。选择运行配置 **Lumora Flask** 并启动 `app.py`。服务默认监听 `127.0.0.1:5000`，请先停止占用该端口的其他 Lumora 实例。

## QQ 邮箱与知识库权限

Flask 启动时读取项目根目录的 `.env`，同名系统环境变量优先。新环境可从 `.env.example` 创建配置，填写下列变量后重启服务。

| 变量 | 用途 |
| --- | --- |
| `SMTP_HOST` / `SMTP_PORT` | QQ 邮箱使用 `smtp.qq.com` 和 SSL 端口 `465` |
| `SMTP_USER` / `SMTP_PASSWORD` | 发件 QQ 邮箱和 SMTP 授权码。请先在发件邮箱的设置中启用 SMTP |
| `SMTP_FROM` | 可选发件地址，省略时使用 `SMTP_USER` |
| `ADMIN_EMAIL` | 管理员的注册邮箱，需在该邮箱首次注册前设置 |
| `FLASK_SECRET_KEY` | 供会话签名使用的独立随机密钥，设置后可在服务重启时保留登录状态 |
| `DEEPSEEK_API_KEY` | 可选，由后端读取，用于生成回答 |

访问登录页，切换到注册，设置 3 至 32 个字符的用户名，输入收件邮箱并获取验证码。用户名支持中文、英文字母、数字、下划线和连字符，英文部分不区分大小写。注册后可用用户名或邮箱加密码登录，已有账号可继续用邮箱登录。收件人可使用其他邮箱服务。管理员登录后，进入 **知识库 → 权限管理** 创建知识库，并给已注册用户分配只读或可编辑权限。

管理员可在权限页面搜索已验证注册用户，点击用户名或邮箱即可按当前读写级别授权。**任务**页面支持向用户发布要求并附加知识库文档。附件只在相应任务中对发布者和接收人开放，不会自动授予整个知识库权限。接收人提交完成说明后，发布者可验收或填写批注退回；接收人修改后可再次提交。

可在服务器本地创建管理员或重置其密码。命令会提示输入密码，保留已有账号的数据和权限。

```powershell
.\venv\Scripts\python.exe -m flask --app app set-admin admin@example.com
```

`.env` 已列入 `.gitignore`。启用 DeepSeek 后，服务会将问题和检索到的文档片段发送给 API。处理企业文档前请确认组织允许使用该服务。未配置密钥时，仍可使用本地检索查看相关原文。通过 HTTPS 部署时请设置 `COOKIE_SECURE=1` 和固定的随机 `FLASK_SECRET_KEY`。

## 文档检索与迁移

应用支持 PDF、DOCX、Markdown 和 TXT。默认使用 512 维带符号特征哈希结合词项匹配进行本地检索。扫描版 PDF 需先在外部执行 OCR。

安装 `requirements-optional.txt` 后，可设置 `EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5` 与 `RERANKER_MODEL=BAAI/bge-reranker-base`，启用 BGE 嵌入和重排。首次使用时会下载模型权重。切换嵌入模型后，请重新导入文档以重建索引。

账户和知识库数据保存在 `data/accounts.db`。迁移旧索引前，备份 `data/knowledge.db`，查看其中 `documents` 表的不同 `owner` 和 `collection` 组合，并在管理界面创建目标知识库。保持数据目录一致，在同一个 Python 环境中执行以下命令。命令仅导入指定用户和集合的文档，并跳过已导入的文档。迁移时应使用原嵌入模型，否则请重新索引原文件。

```powershell
.\venv\Scripts\python.exe -m flask --app app import-legacy --owner OLD_OWNER --collection OLD_COLLECTION --target NEW_BASE
```

## 主要 API

| 接口 | 用途 |
| --- | --- |
| `POST /api/upload` | 上传文档，使用 multipart 表单字段 `file` 和 `collection` |
| `POST /api/ask` | 提问，发送 JSON 字段 `question`，可附带 `collection` 和 `conversation` |
| `GET /api/documents`、`/api/collections`、`/api/stats` | 查询可访问的文档、知识库和统计信息 |
| `GET /api/users` | 管理员查询已验证注册用户 |
| `GET /api/tasks`、`POST /api/tasks` | 查询可见任务；管理员发布任务并附加有权限的文档 |
| `GET /api/tasks/<id>` | 读取本人发布或接收的任务与任务附件内容 |
| `POST /api/tasks/<id>/submit` | 接收人提交任务完成说明 |
| `POST /api/tasks/<id>/review` | 发布者验收或附带批注退回 |
| `DELETE /api/documents/<id>` | 删除有权限编辑的文档 |
| `POST /api/evaluate` | 执行检索评估，传入 `{ "cases": [...] }`，或使用默认评估集 `evaluation/rag_eval.json` |
