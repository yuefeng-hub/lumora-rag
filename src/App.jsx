import { useCallback, useEffect, useRef, useState } from 'react'
import Workspace from './Workspace'
import RagPages, { RatingButtons, toolLinks } from './RagPages'
import {
  ArrowDown, ArrowUpRight, BookOpen, Check, ChevronDown, Clock3, FileText, ClipboardList,
  Languages, LogOut, Menu, MessageCircle, Pause, Play, Plus, Search, Send, ShieldCheck,
  Sparkles, Trash2, Upload, X,
} from 'lucide-react'

const scenes = [
  { label: 'Golden Hour', src: '/static/scene-videos/golden-hour.mp4' },
  { label: 'Still Water', src: '/static/scene-videos/still-water.mp4' },
  { label: 'Deep Woods', src: '/static/scene-videos/deep-woods.mp4' },
  { label: 'Quiet Dawn', src: '/static/scene-videos/quiet-dawn.mp4' },
]

let csrfToken = ''
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'X-CSRF-Token': csrfToken, ...options.headers } })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Request failed')
  if (data.csrfToken) csrfToken = data.csrfToken
  return data
}

const zh = {
  'Retrieval lab':'检索实验室','Evaluation set':'评估集','Answer review':'回答质检','Conversation archive':'对话档案','Query':'检索问题','Run retrieval':'运行检索','Searching':'检索中','Retrieved passages':'命中片段','Reranked':'已重排','Hybrid retrieval':'混合检索','Score':'相关性分数','Rate this answer':'评价回答','Helpful':'有帮助','Needs improvement':'需改进','Review note':'质检备注','Save note':'保存备注','View answer':'查看原回答','Rating':'反馈类型','All ratings':'全部反馈','Feedback records':'条反馈','Retry':'重试','No matching feedback':'没有匹配的反馈','Search conversation titles':'搜索对话标题','No matching conversations':'没有匹配的对话','Export conversation':'导出对话','Updated':'更新时间','Question':'问题','Answer':'回答','Citations':'引用来源','evaluation cases':'条评估问题','Import JSON':'导入 JSON','Export JSON':'导出 JSON','Save set':'保存评估集','Evaluation set saved':'评估集已保存','Evaluation set imported':'评估集已导入','Invalid evaluation JSON':'评估 JSON 格式无效','Test case':'测试问题','Remove case':'删除问题','Add case':'添加问题','Evaluation results':'评估结果','Invalid feedback':'反馈内容无效','Answer unavailable':'回答不可用','Knowledge base unavailable':'知识库不可用','Top K must be an integer from 1 to 20':'Top K 必须是 1 到 20 的整数','Enter a question between 1 and 2000 characters':'请输入 1 到 2000 个字符的问题',
  'Recent activity':'近期动态','Open tasks':'待办任务','Search documents':'搜索文件名','Ask this base':'在此库提问','No matching documents':'没有匹配的文档','Show more':'显示更多','Recent conversations':'近期对话','No open tasks':'暂无待办任务','Evaluating':'评估中','Run evaluation':'运行评估','Matched':'已命中','Missed':'未命中','Expected passage':'预期依据','Page':'页','No evaluation results yet':'暂无评估结果','Close preview':'关闭预览','Document passages':'原文片段','Passage':'片段','Loading':'加载中','No indexed passages':'暂无原文片段','Document unavailable':'文档不可用',
  'Permissions':'权限管理','Knowledge base name':'知识库名称','Create knowledge base':'创建知识库','Select a knowledge base':'选择知识库','Member email':'已注册成员邮箱','Access level':'权限级别','Document removed':'文档已删除','Create a knowledge base in Permissions.':'请在权限管理中创建知识库。','No knowledge bases assigned. Contact an administrator.':'尚未分配知识库，请联系管理员。','New conversation':'新对话','Sign out':'退出登录','Search scope':'检索范围','Golden Hour':'金色时刻','Still Water':'静水','Deep Woods':'幽深森林','Quiet Dawn':'静谧黎明',
  'Tasks':'任务','Publish task':'发布任务','Task title':'任务标题','Task requirements':'任务要求','Assign to user':'选择接收人','Attach documents':'附加知识库文档','Create task':'发布任务','My tasks':'任务列表','No tasks yet.':'暂无任务。','Assigned to you':'分配给我','Published by you':'由我发布','Submission':'完成说明','Submit work':'提交任务','Review submission':'验收提交','Return with comments':'填写批注并退回','Complete task':'验收通过','Return task':'退回修改','Review comments':'退回批注','Documents attached':'关联文档','Read task document':'查看任务文档','Task assigned':'待完成','Awaiting review':'待验收','Changes requested':'待修改','Completed':'已完成','Submit a completion note.':'请填写完成说明。','Choose a user':'请选择用户','Task created':'任务已发布','Submission sent':'任务已提交','Task returned':'任务已退回','Task completed':'任务已完成','Search registered users':'搜索已注册用户','Click a user to grant access':'点击用户即可授权','Grant read':'授予只读','Grant edit':'授予编辑','Registered users':'已注册用户','No matching users':'没有匹配用户','Add documents if needed':'可选择任务相关文档','Return reason required':'退回时请填写修改意见。','Change access':'修改权限','Filter by access level':'按权限筛选',
  'How It Works':'使用指南','Knowledge Base':'知识库','Evaluation':'检索评估','Workspace':'工作空间','Ask Lumora':'开始提问',
  'Private knowledge · Clear answers':'企业私有知识 · 答案有据可循','indexed source':'个知识来源','indexed sources':'个知识来源','Private workspace':'私有工作空间',
  'Clarity in an Endlessly':'让分散知识','Noisy Universe':'成为可靠答案','Ask across your private documents. Get grounded answers with the original source passages in view.':'检索企业文档，让每个回答都能回到原文依据。',
  'Ask your knowledge base…':'提问你的企业知识库…','All sources':'全部知识库','Local retrieval':'本地检索','sources':'个来源','Session isolated':'账号权限隔离',
  'Indexed Sources':'个知识来源','Content Passages':'个内容片段','Conversations':'次对话','Source-Linked Answers':'回答附带原文引用',
  'PRIVATE WORKSPACE':'私有工作空间','Knowledge library':'知识库管理','Documents':'文档','Sessions':'对话记录','Add a source and make it searchable. PDF, Word, Markdown and text are supported.':'添加资料并建立可检索索引。支持 PDF、Word、Markdown 和文本。',
  'Choose or drop a file':'选择或拖入文件','PDF, DOCX, MD, TXT · max 20 MB':'PDF、DOCX、MD、TXT · 最大 20 MB','Knowledge base':'知识库','Build index':'建立索引','Indexing…':'正在建立索引…',
  'Indexed documents':'已索引文档','No documents indexed yet.':'还没有索引文档。','Recent conversations in this browser session.':'此账号的最近对话。','No conversations yet.':'暂无对话记录。',
  'Session-scoped workspace':'按知识库授权隔离','DeepSeek receives prompts and retrieved excerpts when enabled.':'启用 DeepSeek 后，问题和命中文档片段会发送至 API。',
  'View source excerpt':'查看引用原文','Close knowledge library':'关闭知识库','Close library':'关闭知识库','Delete document':'删除文档','Remove':'删除',
  'Retrieval evaluation':'检索评估','test queries':'条评估问题','matched a supporting passage':'命中依据片段',
  'Choose a document first':'请先选择文档','Evaluation complete':'评估完成','All':'全部','Read only':'只读','Can edit':'可编辑','Grant access':'授权','Revoke':'撤销','No access':'无权查看',
}

