import { useEffect, useState } from 'react'
import { ArrowDownToLine, ArrowLeft, ArrowUpRight, Check, ClipboardCheck, Download, FileUp, History, Languages, LogOut, Plus, Search, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react'

export const toolLinks = [
  ['/retrieval', 'Retrieval lab', Search], ['/evaluation', 'Evaluation set', ClipboardCheck], ['/review', 'Answer review', ClipboardCheck], ['/history', 'Conversation archive', History],
]

const ratings = [['helpful', 'Helpful', ThumbsUp], ['needs_work', 'Needs improvement', ThumbsDown]]

export function RatingButtons({ rating, onRate, disabled, tr }) {
  return <div className="rating-buttons" role="group" aria-label={tr('Rate this answer')}>
    {ratings.map(([value, label, Icon]) => <button type="button" key={value} disabled={disabled}
      title={tr(label)} aria-label={tr(label)} aria-pressed={rating === value}
      onClick={() => onRate(rating === value ? null : value)}><Icon size={15}/></button>)}
  </div>
}

function Retrieval({ api, bases, tr }) {
  const [question, setQuestion] = useState('')
  const [collection, setCollection] = useState('all')
  const [limit, setLimit] = useState('5')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(event) {
    event.preventDefault()
    setBusy(true); setError(''); setResult(null)
    try {
      const found = await api('/api/retrieval/test', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, collection, limit: Number(limit) }) })
      setResult({ ...found, question })
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  return <>
    <form className="tool-retrieval-form" onSubmit={run}>
      <label className="tool-question">{tr('Query')}<textarea required maxLength={2000} rows={3} value={question} onChange={event => setQuestion(event.target.value)}/></label>
      <label>{tr('Search scope')}<select value={collection} onChange={event => setCollection(event.target.value)}><option value="all">{tr('All sources')}</option>{bases.map(base => <option key={base.id} value={base.name}>{base.name}</option>)}</select></label>
      <label>Top K<input type="number" required min="1" max="20" value={limit} onChange={event => setLimit(event.target.value)}/></label>
      <button className="tool-action" disabled={busy || !question.trim() || !bases.length}><Search size={16}/>{tr(busy ? 'Searching' : 'Run retrieval')}</button>
    </form>
    {!bases.length && <p className="tool-muted">{tr('No knowledge bases assigned. Contact an administrator.')}</p>}
    {error && <p className="tool-error" role="alert">{error}</p>}
    {result && <section className="tool-results" aria-live="polite">
      <div className="tool-result-heading"><h2>{tr('Retrieved passages')} <small>{result.sources.length}</small></h2><span>{tr(result.reranked ? 'Reranked' : 'Hybrid retrieval')} · {result.elapsedMs} ms</span></div>
      <p className="tool-muted tool-text">{result.question}</p>
      {!result.sources.length && <p className="tool-muted">{tr('No indexed passages')}</p>}
      {result.sources.map((source, index) => <details key={source.id} className="tool-hit" open={index === 0}>
        <summary><span className="tool-hit-rank">#{index + 1}</span><span className="tool-hit-name"><strong>{source.document}</strong><small>{source.collection}{source.page ? ` · ${tr('Page')} ${source.page}` : ''}</small></span><span className="tool-score">{tr('Score')} {source.score.toFixed(3)}</span></summary>
        <p className="tool-text">{source.content}</p>
      </details>)}
    </section>}
  </>
}

