import { useEffect, useRef, useState } from 'react'
import { toolLinks } from './RagPages'
import { ArrowDown, ArrowUpRight, BookOpen, ClipboardList, Clock3, FileText, Search, X } from 'lucide-react'

const taskStatus = { assigned: 'Task assigned', submitted: 'Awaiting review', changes_requested: 'Changes requested' }

export default function Workspace({ api, documents, bases, stats, tasks, history, evaluation, tr, busy, onAsk, onHistory, onDrawer, onEvaluate, evaluating }) {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('')
  const [shown, setShown] = useState(8)
  const [preview, setPreview] = useState(null)
  const dialog = useRef(null)
  const requestId = useRef(0)
  const selectedScope = bases.some(base => base.name === scope) ? scope : ''
  const matches = documents.filter(doc => (!selectedScope || selectedScope === doc.collection) && doc.name.toLowerCase().includes(query.trim().toLowerCase()))
  const pending = tasks.filter(task => task.status !== 'completed')
  const previewDocument = preview && documents.find(doc => doc.id === preview.id)

  useEffect(() => {
    if (previewDocument && !dialog.current.open) dialog.current.showModal()
    if (!previewDocument && dialog.current.open) dialog.current.close()
  }, [previewDocument])

  async function previewPage(id, offset = 0) {
    const ticket = ++requestId.current
    setPreview(current => offset ? { ...current, loading: true, error: '' } : { id, loading: true, passages: [] })
    try {
      const result = await api(`/api/documents/${encodeURIComponent(id)}/passages?offset=${offset}`)
      if (ticket === requestId.current) setPreview(current => ({ id, passages: [...current.passages, ...result.passages], next: result.nextOffset }))
    } catch (error) {
      if (ticket === requestId.current) setPreview(current => ({ ...current, loading: false, error: error.message }))
    }
  }

  return <section className="workbench" id="workspace" aria-labelledby="workspace-title">
    <div className="workbench-inner">
      <header className="workbench-heading">
        <h2 id="workspace-title">{tr('Workspace')}</h2>
        <nav aria-label={tr('Workspace')}>
          <a href="#workspace-documents">{tr('Documents')}</a>
          <a href="#workspace-activity">{tr('Recent activity')}</a>
          <a href="#workspace-evaluation">{tr('Evaluation')}</a>
          {toolLinks.map(([path, label, Icon]) => <a key={path} href={`#${path}`}><Icon size={15}/>{tr(label)}</a>)}
        </nav>
      </header>
      <dl className="workbench-metrics">
        {[[tr('Documents'), stats.documents], [tr('Content Passages'), stats.chunks], [tr('Sessions'), history.length], [tr('Open tasks'), pending.length]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>

      <section className="workbench-section" id="workspace-documents">
        <div className="workbench-section-title"><h3><BookOpen size={19}/>{tr('Indexed documents')}</h3><button onClick={() => onDrawer('documents')}>{tr('Knowledge library')}<ArrowUpRight size={16}/></button></div>
        <div className="workbench-filters">
          <label><Search size={16}/><input aria-label={tr('Search documents')} placeholder={tr('Search documents')} value={query} onChange={event => { setQuery(event.target.value); setShown(8) }}/></label>
          <select aria-label={tr('Knowledge base')} value={selectedScope} onChange={event => { setScope(event.target.value); setShown(8) }}><option value="">{tr('All sources')}</option>{bases.map(base => <option key={base.id}>{base.name}</option>)}</select>
        </div>
        {matches.slice(0, shown).map(doc => <div className="workbench-row" key={doc.id}>
          <button className="workbench-item" onClick={() => previewPage(doc.id)}><FileText size={18}/><span><strong>{doc.name}</strong><small>{doc.collection} · {doc.chunks} {tr('Content Passages')}</small></span></button>
          <button className="workbench-action" disabled={busy} onClick={() => onAsk(doc.collection)}>{tr('Ask this base')}<ArrowUpRight size={15}/></button>
        </div>)}
        {!matches.length && <p className="workbench-empty">{tr(documents.length ? 'No matching documents' : 'No documents indexed yet.')}</p>}
        {shown < matches.length && <button className="workbench-more" onClick={() => setShown(value => value + 8)}>{tr('Show more')}<ArrowDown size={15}/></button>}
      </section>

      <section className="workbench-section workbench-activity" id="workspace-activity" aria-label={tr('Recent activity')}>
        <div><div className="workbench-section-title"><h3><Clock3 size={19}/>{tr('Recent conversations')}</h3><button onClick={() => onDrawer('history')}>{tr('All')}<ArrowUpRight size={16}/></button></div>
          {history.slice(0, 5).map(item => <button className="workbench-activity-row" key={item.conversation} disabled={busy} onClick={() => onHistory(item.conversation)}><span>{item.title}</span><ArrowUpRight size={15}/></button>)}
          {!history.length && <p className="workbench-empty">{tr('No conversations yet.')}</p>}
        </div>
        <div><div className="workbench-section-title"><h3><ClipboardList size={19}/>{tr('Open tasks')}</h3><button onClick={() => onDrawer('tasks')}>{tr('All')}<ArrowUpRight size={16}/></button></div>
          {pending.slice(0, 5).map(task => <button className="workbench-activity-row" key={task.id} onClick={() => onDrawer('tasks', task)}><span>{task.title}</span><small>{tr(taskStatus[task.status])}</small></button>)}
          {!pending.length && <p className="workbench-empty">{tr('No open tasks')}</p>}
        </div>
      </section>

      <section className="workbench-section" id="workspace-evaluation">
        <div className="workbench-section-title"><h3><Search size={19}/>{tr('Retrieval evaluation')}</h3><button disabled={evaluating} onClick={onEvaluate}>{tr(evaluating ? 'Evaluating' : 'Run evaluation')}<ArrowUpRight size={16}/></button></div>
        {evaluation ? <><p className="workbench-empty">{evaluation.total} {tr('test queries')} · {Math.round(evaluation.hit_rate * 100)}% {tr('matched a supporting passage')}</p>
          {evaluation.results.map((result, index) => <details className="workbench-result" key={index}><summary><span>{result.question}</span><small>{tr(result.matched ? 'Matched' : 'Missed')}</small></summary>
            {result.expected && <p>{tr('Expected passage')} · {result.expected}</p>}
            {result.sources.map(source => <blockquote key={source.id}><strong>{source.document}{source.page ? ` · ${tr('Page')} ${source.page}` : ''}</strong><p>{source.content}</p></blockquote>)}
          </details>)}
        </> : <p className="workbench-empty">{tr('No evaluation results yet')}</p>}
      </section>
    </div>
    <dialog ref={dialog} className="document-preview" onClose={() => { ++requestId.current; setPreview(null) }} aria-labelledby="preview-title">
      {previewDocument && <>
        <header><h3 id="preview-title">{previewDocument.name}</h3><button onClick={() => dialog.current.close()} aria-label={tr('Close preview')} title={tr('Close preview')}><X size={20}/></button></header>
        <div className="preview-passages" tabIndex={0} aria-label={tr('Document passages')}>
          {preview.passages.map((item, index) => <article key={item.id}><strong>{item.page ? `${tr('Page')} ${item.page} · ` : ''}{tr('Passage')} {index + 1}</strong><p>{item.content}</p></article>)}
          {preview.error && <p role="alert">{tr(preview.error)}</p>}
          {preview.loading && <p role="status">{tr('Loading')}</p>}
          {!preview.loading && !preview.error && !preview.passages.length && <p>{tr('No indexed passages')}</p>}
        </div>
        {preview.next != null && <button className="workbench-more" disabled={preview.loading} onClick={() => previewPage(preview.id, preview.next)}>{tr('Show more')}<ArrowDown size={15}/></button>}
      </>}
    </dialog>
  </section>
}