function t(value, language) {
  if (language === 'en') return value
  if (zh[value]) return zh[value]
  for (const [key, translation] of Object.entries(zh)) {
    if (value.startsWith(`${key} · `)) return value.replace(key, translation)
    if (value.startsWith(`${key} `)) return value.replace(key, translation)
  }
  return value
}

function SceneVideos({ active, playing = true, onReady }) {
  const stack = useRef(null)
  useEffect(() => {
    for (const video of stack.current.querySelectorAll('video')) {
      if (playing) video.play().catch(() => {})
      else video.pause()
    }
  }, [playing])
  return <div ref={stack} className="video-stack" aria-hidden="true">
    {scenes.map((scene, index) => <video key={scene.src} className={`hero-video ${active === index ? 'active' : ''}`} src={scene.src} autoPlay={playing} muted loop playsInline preload={index === 0 ? 'auto' : 'metadata'} onCanPlay={() => onReady?.(index, true)} onError={event => { event.currentTarget.style.display = 'none'; onReady?.(index, false) }} />)}
  </div>
}

function AuthGate({ language, onLanguage, onAuthenticated, toast }) {
  const [mode, setMode] = useState('login')
  const [identifier, setIdentifier] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [csrf, setCsrf] = useState('')
  const [activeVideo, setActiveVideo] = useState(0)
  const [playing, setPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [available, setAvailable] = useState(0)
  const copy = (en, cn) => language === 'zh' ? cn : en
  const register = mode === 'register'

  useEffect(() => { api('/api/auth/csrf').then(x => setCsrf(x.csrfToken)).catch(() => {}) }, [])
  useEffect(() => {
    if (available && !(available & (1 << activeVideo))) {
      setActiveVideo(scenes.findIndex((_, index) => available & (1 << index)))
    }
    if (!playing) return
    const timer = window.setInterval(() => setActiveVideo(current => {
      for (let step = 1; step < scenes.length; step++) {
        const next = (current + step) % scenes.length
        if (available & (1 << next)) return next
      }
      return current
    }), 8000)
    return () => window.clearInterval(timer)
  }, [activeVideo, available, playing])
  async function requestCode() {
    setBusy(true)
    try { await api('/api/auth/code',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({email,purpose:mode})});setSent(true);toast(copy('Verification code sent','验证码已发送')) }
    catch(error){toast(error.message)} finally{setBusy(false)}
  }
  async function submit(event) {
    event.preventDefault();setBusy(true)
    try {
      const credentials = register ? { username, email, password, code } : { identifier, password }
      const data=await api(`/api/auth/${mode}`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(credentials)})
      onAuthenticated({user:data.user,csrfToken:data.csrfToken})
    } catch(error){toast(error.message)} finally{setBusy(false)}
  }
  return <main className="auth-screen">
    <div className="auth-photo" aria-hidden="true" />
    <SceneVideos active={activeVideo} playing={playing} onReady={(index, ready) => setAvailable(current => ready ? current | (1 << index) : current & ~(1 << index))} />
    <div className="auth-shade" aria-hidden="true" />
    <header className="auth-top"><a className="wordmark" href="#home">Lumora</a><button className="language-toggle liquid-glass" onClick={onLanguage}><Languages size={15}/>{language==='zh'?'EN':'中文'}</button></header>
    <section className="auth-card liquid-glass">
      <div className="auth-symbol"><ShieldCheck size={19}/></div>
      <div className="auth-eyebrow">{copy('PRIVATE KNOWLEDGE WORKSPACE','私有知识工作台')}</div>
      <h1 className="font-display">{mode==='login'?copy('Welcome back','欢迎回来'):copy('Create your account','创建账号')}</h1>
      <p className="auth-subtitle">{mode==='login'?copy('Sign in to your organization knowledge base.','登录后访问管理员分配给你的企业知识库。'):copy('Verify your email to start a private workspace.','通过邮箱验证后创建私有工作空间。')}</p>
      <form onSubmit={submit} className="auth-form">
        {register ? <>
          <label htmlFor="auth-username">{copy('Username','用户名')}</label><input id="auth-username" autoComplete="username" minLength={3} maxLength={32} required value={username} onChange={e => setUsername(e.target.value)} placeholder={copy('3 to 32 characters','3 至 32 个字符')} />
          <label htmlFor="auth-email">{copy('Email address','邮箱地址')}</label><input id="auth-email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={e=>{setEmail(e.target.value);setSent(false)}} placeholder="name@example.com" />
        </> : <>
          <label htmlFor="auth-identifier">{copy('Username or email','用户名或邮箱')}</label><input id="auth-identifier" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} required value={identifier} onChange={e => setIdentifier(e.target.value)} />
        </>}
        {mode==='register'&&<><label htmlFor="auth-code">{copy('Verification code','邮箱验证码')}</label><div className="code-field"><input id="auth-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" required value={code} onChange={e=>setCode(e.target.value)} placeholder="000000"/><button type="button" disabled={!csrf||busy||!email} onClick={requestCode}>{sent?copy('Resend code','重新发送'):copy('Send code','获取验证码')}</button></div></>}
        <label htmlFor="auth-password">{copy('Password','密码')}</label><input id="auth-password" type="password" autoComplete={mode==='login'?'current-password':'new-password'} minLength="10" required value={password} onChange={e=>setPassword(e.target.value)} placeholder={copy('At least 10 characters','至少 10 位字符')} />
        <button disabled={!csrf||busy} className="auth-submit">{busy?copy('Please wait…','请稍候…'):mode==='login'?copy('Sign in','登录'):copy('Create account','注册并登录')}<ArrowUpRight size={16}/></button>
      </form>
      <div className="auth-switch">{mode==='login'?copy("New here?","还没有账号？"):copy('Already registered?','已有账号？')} <button onClick={()=>{setMode(mode==='login'?'register':'login');setSent(false)}}>{mode==='login'?copy('Create account','注册账号'):copy('Sign in','去登录')}</button></div>
    </section>
    <footer className="auth-footer">
      <span>{copy('PRIVATE · VERIFIED · SOURCE-LINKED','私有访问 · 邮箱验证 · 原文溯源')}</span>
      <button type="button" className="auth-motion" onClick={() => setPlaying(value => !value)} aria-label={playing ? copy('Pause background video','暂停背景视频') : copy('Play background video','播放背景视频')} title={playing ? copy('Pause background video','暂停背景视频') : copy('Play background video','播放背景视频')}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
    </footer>
  </main>
}