function ReviewRecord({ record, onSave, onOpen, tr, busy }) {
  const [note, setNote] = useState(record.note)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function save(rating, editedNote) {
    setSaving(true); setError('')
    try { await onSave(record.id, rating, editedNote) }
    catch (failure) { setError(failure.message) }
    finally { setSaving(false) }
  }
  return <article className="tool-record">
    <div className="tool-record-heading"><time dateTime={record.updated}>{new Date(record.updated).toLocaleString()}</time><RatingButtons rating={record.rating} onRate={value => save(value)} disabled={saving} tr={tr}/></div>
    <p className="tool-text">{record.excerpt}{record.excerpt.length === 360 ? '\u2026' : ''}</p>
    <form className="tool-note" onSubmit={event => { event.preventDefault(); save(record.rating, note) }}>
      <label>{tr('Review note')}<textarea maxLength={500} rows={2} value={note} onChange={event => setNote(event.target.value)}/></label>
      <div className="tool-record-footer"><button type="submit" className="tool-action" disabled={saving || note === record.note}>{tr('Save note')}</button>
        <button className="tool-link" type="button" disabled={busy} onClick={() => onOpen(record.conversation, record.id)}>{tr('View answer')}<ArrowUpRight size={15}/></button></div>
    </form>
    {error && <p role="alert" className="tool-error">{error}</p>}
  </article>
}

function Review({ api, tr, onOpen, onRate, busy }) {
  const [records, setRecords] = useState(null)
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')
  const [request, setRequest] = useState(0)
  useEffect(() => {
    let current = true
    api('/api/answer-feedback').then(rows => { if (current) setRecords(rows) })
      .catch(failure => { if (current) setError(failure.message) })
    return () => { current = false }
  }, [api, request])
  async function save(id, rating, note) {
    const update = await onRate(id, rating, note)
    setRecords(rows => rows.map(row => row.id === id ? { ...row, ...update } : row).filter(row => row.rating))
  }
  const filtered = records?.filter(record => filter === 'all' || record.rating === filter)
  return <>
    <div className="tool-toolbar"><label>{tr('Rating')}<select value={filter} onChange={event => setFilter(event.target.value)}>
      <option value="all">{tr('All ratings')}</option>{ratings.map(([value, label]) => <option key={value} value={value}>{tr(label)}</option>)}
    </select></label><span className="tool-muted">{filtered?.length ?? 0} {tr('Feedback records')}</span></div>
    {error && <p role="alert" className="tool-error">{error} <button className="tool-link" onClick={() => { setError(''); setRequest(current => current + 1) }}>{tr('Retry')}</button></p>}
    {!records && !error && <p className="tool-muted" role="status">{tr('Loading')}</p>}
    {filtered?.length === 0 && <p className="tool-muted">{tr('No matching feedback')}</p>}
    {filtered?.map(record => <ReviewRecord key={record.id} record={record} onSave={save} onOpen={onOpen} tr={tr} busy={busy}/>)}
  </>
}

