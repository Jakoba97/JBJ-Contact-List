function $(id){return document.getElementById(id)}

function setProgress(p, label){
  const bar = $('progressBar')
  if(bar){
    bar.style.width = `${p}%`
    bar.setAttribute('aria-valuenow', p)
    const wrap = bar.closest('.progress-wrap')
    if(wrap) wrap.style.display = 'block'
    const lbl = wrap && wrap.querySelector('.progress-label')
    if(lbl) lbl.textContent = label || ''
  }
}

function summaryPhrase(label, result){
  if(!result) return ''
  const parts = []
  if(result.inserted) parts.push(`${result.inserted} new ${label}${result.inserted===1?'':'s'}`)
  if(result.updated) parts.push(`${result.updated} ${label}${result.updated===1?'':'s'} updated`)
  if(!parts.length) return `No ${label} changes`
  return parts.join(', ')
}

function showSummary(obj){
  const s = $('importSummary')
  if(s) s.style.display = ''
  const lines = [summaryPhrase('contact', obj.contacts), summaryPhrase('organization', obj.organizations)]
    .filter(Boolean)
  const archived = obj.contacts && obj.contacts.archived ? ` · ${obj.contacts.archived} marked Inactive` : ''
  s.innerHTML = `<p><i class="fas fa-circle-check"></i> Synced from spreadsheet - ${lines.join(' · ')}${archived}</p>`
  // Group / organization results. Names come from user input, so use textContent.
  const t = obj.targets || {}
  const extra = []
  if(t.group) extra.push(`${t.group.added} added to ${t.group_created ? 'new ' : ''}group "${t.group.name}"`)
  if(t.organization) extra.push(`${t.organization.total} set to ${t.organization_created ? 'new ' : ''}organization "${t.organization.name}"`)
  const skipped = obj.contacts && obj.contacts.not_in_crm
  if(skipped) extra.push(`${skipped} not in the CRM, skipped`)
  extra.forEach(line=>{
    const p = document.createElement('p')
    p.textContent = line
    s.appendChild(p)
  })
  fetch('/api/categories').then(r=>r.json()).then(cat=>{
    const list = cat.map(c=>`<div>${c.tag||'<none>'}: ${c.count}</div>`).join('')
    s.innerHTML += `<h4>Category breakdown</h4>${list}`
  })
}

function pollTaskStatus(task_id){
  return new Promise((resolve, reject)=>{
    const interval = setInterval(()=>{
      fetch(`/api/upload/status/${task_id}`)
        .then(r=>r.json())
        .then(task=>{
          if(task.status === 'running'){
            setProgress(task.progress, `Processing… ${task.progress}%`)
          } else if(task.status === 'done'){
            clearInterval(interval)
            setProgress(100, 'Complete!')
            resolve(task.result)
          } else if(task.status === 'error'){
            clearInterval(interval)
            reject(task.error || 'Import failed')
          }
        })
        .catch(err=>{ clearInterval(interval); reject(err) })
    }, 800)
  })
}

function doUpload(file, archiveMissing, targets){
  return new Promise((resolve, reject)=>{
    const xhr = new XMLHttpRequest()
    const fd = new FormData()
    fd.append('file', file)
    if(archiveMissing) fd.append('archive_missing', '1')
    Object.entries(targets || {}).forEach(([k, v])=> fd.append(k, v))
    xhr.open('POST', '/api/upload')
    xhr.upload.addEventListener('progress', (e)=>{
      if(e.lengthComputable){
        const p = Math.round((e.loaded / e.total) * 15)
        setProgress(p, `Uploading… ${p}%`)
      }
    })
    xhr.onreadystatechange = ()=>{
      if(xhr.readyState === 4){
        if(xhr.status >= 200 && xhr.status < 300){
          const resp = JSON.parse(xhr.responseText)
          if(resp.task_id){
            setProgress(15, 'Processing…')
            pollTaskStatus(resp.task_id).then(resolve).catch(reject)
          } else {
            resolve(resp)
          }
        } else {
          reject(xhr.responseText)
        }
      }
    }
    xhr.send(fd)
  })
}

// ── Preview modal ─────────────────────────────────────────────────────── //

let _pendingFile = null
let _pendingArchive = false

