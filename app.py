import hashlib, hmac, json, math, os, re, secrets, smtplib, sqlite3, ssl, struct, urllib.error, urllib.request, uuid
from contextlib import closing, contextmanager
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from functools import wraps
from pathlib import Path
from time import perf_counter
import click
from dotenv import load_dotenv
from flask import Flask, abort, g, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE = Path(__file__).resolve().parent
load_dotenv(BASE / ".env")
DATA = Path(os.environ.get("RAG_DATA_DIR", BASE / "data"))
UPLOADS, DB_PATH = DATA / "uploads", DATA / "accounts.db"
ALLOWED = {"pdf", "docx", "md", "markdown", "txt"}
app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY") or secrets.token_hex(32)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax", SESSION_COOKIE_SECURE=os.getenv("COOKIE_SECURE", "0") == "1", PERMANENT_SESSION_LIFETIME=timedelta(days=7))

@contextmanager
def db():
    with closing(open_db()) as connection, connection:
        yield connection

def open_db():
    DATA.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    c.executescript("""
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT NOT NULL COLLATE NOCASE UNIQUE,password_hash TEXT NOT NULL,is_admin INTEGER NOT NULL DEFAULT 0,verified INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS email_codes(email TEXT PRIMARY KEY COLLATE NOCASE,purpose TEXT NOT NULL,code_hash TEXT NOT NULL,expires INTEGER NOT NULL,last_sent INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS login_attempts(email TEXT PRIMARY KEY COLLATE NOCASE,count INTEGER NOT NULL,first_attempt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS mail_requests(id INTEGER PRIMARY KEY,ip TEXT NOT NULL,sent INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS conversation_scopes(owner TEXT NOT NULL,conversation TEXT NOT NULL,scope TEXT NOT NULL,PRIMARY KEY(owner,conversation));
    CREATE TABLE IF NOT EXISTS legacy_imports(document_id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS knowledge_bases(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL COLLATE NOCASE UNIQUE,created_by INTEGER,created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS knowledge_access(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,knowledge_base_id INTEGER NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,can_write INTEGER NOT NULL DEFAULT 0,can_view INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(user_id,knowledge_base_id));
    CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,owner TEXT,name TEXT,collection TEXT,chunks INTEGER,created TEXT);
    CREATE TABLE IF NOT EXISTS chunks(id TEXT PRIMARY KEY,document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,owner TEXT,collection TEXT,page INTEGER,content TEXT,vector BLOB,fingerprint TEXT);
    CREATE INDEX IF NOT EXISTS chunks_scope ON chunks(owner,collection);
    CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,owner TEXT,conversation TEXT,role TEXT,content TEXT,created TEXT);
    CREATE TABLE IF NOT EXISTS answer_sources(message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,rank INTEGER NOT NULL,chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,score REAL NOT NULL,PRIMARY KEY(message_id,rank));
    CREATE INDEX IF NOT EXISTS answer_sources_chunk ON answer_sources(chunk_id);
    CREATE TABLE IF NOT EXISTS answer_feedback(message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,rating TEXT NOT NULL CHECK(rating IN ('helpful','needs_work')),note TEXT NOT NULL,updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS evaluations(id INTEGER PRIMARY KEY,owner TEXT,question TEXT,expected TEXT,hits INTEGER,top_score REAL,created TEXT);
    CREATE TABLE IF NOT EXISTS evaluation_cases(id INTEGER PRIMARY KEY AUTOINCREMENT,owner TEXT NOT NULL,question TEXT NOT NULL,expected TEXT NOT NULL,collection TEXT NOT NULL DEFAULT 'all');
    CREATE INDEX IF NOT EXISTS evaluation_cases_owner ON evaluation_cases(owner,id);
    CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,publisher_id INTEGER NOT NULL REFERENCES users(id),assignee_id INTEGER NOT NULL REFERENCES users(id),status TEXT NOT NULL DEFAULT 'assigned',submission TEXT NOT NULL DEFAULT '',review_note TEXT NOT NULL DEFAULT '',created TEXT NOT NULL,updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS task_documents(task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,PRIMARY KEY(task_id,document_id));
    CREATE INDEX IF NOT EXISTS tasks_assignee_status ON tasks(assignee_id,status,updated);
    CREATE INDEX IF NOT EXISTS tasks_publisher_status ON tasks(publisher_id,status,updated);
    """)
    if "username" not in {row["name"] for row in c.execute("PRAGMA table_info(users)")}:
        # Serialize the migration when multiple requests open an older database.
        with c:
            c.execute("BEGIN IMMEDIATE")
            if "username" not in {row["name"] for row in c.execute("PRAGMA table_info(users)")}:
                c.execute("ALTER TABLE users ADD COLUMN username TEXT COLLATE NOCASE")
                c.execute("CREATE UNIQUE INDEX users_username ON users(username)")
    if "can_view" not in {row["name"] for row in c.execute("PRAGMA table_info(knowledge_access)")}:
        c.execute("ALTER TABLE knowledge_access ADD COLUMN can_view INTEGER NOT NULL DEFAULT 1")
    return c

def valid_username(username):
    return bool(re.fullmatch(r"[a-zA-Z0-9_\-\u3400-\u4dbf\u4e00-\u9fff]{3,32}",username))

def public_user(user):
    return {"id":user["id"],"email":user["email"],"username":user["username"],"isAdmin":bool(user["is_admin"])}

def owner():
    return str(g.user["id"])