function Archive({ api, history, onOpen, tr, busy }) {
  const [query, setQuery] = useState('')
  const [exporting, setExporting] = useState(null)
  const [error, setError] = useState('')
  const filtered = history.filter(row => row.title.toLowerCase().includes(query.trim().toLowerCase()))
  async function exportConversation(row) {
    setExporting(row.conversation); setError('')
    try {
      const messages = await api(`/api/conversations/${row.conversation}`)
      const lines = [`# ${row.title}`, '', `${tr('Updated')} ${row.updated.replace('T', ' ')}`, '']
      for (const message of messages) {
        if (message.role === 'user') {
          lines.push(`## ${tr('Question')}`, '', message.content, '')
          continue
        }
        if (message.role !== 'assistant') continue
        lines.push(`## ${tr('Answer')}`, '', message.content, '')
        if (message.sources?.length) {
          lines.push(`### ${tr('Citations')}`, '')
          for (const [index, source] of message.sources.entries()) {
            const page = source.page ? `, ${tr('Page')} ${source.page}` : ''
            lines.push(`${index + 1}. **${source.document}** (${source.collection}${page}; ${tr('Score')} ${Number(source.score).toFixed(3)})`, '', source.content, '')
          }
        }
        if (message.rating) lines.push(`> ${tr(message.rating === 'helpful' ? 'Helpful' : 'Needs improvement')}${message.note ? `: ${message.note}` : ''}`, '')
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      const safeTitle = row.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 80) || 'conversation'
      anchor.download = `${safeTitle}.md`
      document.body.append(anchor); anchor.click(); anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (failure) { setError(failure.message) }
    finally { setExporting(null) }
  }
  return <>
    <div className="tool-toolbar"><label>{tr('Search conversation titles')}<input type="search" value={query} onChange={event => setQuery(event.target.value)}/></label></div>
    {error && <p className="tool-error" role="alert">{error}</p>}
    {!filtered.length && <p className="tool-muted">{tr('No matching conversations')}</p>}
    {filtered.map(row => <div className="tool-archive-row" key={row.conversation}>
      <History size={17}/><button className="tool-archive-open" disabled={busy} onClick={() => onOpen(row.conversation)}>{row.title}<small>{row.updated.replace('T', ' ')}</small></button>
      <button className="tool-archive-export" disabled={busy || exporting === row.conversation} onClick={() => exportConversation(row)} title={tr('Export conversation')} aria-label={`${tr('Export conversation')}: ${row.title}`}><Download size={17}/></button>
    </div>)}
  </>
}

function EvaluationSet({ api, bases, tr }) {
  const [cases, setCases] = useState(null)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    api('/api/evaluation-cases').then(rows => { if (active) setCases(rows) })
      .catch(failure => { if (active) setError(failure.message) })
    return () => { active = false }
  }, [api])
  function edit(index, field, value) {
    setCases(current => current.map((item, i) => i === index ? { ...item, [field]: value } : item))
    setNotice(''); setResult(null)
  }
  async function saveCases(next = cases) {
    setBusy(true); setError(''); setNotice('')
    try {
      const saved = await api('/api/evaluation-cases', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cases: next.map(({ question, expected, collection }) => ({ question, expected, collection })) }) })
      setCases(saved); setNotice(tr('Evaluation set saved'))
      return saved
    } catch (failure) { setError(failure.message); return null }
    finally { setBusy(false) }
  }
  async function run() {
    setBusy(true); setError(''); setNotice('')
    try {
      const saved = await api('/api/evaluation-cases', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cases: cases.map(({ question, expected, collection }) => ({ question, expected, collection })) }) })
      setCases(saved)
      const evaluated = await api('/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cases: saved }) })
      setResult(evaluated)
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  function exportCases() {
    const blob = new Blob([JSON.stringify(cases.map(({ question, expected, collection }) => ({ question, expected, collection })), null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob); const link = document.createElement('a')
    link.href = url; link.download = 'lumora-evaluation-set.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function importCases(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true); setError(''); setNotice('')
    try {
      const parsed = JSON.parse(await file.text())
      const imported = Array.isArray(parsed) ? parsed : parsed.cases
      if (!Array.isArray(imported) || !imported.length || imported.length > 100 || imported.some(item => !item || typeof item.question !== 'string' || typeof item.expected !== 'string' || (item.collection != null && typeof item.collection !== 'string'))) throw new Error(tr('Invalid evaluation JSON'))
      const saved = await api('/api/evaluation-cases', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cases: imported.map(item => ({ question: item.question, expected: item.expected, collection: item.collection || 'all' })) }) })
      setCases(saved); setResult(null); setNotice(tr('Evaluation set imported'))
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  if (!cases) return <p className="tool-muted" role="status">{error || tr('Loading')}</p>
  return <>
    <div className="eval-set-toolbar"><span className="tool-muted">{cases.length} / 100 {tr('evaluation cases')}</span>
      <div><label className="tool-action eval-file-button"><FileUp size={16}/>{tr('Import JSON')}<input type="file" accept="application/json,.json" onChange={importCases}/></label>
      <button className="tool-action" disabled={busy || !cases.length} onClick={exportCases}><ArrowDownToLine size={16}/>{tr('Export JSON')}</button>
      <button className="tool-action" disabled={busy || !cases.length} onClick={() => saveCases()}><Check size={16}/>{tr('Save set')}</button>
      <button className="tool-action eval-run-button" disabled={busy || !cases.length} onClick={run}><Search size={16}/>{tr(busy ? 'Evaluating' : 'Run evaluation')}</button></div>
    </div>
    {notice && <p className="tool-success" role="status">{notice}</p>}{error && <p className="tool-error" role="alert">{error}</p>}
    <div className="eval-case-list">{cases.map((item,index) => <article className="eval-case" key={item.id ?? index}>
      <div className="eval-case-heading"><strong>{tr('Test case')} {index+1}</strong><button className="eval-icon-button" aria-label={tr('Remove case')} title={tr('Remove case')} disabled={busy || cases.length === 1} onClick={() => { setCases(current => current.filter((_,i) => i !== index)); setNotice(''); setResult(null) }}><Trash2 size={16}/></button></div>
      <label>{tr('Question')}<textarea rows={2} maxLength={2000} value={item.question} onChange={event => edit(index,'question',event.target.value)}/></label>
      <label>{tr('Expected passage')}<textarea rows={2} maxLength={2000} value={item.expected} onChange={event => edit(index,'expected',event.target.value)}/></label>
      <label>{tr('Search scope')}<select value={item.collection || 'all'} onChange={event => edit(index,'collection',event.target.value)}><option value="all">{tr('All sources')}</option>{bases.map(base => <option key={base.id} value={base.name}>{base.name}</option>)}</select></label>
    </article>)}</div>
    <button className="tool-link eval-add-button" disabled={busy || cases.length >= 100} onClick={() => { setCases(current => [...current,{question:'',expected:'',collection:'all'}]); setResult(null); setNotice('') }}><Plus size={16}/>{tr('Add case')}</button>
    {result && <section className="tool-results" aria-live="polite"><div className="tool-result-heading"><h2>{tr('Evaluation results')}</h2><span>{result.total} {tr('test queries')} · {Math.round(result.hit_rate*100)}%</span></div>
      {result.results.map((item,index) => <details className="tool-hit" key={`${index}-${item.question}`}><summary><span className="tool-hit-rank">{item.matched ? '✓' : '×'}</span><span className="tool-hit-name"><strong>{item.question}</strong><small>{tr(item.matched ? 'Matched' : 'Missed')} · {tr('Score')} {Number(item.top_score).toFixed(3)}</small></span><span className="tool-score">{item.sources.length} {tr('sources')}</span></summary>
        <p className="tool-muted">{tr('Expected passage')}: {item.expected}</p>{item.sources.map(source => <p className="tool-text" key={source.id}><strong>{source.document}{source.page ? ` · ${tr('Page')} ${source.page}` : ''}</strong><br/>{source.content}</p>)}
      </details>)}
    </section>}
  </>
}

export default function RagPages({ page, api, bases, history, tr, language, onLanguage, onLogout, onOpen, onRate, busy }) {
  const title = toolLinks.find(([path]) => path === page)[1]
  return <div className="rag-pages">
    <header className="tool-header"><div>
      <a href="#home" className="wordmark">Lumora</a>
      <div className="tool-header-actions"><button className="tool-link" onClick={onLanguage} aria-label={language === 'zh' ? 'Switch to English' : '\u5207\u6362\u5230\u4e2d\u6587'}><Languages size={16}/>{language === 'zh' ? 'EN' : '\u4e2d\u6587'}</button>
        <button className="tool-link" disabled={busy} onClick={onLogout} aria-label={tr('Sign out')} title={tr('Sign out')}><LogOut size={17}/></button></div>
    </div></header>
    <div className="tool-layout">
      <nav className="tool-nav" aria-label={tr('Workspace')}>
        <a href="#workspace"><ArrowLeft size={17}/>{tr('Workspace')}</a>
        {toolLinks.map(([path, label, Icon]) => <a key={path} href={`#${path}`} aria-current={page === path ? 'page' : undefined}><Icon size={17}/>{tr(label)}</a>)}
      </nav>
      <section className="tool-content" aria-labelledby="tool-title">
        <h1 id="tool-title">{tr(title)}</h1>
        {page === '/retrieval' && <Retrieval api={api} bases={bases} tr={tr}/>}
        {page === '/evaluation' && <EvaluationSet api={api} bases={bases} tr={tr}/>}
        {page === '/review' && <Review api={api} tr={tr} onOpen={onOpen} onRate={onRate} busy={busy}/>}
        {page === '/history' && <Archive api={api} history={history} tr={tr} onOpen={onOpen} busy={busy}/>}
      </section>
    </div>
  </div>
}