function SourceList({ sources, tr }) {
  const [expanded, setExpanded] = useState(null)
  if (!sources?.length) return null
  return <div className="mt-4 flex flex-wrap gap-2">
    {sources.map((source, i) => <button
      key={source.id} onClick={() => setExpanded(expanded === source.id ? null : source.id)}
      className="source-chip" title={tr('View source excerpt')} aria-expanded={expanded===source.id}
    >
      <FileText size={13} />
      <span>{String(source.rank ?? i + 1).padStart(2, '0')} · {source.document}{source.page ? ` · p.${source.page}` : ''}</span>
      {expanded === source.id && <span className="source-popover">{source.content}</span>}
    </button>)}
  </div>
}

function AccessEditor({ bases, onRefresh, tr, toast }) {
  const [name,setName]=useState('')
  const [id,setId]=useState('')
  const [filter,setFilter]=useState('')
  const [filterLevel,setFilterLevel]=useState('all')
  const [saving,setSaving]=useState(false)
  const [users,setUsers]=useState([])
  const base=bases.find(item=>String(item.id)===id)
  useEffect(()=>{api('/api/users').then(setUsers).catch(error=>toast(error.message))},[toast])
  async function save(url,method,body) {
    setSaving(true)
    try { const result=await api(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});await onRefresh();return result }
    catch(error){toast(error.message)} finally {setSaving(false)}
  }
  const allMembers=base?.members.map(member=>({email:member.email,username:member.username,canView:Boolean(member.can_view),canWrite:Boolean(member.can_write)})) || []
  const memberByEmail=new Map(allMembers.map(member=>[member.email.toLowerCase(),member]))
  function permissionOf(email) {
    const member=memberByEmail.get(email.toLowerCase())
    return member?.canWrite?'write':member?.canView?'read':'none'
  }
  function updatePermission(user,level) {
    return save(`/api/knowledge-bases/${base.id}/members/${user.id}`,'PUT',{level})
  }
  const matches=users.filter(item=>{
    const permission=permissionOf(item.email)
    return (filterLevel==='all'||permission===filterLevel)&&`${item.username||''} ${item.email}`.toLowerCase().includes(filter.trim().toLowerCase())
  })
  return <div className="access-editor">
    <form onSubmit={async e=>{e.preventDefault();const result=await save('/api/knowledge-bases','POST',{name});if(result){setName('');setId(String(result.id))}}}>
      <input aria-label={tr('Knowledge base name')} placeholder={tr('Knowledge base name')} value={name} onChange={e=>setName(e.target.value)} required maxLength={60}/>
      <button disabled={saving} className="upload-action"><Plus size={15}/>{tr('Create knowledge base')}</button>
    </form>
    <select aria-label={tr('Knowledge base')} value={id} onChange={e=>setId(e.target.value)}><option value="">{tr('Select a knowledge base')}</option>{bases.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>
    {base&&<>
      <label className="access-level-label">{tr('Access level')}</label>
      <select aria-label={tr('Filter by access level')} value={filterLevel} onChange={e=>setFilterLevel(e.target.value)}><option value="all">{tr('All')}</option><option value="none">{tr('No access')}</option><option value="read">{tr('Read only')}</option><option value="write">{tr('Can edit')}</option></select>
      <input aria-label={tr('Search registered users')} placeholder={tr('Search registered users')} value={filter} onChange={e=>setFilter(e.target.value)}/>
      <div className="registered-users"><div className="drawer-eyebrow">{tr('Registered users')} · {users.length}</div>
        {matches.map(item=><div className="registered-user" key={item.id}><span><strong>{item.username||item.email}</strong><small>{item.email}</small></span><select className="member-access-select" aria-label={`${tr('Change access')} ${item.email}`} value={permissionOf(item.email)} disabled={saving} onChange={e=>updatePermission(item,e.target.value)}><option value="none">{tr('No access')}</option><option value="read">{tr('Read only')}</option><option value="write">{tr('Can edit')}</option></select></div>)}
        {!matches.length&&<div className="empty-list">{tr('No matching users')}</div>}
      </div>
    </>}
  </div>
}