def login_required(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        g.user = None
        if session.get("user_id"):
            with db() as c: g.user = c.execute("SELECT id,email,is_admin,verified FROM users WHERE id=?", (session["user_id"],)).fetchone()
        if not g.user or not g.user["verified"]: return jsonify(error="Authentication required"), 401
        return fn(*args, **kwargs)
    return wrapped

def admin_required(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        if not g.user or not g.user["is_admin"]: return jsonify(error="Administrator access required"), 403
        return fn(*args, **kwargs)
    return wrapped

@app.before_request
def csrf_guard():
    if request.path.startswith("/api/") and request.method not in {"GET", "HEAD", "OPTIONS"}:
        expected = session.get("csrf_token", "")
        supplied = request.headers.get("X-CSRF-Token", "")
        if not expected or not hmac.compare_digest(expected, supplied): return jsonify(error="Invalid session token; refresh the page and retry"), 400

def accessible_collections(write=False):
    user_id = int(owner())
    with db() as c:
        if g.user["is_admin"]: return [r["name"] for r in c.execute("SELECT name FROM knowledge_bases ORDER BY name")]
        op = " AND COALESCE(a.can_write,0)=1" if write else ""
        return [r["name"] for r in c.execute("SELECT b.name FROM knowledge_bases b LEFT JOIN knowledge_access a ON a.knowledge_base_id=b.id AND a.user_id=? WHERE COALESCE(a.can_view,1)=1"+op+" ORDER BY b.name", (user_id,))]

def can_access_collection(name, write=False):
    with db() as c:
        if g.user["is_admin"]: return bool(c.execute("SELECT 1 FROM knowledge_bases WHERE name=? COLLATE BINARY",(name,)).fetchone())
        row=c.execute("SELECT COALESCE(a.can_view,1) can_view,COALESCE(a.can_write,0) can_write FROM knowledge_bases b LEFT JOIN knowledge_access a ON a.knowledge_base_id=b.id AND a.user_id=? WHERE b.name=? COLLATE BINARY",(g.user["id"],name)).fetchone()
    return bool(row and row["can_view"] and (row["can_write"] or not write))

def send_email_code(email, code, purpose):
    host=os.getenv("SMTP_HOST","smtp.qq.com"); port=int(os.getenv("SMTP_PORT","465"))
    username=os.getenv("SMTP_USER","").strip(); password=os.getenv("SMTP_PASSWORD","").strip()
    sender=os.getenv("SMTP_FROM",username).strip()
    if not username or not password or not sender: raise RuntimeError("SMTP is not configured; set SMTP_USER, SMTP_PASSWORD and SMTP_FROM")
    message=EmailMessage()
    message["Subject"]="Lumora 邮箱验证码" if purpose=="register" else "Lumora 登录验证码"
    message["From"]=sender; message["To"]=email
    message.set_content(f"Lumora 验证码：{code}\n\n验证码 10 分钟内有效，请勿转发给他人。若非本人操作，请忽略此邮件。")
    with smtplib.SMTP_SSL(host,port,context=ssl.create_default_context(),timeout=15) as smtp:
        smtp.login(username,password); smtp.send_message(message)

@app.get("/api/auth/csrf")
def csrf_token():
    if not session.get("csrf_token"): session["csrf_token"]=secrets.token_urlsafe(32)
    return jsonify(csrfToken=session["csrf_token"])

@app.post("/api/auth/code")
def request_email_code():
    body=request.get_json(force=True); email=str(body.get("email","")).strip().lower(); purpose=str(body.get("purpose","register"))
    if purpose != "register" or len(email)>254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+",email): return jsonify(error="请输入有效邮箱地址。"),400
    now=int(datetime.now(timezone.utc).timestamp())
    code=f"{secrets.randbelow(1000000):06d}"
    digest=code_digest(email,code)
    with db() as c:
        c.execute("BEGIN IMMEDIATE")
        prior=c.execute("SELECT last_sent FROM email_codes WHERE email=?",(email,)).fetchone()
        if prior and now-prior["last_sent"]<60: return jsonify(error="请稍后再获取验证码。"),429
        ip=request.remote_addr or "unknown"
        c.execute("DELETE FROM mail_requests WHERE sent<?",(now-3600,))
        if c.execute("SELECT COUNT(*) FROM mail_requests WHERE ip=?",(ip,)).fetchone()[0]>=20: return jsonify(error="请求过多，请稍后重试。"),429
        c.execute("INSERT INTO mail_requests(ip,sent) VALUES(?,?)",(ip,now))
        if c.execute("SELECT 1 FROM users WHERE email=?",(email,)).fetchone(): return jsonify(ok=True)
        c.execute("INSERT INTO email_codes VALUES(?,?,?,?,?,0) ON CONFLICT(email) DO UPDATE SET purpose=excluded.purpose,code_hash=excluded.code_hash,expires=excluded.expires,last_sent=excluded.last_sent,attempts=0",(email,purpose,digest,now+600,now))
    try: send_email_code(email,code,purpose)
    except (OSError,RuntimeError,smtplib.SMTPException,ValueError):
        app.logger.warning("Verification email delivery failed")
        with db() as c: c.execute("DELETE FROM email_codes WHERE email=? AND code_hash=?",(email,digest))
        return jsonify(error="验证码邮件发送失败，请检查 SMTP 服务配置。"),503
    return jsonify(ok=True,message="验证码已发送，请检查邮箱。")

def code_digest(email,code):
    return hmac.new(app.secret_key.encode(),f"{email}:{code}".encode(),hashlib.sha256).hexdigest()

def consume_code(c,email,code,purpose):
    row=c.execute("SELECT * FROM email_codes WHERE email=?",(email,)).fetchone(); now=int(datetime.now(timezone.utc).timestamp())
    if not row or row["purpose"]!=purpose or row["expires"]<now or row["attempts"]>=5: return False
    digest=code_digest(email,code)
    if not hmac.compare_digest(digest,row["code_hash"]):
        c.execute("UPDATE email_codes SET attempts=attempts+1 WHERE email=?",(email,)); return False
    c.execute("DELETE FROM email_codes WHERE email=?",(email,)); return True

@app.post("/api/auth/register")
def register():
    b=request.get_json(force=True); email=str(b.get("email","")).strip().lower(); code=str(b.get("code","")).strip(); password=str(b.get("password",""))
    username=str(b.get("username") or "").strip()
    if not valid_username(username): return jsonify(error="用户名须为 3 至 32 个中文、英文字母、数字、下划线或连字符。"),400
    if len(email)>254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+",email) or len(password)<10 or len(password)>256 or not re.fullmatch(r"[0-9]{6}",code): return jsonify(error="请填写有效邮箱、6 位验证码和至少 10 位密码。"),400
    with db() as c:
        c.execute("BEGIN IMMEDIATE")
        if c.execute("SELECT 1 FROM users WHERE username=?",(username,)).fetchone(): return jsonify(error="该用户名已被使用。"),409
        if not consume_code(c,email,code,"register"): return jsonify(error="验证码无效、已过期或尝试次数过多。"),400
        first=email==os.getenv("ADMIN_EMAIL","").strip().lower()
        try:
            cur=c.execute("INSERT INTO users(email,username,password_hash,is_admin,verified,created) VALUES(?,?,?,?,?,?)",(email,username,generate_password_hash(password,method="scrypt"),int(first),1,datetime.now(timezone.utc).isoformat(timespec="seconds")))
        except sqlite3.IntegrityError: return jsonify(error="该邮箱已注册，请直接登录。"),409
        user_id=cur.lastrowid
    session.clear(); session["user_id"]=user_id; session["csrf_token"]=secrets.token_urlsafe(32); session.permanent=True
    return jsonify(user=public_user(dict(id=user_id,email=email,username=username,is_admin=first)),csrfToken=session["csrf_token"]),201

@app.post("/api/auth/login")
def login():
    b=request.get_json(force=True); identifier=str(b.get("identifier",b.get("email","")) or "").strip().lower(); password=str(b.get("password",""))
    error="用户名、邮箱或密码不正确。"
    if not identifier or len(identifier)>254 or len(password)>256 or not password: return jsonify(error=error),401
    now=int(datetime.now(timezone.utc).timestamp())
    with db() as c:
        if "@" in identifier:
            user=c.execute("SELECT * FROM users WHERE email=?",(identifier,)).fetchone()
        else:
            user=c.execute("SELECT * FROM users WHERE username=?",(identifier,)).fetchone()
        attempt_key=user["email"] if user else identifier
        attempt=c.execute("SELECT count,first_attempt FROM login_attempts WHERE email=?",(attempt_key,)).fetchone()
        if attempt and now-attempt["first_attempt"]<900 and attempt["count"]>=10: return jsonify(error="尝试次数过多，请 15 分钟后重试。"),429
        valid=bool(user and check_password_hash(user["password_hash"],password) and user["verified"])
        if not valid:
            c.execute("INSERT INTO login_attempts VALUES(?,?,?) ON CONFLICT(email) DO UPDATE SET count=CASE WHEN ?-first_attempt>=900 THEN 1 ELSE count+1 END,first_attempt=CASE WHEN ?-first_attempt>=900 THEN ? ELSE first_attempt END",(attempt_key,1,now,now,now,now))
            if not user: check_password_hash(generate_password_hash("timing-padding-value",method="scrypt"),password or " ")
            return jsonify(error=error),401
        c.execute("DELETE FROM login_attempts WHERE email=?",(attempt_key,))
    session.clear(); session["user_id"]=user["id"]; session["csrf_token"]=secrets.token_urlsafe(32); session.permanent=True
    return jsonify(user=public_user(user),csrfToken=session["csrf_token"])

@app.post("/api/auth/logout")
@login_required
def logout():
    session.clear(); return jsonify(ok=True)

def clean(text):
    text = re.sub(r"[\t\f\v ]+", " ", text.replace("\x00", " ").replace("\r", "\n"))
    return re.sub(r"\n\s*\n\s*\n+", "\n\n", text).strip()

def chunk_text(text, size=520, overlap=90):
    result, current = [], ""
    for para in re.split(r"\n+", clean(text)):
        para = para.strip()
        if not para: continue
        if current and len(current) + len(para) > size:
            result.append(current)
            current = current[-overlap:] + " " + para
        else: current = (current + "\n" + para).strip()
        while len(current) > size * 1.5:
            result.append(current[:size])
            current = current[size-overlap:]
    if current: result.append(current)
    return result

def embed(text):
    """Offline signed feature hashing; this demo is not a semantic BGE model."""
    model_name = os.getenv("EMBEDDING_MODEL", "").strip()
    if model_name:
        from sentence_transformers import SentenceTransformer
        global _embedding_model
        if "_embedding_model" not in globals(): _embedding_model = SentenceTransformer(model_name)
        return _embedding_model.encode(text, normalize_embeddings=True).tolist()
    v = [0.0] * 512
    for t in re.findall(r"[a-zA-Z0-9_]+|[\u4e00-\u9fff]", text.lower()):
        n = int.from_bytes(hashlib.blake2b(t.encode(), digest_size=8).digest(), "little")
        v[n % 512] += 1 if n & (1 << 20) else -1
    norm = math.sqrt(sum(x*x for x in v)) or 1
    return [x/norm for x in v]

def terms(text): return set(re.findall(r"[a-zA-Z0-9_]+|[\u4e00-\u9fff]", text.lower()))
def pack(v): return struct.pack("512f", *v)

def search(question, collection="all", limit=5):
    names=accessible_collections() if collection=="all" else ([collection] if can_access_collection(collection) else [])
    if not names: return []
    with db() as c:
        marks=",".join("?" for _ in names)
        rows = c.execute(f"SELECT x.*,d.name FROM chunks x JOIN documents d ON d.id=x.document_id WHERE d.collection IN ({marks})", names).fetchall()
    qv, qt, ranked = embed(question), terms(question), []
    for r in rows:
        vec = struct.unpack("512f", r["vector"])
        cosine = sum(a*b for a,b in zip(qv,vec))
        lexical = len(qt & terms(r["content"])) / max(1,len(qt))
        ranked.append({"id":r["id"],"document":r["name"],"collection":r["collection"],"page":r["page"],"content":r["content"],"score":round(.72*cosine+.28*lexical,4)})
    ranked = sorted(ranked,key=lambda x:x["score"],reverse=True)[:max(limit,20)]
    reranker_name = os.getenv("RERANKER_MODEL", "").strip()
    if reranker_name and ranked:
        from sentence_transformers import CrossEncoder
        global _reranker
        if "_reranker" not in globals(): _reranker = CrossEncoder(reranker_name)
        scores = _reranker.predict([(question, hit["content"]) for hit in ranked])
        for hit, score in zip(ranked, scores): hit["score"] = float(score)
        ranked.sort(key=lambda x:x["score"],reverse=True)
    return ranked[:limit]

def llm_answer(question, hits, history):
    key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not key: return None
    if not hits or hits[0]["score"] < .08: return "知识库中没有找到足够相关的依据，请调整问题或上传相关文档。"
    refs = "\n\n".join(f"[来源 {i+1}] {h['document']} / {h['collection']} / {('第 '+str(h['page'])+' 页') if h['page'] else '片段'}\n{h['content']}" for i,h in enumerate(hits))
    msgs = [{"role":"system","content":"你是企业私有知识库问答助手。仅依据资料回答，不得编造；资料不足时明确说明。使用 [来源 1] 格式引用支持答案的资料。"}]
    msgs.extend({"role":m["role"],"content":m["content"][:2500]} for m in history[-6:])
    msgs.append({"role":"user","content":f"问题：{question}\n\n检索资料：\n{refs}"})
    payload = json.dumps({"model":os.getenv("DEEPSEEK_MODEL","deepseek-chat"),"messages":msgs,"temperature":.2}).encode()
    req = urllib.request.Request(os.getenv("DEEPSEEK_BASE_URL","https://api.deepseek.com").rstrip("/")+"/chat/completions",data=payload,headers={"Authorization":"Bearer "+key,"Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(req,timeout=75) as r: return json.loads(r.read())["choices"][0]["message"]["content"]
    except urllib.error.HTTPError as e:
        detail=e.read(1000).decode("utf-8","replace")
        app.logger.warning("DeepSeek HTTP %s: %s",e.code,detail)
        if e.code in (401,403): return "DeepSeek API 拒绝了请求，请检查服务端 API 密钥和账户权限。"
        if e.code == 429: return "DeepSeek API 当前请求过于频繁或额度不足，请稍后重试。"
        return f"DeepSeek API 暂时不可用（HTTP {e.code}），请稍后重试。"
    except (urllib.error.URLError,TimeoutError) as e:
        app.logger.warning("DeepSeek connection failed: %r",e)
        return "无法连接 DeepSeek，请检查运行本项目的电脑/服务器是否允许访问 api.deepseek.com，并确认网络代理或防火墙设置。"
    except (KeyError,ValueError) as e:
        app.logger.warning("Invalid DeepSeek response: %r",e)
        return "DeepSeek 返回内容异常，请检查服务端日志后重试。"

@app.get("/")
def index():
    bundle = BASE / "dist"
    if (bundle / "index.html").exists():
        return send_from_directory(bundle, "index.html")
    abort(503, description="React frontend is not built. Run npm install and npm run build.")

@app.get("/assets/<path:filename>")
def frontend_assets(filename):
    return send_from_directory(BASE / "dist" / "assets", filename)

@app.get("/api/profile")
def profile():
    user=None; csrf=session.get("csrf_token")
    if session.get("user_id"):
        with db() as c: user=c.execute("SELECT id,email,username,is_admin,verified FROM users WHERE id=?",(session["user_id"],)).fetchone()
    if not csrf: csrf=secrets.token_urlsafe(32); session["csrf_token"]=csrf
    return jsonify(llm=bool(os.getenv("DEEPSEEK_API_KEY")),authenticated=bool(user and user["verified"]),user=public_user(user) if user else None,csrfToken=csrf)

@app.get("/api/knowledge-bases")
@login_required
def knowledge_bases():
    names=accessible_collections()
    with db() as c:
        rows=c.execute("SELECT b.id,b.name,b.created_by,b.created,COUNT(DISTINCT d.id) documents FROM knowledge_bases b LEFT JOIN documents d ON d.collection=b.name WHERE b.name IN ("+(",".join("?" for _ in names) or "NULL")+") GROUP BY b.id ORDER BY b.name",names).fetchall()
        members={r["name"]:[dict(x) for x in c.execute("SELECT u.id,u.email,u.username,COALESCE(a.can_view,1) can_view,COALESCE(a.can_write,0) can_write FROM users u LEFT JOIN knowledge_access a ON a.user_id=u.id AND a.knowledge_base_id=(SELECT id FROM knowledge_bases WHERE name=?) WHERE u.verified=1 AND u.is_admin=0 ORDER BY u.username COLLATE NOCASE,u.email COLLATE NOCASE",(r["name"],)).fetchall()] for r in rows} if g.user["is_admin"] else {}
    return jsonify([dict(r,canWrite=g.user["is_admin"] or can_access_collection(r["name"],True),members=members.get(r["name"],[])) for r in rows])

@app.get("/api/users")
@login_required
@admin_required
def registered_users():
    with db() as c:
        users=c.execute("SELECT id,email,username,is_admin FROM users WHERE verified=1 AND is_admin=0 ORDER BY username COLLATE NOCASE,email COLLATE NOCASE").fetchall()
    return jsonify([dict(id=u["id"],email=u["email"],username=u["username"],isAdmin=bool(u["is_admin"])) for u in users])

@app.post("/api/knowledge-bases")
@login_required
@admin_required
def create_knowledge_base():
    b=request.get_json(force=True); name=clean(str(b.get("name","")))[:60]
    if not name or name.lower()=="all": return jsonify(error="请输入有效的知识库名称。"),400
    with db() as c:
        try: cur=c.execute("INSERT INTO knowledge_bases(name,created_by,created) VALUES(?,?,?)",(name,g.user["id"],datetime.now(timezone.utc).isoformat(timespec="seconds")))
        except sqlite3.IntegrityError: return jsonify(error="该知识库名称已存在。"),409
    return jsonify(ok=True,id=cur.lastrowid,name=name),201

@app.put("/api/knowledge-bases/<int:kb_id>/members")
@login_required
@admin_required
def set_knowledge_members(kb_id):
    body=request.get_json(force=True); members=body.get("members",[])
    if not isinstance(members,list) or len(members)>500: return jsonify(error="成员列表无效。"),400
    with db() as c:
        if not c.execute("SELECT 1 FROM knowledge_bases WHERE id=?",(kb_id,)).fetchone(): return jsonify(error="知识库不存在。"),404
        grants={}
        for member in members:
            if not isinstance(member,dict) or not isinstance(member.get("canWrite"),bool) or ("canView" in member and not isinstance(member["canView"],bool)): return jsonify(error="成员列表无效。"),400
            email=str(member.get("email","")).strip().lower(); user=c.execute("SELECT id FROM users WHERE email=? AND verified=1 AND is_admin=0",(email,)).fetchone()
            if not user: return jsonify(error=f"邮箱尚未注册：{email}"),404
            can_view=member.get("canView",True)
            if member["canWrite"] and not can_view: return jsonify(error="无权查看时不能设置为可编辑。"),400
            grants[user["id"]]=(int(can_view),int(member["canWrite"]))
        all_users=[row["id"] for row in c.execute("SELECT id FROM users WHERE verified=1 AND is_admin=0")]
        c.execute("DELETE FROM knowledge_access WHERE knowledge_base_id=?",(kb_id,))
        c.executemany("INSERT INTO knowledge_access(user_id,knowledge_base_id,can_view,can_write) VALUES(?,?,?,?)",[(uid,kb_id,*grants.get(uid,(1,0))) for uid in all_users])
    return jsonify(ok=True)

@app.put("/api/knowledge-bases/<int:kb_id>/members/<int:user_id>")
@login_required
@admin_required
def set_knowledge_member(kb_id,user_id):
    body=request.get_json(silent=True) or {}
    level=body.get("level")
    levels={"none":(0,0),"read":(1,0),"write":(1,1)}
    if level not in levels: return jsonify(error="权限级别无效。"),400
    with db() as c:
        if not c.execute("SELECT 1 FROM knowledge_bases WHERE id=?",(kb_id,)).fetchone(): return jsonify(error="知识库不存在。"),404
        user=c.execute("SELECT id FROM users WHERE id=? AND verified=1 AND is_admin=0",(user_id,)).fetchone()
        if not user: return jsonify(error="用户不存在。"),404
        can_view,can_write=levels[level]
        c.execute("INSERT INTO knowledge_access(user_id,knowledge_base_id,can_view,can_write) VALUES(?,?,?,?) ON CONFLICT(user_id,knowledge_base_id) DO UPDATE SET can_view=excluded.can_view,can_write=excluded.can_write",(user_id,kb_id,can_view,can_write))
    return jsonify(ok=True,level=level)

def task_view(row):
    with db() as c:
        docs=c.execute("SELECT d.id,d.name,d.collection,d.chunks FROM task_documents td JOIN documents d ON d.id=td.document_id WHERE td.task_id=? ORDER BY d.name",(row["id"],)).fetchall()
    return {"id":row["id"],"title":row["title"],"description":row["description"],"publisherId":row["publisher_id"],"publisher":row["publisher_name"],"assigneeId":row["assignee_id"],"assignee":row["assignee_name"],"status":row["status"],"submission":row["submission"],"reviewNote":row["review_note"],"created":row["created"],"updated":row["updated"],"documents":[dict(doc) for doc in docs]}

TASK_SELECT="""SELECT t.*,p.username publisher_name,a.username assignee_name FROM tasks t JOIN users p ON p.id=t.publisher_id JOIN users a ON a.id=t.assignee_id"""

@app.get("/api/tasks")
@login_required
def list_tasks():
    with db() as c:
        rows=c.execute(TASK_SELECT+" WHERE t.publisher_id=? OR t.assignee_id=? ORDER BY t.updated DESC",(g.user["id"],g.user["id"])).fetchall()
    return jsonify([task_view(row) for row in rows])

@app.post("/api/tasks")
@login_required
@admin_required
def create_task():
    body=request.get_json(silent=True) or {}
    title=clean(str(body.get("title", "")))[:120]
    description=clean(str(body.get("description", "")))[:10000]
    try: assignee_id=int(body.get("assigneeId"))
    except (TypeError,ValueError): return jsonify(error="请选择任务接收人。"),400
    document_ids=body.get("documentIds",[])
    if not title or not description: return jsonify(error="请填写任务标题和要求。"),400
    if not isinstance(document_ids,list) or len(document_ids)>100: return jsonify(error="任务文档列表无效。"),400
    document_ids=list(dict.fromkeys(str(value) for value in document_ids))
    with db() as c:
        assignee=c.execute("SELECT id FROM users WHERE id=? AND verified=1",(assignee_id,)).fetchone()
        if not assignee: return jsonify(error="任务接收人不存在。"),404
        if document_ids:
            marks=",".join("?" for _ in document_ids)
            found=c.execute(f"SELECT id FROM documents WHERE id IN ({marks})",document_ids).fetchall()
            if len(found)!=len(document_ids): return jsonify(error="部分任务文档不存在或无权访问。"),404
        now=datetime.now(timezone.utc).isoformat(timespec="seconds")
        task_id=uuid.uuid4().hex
        c.execute("INSERT INTO tasks(id,title,description,publisher_id,assignee_id,status,created,updated) VALUES(?,?,?,?,?,'assigned',?,?)",(task_id,title,description,g.user["id"],assignee_id,now,now))
        c.executemany("INSERT INTO task_documents(task_id,document_id) VALUES(?,?)",[(task_id,did) for did in document_ids])
        row=c.execute(TASK_SELECT+" WHERE t.id=?",(task_id,)).fetchone()
    return jsonify(task=task_view(row)),201

def get_task_for_user(task_id):
    with db() as c: row=c.execute(TASK_SELECT+" WHERE t.id=? AND (t.publisher_id=? OR t.assignee_id=?)",(task_id,g.user["id"],g.user["id"])).fetchone()
    return row

@app.get("/api/tasks/<task_id>")
@login_required
def get_task(task_id):
    row=get_task_for_user(task_id)
    if not row: return jsonify(error="任务不存在或无权查看。"),404
    result=task_view(row)
    with db() as c:
        passages=c.execute("SELECT d.id documentId,d.name document,d.collection,ch.page,ch.content FROM task_documents td JOIN documents d ON d.id=td.document_id JOIN chunks ch ON ch.document_id=d.id WHERE td.task_id=? ORDER BY d.name,ch.page,ch.id",(task_id,)).fetchall()
    result["passages"]=[dict(item) for item in passages]
    return jsonify(result)

@app.post("/api/tasks/<task_id>/submit")
@login_required
def submit_task(task_id):
    submission=clean(str((request.get_json(silent=True) or {}).get("submission", "")))[:20000]
    if not submission: return jsonify(error="请填写完成说明后提交。"),400
    now=datetime.now(timezone.utc).isoformat(timespec="seconds")
    with db() as c:
        result=c.execute("UPDATE tasks SET submission=?,status='submitted',review_note='',updated=? WHERE id=? AND assignee_id=? AND status IN ('assigned','changes_requested')",(submission,now,task_id,g.user["id"]))
        if not result.rowcount: return jsonify(error="任务当前不可提交，或你不是任务接收人。"),409
        row=c.execute(TASK_SELECT+" WHERE t.id=?",(task_id,)).fetchone()
    return jsonify(task=task_view(row))

@app.post("/api/tasks/<task_id>/review")
@login_required
def review_task(task_id):
    body=request.get_json(silent=True) or {}
    decision=body.get("decision")
    note=clean(str(body.get("note", "")))[:4000]
    if decision not in {"complete","return"}: return jsonify(error="验收操作无效。"),400
    if decision=="return" and not note: return jsonify(error="退回时请填写修改意见。"),400
    now=datetime.now(timezone.utc).isoformat(timespec="seconds")
    status="completed" if decision=="complete" else "changes_requested"
    with db() as c:
        result=c.execute("UPDATE tasks SET status=?,review_note=?,updated=? WHERE id=? AND publisher_id=? AND status='submitted'",(status,note,now,task_id,g.user["id"]))
        if not result.rowcount: return jsonify(error="任务尚未提交，或你不是发布者。"),409
        row=c.execute(TASK_SELECT+" WHERE t.id=?",(task_id,)).fetchone()
    return jsonify(task=task_view(row))

@app.get("/api/documents")
@login_required
def documents():
    names=accessible_collections()
    with db() as c: rows=c.execute("SELECT id,name,collection,chunks,created FROM documents WHERE collection IN ("+(",".join("?" for _ in names) or "NULL")+") ORDER BY created DESC",names).fetchall()
    return jsonify([dict(r) for r in rows])

@app.get("/api/documents/<did>/passages")
@login_required
def document_passages(did):
    allowed = accessible_collections()
    offset = max(0, min(request.args.get("offset", 0, type=int), 1000000))
    with db() as c:
        doc = c.execute("SELECT id,name,collection,chunks FROM documents WHERE id=?", (did,)).fetchone()
        if not doc or doc["collection"] not in allowed:
            return jsonify(error="Document unavailable"), 404
        rows = c.execute("SELECT id,page,content FROM chunks WHERE document_id=? ORDER BY rowid LIMIT 21 OFFSET ?", (did, offset)).fetchall()
    return jsonify(passages=[dict(row) for row in rows[:20]], nextOffset=offset+20 if len(rows)>20 else None)

@app.get("/api/collections")
@login_required
def collections():
    names=accessible_collections()
    with db() as c: rows=c.execute("SELECT b.name collection,COUNT(DISTINCT d.id) docs FROM knowledge_bases b LEFT JOIN documents d ON d.collection=b.name WHERE b.name IN ("+(",".join("?" for _ in names) or "NULL")+") GROUP BY b.id ORDER BY b.name",names).fetchall()
    return jsonify([dict(r) for r in rows])

def extract(path, ext):
    if ext == "pdf":
        from pypdf import PdfReader
        return [(i+1,clean(p.extract_text() or "")) for i,p in enumerate(PdfReader(str(path)).pages)]
    if ext == "docx":
        from docx import Document
        d=Document(str(path)); text="\n".join(p.text for p in d.paragraphs)
        text += "\n" + "\n".join(" | ".join(cell.text for cell in row.cells) for table in d.tables for row in table.rows)
        return [(None,clean(text))]
    return [(None,clean(path.read_text(encoding="utf-8-sig")))]

@app.post("/api/upload")
@login_required
def upload():
    f=request.files.get("file"); collection=clean(request.form.get("collection","通用知识库"))[:60] or "通用知识库"
    if not can_access_collection(collection,True): return jsonify(error="你没有该知识库的写入权限。"),403
    if not f or not f.filename: return jsonify(error="请选择文件。"),400
    ext=f.filename.rsplit(".",1)[-1].lower() if "." in f.filename else ""
    if ext not in {"pdf","docx","md","markdown","txt"}: return jsonify(error="支持 PDF、DOCX、Markdown、TXT。"),400
    UPLOADS.mkdir(parents=True,exist_ok=True); did=uuid.uuid4().hex; path=UPLOADS/f"{did}.{ext}"; f.save(path)
    try:
        parts=[]; seen=set()
        for page,text in extract(path,ext):
            for content in chunk_text(text):
                fp=hashlib.sha256(re.sub(r"\s+","",content).lower().encode()).hexdigest()
                if fp not in seen: seen.add(fp); parts.append((page,content,fp))
        if not parts: return jsonify(error="未提取到文本；扫描版 PDF 暂不支持 OCR。"),422
        now=datetime.now().isoformat(timespec="seconds")
        with db() as c:
            c.execute("INSERT INTO documents VALUES(?,?,?,?,?,?)",(did,str(owner()),f.filename,collection,len(parts),now))
            c.executemany("INSERT INTO chunks VALUES(?,?,?,?,?,?,?,?)",[(uuid.uuid4().hex,did,owner(),collection,p,t,pack(embed(t)),fp) for p,t,fp in parts])
        return jsonify(id=did,name=f.filename,collection=collection,chunks=len(parts))
    except Exception as e:
        app.logger.exception("Import failed")
        return jsonify(error="文档解析失败："+str(e)[:140]),422
    finally: path.unlink(missing_ok=True)

@app.delete("/api/documents/<did>")
@login_required
def delete_document(did):
    with db() as c: doc=c.execute("SELECT collection FROM documents WHERE id=?",(did,)).fetchone()
    if not doc: return jsonify(ok=False),404
    if not can_access_collection(doc["collection"],True): return jsonify(error="你没有该知识库的写入权限。"),403
    with db() as c: cur=c.execute("DELETE FROM documents WHERE id=?",(did,))
    return jsonify(ok=bool(cur.rowcount))

@app.get("/api/conversations")
@login_required
def conversations():
    allowed=set(accessible_collections())
    with db() as c:
        rows = c.execute("""SELECT summary.conversation,m.content title,summary.updated,s.scope
            FROM (SELECT conversation,MIN(id) first_id,MAX(created) updated FROM messages
                  WHERE owner=? AND role='user' GROUP BY conversation) summary
            JOIN messages m ON m.id=summary.first_id JOIN conversation_scopes s USING(owner,conversation)
            ORDER BY summary.updated DESC,summary.first_id DESC""", (owner(),)).fetchall()
    history = []
    for row in rows:
        scope = json.loads(row['scope'])
        if set(scope)<=allowed:
            history.append(dict(conversation=row['conversation'],title=row['title'],updated=row['updated'],
                                collection=scope[0] if len(scope)==1 else 'all'))
    return jsonify(history)

@app.get("/api/conversations/<cid>")
@login_required
def conversation(cid):
    allowed=set(accessible_collections())
    with db() as c:
        scope=c.execute("SELECT scope FROM conversation_scopes WHERE owner=? AND conversation=?",(owner(),cid)).fetchone()
        if not scope or not set(json.loads(scope["scope"]))<=allowed: return jsonify(error="Conversation unavailable"),404
        rows = c.execute("""SELECT m.id,m.role,m.content,m.created,f.rating,f.note
            FROM messages m LEFT JOIN answer_feedback f ON m.id=f.message_id
            WHERE m.owner=? AND m.conversation=? ORDER BY m.id""", (owner(),cid)).fetchall()
        sources = c.execute("""SELECT s.message_id,s.rank,x.id,d.name document,d.collection,x.page,x.content,s.score
            FROM answer_sources s JOIN messages m ON m.id=s.message_id
            JOIN chunks x ON x.id=s.chunk_id JOIN documents d ON d.id=x.document_id
            WHERE m.owner=? AND m.conversation=? ORDER BY s.rank""", (owner(),cid)).fetchall()
    by_message = {}
    for row in sources:
        if row['collection'] in allowed:
            source = dict(row)
            by_message.setdefault(source.pop('message_id'), []).append(source)
    return jsonify([dict(row, sources=by_message.get(row['id'], [])) for row in rows])

@app.post('/api/retrieval/test')
@login_required
def retrieval_test():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify(error='Invalid request'), 400
    question, collection, limit = body.get('question'), body.get('collection','all'), body.get('limit',5)
    if not isinstance(question, str) or not clean(question) or len(question)>2000:
        return jsonify(error='Enter a question between 1 and 2000 characters'), 400
    if type(limit) is not int or not 1<=limit<=20:
        return jsonify(error='Top K must be an integer from 1 to 20'), 400
    allowed = accessible_collections()
    if not allowed or not isinstance(collection,str) or (collection!='all' and collection not in allowed):
        return jsonify(error='Knowledge base unavailable'), 403
    started = perf_counter()
    hits = search(clean(question), collection, limit)
    return jsonify(sources=hits, elapsedMs=round((perf_counter()-started)*1000),
                   reranked=bool(hits and os.getenv('RERANKER_MODEL','').strip()))

@app.get('/api/answer-feedback')
@login_required
def feedback_history():
    allowed = set(accessible_collections())
    with db() as c:
        rows = c.execute("""SELECT m.id,m.conversation,substr(m.content,1,360) excerpt,
            f.rating,f.note,f.updated,s.scope FROM answer_feedback f
            JOIN messages m ON m.id=f.message_id JOIN conversation_scopes s USING(owner,conversation)
            WHERE m.owner=? ORDER BY f.updated DESC,m.id DESC""", (owner(),)).fetchall()
    return jsonify([{key:row[key] for key in row.keys() if key!='scope'}
                    for row in rows if set(json.loads(row['scope']))<=allowed])

@app.put('/api/answers/<int:message_id>/feedback')
@login_required
def save_feedback(message_id):
    body = request.get_json(silent=True)
    if not isinstance(body,dict) or 'rating' not in body:
        return jsonify(error='Invalid feedback'),400
    rating, note = body['rating'], body.get('note')
    if rating not in (None,'helpful','needs_work') or (note is not None and (not isinstance(note,str) or len(note)>500)):
        return jsonify(error='Invalid feedback'),400
    allowed = set(accessible_collections())
    with db() as c:
        row = c.execute("""SELECT s.scope FROM messages m JOIN conversation_scopes s USING(owner,conversation)
            WHERE m.id=? AND m.owner=? AND m.role='assistant'""", (message_id,owner())).fetchone()
        if not row or not set(json.loads(row['scope']))<=allowed:
            return jsonify(error='Answer unavailable'),404
        if rating is None:
            c.execute('DELETE FROM answer_feedback WHERE message_id=?', (message_id,))
            return jsonify(rating=None,note='')
        c.execute("""INSERT INTO answer_feedback VALUES (?,?,COALESCE(?,''),?)
            ON CONFLICT(message_id) DO UPDATE SET rating=excluded.rating,
            note=COALESCE(?,answer_feedback.note),updated=excluded.updated""",
            (message_id,rating,note,datetime.now(timezone.utc).isoformat(),note))
        saved = c.execute('SELECT rating,note,updated FROM answer_feedback WHERE message_id=?', (message_id,)).fetchone()
    return jsonify(dict(saved))

@app.post("/api/ask")
@login_required
def ask():
    b=request.get_json(force=True); q=clean(str(b.get("question","")))[:2000]
    if not q: return jsonify(error="请输入问题。"),400
    cid=b.get("conversation") or uuid.uuid4().hex; scope=clean(str(b.get("collection","all"))) or "all"
    if not isinstance(cid,str) or not re.fullmatch(r"[a-f0-9]{32}",cid): return jsonify(error="Invalid conversation"),400
    if scope!="all" and not can_access_collection(scope): return jsonify(error="你没有该知识库的访问权限。"),403
    allowed=accessible_collections()
    if scope=="all" and not allowed: return jsonify(error="你尚未获分配知识库，请联系管理员。"),403
    active=set(allowed if scope=="all" else [scope])
    with db() as c:
        c.execute("BEGIN IMMEDIATE")
        prior=c.execute("SELECT scope FROM conversation_scopes WHERE owner=? AND conversation=?",(owner(),cid)).fetchone()
        if prior and not set(json.loads(prior["scope"]))<=active: return jsonify(error="Start a new conversation to change the search scope"),403
        c.execute("INSERT INTO conversation_scopes VALUES(?,?,?) ON CONFLICT(owner,conversation) DO UPDATE SET scope=excluded.scope",(owner(),cid,json.dumps(sorted(active))))
        history=c.execute("SELECT role,content FROM messages WHERE owner=? AND conversation=? ORDER BY id",(owner(),cid)).fetchall()
    hits=[h for h in search(q,scope) if h["collection"] in active]
    answer=llm_answer(q,hits,history)
    if answer is None:
        answer=("检索到以下相关原文。配置服务端 DEEPSEEK_API_KEY 后即可启用生成式回答。\n\n"+"\n\n".join(h["content"] for h in hits[:2])) if hits and hits[0]["score"]>=.05 else "知识库中没有找到足够相关的依据，请调整问题或上传相关文档。"
    now=datetime.now().isoformat(timespec="seconds")
    for rank, hit in enumerate(hits,1):
        hit['rank'] = rank
    with db() as c:
        statement = 'INSERT INTO messages(owner,conversation,role,content,created) VALUES(?,?,?,?,?)'
        c.execute(statement, (owner(),cid,'user',q,now))
        message_id = c.execute(statement, (owner(),cid,'assistant',answer,now)).lastrowid
        # The document can be deleted while the model generates the answer.
        c.executemany('INSERT INTO answer_sources SELECT ?,?,id,? FROM chunks WHERE id=?',
                      [(message_id,h['rank'],h['score'],h['id']) for h in hits])
    return jsonify(answer=answer,conversation=cid,messageId=message_id,sources=hits,llm=bool(os.getenv("DEEPSEEK_API_KEY")))

@app.post("/api/evaluate")
@login_required
def evaluate():
    body=request.get_json(silent=True)
    body=body if isinstance(body,dict) else {}
    cases=body.get("cases")
    if not isinstance(cases,list): cases=json.loads((BASE/"evaluation"/"rag_eval.json").read_text(encoding="utf-8"))
    if not 1<=len(cases)<=100: return jsonify(error="Evaluation set must contain 1 to 100 cases"),400
    allowed=set(accessible_collections())
    if not allowed: return jsonify(error="No knowledge base is assigned to this account"),403
    for case in cases:
        if not isinstance(case,dict): return jsonify(error="Invalid evaluation case"),400
        question,expected,collection=case.get("question"),case.get("expected"),case.get("collection","all")
        if not isinstance(question,str) or not clean(question) or len(question)>2000 or not isinstance(expected,str) or not clean(expected) or len(expected)>2000:
            return jsonify(error="Each case needs a question and expected passage, up to 2000 characters"),400
        if not isinstance(collection,str) or (collection!="all" and collection not in allowed):
            return jsonify(error="Knowledge base unavailable"),403
    results=[]
    for case in cases:
        hs=search(clean(case["question"]),case.get("collection","all"),5); expected=clean(case["expected"]).lower()
        matched=bool(expected and any(expected in h["content"].lower() for h in hs)); score=hs[0]["score"] if hs else 0
        results.append({"question":case.get("question"),"expected":expected,"matched":matched,"top_score":score,"sources":hs[:3]})
        with db() as c: c.execute("INSERT INTO evaluations(owner,question,expected,hits,top_score,created) VALUES(?,?,?,?,?,?)",(owner(),case.get("question",""),expected,int(matched),score,datetime.now().isoformat(timespec="seconds")))
    return jsonify(total=len(results),hit_rate=round(sum(x["matched"] for x in results)/max(1,len(results)),3),results=results)

@app.get("/api/evaluation-cases")
@login_required
def get_evaluation_cases():
    with db() as c:
        rows=c.execute("SELECT id,question,expected,collection FROM evaluation_cases WHERE owner=? ORDER BY id",(owner(),)).fetchall()
    if rows: return jsonify([dict(row) for row in rows])
    defaults=json.loads((BASE/"evaluation"/"rag_eval.json").read_text(encoding="utf-8"))
    allowed=set(accessible_collections())
    return jsonify([{**case,"id":f"default-{index}"} for index,case in enumerate(defaults)
                    if case.get("collection","all")=="all" or case.get("collection") in allowed])

@app.put("/api/evaluation-cases")
@login_required
def put_evaluation_cases():
    body=request.get_json(silent=True)
    cases=body.get("cases") if isinstance(body,dict) else None
    if not isinstance(cases,list) or not 1<=len(cases)<=100:
        return jsonify(error="Evaluation set must contain 1 to 100 cases"),400
    allowed=set(accessible_collections())
    normalized=[]
    for case in cases:
        if not isinstance(case,dict): return jsonify(error="Invalid evaluation case"),400
        question,expected,collection=case.get("question"),case.get("expected"),case.get("collection","all")
        if not isinstance(question,str) or not clean(question) or len(question)>2000 or not isinstance(expected,str) or not clean(expected) or len(expected)>2000:
            return jsonify(error="Each case needs a question and expected passage, up to 2000 characters"),400
        if not isinstance(collection,str) or (collection!="all" and collection not in allowed):
            return jsonify(error="Knowledge base unavailable"),403
        normalized.append((owner(),clean(question),clean(expected),collection))
    with db() as c:
        c.execute("DELETE FROM evaluation_cases WHERE owner=?",(owner(),))
        c.executemany("INSERT INTO evaluation_cases(owner,question,expected,collection) VALUES(?,?,?,?)",normalized)
        rows=c.execute("SELECT id,question,expected,collection FROM evaluation_cases WHERE owner=? ORDER BY id",(owner(),)).fetchall()
    return jsonify([dict(row) for row in rows])

@app.get("/api/stats")
@login_required
def stats():
    names=accessible_collections()
    with db() as c:
        marks=",".join("?" for _ in names) or "NULL"
        docs=c.execute(f"SELECT COUNT(*) FROM documents WHERE collection IN ({marks})",names).fetchone()[0]
        chunks=c.execute(f"SELECT COUNT(*) FROM chunks WHERE collection IN ({marks})",names).fetchone()[0]
        chats=c.execute("SELECT COUNT(DISTINCT conversation) FROM messages WHERE owner=?",(owner(),)).fetchone()[0]
        ev=c.execute("SELECT COUNT(*),COALESCE(AVG(hits),0) FROM evaluations WHERE owner=?",(owner(),)).fetchone()
    return jsonify(documents=docs,chunks=chunks,conversations=chats,evaluations=ev[0],hit_rate=round(ev[1],3))

@app.errorhandler(413)
def too_large(_): return jsonify(error="文件不能超过 20 MB。"),413

@app.cli.command("set-admin")
@click.argument("email")
@click.password_option()
def set_admin(email,password):
    """Create or update a verified local administrator."""
    email=email.strip().lower()
    if len(email)>254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+",email) or not 10<=len(password)<=256:
        raise click.ClickException("Enter a valid email and a password of 10 to 256 characters.")
    password_hash=generate_password_hash(password,method="scrypt")
    with db() as c:
        c.execute("""INSERT INTO users(email,password_hash,is_admin,verified,created) VALUES(?,?,1,1,?)
                     ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash,is_admin=1,verified=1""",
                  (email,password_hash,datetime.now(timezone.utc).isoformat(timespec="seconds")))
        c.execute("DELETE FROM login_attempts WHERE email=?",(email,))
        c.execute("DELETE FROM email_codes WHERE email=?",(email,))
    click.echo("Administrator account configured.")

@app.cli.command("import-legacy")
@click.option("--owner", "legacy_owner", required=True, help="Exact owner ID from the old database")
@click.option("--collection", required=True, help="Source collection in the old database")
@click.option("--target", required=True, help="Existing destination knowledge base")
def import_legacy(legacy_owner, collection, target):
    source = DATA / "knowledge.db"
    if not source.is_file():
        raise click.ClickException("Legacy knowledge.db was not found")
    with closing(sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True)) as old, db() as current:
        current.execute("BEGIN IMMEDIATE")
        base = current.execute("SELECT name,created_by FROM knowledge_bases WHERE name=?", (target,)).fetchone()
        if not base:
            raise click.ClickException("Create the destination knowledge base first")
        docs = old.execute("SELECT id,name,chunks,created FROM documents WHERE owner=? AND collection=?", (legacy_owner,collection)).fetchall()
        count = 0
        for old_id, name, chunks, created in docs:
            result = current.execute("INSERT OR IGNORE INTO legacy_imports VALUES(?)", (old_id,))
            if not result.rowcount:
                continue
            document_id = uuid.uuid4().hex
            creator = str(base["created_by"])
            current.execute("INSERT INTO documents VALUES(?,?,?,?,?,?)", (document_id,creator,name,base["name"],chunks,created))
            passages = old.execute("SELECT page,content,vector,fingerprint FROM chunks WHERE document_id=? AND owner=? AND collection=?", (old_id,legacy_owner,collection))
            current.executemany("INSERT INTO chunks VALUES(?,?,?,?,?,?,?,?)", ((uuid.uuid4().hex,document_id,creator,base["name"],*passage) for passage in passages))
            count += 1
    click.echo(f"Imported {count} documents")

if __name__ == "__main__":
    from waitress import serve
    serve(app,host=os.getenv("HOST","127.0.0.1"),port=int(os.getenv("PORT","5000")))