function showPreviewModal(data, file, archiveMissing){
  _pendingFile = file
  _pendingArchive = archiveMissing

  const newList = (data.new || []).slice(0, 10).map(c =>
    `<li>${c.name}${c.organization ? ` · ${c.organization}` : ''}${c.tag ? ` <em>${c.tag}</em>` : ''}</li>`
  ).join('')
  const updList = (data.updated || []).slice(0, 10).map(c => {
    const fields = Object.keys(c.changes).join(', ')
    return `<li>${c.name} — <span style="color:#888">${fields}</span></li>`
  }).join('')
  const moreNew = data.new_count > 10 ? `<li style="color:#888">…and ${data.new_count - 10} more</li>` : ''
  const moreUpd = data.updated_count > 10 ? `<li style="color:#888">…and ${data.updated_count - 10} more</li>` : ''

  $('previewNewCount').textContent = data.new_count
  $('previewUpdCount').textContent = data.updated_count
  $('previewNewList').innerHTML = newList + moreNew || '<li style="color:#888">None</li>'
  $('previewUpdList').innerHTML = updList + moreUpd || '<li style="color:#888">None</li>'
  $('previewModal').style.display = 'flex'
}

function closePreview(){
  $('previewModal').style.display = 'none'
  _pendingFile = null
}

// ── "Add to" choices: contact list / group / organization ─────────────── //

const NEW_OPTION = '__new__'

function fillSelect(sel, placeholder, items, newLabel){
  // Built with Option objects, not innerHTML: names come from spreadsheets.
  sel.innerHTML = ''
  sel.add(new Option(placeholder, ''))
  items.forEach(([value, label])=> sel.add(new Option(label, value)))
  if(newLabel) sel.add(new Option(newLabel, NEW_OPTION))
}

// Organizations-page directory, one heading per category in the same order
// as the category chips; categories not in that list (e.g. Uncategorized) last.
// Every category gets a heading, even one with no organizations yet.
function fillOrgSelect(sel, orgs, categoryOrder){
  sel.innerHTML = ''
  sel.add(new Option('Choose an organization…', ''))
  const byCat = new Map()
  orgs.forEach(o=>{
    if(!byCat.has(o.category)) byCat.set(o.category, [])
    byCat.get(o.category).push(o.name)
  })
  const cats = categoryOrder
    .concat([...byCat.keys()].filter(c=> !categoryOrder.includes(c)))
  cats.forEach(cat=>{
    const group = document.createElement('optgroup')
    group.label = cat
    const names = byCat.get(cat) || []
    names.forEach(name=> group.appendChild(new Option(name, name)))
    if(!names.length){
      const empty = new Option('No organizations yet', '')
      empty.disabled = true
      group.appendChild(empty)
    }
    sel.appendChild(group)
  })
  sel.add(new Option('+ Create new organization…', NEW_OPTION))
}

async function loadImportTargets(){
  try {
    const r = await fetch('/api/upload/targets')
    if(!r.ok) throw new Error(`HTTP ${r.status}`)
    const t = await r.json()
    fillSelect($('tgtGroupSelect'), 'Choose a group…',
      t.groups.map(g=>[String(g.id), `${g.name} (${g.contact_count})`]), '+ Create new group…')
    fillOrgSelect($('tgtOrgSelect'), t.organizations, t.org_categories)
    fillSelect($('tgtOrgCategory'), 'Select category…',
      t.org_categories.map(c=>[c, c]), null)
  } catch(e){
    // Pickers still work for creating new ones; just no existing choices.
    fillSelect($('tgtGroupSelect'), 'Could not load groups', [], '+ Create new group…')
    fillSelect($('tgtOrgSelect'), 'Could not load organizations', [], '+ Create new organization…')
    fillSelect($('tgtOrgCategory'), 'Could not load categories', [], null)
  }
}

function syncTargetUI(){
  const groupOn = $('tgtGroup').checked, orgOn = $('tgtOrg').checked
  $('tgtGroupPicker').hidden = !groupOn
  $('tgtOrgPicker').hidden = !orgOn
  const newGroup = $('tgtGroupSelect').value === NEW_OPTION
  const newOrg = $('tgtOrgSelect').value === NEW_OPTION
  $('tgtGroupNew').hidden = !newGroup
  $('tgtOrgNew').hidden = !newOrg
  $('tgtOrgCategoryWrap').hidden = !newOrg
  $('tgtNote').hidden = $('tgtContacts').checked || !(groupOn || orgOn)
  $('tgtError').hidden = true
}