function TaskCenter({ documents, user, tr, toast, initialTask, onTasksChanged }) {
  const [tasks,setTasks]=useState([])
  const [users,setUsers]=useState([])
  const [selected,setSelected]=useState(null)
  const [detail,setDetail]=useState(null)
  const [title,setTitle]=useState('')
  const [description,setDescription]=useState('')
  const [assignee,setAssignee]=useState('')
  const [documentIds,setDocumentIds]=useState([])
  const [submission,setSubmission]=useState('')
  const [note,setNote]=useState('')
  const [busy,setBusy]=useState(false)
  const taskRequest = useRef(0)
  const taskDetail = useRef(null)

  async function refreshTasks() {
    const items=await api('/api/tasks')
    setTasks(items)
    onTasksChanged(items)
    if(selected){const updated=items.find(item=>item.id===selected);if(updated)setDetail(current=>current?{...current,...updated}:current)}
  }
  useEffect(()=>{refreshTasks().catch(error=>toast(error.message));if(user.isAdmin)api('/api/users').then(setUsers).catch(error=>toast(error.message))},[user.isAdmin,toast])
  useEffect(() => { if (initialTask) openTask(initialTask) }, [initialTask])
  useEffect(() => {
    if (initialTask && detail?.id === initialTask.id) taskDetail.current?.scrollIntoView({ block: 'start' })
  }, [detail?.id, initialTask])

  async function publish(event) {
    event.preventDefault();setBusy(true)
    try {
      const result=await api('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,description,assigneeId:Number(assignee),documentIds})})
      setTitle('');setDescription('');setDocumentIds([]);setSelected(result.task.id);setDetail(result.task);await refreshTasks();toast(tr('Task created'))
    } catch(error){toast(error.message)} finally{setBusy(false)}
  }
  async function openTask(task) {
    const ticket = ++taskRequest.current
    setSelected(task.id);setDetail(null);setSubmission('');setNote('')
    try {
      const result = await api(`/api/tasks/${task.id}`)
      if (ticket === taskRequest.current) setDetail(result)
    } catch (error) {
      if (ticket === taskRequest.current) toast(error.message)
    }
  }
  async function submit(event) {
    event.preventDefault();setBusy(true)
    try{const result=await api(`/api/tasks/${selected}/submit`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({submission})});setDetail(result.task);setSubmission('');await refreshTasks();toast(tr('Submission sent'))}catch(error){toast(error.message)}finally{setBusy(false)}
  }
  async function review(decision) {
    if(decision==='return'&&!note.trim())return toast(tr('Return reason required'))
    setBusy(true)
    try{const result=await api(`/api/tasks/${selected}/review`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision,note})});setDetail(result.task);setNote('');await refreshTasks();toast(tr(decision==='complete'?'Task completed':'Task returned'))}catch(error){toast(error.message)}finally{setBusy(false)}
  }
  const statusText={assigned:'Task assigned',submitted:'Awaiting review',changes_requested:'Changes requested',completed:'Completed'}
  return <div className="task-center">
    {user.isAdmin&&<form className="task-compose" onSubmit={publish}>
      <div className="drawer-eyebrow">{tr('Publish task')}</div>
      <input aria-label={tr('Task title')} placeholder={tr('Task title')} value={title} onChange={e=>setTitle(e.target.value)} required maxLength={120}/>
      <textarea aria-label={tr('Task requirements')} placeholder={tr('Task requirements')} value={description} onChange={e=>setDescription(e.target.value)} required maxLength={10000} rows={4}/>
      <label className="task-field-label" htmlFor="task-assignee">{tr('Assign to user')}</label>
      <select id="task-assignee" value={assignee} onChange={e=>setAssignee(e.target.value)} required><option value="">{tr('Choose a user')}</option>{users.filter(item=>item.id!==user.id).map(item=><option key={item.id} value={item.id}>{item.username||item.email} · {item.email}</option>)}</select>
      <fieldset className="task-document-picker"><legend>{tr('Attach documents')}</legend>
        {documents.length?documents.map(doc=><label key={doc.id}><input type="checkbox" checked={documentIds.includes(doc.id)} onChange={e=>setDocumentIds(current=>e.target.checked?[...current,doc.id]:current.filter(id=>id!==doc.id))}/><span>{doc.name}<small>{doc.collection}</small></span></label>):<small>{tr('Add documents if needed')}</small>}
      </fieldset>
      <button disabled={busy||!assignee} className="upload-action"><ClipboardList size={15}/>{tr('Create task')}<ArrowUpRight size={15}/></button>
    </form>}
    <div className="task-list-heading">{tr('My tasks')} <span>{tasks.length}</span></div>
    {tasks.length?tasks.map(task=><button key={task.id} className={`task-row ${selected===task.id?'selected':''}`} onClick={()=>openTask(task)}><span className="task-row-main"><strong>{task.title}</strong><small>{tr(task.assigneeId===user.id?'Assigned to you':'Published by you')} · {task.assigneeId===user.id?task.publisher:task.assignee}</small></span><span className={`task-status status-${task.status}`}>{tr(statusText[task.status])}</span></button>):<div className="empty-list">{tr('No tasks yet.')}</div>}
    {detail&&<section className="task-detail" ref={taskDetail}>
      <div className="drawer-eyebrow">{tr(statusText[detail.status])}</div><h3>{detail.title}</h3><p className="task-description">{detail.description}</p>
      <div className="task-people">{detail.publisher} → {detail.assignee}</div>
      {detail.documents?.length>0&&<div className="task-attachments"><div className="drawer-eyebrow">{tr('Documents attached')}</div>{detail.documents.map(doc=><details key={doc.id} className="task-document"><summary><FileText size={14}/>{doc.name}<small>{doc.collection}</small></summary>{detail.passages?.filter(item=>item.documentId===doc.id).map((passage,index)=><p key={`${doc.id}-${index}`} className="task-passage">{passage.page?`p. ${passage.page} · `:''}{passage.content}</p>)}</details>)}</div>}
      {detail.reviewNote&&<div className="task-review-note"><strong>{tr('Review comments')}</strong><p>{detail.reviewNote}</p></div>}
      {detail.submission&&<div className="task-submission"><strong>{tr('Submission')}</strong><p>{detail.submission}</p></div>}
      {detail.assigneeId===user.id&&['assigned','changes_requested'].includes(detail.status)&&<form className="task-action-form" onSubmit={submit}><textarea aria-label={tr('Submission')} placeholder={tr('Submit a completion note.')} value={submission} onChange={e=>setSubmission(e.target.value)} required maxLength={20000} rows={5}/><button className="upload-action" disabled={busy||!submission.trim()}>{tr('Submit work')}<ArrowUpRight size={15}/></button></form>}
      {detail.publisherId===user.id&&detail.status==='submitted'&&<div className="task-action-form"><textarea aria-label={tr('Review comments')} placeholder={tr('Return with comments')} value={note} onChange={e=>setNote(e.target.value)} maxLength={4000} rows={3}/><button className="upload-action task-complete" disabled={busy} onClick={()=>review('complete')}>{tr('Complete task')}<Check size={15}/></button><button className="upload-action task-return" disabled={busy||!note.trim()} onClick={()=>review('return')}>{tr('Return task')}<ArrowUpRight size={15}/></button></div>}
    </section>}
  </div>
}

function KnowledgeDrawer({ open, tab, setTab, initialTask, onTasksChanged, onClose, documents, bases, user, tr, onRefresh, onOpenConversation, toast }) {
  const [collection, setCollection] = useState('')
  const writable=bases.filter(base=>base.canWrite)
  const target=writable.some(base=>base.name===collection)?collection:writable[0]?.name || ''
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState([])
  const fileRef = useRef(null)

  useEffect(() => {
    if (open && tab === 'history') api('/api/conversations').then(setHistory).catch(() => setHistory([]))
  }, [open, tab])

  async function upload(event) {
    event.preventDefault()
    if (!file || !target) return toast(tr('Choose a document first'))
    setBusy(true)
    const body = new FormData()
    body.append('file', file)
    body.append('collection', target)
    try {
      const result = await api('/api/upload', { method: 'POST', body })
      toast(`${result.chunks} ${tr('Content Passages')}`)
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      await onRefresh()
    } catch (error) { toast(error.message) }
    finally { setBusy(false) }
  }

  async function remove(doc) {
    if (!window.confirm(`${tr('Delete document')}: ${doc.name}?`)) return
    try { await api(`/api/documents/${doc.id}`, { method: 'DELETE' }); await onRefresh(); toast(tr('Document removed')) }
    catch (error) { toast(error.message) }
  }

  return <>
    <button className={`drawer-backdrop ${open ? 'visible' : ''}`} onClick={onClose} aria-label={tr('Close knowledge library')} />
    <aside className={`knowledge-drawer ${open ? 'open' : ''}`} role="dialog" aria-modal="true" aria-label={tr('Knowledge library')} aria-hidden={!open} inert={open ? undefined : ''}>
      <header className="drawer-header">
        <div><div className="drawer-eyebrow">{tr('PRIVATE WORKSPACE')}</div><h2>{tr('Knowledge library')}</h2><small className="account-email">{user.email}</small></div>
        <button className="icon-button dark-icon" onClick={onClose} title={tr('Close library')} aria-label={tr('Close library')}><X size={18} /></button>
      </header>
      <nav className="drawer-tabs" aria-label={tr('Knowledge library')}>
        <button aria-current={tab === 'documents' ? 'page' : undefined} className={`drawer-tab ${tab === 'documents' ? 'selected' : ''}`} onClick={() => setTab('documents')}><BookOpen size={16} />{tr('Documents')}</button>
        <button aria-current={tab === 'history' ? 'page' : undefined} className={`drawer-tab ${tab === 'history' ? 'selected' : ''}`} onClick={() => setTab('history')}><Clock3 size={16} />{tr('Sessions')}</button>
        <button aria-current={tab === 'tasks' ? 'page' : undefined} className={`drawer-tab ${tab==='tasks'?'selected':''}`} onClick={()=>setTab('tasks')}><ClipboardList size={16}/>{tr('Tasks')}</button>
        {user.isAdmin&&<button aria-current={tab === 'access' ? 'page' : undefined} className={`drawer-tab ${tab==='access'?'selected':''}`} onClick={()=>setTab('access')}><ShieldCheck size={16}/>{tr('Permissions')}</button>}
      </nav>
      <div className="drawer-content">
        {tab==='access'&&user.isAdmin ? <AccessEditor bases={bases} onRefresh={onRefresh} tr={tr} toast={toast}/> : tab==='tasks' ? <TaskCenter documents={documents} user={user} tr={tr} toast={toast} initialTask={initialTask} onTasksChanged={onTasksChanged}/> : tab === 'documents' ? <>
          {!bases.length && <div className="empty-list">{tr(user.isAdmin?'Create a knowledge base in Permissions.':'No knowledge bases assigned. Contact an administrator.')}</div>}
          {target&&<form className="upload-card" onSubmit={upload} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();setFile(e.dataTransfer.files[0]||null)}}>
            <input ref={fileRef} className="sr-only" type="file" accept=".pdf,.docx,.md,.markdown,.txt" onChange={e => setFile(e.target.files?.[0] || null)} />
            <button type="button" className="upload-select" onClick={() => fileRef.current?.click()}>
              <span className="upload-icon"><Upload size={18} /></span>
              <span className="min-w-0 text-left"><strong className="block truncate text-xs">{file?.name || tr('Choose or drop a file')}</strong><small className="mt-1 block text-[10px] text-[#7f887b]">{tr('PDF, DOCX, MD, TXT · max 20 MB')}</small></span>
            </button>
            <label className="mt-3 block text-[10px] text-[#758071]" htmlFor="collection-input">{tr('Knowledge base')}</label>
            <select id="collection-input" value={target} onChange={e=>setCollection(e.target.value)} className="collection-input">{writable.map(base=><option key={base.id}>{base.name}</option>)}</select>
            <button disabled={busy || !file} className="upload-action">{tr(busy ? 'Indexing…' : 'Build index')}<ArrowUpRight size={15} /></button>
          </form>}
          <div className="drawer-section-heading"><h3>{tr('Indexed documents')}</h3><span>{documents.length}</span></div>
          <div className="mt-2">
            {documents.length ? documents.map(doc => <div className="document-row" key={doc.id}>
              <span className="file-type">{doc.name.split('.').pop()?.slice(0, 4).toUpperCase()}</span>
              <span className="min-w-0"><strong className="block truncate text-[11px]">{doc.name}</strong><small className="mt-1 block text-[9px] text-[#818a7e]">{doc.collection} · {doc.chunks} {tr('Content Passages')}</small></span>
              {writable.some(base=>base.name===doc.collection)&&<button onClick={() => remove(doc)} className="delete-button" title={tr('Delete document')} aria-label={`${tr('Delete document')} ${doc.name}`}><Trash2 size={14} /></button>}
            </div>) : <div className="empty-list">{tr('No documents indexed yet.')}</div>}
          </div>
        </> : <div>
          {history.length ? history.map(item => <button className="history-row" key={item.conversation} onClick={() => onOpenConversation(item.conversation)}><MessageCircle size={15} /><span className="truncate">{item.title}</span><ArrowUpRight size={13} /></button>) : <div className="empty-list">{tr('No conversations yet.')}</div>}
        </div>}
      </div>
      <div className="drawer-note"><ShieldCheck size={17} /><span><strong>{tr('Session-scoped workspace')}</strong><small>{tr('DeepSeek receives prompts and retrieved excerpts when enabled.')}</small></span></div>
    </aside>
  </>
}