function resetTargets(){
  $('tgtContacts').checked = true
  $('tgtGroup').checked = false
  $('tgtOrg').checked = false
  ;['tgtGroupNew', 'tgtOrgNew'].forEach(id=> $(id).value = '')
  ;['tgtGroupSelect', 'tgtOrgSelect', 'tgtOrgCategory'].forEach(id=> $(id).value = '')
  syncTargetUI()
}

// Returns the form fields for /api/upload, or null (after showing why).
function collectTargets(){
  const err = (msg)=>{ $('tgtError').textContent = msg; $('tgtError').hidden = false; return null }
  const out = { add_contacts: $('tgtContacts').checked ? '1' : '0' }
  if($('tgtGroup').checked){
    out.add_group = '1'
    const v = $('tgtGroupSelect').value
    if(v === NEW_OPTION){
      const name = $('tgtGroupNew').value.trim()
      if(!name) return err('Enter a name for the new group.')
      out.group_name = name
    } else if(v){
      out.group_id = v
    } else return err('Choose a group, or create a new one.')
  }
  if($('tgtOrg').checked){
    out.add_org = '1'
    const v = $('tgtOrgSelect').value
    if(v === NEW_OPTION){
      const name = $('tgtOrgNew').value.trim()
      if(!name) return err('Enter a name for the new organization.')
      const category = $('tgtOrgCategory').value
      if(!category) return err('Select a category for the new organization.')
      out.organization = name
      out.org_category = category
    } else if(v){
      out.organization = v
    } else return err('Choose an organization, or create a new one.')
  }
  if(out.add_contacts !== '1' && !out.add_group && !out.add_org)
    return err('Check at least one place to add the contacts.')
  return out
}

function confirmImport(){
  const targets = collectTargets()
  if(!targets) return
  $('previewModal').style.display = 'none'
  // "Mark missing as Inactive" only makes sense for a full contact-list sync.
  const archive = _pendingArchive && targets.add_contacts === '1'
  doUpload(_pendingFile, archive, targets).then(showSummary).catch(handleUploadError)
}

function handleUploadError(err) {
  let msg = 'Upload failed'
  try { const j = JSON.parse(err); msg = j.error || j.details || err } catch(e) { msg = err || 'Upload failed' }
  alert('Upload error: ' + msg)
}

async function previewThenUpload(file){
  const archiveCb = $('archiveMissing')
  const archiveMissing = archiveCb && archiveCb.checked
  const fd = new FormData()
  fd.append('file', file)
  setProgress(5, 'Analyzing file…')
  const wrap = $('progressBar')?.closest('.progress-wrap')
  if(wrap) wrap.style.display = 'block'
  try {
    const r = await fetch('/api/upload/preview', { method: 'POST', body: fd })
    const data = await r.json()
    if(data.error){ handleUploadError(data.error); return }
    const wrap2 = $('progressBar')?.closest('.progress-wrap')
    if(wrap2) wrap2.style.display = 'none'
    await loadImportTargets()
    resetTargets()
    showPreviewModal(data, file, archiveMissing)
  } catch(e){
    handleUploadError(String(e))
  }
}

window.addEventListener('load', ()=>{
  const drop = $('dropZone')
  const fileInput = $('adminFile')
  const pick = $('pickFile')
  const exportBtn = $('exportBtn')

  if(pick) pick.addEventListener('click', ()=>fileInput.click())
  if(fileInput) fileInput.addEventListener('change', (e)=>{ const f = e.target.files[0]; if(f) previewThenUpload(f) })

  if(drop){
    drop.addEventListener('dragover', (e)=>{ e.preventDefault(); drop.style.background = '#fff6' })
    drop.addEventListener('dragleave', ()=>{ drop.style.background = '' })
    drop.addEventListener('drop', (e)=>{ e.preventDefault(); drop.style.background=''; const f = e.dataTransfer.files[0]; if(f) previewThenUpload(f) })
  }

  if(exportBtn) exportBtn.addEventListener('click', ()=>{ window.location.href = '/api/export' })

  ;['tgtContacts', 'tgtGroup', 'tgtOrg', 'tgtGroupSelect', 'tgtOrgSelect'].forEach(id=>{
    const node = $(id)
    if(node) node.addEventListener('change', ()=>{
      syncTargetUI()
      if(id === 'tgtGroupSelect' && node.value === NEW_OPTION) $('tgtGroupNew').focus()
      if(id === 'tgtOrgSelect' && node.value === NEW_OPTION) $('tgtOrgNew').focus()
    })
  })
})