function activeToolPage() {
  const path = window.location.hash.slice(1)
  return toolLinks.some(([value]) => value === path) ? path : null
}

export default function App() {
  const [page, setPage] = useState(activeToolPage)
  const [answerTarget, setAnswerTarget] = useState(null)
  const [showTranscript, setShowTranscript] = useState(false)
  const [ratingPending, setRatingPending] = useState(null)
  const [language, setLanguage] = useState(() => localStorage.getItem('lumora-language') === 'en' ? 'en' : 'zh')
  const [user, setUser] = useState(null)
  const [llmConfigured, setLlmConfigured] = useState(false)
  const [loading, setLoading] = useState(true)
  const [bases, setBases] = useState([])
  const [activeVideo, setActiveVideo] = useState(0)
  const [transitioning, setTransitioning] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerTab, setDrawerTab] = useState('documents')
  const [drawerTask, setDrawerTask] = useState(null)
  const [taskOverview, setTaskOverview] = useState([])
  const [recentHistory, setRecentHistory] = useState([])
  const [documents, setDocuments] = useState([])
  const [collections, setCollections] = useState([])
  const [stats, setStats] = useState({ documents: 0, chunks: 0, conversations: 0 })
  const [selectedCollection, setSelectedCollection] = useState('all')
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState([])

  useEffect(() => {
    const navigate = () => setPage(activeToolPage())
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (page) window.scrollTo(0, 0)
      else if (answerTarget !== null) document.getElementById(`answer-${answerTarget}`)?.scrollIntoView({ block: 'nearest' })
      else if (window.location.hash === '#workspace') document.getElementById('workspace')?.scrollIntoView()
    })
    return () => cancelAnimationFrame(frame)
  }, [page, answerTarget])
  const [conversation, setConversation] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [evaluation, setEvaluation] = useState(null)
  const [evaluating, setEvaluating] = useState(false)
  const inputRef = useRef(null)
  const toastTimeout = useRef(null)
  const deepMode = activeVideo === 2
  const tr = text => t(text, language)
  const copy = (en, cn) => language === 'zh' ? cn : en
  function toggleLanguage() { setLanguage(current => current === 'zh' ? 'en' : 'zh') }
  useEffect(() => { localStorage.setItem('lumora-language',language); document.documentElement.lang=language==='zh'?'zh-CN':'en' }, [language])

  const toast = useCallback(message => {
    setToastMessage(message)
    clearTimeout(toastTimeout.current)
    toastTimeout.current = setTimeout(() => setToastMessage(''), 2600)
  }, [])

  const refresh = useCallback(async () => {
    const [docs, groups, counts, scopes, history] = await Promise.all([api('/api/documents'), api('/api/collections'), api('/api/stats'), api('/api/knowledge-bases'), api('/api/conversations')])
    setDocuments(docs); setCollections(groups); setStats(counts); setBases(scopes)
    setRecentHistory(history)
    setSelectedCollection(current => groups.some(group=>group.collection===current) ? current : 'all')
  }, [])

  useEffect(() => {
    api('/api/profile').then(profile => {
      setUser(profile.authenticated ? profile.user : null)
      setLlmConfigured(profile.llm)
    }).catch(error=>toast(error.message)).finally(()=>setLoading(false))
  }, [toast])
  useEffect(() => {
    if (!user) return
    refresh().catch(error => toast(error.message))
    let active = true
    api('/api/tasks').then(items => { if (active) setTaskOverview(items) }).catch(error => { if (active) toast(error.message) })
    return () => { active = false }
  }, [user, refresh, toast])

  useEffect(() => {
    function onKey(event) { if (event.key === 'Escape') { setMenuOpen(false); setDrawerOpen(false) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function switchScene(index) {
    if (index === activeVideo || transitioning) return
    setTransitioning(true); setActiveVideo(index)
    window.setTimeout(() => setTransitioning(false), 1000)
  }

  async function ask(event) {
    event?.preventDefault()
    const text = question.trim()
    if (!text || busy || !bases.length) return
    setAnswerTarget(null)
    setShowTranscript(false)
    setBusy(true); setQuestion('')
    setMessages(current => [...current, { role: 'user', content: text }])
    try {
      const result = await api('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: text, collection: selectedCollection, conversation }) })
      setConversation(result.conversation)
      setMessages(current => [...current, { id: result.messageId, role: 'assistant', content: result.answer, sources: result.sources }])
      await refresh()
    } catch (error) { setMessages(current => [...current, { role: 'assistant', content: error.message, sources: [] }]) }
    finally { setBusy(false); inputRef.current?.focus() }
  }

  async function runEvaluation() {
    if (evaluating) return
    setMenuOpen(false)
    setEvaluating(true)
    document.getElementById('workspace-evaluation')?.scrollIntoView()
    try { const result = await api('/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); setEvaluation(result) }
    catch (error) { toast(error.message) }
    finally { setEvaluating(false) }
  }

  function newConversation() { setMessages([]); setConversation(null); setQuestion(''); setMenuOpen(false); setShowTranscript(false); setAnswerTarget(null); inputRef.current?.focus() }

  async function rateAnswer(id, rating, note) {
    const saved = await api(`/api/answers/${id}/feedback`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating, note }) })
    setMessages(current => current.map(message => message.id === id ? { ...message, ...saved } : message))
    return saved
  }

  async function rateFromChat(id, rating) {
    setRatingPending(id)
    try { await rateAnswer(id, rating) }
    catch (error) { toast(tr(error.message)) }
    finally { setRatingPending(null) }
  }

  function openDrawer(tab, task = null) {
    setDrawerTask(task)
    setDrawerTab(tab)
    setDrawerOpen(true)
    setMenuOpen(false)
  }

  function askInBase(name) {
    if (busy) return
    newConversation()
    setSelectedCollection(name)
  }

  async function openConversation(id, target = null) {
    if (busy) return
    try {
      const history = await api(`/api/conversations/${id}`)
      setConversation(id)
      setSelectedCollection(history.find(message => message.role === 'assistant' && message.sources?.length)?.sources[0]?.collection
        ?? recentHistory.find(item => item.conversation === id)?.collection ?? 'all')
      setMessages(history)
      setShowTranscript(true)
      setAnswerTarget(target)
      setDrawerOpen(false)
      if (page) window.location.hash = 'home'
      document.getElementById('home')?.scrollIntoView()
    } catch (error) { toast(error.message) }
  }

  async function logout() {
    try {
      await api('/api/auth/logout',{method:'POST'})
      setUser(null);setDrawerOpen(false);setBases([]);setCollections([]);setDocuments([]);setRecentHistory([]);setTaskOverview([]);setEvaluation(null);setStats({documents:0,chunks:0,conversations:0});newConversation()
    } catch(error) { toast(error.message) }
  }

  if (loading) return <main className="auth-screen" aria-busy="true"><div className="auth-top"><span className="wordmark">Lumora</span></div></main>
  if (!user) return <><AuthGate language={language} onLanguage={toggleLanguage} onAuthenticated={data=>setUser(data.user)} toast={toast}/>{toastMessage&&<div className="toast-message" role="status">{toastMessage}</div>}</>

  return <main className="lumora-page">
    {page ? <RagPages page={page} api={api} bases={bases} history={recentHistory} tr={tr} language={language} onLanguage={toggleLanguage} onLogout={logout} onOpen={openConversation} onRate={rateAnswer} busy={busy || evaluating}/> : <>
    <div className={`hero-shell ${deepMode ? 'deep-mode' : ''} ${messages.length?'has-answer':''}`}>
    <div className="scene-fallback" />
    <SceneVideos active={activeVideo} />
    <div className="cinema-shade" aria-hidden="true" />
    <img className="train-overlay" src="https://soft-zoom-63098134.figma.site/_assets/v11/0b4a435b2df2747593c43d7a1c9b4578f7d8d90c.png" alt="" onError={event => { event.currentTarget.style.display = 'none' }} />

    <header className="hero-nav">
      <a href="#home" className="wordmark">Lumora</a>
      <div className="nav-actions">
      <nav className="desktop-nav liquid-glass" aria-label={copy('Main navigation','主导航')}>
        <button onClick={newConversation} disabled={busy}>{tr('New conversation')}</button>
        <button onClick={() => openDrawer('documents')}>{tr('Knowledge Base')}</button>
        <button onClick={runEvaluation}>{tr('Evaluation')}</button>
        <button onClick={() => { window.location.hash = '/retrieval' }}>{tr('Retrieval lab')}</button>
        <button className="nav-cta" onClick={() => inputRef.current?.focus()}>{tr('Ask Lumora')} <ArrowUpRight size={14} /></button>
      </nav>
      <button className="language-toggle liquid-glass" onClick={toggleLanguage} title={copy('Switch to Chinese','切换到英文')}><Languages size={15}/>{language==='zh'?'EN':'中文'}</button>
      <button className="icon-button logout-button" disabled={busy || evaluating} onClick={logout} title={tr('Sign out')} aria-label={tr('Sign out')}><LogOut size={16}/></button>
      <button className="mobile-menu-button liquid-glass" onClick={() => setMenuOpen(value => !value)} aria-label={menuOpen ? copy('Close menu','关闭菜单') : copy('Open menu','打开菜单')}>
        <Menu className={`menu-icon ${menuOpen ? 'icon-out' : 'icon-in'}`} size={19} />
        <X className={`menu-icon x-icon ${menuOpen ? 'icon-in' : 'icon-out'}`} size={19} />
      </button>
      </div>
    </header>

    <div className={`mobile-menu-overlay ${menuOpen ? 'menu-visible' : ''}`} aria-hidden={!menuOpen}>
      <nav className="mobile-menu-links">
        {[['New conversation', newConversation], ['Knowledge Base', () => openDrawer('documents')], ...toolLinks.map(([path, label]) => [label, () => { window.location.hash = path }])].map(([label, action], index) => <button key={label} disabled={label==='New conversation'&&busy} onClick={() => { action(); setMenuOpen(false) }} style={{ '--stagger': `${100 + index * 50}ms` }}>{tr(label)}<ArrowUpRight size={20} /></button>)}
        <button className="mobile-cta" onClick={() => { setMenuOpen(false); inputRef.current?.focus() }}>{tr('Ask Lumora')} <ArrowUpRight size={17} /></button>
      </nav>
    </div>

    <section id="home" className={`hero-content ${deepMode ? 'dark-content' : ''}`}>
      <div className="hero-inner">
        <div className="hero-badge liquid-glass"><span className="badge-spark"><Sparkles size={13} /></span><span>{tr('Private knowledge · Clear answers')}</span></div>
        <h1>{tr('Clarity in an Endlessly')}<br /><em>{tr('Noisy Universe')}</em></h1>
        <p className="hero-subtext">{tr('Ask across your private documents. Get grounded answers with the original source passages in view.')}</p>
        <form className="ask-form liquid-glass" onSubmit={ask}>
          <Search className="search-icon" size={17} />
          <textarea ref={inputRef} value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); ask(event) } }} rows={1} aria-label={tr('Ask your knowledge base…')} placeholder={tr('Ask your knowledge base…')} />
          <div className="ask-controls">
            <label className="sr-only" htmlFor="collection-select">{tr('Search scope')}</label>
            <select id="collection-select" disabled={busy} value={selectedCollection} onChange={event => {newConversation();setSelectedCollection(event.target.value)}} title={tr('Search scope')}>
              <option value="all">{tr('All sources')}</option>{collections.map(item => <option key={item.collection} value={item.collection}>{item.collection}</option>)}
            </select><ChevronDown className="select-chevron" size={12} />
          </div>
          <button type="submit" className="ask-submit" disabled={busy || !question.trim() || !bases.length} aria-label={tr('Ask Lumora')} title={tr('Ask Lumora')}>{busy ? <span className="loader-dot" /> : <Send size={16} />}</button>
        </form>

        {messages.length > 0 && <div className="answer-panel liquid-glass" aria-live="polite">
          {(showTranscript ? messages : messages.slice(-2)).map((message, index) => <div key={message.id ?? `${message.role}-${messages.length}-${index}`} id={message.id ? `answer-${message.id}` : undefined} className="answer-message">
            {message.role === 'assistant' && <div className="answer-label"><Sparkles size={13} />{copy('LUMORA ANSWER','LUMORA 回答')}</div>}
            <p className={message.role === 'user' ? 'answer-question' : 'answer-text'}>{message.content}</p>
            {message.role === 'assistant' && <SourceList sources={message.sources} tr={tr} />}
            {message.role === 'assistant' && message.id && <div className="answer-feedback-actions"><RatingButtons rating={message.rating} onRate={rating => rateFromChat(message.id, rating)} disabled={ratingPending !== null} tr={tr}/>{message.rating && <a href="#/review">{tr('Answer review')}<ArrowUpRight size={14}/></a>}</div>}
          </div>)}
        </div>}

        <div className="hero-capabilities">
          <span>{llmConfigured ? <Sparkles size={13} /> : <Search size={13} />}{llmConfigured ? 'DeepSeek' : tr('Local retrieval')}</span><i />
          <button onClick={() => openDrawer('documents')}><BookOpen size={13} /> {stats.documents} {tr('sources')}</button><i />
          <span><ShieldCheck size={13} />{tr('Session isolated')}</span>
        </div>
      </div>
      <div className="video-switcher" aria-label={copy('Choose background scene','选择背景场景')}>
        {scenes.map((scene, index) => <button key={scene.label} className={activeVideo === index ? 'selected' : ''} onClick={() => switchScene(index)} disabled={transitioning && activeVideo !== index}>
          <span>{tr(scene.label)}</span><i />
        </button>)}
      </div>
    </section>

    <div className="hero-workbench-link">
      <a href="#workspace" className="liquid-glass"><span>{tr('Workspace')}</span><ArrowDown size={15}/></a>
    </div>
    </div>

    <Workspace api={api} documents={documents} bases={bases} stats={stats} tasks={taskOverview} history={recentHistory} evaluation={evaluation} tr={tr} busy={busy} onAsk={askInBase} onHistory={openConversation} onDrawer={openDrawer} onEvaluate={runEvaluation} evaluating={evaluating}/>
    </>}
    <KnowledgeDrawer open={drawerOpen} tab={drawerTab} setTab={tab => { setDrawerTask(null); setDrawerTab(tab) }} initialTask={drawerTask} onTasksChanged={setTaskOverview} onClose={() => { setDrawerOpen(false); setDrawerTask(null) }} documents={documents} bases={bases} user={user} tr={tr} onRefresh={refresh} onOpenConversation={openConversation} toast={toast} />
    {toastMessage && <div className="toast-message" role="status">{toastMessage}</div>}
  </main>
}
