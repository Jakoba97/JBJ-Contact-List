// =============================================================================
// Author: Kadin Lee-Smith
// Frontend JavaScript for the Contact & Relationship Management Platform.
// All UI logic, API calls, and interactive features written by Kadin Lee-Smith.
// =============================================================================
const API = {
  contacts: '/api/contacts',
  sections: '/api/sections',
  stats: '/api/stats',
  tags: '/api/tags',
  sectionCategories: '/api/section-categories',
  counties: '/api/counties',
}

let state = { page: 1, limit: 25, q: '', tags: [], counties: [], followup: '', favoritesOnly: false, incompleteOnly: false, total: 0, view: 'people', selectedKey: null, layout: 'grid', showDeleted: false }

// Clicking a card a second time hides the detail panel instead of leaving
// it open forever -- this is also what drives the "selected card" highlight
// (Gmail-style) since both need to track which card is currently open.
function selectCard(key, cardEl, openFn){
  const panel = el('contactDetail')
  if(state.selectedKey === key){
    state.selectedKey = null
    if(panel) panel.style.display = 'none'
    document.querySelectorAll('.card.selected').forEach(c=>c.classList.remove('selected'))
    return
  }
  state.selectedKey = key
  document.querySelectorAll('.card.selected').forEach(c=>c.classList.remove('selected'))
  if(cardEl) cardEl.classList.add('selected')
  openFn()
}

function el(id){return document.getElementById(id)}
function initials(first, last, fallback){
  const text = (first||'').charAt(0) + (last||'').charAt(0)
  return text || (fallback || '-')
}

// Deterministic, varied colors for tag/list pills -- same label always
// gets the same color, so they stay easy to visually scan/group by, and
// it spreads the page's color use out instead of everything being a
// shade of brand red.
const TAG_PALETTE = [
  {bg:'#E3EDF7', text:'#1F4E79'},
  {bg:'#E0F2F1', text:'#00695C'},
  {bg:'#F1E9F9', text:'#6A3D9A'},
  {bg:'#FDF1DC', text:'#8A5A00'},
  {bg:'#E6F4EA', text:'#1E7B34'},
  {bg:'#E8EAED', text:'#3D4041'},
  {bg:'#FBE7E7', text:'#9B3B3C'},
  {bg:'#E8EAF6', text:'#303F9F'},
]
function scoreBadgeHtml(score){
  if(score == null) return ''
  const color = score >= 80 ? '#166534' : score >= 50 ? '#92400e' : '#6b7280'
  const bg    = score >= 80 ? '#f0fdf4' : score >= 50 ? '#fef3c7' : '#f3f4f6'
  const border= score >= 80 ? '#86efac' : score >= 50 ? '#fcd34d' : '#d1d5db'
  return `<span title="Profile score: ${score}/100" style="display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:20px;font-size:11px;font-weight:700;background:${bg};color:${color};border:1px solid ${border};"><i class="fas fa-star" style="font-size:9px;"></i>${score}</span>`
}
function tagColor(label){
  const s = String(label||'')
  let hash = 0
  for(let i=0;i<s.length;i++){ hash = (hash * 31 + s.charCodeAt(i)) >>> 0 }
  return TAG_PALETTE[hash % TAG_PALETTE.length]
}
function pillHtml(label, extraClass){
  const c = tagColor(label)
  return `<span class="pill${extraClass? ' '+extraClass : ''}" style="background:${c.bg};color:${c.text}">${label}</span>`
}

// "3d ago" / "Today" -- compact, for card-level outreach indicators where
// a full date+name (like the detail panel's badge) would be too much text.
function relativeDays(dateStr){
  if(!dateStr) return null
  const then = new Date(dateStr + 'T00:00:00')
  const days = Math.round((new Date().setHours(0,0,0,0) - then.getTime()) / 86400000)
  if(days <= 0) return 'Today'
  if(days === 1) return '1 day ago'
  return `${days} days ago`
}

// Lightweight toast notification -- replaces native alert() for save/
// delete/error feedback, since alert() blocks the whole page.
function toast(message, type){
  let stack = document.querySelector('.toast-stack')
  if(!stack){
    stack = document.createElement('div')
    stack.className = 'toast-stack'
    document.body.appendChild(stack)
  }
  const icon = type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check'
  const t = document.createElement('div')
  t.className = 'toast' + (type === 'error' ? ' toast-error' : '')
  t.innerHTML = `<i class="fas ${icon}"></i> ${message}`
  stack.appendChild(t)
  requestAnimationFrame(()=> t.classList.add('show'))
  setTimeout(()=>{
    t.classList.remove('show')
    setTimeout(()=> t.remove(), 250)
  }, 3200)
}
console.debug('app.js loaded')

// The Export and AI Tools dropdowns are independent toggle buttons, but
// each one's own click handler calls stopPropagation() (so opening it
// doesn't immediately trigger its own "click outside closes it" listener) --
// which also stops that click from reaching the *other* dropdown's
// outside-click listener, so it'd never close. Closing the other menu
// before opening one keeps only one open at a time. (Tags/Counties live
// permanently in the sidebar in this layout, not as popovers.)
function closeOtherFilterMenus(exceptId){
  ;['exportMenu', 'toolsMenu'].forEach(id => {
    if(id === exceptId) return
    const m = el(id)
    if(m) m.style.display = 'none'
  })
}

function updateTagFilterLabel(){
  const label = el('tagFilterLabel')
  if(!label) return
  label.textContent = state.tags.length ? `(${state.tags.length} selected)` : ''
}

// The category dropdown is shared by both views, but People (Contact.tag)
// and Organizations (OutreachOrg.tag) use different category names for the
// same kind of grouping -- so it's repopulated from a different endpoint
// whenever the view changes, rather than trying to merge the two lists.
async function fetchTagOptions(){
  const menu = el('tagFilterMenu')
  if(!menu) return
  try{
    const url = state.view === 'organizations' ? API.sectionCategories : API.tags
    const res = await fetch(url)
    const names = await res.json()
    if(!names.length){
      menu.innerHTML = '<div class="filter-menu-empty">No tags on file yet.</div>'
      updateTagFilterLabel()
      return
    }
    menu.innerHTML = names.map(name => `
      <label class="filter-option">
        <input type="checkbox" value="${name}" ${state.tags.includes(name) ? 'checked' : ''}>
        <span>${name}</span>
      </label>
    `).join('')
    menu.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', ()=>{
        if(cb.checked){
          if(!state.tags.includes(cb.value)) state.tags.push(cb.value)
        } else {
          state.tags = state.tags.filter(t => t !== cb.value)
        }
        updateTagFilterLabel()
      })
    })
    updateTagFilterLabel()
  }catch(e){console.warn(e)}
}

function bindTagFilter(){
  const btn = el('tagFilterBtn')
  const menu = el('tagFilterMenu')
  if(!btn || !menu) return
  btn.addEventListener('click', (e)=>{
    e.stopPropagation()
    const opening = menu.style.display === 'none'
    closeOtherFilterMenus('tagFilterMenu')
    menu.style.display = opening ? '' : 'none'
  })
  menu.addEventListener('click', (e)=> e.stopPropagation())
  document.addEventListener('click', ()=>{ menu.style.display = 'none' })
}

function updateCountyFilterLabel(){
  const label = el('countyFilterLabel')
  if(!label) return
  label.textContent = state.counties.length ? `(${state.counties.length} selected)` : ''
}

async function fetchCounties(){
  try{
    const res = await fetch(API.counties)
    const names = await res.json()
    const menu = el('countyFilterMenu')
    if(!menu) return
    if(!names.length){
      menu.innerHTML = '<div class="filter-menu-empty">No counties on file yet.</div>'
      return
    }
    menu.innerHTML = names.map(name => `
      <label class="filter-option">
        <input type="checkbox" value="${name}" ${state.counties.includes(name) ? 'checked' : ''}>
        <span>${name}</span>
      </label>
    `).join('')
    menu.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', ()=>{
        if(cb.checked){
          if(!state.counties.includes(cb.value)) state.counties.push(cb.value)
        } else {
          state.counties = state.counties.filter(c => c !== cb.value)
        }
        updateCountyFilterLabel()
      })
    })
    updateCountyFilterLabel()
  }catch(e){console.warn(e)}
}

function bindCountyFilter(){
  const btn = el('countyFilterBtn')
  const menu = el('countyFilterMenu')
  if(!btn || !menu) return
  btn.addEventListener('click', (e)=>{
    e.stopPropagation()
    const opening = menu.style.display === 'none'
    closeOtherFilterMenus('countyFilterMenu')
    menu.style.display = opening ? '' : 'none'
  })
  menu.addEventListener('click', (e)=> e.stopPropagation())
  document.addEventListener('click', ()=>{ menu.style.display = 'none' })
}

async function fetchStats(){
  try{
    const res = await fetch(API.stats)
    const json = await res.json()
    if(el('statTotalLabel')) el('statTotalLabel').textContent = 'Total Contacts'
    if(el('statIncompleteLabel')) el('statIncompleteLabel').textContent = 'Need Review'
    el('statTotal').textContent = (json.total ?? 0).toLocaleString()
    if(el('statIncomplete')) el('statIncomplete').textContent = (json.incomplete ?? 0).toLocaleString()
    if(el('statOrgsCard')) el('statOrgsCard').style.display = ''
    if(el('statCompleteCard')) el('statCompleteCard').style.display = ''
    if(el('statOrgs')) el('statOrgs').textContent = (json.organizations ?? 0).toLocaleString()
    if(el('statComplete')) el('statComplete').textContent = (json.complete_pct ?? 0) + '%'
  }catch(e){console.warn(e)}
}

async function fetchSectionStats(){
  try{
    const res = await fetch('/api/section-stats')
    const json = await res.json()
    if(el('statTotalLabel')) el('statTotalLabel').textContent = 'Total Organizations'
    if(el('statIncompleteLabel')) el('statIncompleteLabel').textContent = 'No Contact on File'
    el('statTotal').textContent = (json.total ?? 0).toLocaleString()
    if(el('statIncomplete')) el('statIncomplete').textContent = (json.no_contact ?? 0).toLocaleString()
    if(el('statOrgsCard')) el('statOrgsCard').style.display = 'none'
    if(el('statCompleteCard')) el('statCompleteCard').style.display = 'none'
  }catch(e){console.warn(e)}
}

// Returns a deterministic hex color for each unique tag value so the same
// tag always gets the same color, giving the card grid visual grouping at a
// glance without manually maintaining a hard-coded palette.
function tagHue(tag){
  if(!tag) return null
  const PALETTE = {
    'NA / CA / HOA':'#2C5C8A', 'ISD Staff':'#1E7B34', 'JBJ Staff':'#AD0304',
    'State Senator':'#6D0712', 'State Senator Staff':'#B8740C',
    'Chamber of Commerce':'#2C5C8A', 'City / Town Council':'#1E7B34',
    'City / Town Staff':'#3D4041', 'Clergy':'#6D0712', 'Client':'#AD0304',
    'Advocacy Agency':'#B8740C', 'Prospect':'#2C5C8A',
    'Legacy - Unverified':'#94999C',
  }
  if(PALETTE[tag]) return PALETTE[tag]
  // Fallback: hash the tag string to pick a hue
  let h = 0
  for(let i=0;i<tag.length;i++) h = (h * 31 + tag.charCodeAt(i)) & 0xffffffff
  const hue = Math.abs(h) % 360
  return `hsl(${hue},50%,35%)`
}

function renderCard(c){
  const div = document.createElement('div')
  const key = 'contact:'+c.id
  div.className = 'card' + (state.selectedKey === key ? ' selected' : '')
  div.tabIndex = 0

  const lastContacted = relativeDays(c.last_contacted_on)
  const lastEmailed   = relativeDays(c.last_emailed_on)
  const recencyBits   = []
  if(lastContacted) recencyBits.push(`<span class="recency-item"><i class="fas fa-comment-dots recency-icon"></i>${lastContacted}</span>`)
  if(lastEmailed)   recencyBits.push(`<span class="recency-item"><i class="fas fa-envelope recency-icon"></i>${lastEmailed}</span>`)
  const recencyHtml = recencyBits.length ? `<div class="card-recency">${recencyBits.join('')}</div>` : ''

  const tagColor = tagHue(c.tag)
  div.style.borderTopColor = tagColor || ''

  div.innerHTML = `
    <div class="card-top">
      <div class="avatar md" style="${tagColor ? `background:linear-gradient(140deg,${tagColor}cc,${tagColor}88)` : ''}">
        ${initials(c.first_name, c.last_name)}
      </div>
      <div class="card-info">
        <h3 class="card-name">${c.first_name||''} ${c.last_name||''}</h3>
        ${c.organization ? `<div class="card-org"><i class="fas fa-building"></i> ${c.organization}</div>` : ''}
        ${c.title ? `<div class="card-role">${c.title}</div>` : ''}
      </div>
      <button class="favorite-btn${c.is_favorite? ' is-favorite':''}" title="${c.is_favorite? 'Unstar' : 'Star this contact'}" aria-pressed="${c.is_favorite? 'true':'false'}">
        <i class="${c.is_favorite? 'fas':'far'} fa-star"></i>
      </button>
    </div>
    <div class="card-meta-row">
      ${c.tag ? `<span class="card-tag-pill" style="${tagColor ? `background:${tagColor}18;color:${tagColor};border-color:${tagColor}40` : ''}">${c.tag}</span>` : ''}
      ${c.county ? `<span class="card-county"><i class="fas fa-location-dot"></i> ${c.county}</span>` : ''}
      ${scoreBadgeHtml(c.score)}
    </div>
    ${recencyHtml}
    <div class="card-actions">
      ${state.showDeleted
        ? `<button class="btn btn-sm restore-btn"><i class="fas fa-rotate-left"></i> Restore</button><button class="btn btn-sm btn-danger purge-btn"><i class="fas fa-trash"></i> Delete Forever</button>`
        : `<button class="btn btn-sm view-btn"><i class="fas fa-eye"></i> View</button><button class="btn btn-sm edit-btn"><i class="fas fa-pen"></i> Edit</button>`
      }
    </div>
  `
  div.addEventListener('click', (ev)=>{
    if(ev.target && ev.target.closest('.edit-btn, .favorite-btn, .restore-btn, .purge-btn')) return
    if(!state.showDeleted) selectCard(key, div, ()=> showContactDetail(c))
  })
  const editBtn = div.querySelector('.edit-btn')
  if(editBtn) editBtn.addEventListener('click', (e)=>{ e.stopPropagation(); openProfile(c.id) })
  const favoriteBtn = div.querySelector('.favorite-btn')
  if(favoriteBtn) favoriteBtn.addEventListener('click', (e)=>{ e.stopPropagation(); toggleFavorite(c, favoriteBtn) })
  const restoreBtn = div.querySelector('.restore-btn')
  if(restoreBtn) restoreBtn.addEventListener('click', (e)=>{ e.stopPropagation(); restoreContact(c.id, div) })
  const purgeBtn = div.querySelector('.purge-btn')
  if(purgeBtn) purgeBtn.addEventListener('click', (e)=>{ e.stopPropagation(); purgeContact(c.id, div) })
  return div
}

function renderRow(c) {
  const key = 'contact:' + c.id
  const row = document.createElement('div')
  row.className = 'list-row' + (state.selectedKey === key ? ' selected' : '')
  const tagColor = tagHue(c.tag)
  const avatarStyle = tagColor ? `background:linear-gradient(140deg,${tagColor}cc,${tagColor}88)` : ''
  row.innerHTML = `
    <div class="list-avatar" style="${avatarStyle}">${initials(c.first_name, c.last_name)}</div>
    <div class="list-name">${c.first_name || ''} ${c.last_name || ''}</div>
    <div class="list-org">${c.organization || '<span style="color:#ccc">-</span>'}</div>
    <div class="list-title">${c.title || '<span style="color:#ccc">-</span>'}</div>
    <div>${c.tag ? `<span class="list-tag" style="${tagColor ? `background:${tagColor}18;color:${tagColor};border-color:${tagColor}40` : ''}">${c.tag}</span>` : ''}</div>
    <div class="list-actions">
      <button class="btn btn-sm view-btn"><i class="fas fa-eye"></i> View</button>
      <button class="btn btn-sm edit-btn"><i class="fas fa-pen"></i> Edit</button>
    </div>
  `
  row.addEventListener('click', (ev) => {
    if (ev.target && ev.target.closest('.edit-btn')) return
    selectCard(key, row, () => showContactDetail(c))
  })
  row.querySelector('.edit-btn').addEventListener('click', (e) => { e.stopPropagation(); openProfile(c.id) })
  return row
}

async function toggleFavorite(c, btnEl){
  const next = !c.is_favorite
  try{
    const res = await fetch(`/api/contacts/${c.id}/favorite`, {
      method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({is_favorite: next})
    })
    if(!res.ok){ toast('Could not update favorite.', 'error'); return }
    c.is_favorite = next
    btnEl.classList.toggle('is-favorite', next)
    btnEl.querySelector('i').className = next ? 'fas fa-star' : 'far fa-star'
    btnEl.title = next ? 'Unstar' : 'Star this contact'
    btnEl.setAttribute('aria-pressed', next ? 'true' : 'false')
    const card = btnEl.closest('.card')
    if(state.favoritesOnly && !next && card) card.remove()
  }catch(e){ toast('Could not reach the server.', 'error'); console.error(e) }
}

async function deleteContact(c){
  const name = `${c.first_name||''} ${c.last_name||''}`.trim() || c.email || 'this contact'
  if(!confirm(`Delete ${name}? This also removes their logged outreach history and cannot be undone.`)) return
  try{
    const res = await fetch(`/api/contacts/${c.id}`, { method: 'DELETE' })
    if(!res.ok){ toast('Could not delete this contact.', 'error'); return }
    state.selectedKey = null
    const panel = el('contactDetail')
    if(panel) panel.style.display = 'none'
    toast('Contact deleted')
    search()
    fetchStats()
  }catch(e){ toast('Could not reach the server.', 'error'); console.error(e) }
}

// Organizations view card -- lists every contact at the organization (not
// just one "primary" contact), since coworkers sharing an organization
// should show up together.
function renderOrgCard(item){
  const div = document.createElement('div')
  const key = 'org:'+item.organization
  div.className = 'card' + (state.selectedKey === key ? ' selected' : '')
  div.tabIndex = 0
  const contacts = item.contacts || []
  const contactsHtml = contacts.length
    ? `<div class="org-contacts">${contacts.map(c=>`<div class="org-contact-row" data-id="${c.id}"><span class="pc-name">${c.name||'(no name)'}</span><span class="pc-meta">${c.title? ' - '+c.title : ''}</span></div>`).join('')}</div>`
    : '<div class="muted">No contact on file</div>'
  div.innerHTML = `
    <div class="card-top">
      <div class="avatar md">${(item.organization||'?').charAt(0).toUpperCase()}</div>
      <div>
        <h3>${item.organization||''}</h3>
        <div class="meta">${item.contact_count||0} contact${item.contact_count===1?'':'s'}${item.latest_updated? ' • Updated '+new Date(item.latest_updated+'T00:00:00').toLocaleDateString() : ''}</div>
      </div>
    </div>
    ${contactsHtml}
    ${item.notes ? `<div class="category">${item.notes.replace(/\|\|/g,', ')}</div>` : ''}
    <div class="card-actions" style="margin-top:8px;display:flex;gap:8px;">
      <button class="btn btn-sm view-btn"><i class="fas fa-eye"></i> View</button>
      <a href="/organizations/${encodeURIComponent(item.organization)}" class="btn btn-sm" style="text-decoration:none;"><i class="fas fa-arrow-up-right-from-square"></i> Full Page</a>
      <button class="btn btn-sm add-btn"><i class="fas fa-plus"></i> Add Contact</button>
    </div>
  `
  div.addEventListener('click', (ev)=>{
    const row = ev.target.closest('.org-contact-row')
    if(row){ ev.stopPropagation(); selectCard('contact:'+row.dataset.id, null, ()=> showContactDetail(parseInt(row.dataset.id,10))); return }
    if(ev.target && ev.target.closest('.add-btn')) return
    selectCard(key, div, ()=> showOrgDetail(item))
  })
  const addBtn = div.querySelector('.add-btn')
  if(addBtn) addBtn.addEventListener('click', (e)=>{ e.stopPropagation(); openProfile(null, {organization: item.organization, tag: item.tag||''}) })
  return div
}

function renderOrgRow(item) {
  const key = 'org:' + item.organization
  const row = document.createElement('div')
  row.className = 'list-row' + (state.selectedKey === key ? ' selected' : '')
  const tagColor = tagHue(item.tag)
  const avatarStyle = tagColor ? `background:linear-gradient(140deg,${tagColor}cc,${tagColor}88)` : ''
  if (tagColor) row.style.borderLeft = `3px solid ${tagColor}`
  row.innerHTML = `
    <div class="list-avatar" style="${avatarStyle}">${(item.organization || '?').charAt(0).toUpperCase()}</div>
    <div class="list-name">${item.organization || ''}</div>
    <div class="list-org">
      ${tagColor ? `<span class="list-tag" style="background:${tagColor}18;color:${tagColor};border-color:${tagColor}40">${item.tag}</span>` : ''}
      <span style="margin-left:${tagColor ? '6px' : '0'}">${item.contact_count || 0} contact${item.contact_count === 1 ? '' : 's'}</span>
    </div>
    <div class="list-title">${item.notes ? item.notes.replace(/\|\|/g, ', ') : '<span style="color:#ccc">-</span>'}</div>
    <div></div>
    <div class="list-actions">
      <button class="btn btn-sm view-btn"><i class="fas fa-eye"></i></button>
      <a href="/organizations/${encodeURIComponent(item.organization)}" class="btn btn-sm" style="text-decoration:none;" title="Open full page"><i class="fas fa-arrow-up-right-from-square"></i></a>
      <button class="btn btn-sm add-btn"><i class="fas fa-plus"></i></button>
    </div>
  `
  row.addEventListener('click', (ev) => {
    if (ev.target && ev.target.closest('.add-btn')) return
    selectCard(key, row, () => showOrgDetail(item))
  })
  row.querySelector('.add-btn').addEventListener('click', (e) => {
    e.stopPropagation()
    openProfile(null, { organization: item.organization, tag: item.tag || '' })
  })
  return row
}

async function showContactDetail(contact){
  try{
    let c = contact
    if(typeof contact === 'number' || typeof contact === 'string'){
      const res = await fetch('/api/contacts/' + encodeURIComponent(contact))
      c = await res.json()
    }
    const panel = el('contactDetail')
    if(!panel) return
    const incomplete = ((!c.email || c.email.trim()==='') && (!c.phone_office && !c.phone_cell))
    const hasNotes = c.notes && c.notes.trim().length>0
    panel.innerHTML = `
      <div class="detail-card">
        <div class="detail-photo photo-placeholder">${(c.first_name||c.last_name)? (c.first_name||'').charAt(0) + (c.last_name||'').charAt(0) : '-'}</div>
        <div class="detail-main">
          <h2>${(c.first_name||'') + ' ' + (c.last_name||'')} <button id="detailFavoriteBtn" class="favorite-btn${c.is_favorite? ' is-favorite':''}" title="${c.is_favorite? 'Unstar' : 'Star this contact'}" aria-pressed="${c.is_favorite? 'true':'false'}"><i class="${c.is_favorite? 'fas':'far'} fa-star"></i></button></h2>
          <div class="detail-sub">${c.title||''} ${c.organization? ' • '+c.organization : ''}</div>
          <div class="detail-row"><strong>Email:</strong> ${c.email? `<a href="mailto:${c.email}">${c.email}</a>` : '<span class="muted">No email</span>'}</div>
          <div class="detail-row"><strong>Phone:</strong> ${c.phone_office? `<a href="tel:${c.phone_office}">${c.phone_office}</a>` : (c.phone_cell? `<a href="tel:${c.phone_cell}">${c.phone_cell}</a>` : '<span class="muted">No phone</span>')}</div>
          <div class="detail-row"><strong>County:</strong> ${c.county || '<span class="muted">Unknown</span>'}</div>
          ${c.tag ? `<div class="detail-row"><strong>Category:</strong> ${pillHtml(c.tag,'small')}</div>` : ''}
          ${(()=>{
            const lists = c.lists||[]
            if(!lists.length) return ''
            const SHOW = 3
            const visible = lists.slice(0,SHOW)
            const hidden  = lists.slice(SHOW)
            const uid = 'lists-' + (c.id||Math.random())
            const liStyle = 'margin-bottom:2px;'
            const ulStyle = 'margin:4px 0 0 16px;padding:0;font-size:13px;line-height:1.8;'
            const visibleHtml = visible.map(x=>`<li style="${liStyle}">${x}</li>`).join('')
            const hiddenBlock = hidden.length
              ? `<ul id="${uid}-more" style="${ulStyle}display:none;">${hidden.map(x=>`<li style="${liStyle}">${x}</li>`).join('')}</ul>
                 <button id="${uid}-btn" onclick="var m=document.getElementById('${uid}-more'),b=this;var open=m.style.display==='none';m.style.display=open?'':'none';b.textContent=open?'Show less':'+ ${hidden.length} more';" style="background:none;border:none;color:var(--maroon,#AD0304);font-size:12px;cursor:pointer;padding:2px 0;margin-left:16px;">+ ${hidden.length} more</button>`
              : ''
            return `<div class="detail-row"><strong>Email Lists:</strong><ul style="${ulStyle}">${visibleHtml}</ul>${hiddenBlock}</div>`
          })()}
          <div class="detail-notes">${hasNotes? `<h4>Notes</h4><div class="notes">${(c.notes||'').replace(/\n/g,'<br>')}</div>` : ''}</div>
          <div class="detail-flags" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
            ${incomplete? '<span class="flag flag-warn">Incomplete</span>' : '<span class="flag flag-ok">Complete</span>'}
            ${hasNotes? '<span class="flag flag-info">Has notes</span>' : ''}
            <button id="detailEditBtn" class="btn"><i class="fas fa-pen"></i> Edit</button>
            ${window.CAN_EXPORT ? `<a id="detailExport" class="btn" href="/api/export?id=${encodeURIComponent(c.id||'')}"><i class="fas fa-download"></i> Export</a>` : ''}
            ${window.IS_ADMIN ? '<button id="detailDeleteBtn" class="btn" style="color:#9b1c1c;"><i class="fas fa-trash"></i> Delete</button>' : ''}
          </div>
          ${pipelineStageSectionHtml(c.pipeline_stage || '')}
          ${taskSectionHtml()}
          <div class="email-stats-section detail-section"></div>
          ${activitySectionHtml()}
        </div>
      </div>
    `
    panel.style.display = ''
    panel.scrollTop = 0
    // On desktop the panel is sticky so it's always visible - no scroll needed.
    // On mobile it stacks below the results, so scroll it into view.
    if(window.innerWidth < 768) panel.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const edit = el('detailEditBtn'); if(edit) edit.addEventListener('click', ()=> openProfile(c.id))
    const favBtn = el('detailFavoriteBtn'); if(favBtn) favBtn.addEventListener('click', ()=> toggleFavorite(c, favBtn))
    const deleteBtn = el('detailDeleteBtn'); if(deleteBtn) deleteBtn.addEventListener('click', ()=> deleteContact(c))
    const stageSelect = el('pipelineStageSelect')
    if(stageSelect) stageSelect.addEventListener('change', async ()=>{
      await movePipelineContact(c.id, stageSelect.value)
      toast(stageSelect.value ? `Moved to ${stageSelect.value}` : 'Removed from pipeline')
    })
    const taskContainer = panel.querySelector('.task-section-inline')
    loadContactTaskSection(taskContainer, c.id)
    bindContactTaskForm(taskContainer, c.id)
    const emailStatsContainer = panel.querySelector('.email-stats-section')
    if(emailStatsContainer) loadEmailStats(emailStatsContainer, c.id)
    const activityContainer = panel.querySelector('.activity-section')
    loadActivitySection(activityContainer, 'contact', c.id)
    bindActivityForm(activityContainer, 'contact', c.id)
  }catch(e){ console.error(e) }
}

// Org-level detail: full contact list (each clickable into their own detail
// or edit), notes, last-touched date, and the shared outreach-activity log.
function showOrgDetail(item){
  const panel = el('contactDetail')
  if(!panel) return
  const contacts = item.contacts || []
  const contactsHtml = contacts.length
    ? `<div class="detail-row"><strong>Contacts:</strong></div><div class="org-contact-list">${contacts.map(c=>`
        <div class="org-contact-item">
          <div class="org-contact-info">
            <div class="avatar sm">${c.name ? c.name.split(' ').filter(Boolean).map(s=>s.charAt(0)).slice(0,2).join('') : '-'}</div>
            <div class="org-contact-text">
              <div class="pc-name">${c.name||'(no name)'}</div>
              <div class="pc-meta">${c.title||''}${c.email? ' • '+c.email : ''}</div>
            </div>
          </div>
          <div class="org-contact-actions">
            <button class="btn btn-sm view-person-btn" data-id="${c.id}"><i class="fas fa-eye"></i> View</button>
            <button class="btn btn-sm edit-person-btn" data-id="${c.id}"><i class="fas fa-pen"></i> Edit</button>
          </div>
        </div>
      `).join('')}</div>`
    : '<div class="detail-row"><span class="flag flag-warn">No contact on file</span></div>'
  panel.innerHTML = `
    <div class="detail-card">
      <div class="detail-photo photo-placeholder">${(item.organization||'?').charAt(0)}</div>
      <div class="detail-main">
        <h2>${item.organization||''}</h2>
        <div class="detail-sub">${item.tag||''}</div>
        <div class="detail-row"><strong>Last touched:</strong> ${item.latest_updated? new Date(item.latest_updated+'T00:00:00').toLocaleDateString() : '<span class="muted">Never</span>'}</div>
        <div class="detail-notes">${item.notes? `<h4>Notes</h4><div class="notes">${item.notes.replace(/\|\|/g,', ')}</div>` : ''}</div>
        ${contactsHtml}
        <div class="detail-flags" style="margin-top:10px;display:flex;gap:8px;align-items:center">
          <button id="detailAddContactBtn" class="btn btn-primary"><i class="fas fa-plus"></i> Add Contact</button>
        </div>
        ${activitySectionHtml()}
      </div>
    </div>
  `
  panel.style.display = ''
  const addBtn = el('detailAddContactBtn')
  if(addBtn) addBtn.addEventListener('click', ()=> openProfile(null, {organization: item.organization, tag: item.tag||''}))
  panel.querySelectorAll('.view-person-btn').forEach(b=> b.addEventListener('click', ()=> showContactDetail(parseInt(b.dataset.id,10))))
  panel.querySelectorAll('.edit-person-btn').forEach(b=> b.addEventListener('click', ()=> openProfile(parseInt(b.dataset.id,10))))
  const activityContainer = panel.querySelector('.activity-section')
  loadActivitySection(activityContainer, 'org', item.organization)
  bindActivityForm(activityContainer, 'org', item.organization)
}

// Outreach history shared by the Contacts detail panel and the Organizations
// detail panel -- lets staff see, before reaching out, whether someone
// (or an organization) has already been contacted, by whom, and why.
function activitySectionHtml(){
  const today = new Date().toISOString().slice(0,10)
  return `
    <div class="activity-section">
      <h4>Outreach History</h4>
      <div class="activity-badge"></div>
      <div class="activity-list">Loading…</div>
      <div class="activity-form">
        <select class="activity-channel">
          <option value="Email">Email</option>
          <option value="Phone">Phone</option>
          <option value="Meeting">Meeting</option>
          <option value="Other">Other</option>
        </select>
        <input type="date" class="activity-date" value="${today}">
        <textarea class="activity-summary" rows="2" placeholder="What was discussed / details"></textarea>
        <button class="btn btn-primary activity-log-btn"><i class="fas fa-phone"></i> Log Outreach</button>
      </div>
    </div>
  `
}

function activityBadgeHtml(activity){
  if(!activity || activity.length === 0) return ''
  const latest = activity[0]
  return `<span class="flag flag-warn">Contacted ${activity.length} time${activity.length===1?'':'s'} - last ${new Date(latest.contacted_on+'T00:00:00').toLocaleDateString()} by ${latest.employee_name}</span>`
}

function activityListHtml(activity){
  if(!activity || activity.length === 0) return '<div class="muted">No outreach logged yet.</div>'
  return activity.map(a=>`
    <div class="activity-item">
      <div class="activity-meta"><strong>${new Date(a.contacted_on+'T00:00:00').toLocaleDateString()}</strong> - ${a.employee_name}${a.channel? ' via '+a.channel : ''}</div>
      <div class="activity-summary">${(a.summary||'').replace(/\n/g,'<br>')}</div>
      <button class="btn btn-sm activity-delete" data-id="${a.id}"><i class="fas fa-trash"></i> Delete</button>
    </div>
  `).join('')
}

function activityUrl(scopeType, scopeId){
  return scopeType === 'contact'
    ? `/api/contacts/${encodeURIComponent(scopeId)}/activity`
    : `/api/organizations/${encodeURIComponent(scopeId)}/activity`
}

async function loadEmailStats(container, contactId){
  if(!container) return
  try{
    const res  = await fetch(`/api/contacts/${contactId}/email-events`)
    const data = await res.json()
    const s    = data.summary || {}
    if(!Object.keys(s).length){ container.innerHTML = ''; return }
    const opens  = s.open  || 0
    const clicks = s.click || 0
    const rows = [
      opens  ? `<span><i class="fas fa-envelope-open" style="color:var(--blue);"></i> ${opens} open${opens!==1?'s':''}</span>` : '',
      clicks ? `<span><i class="fas fa-arrow-pointer" style="color:var(--green);"></i> ${clicks} click${clicks!==1?'s':''}</span>` : '',
    ].filter(Boolean).join('  ·  ')
    if(!rows){ container.innerHTML = ''; return }
    container.innerHTML = `
      <h4 class="detail-section-title"><i class="fas fa-chart-line"></i> Email Engagement</h4>
      <div style="font-size:13px;display:flex;gap:14px;flex-wrap:wrap;">${rows}</div>
    `
  }catch(e){ container.innerHTML = '' }
}

async function loadActivitySection(container, scopeType, scopeId){
  if(!container) return
  const listEl = container.querySelector('.activity-list')
  const badgeEl = container.querySelector('.activity-badge')
  try{
    const res = await fetch(activityUrl(scopeType, scopeId))
    const json = await res.json()
    const activity = json.activity || []
    if(badgeEl) badgeEl.innerHTML = activityBadgeHtml(activity)
    if(listEl) listEl.innerHTML = activityListHtml(activity)
    if(listEl) listEl.querySelectorAll('.activity-delete').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        if(!confirm('Delete this log entry?')) return
        await fetch('/api/activity/'+btn.dataset.id, {method:'DELETE'})
        loadActivitySection(container, scopeType, scopeId)
      })
    })
  }catch(e){ if(listEl) listEl.innerHTML = '<div class="muted">Could not load outreach history.</div>'; console.error(e) }
}

function bindActivityForm(container, scopeType, scopeId){
  if(!container) return
  const btn = container.querySelector('.activity-log-btn')
  if(!btn) return
  btn.addEventListener('click', async ()=>{
    const summary = container.querySelector('.activity-summary').value.trim()
    const channel = container.querySelector('.activity-channel').value
    const contacted_on = container.querySelector('.activity-date').value
    if(!summary){ toast('A short summary is required.', 'error'); return }
    try{
      const res = await fetch(activityUrl(scopeType, scopeId), {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ summary, channel, contacted_on })
      })
      if(!res.ok){ toast('Could not log outreach.', 'error'); return }
      container.querySelector('.activity-summary').value = ''
      loadActivitySection(container, scopeType, scopeId)
      toast('Outreach logged')
    }catch(e){ toast('Could not log outreach.', 'error'); console.error(e) }
  })
}

// ------------------------------------------------------------------ //
// Tasks — Kadin Lee-Smith                                             //
// ------------------------------------------------------------------ //

async function loadTaskBadge(){
  try{
    const res = await fetch('/api/tasks/count')
    const json = await res.json()
    const badge = el('taskBadge')
    if(!badge) return
    if(json.count > 0){
      badge.textContent = json.count
      badge.style.display = ''
    } else {
      badge.style.display = 'none'
    }
  }catch(e){ console.warn('task badge', e) }
}

function taskItemHtml(t, showContact){
  const urgency = t.urgency || 'no_date'
  const dueLabel = t.due_date ? new Date(t.due_date+'T00:00:00').toLocaleDateString() : ''
  const dueClass = urgency === 'overdue' ? 'overdue' : urgency === 'today' ? 'today' : ''
  const contactSpan = showContact && t.contact_name ? `<span class="task-contact">↳ ${t.contact_name}</span>` : ''
  const notesHtml = t.notes ? `<div class="task-notes">${t.notes.replace(/\n/g,'<br>')}</div>` : ''
  return `
    <div class="task-item task-${urgency}${t.completed ? ' task-done' : ''}">
      <button class="task-complete-btn" data-id="${t.id}" data-completed="${t.completed}" title="${t.completed ? 'Reopen' : 'Mark complete'}">
        <i class="${t.completed ? 'fas' : 'far'} fa-circle-check"></i>
      </button>
      <div class="task-body">
        <div class="task-title">${t.title}</div>
        <div class="task-meta">
          ${dueLabel ? `<span class="task-due ${dueClass}">${dueLabel}</span>` : ''}
          ${contactSpan}
        </div>
        ${notesHtml}
      </div>
      <button class="task-delete-btn btn btn-sm" data-id="${t.id}" title="Delete"><i class="fas fa-trash"></i> Delete</button>
    </div>`
}

function renderGlobalTaskList(tasks){
  if(!tasks.length) return '<div class="muted" style="text-align:center;padding:24px;">No pending tasks.</div>'
  const overdue = tasks.filter(t => t.urgency === 'overdue')
  const today   = tasks.filter(t => t.urgency === 'today')
  const upcoming= tasks.filter(t => t.urgency === 'upcoming')
  const noDate  = tasks.filter(t => t.urgency === 'no_date')
  const section = (title, items, cls) => !items.length ? '' : `
    <div class="task-section">
      <div class="task-section-header task-section-${cls}">${title} (${items.length})</div>
      ${items.map(t => taskItemHtml(t, true)).join('')}
    </div>`
  return [
    section('Overdue', overdue, 'overdue'),
    section('Due Today', today, 'today'),
    section('Upcoming', upcoming, 'upcoming'),
    section('No Date', noDate, 'nodate'),
  ].join('')
}

function bindTaskItems(container, afterAction){
  container.querySelectorAll('.task-complete-btn').forEach(btn => {
    btn.addEventListener('click', async ()=>{
      const completed = btn.dataset.completed === 'true' ? false : true
      await fetch(`/api/tasks/${btn.dataset.id}`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({completed})
      })
      loadTaskBadge()
      afterAction()
    })
  })
  container.querySelectorAll('.task-delete-btn').forEach(btn => {
    btn.addEventListener('click', async ()=>{
      if(!confirm('Delete this task?')) return
      await fetch(`/api/tasks/${btn.dataset.id}`, {method: 'DELETE'})
      loadTaskBadge()
      afterAction()
    })
  })
}

let taskPanelView = 'pending'

async function refreshTasksPanel(){
  const content = el('tasksPanelContent')
  if(!content) return
  content.innerHTML = 'Loading…'
  try{
    const url = taskPanelView === 'completed' ? '/api/tasks?completed=true' : '/api/tasks'
    const res = await fetch(url)
    const json = await res.json()
    const tasks = json.tasks || []
    if(taskPanelView === 'completed'){
      content.innerHTML = renderCompletedTaskList(tasks)
    } else {
      content.innerHTML = renderGlobalTaskList(tasks)
    }
    bindTaskItems(content, refreshTasksPanel)
  }catch(e){ content.innerHTML = '<div class="muted">Could not load tasks.</div>' }
}

function renderCompletedTaskList(tasks){
  if(!tasks.length) return '<div class="muted" style="text-align:center;padding:24px;">No completed tasks yet.</div>'
  return tasks.map(t => {
    const completedDate = t.completed_at ? new Date(t.completed_at).toLocaleDateString() : ''
    const contactSpan = t.contact_name ? `<span class="task-contact">↳ ${t.contact_name}</span>` : ''
    return `
      <div class="task-item task-done">
        <button class="task-complete-btn" data-id="${t.id}" data-completed="true" title="Reopen task">
          <i class="fas fa-circle-check"></i>
        </button>
        <div class="task-body">
          <div class="task-title">${t.title}</div>
          <div class="task-meta">
            ${completedDate ? `<span>Completed ${completedDate}</span>` : ''}
            ${contactSpan}
          </div>
        </div>
        <button class="task-delete-btn btn btn-sm" data-id="${t.id}" title="Delete"><i class="fas fa-trash"></i> Delete</button>
      </div>`
  }).join('')
}

function bindTasksPanel(){
  const btn = el('tasksBtn')
  const modal = el('tasksPanelModal')
  const closeBtn = el('closeTasksPanel')
  const showAddBtn = el('showAddGlobalTaskBtn')
  const addForm = el('addGlobalTaskForm')
  const saveBtn = el('saveGlobalTaskBtn')
  const cancelBtn = el('cancelGlobalTaskBtn')

  if(!btn || !modal) return

  btn.addEventListener('click', ()=>{
    taskPanelView = 'pending'
    const pb = el('taskViewPending'); const cb = el('taskViewCompleted')
    if(pb){ pb.classList.add('active'); pb.classList.add('task-tab') }
    if(cb) cb.classList.remove('active')
    const addGlobalTaskBtn = el('showAddGlobalTaskBtn')
    if(addGlobalTaskBtn) addGlobalTaskBtn.style.display = ''
    modal.style.display = ''
    refreshTasksPanel()
  })
  if(closeBtn) closeBtn.addEventListener('click', ()=>{ modal.style.display = 'none' })
  modal.addEventListener('click', (e)=>{ if(e.target === modal) modal.style.display = 'none' })

  const pendingBtn = el('taskViewPending')
  const completedBtn = el('taskViewCompleted')
  if(pendingBtn && completedBtn){
    pendingBtn.addEventListener('click', ()=>{
      taskPanelView = 'pending'
      pendingBtn.classList.add('active'); completedBtn.classList.remove('active')
      const f = el('addGlobalTaskForm'); if(f) f.style.display = 'none'
      const b = el('showAddGlobalTaskBtn'); if(b) b.style.display = ''
      refreshTasksPanel()
    })
    completedBtn.addEventListener('click', ()=>{
      taskPanelView = 'completed'
      completedBtn.classList.add('active'); pendingBtn.classList.remove('active')
      const f = el('addGlobalTaskForm'); if(f) f.style.display = 'none'
      const b = el('showAddGlobalTaskBtn'); if(b) b.style.display = 'none'
      refreshTasksPanel()
    })
  }

  if(showAddBtn && addForm){
    showAddBtn.addEventListener('click', ()=>{
      addForm.style.display = addForm.style.display === 'none' ? '' : 'none'
      if(addForm.style.display !== 'none'){
        const inp = el('newTaskTitle'); if(inp) inp.focus()
      }
    })
  }
  if(cancelBtn) cancelBtn.addEventListener('click', ()=>{ addForm.style.display = 'none' })
  if(saveBtn){
    saveBtn.addEventListener('click', async ()=>{
      const title = (el('newTaskTitle').value || '').trim()
      if(!title){ toast('Enter a task title.', 'error'); return }
      const due_date = el('newTaskDue').value || null
      const notesEl = el('newTaskNotes')
      const notes = (notesEl ? notesEl.value : '').trim() || null
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({title, due_date, notes})
      })
      if(!res.ok){ toast('Could not save task.', 'error'); return }
      el('newTaskTitle').value = ''
      el('newTaskDue').value = ''
      const notesField = el('newTaskNotes'); if(notesField) notesField.value = ''
      addForm.style.display = 'none'
      loadTaskBadge()
      refreshTasksPanel()
      toast('Task added')
    })
  }
}

// Contact-level task section (embedded in the contact detail panel)

function taskSectionHtml(){
  return `
    <div class="task-section-inline">
      <h4><i class="fas fa-list-check"></i> Tasks</h4>
      <div class="task-list-inline">Loading…</div>
      <div class="task-inline-form">
        <input type="text" class="task-inline-input" placeholder="Add a task…" />
        <input type="date" class="task-inline-date" />
        <button class="btn btn-sm btn-primary task-inline-add"><i class="fas fa-plus"></i> Add</button>
      </div>
      <textarea class="task-inline-notes" rows="2" placeholder="Notes (optional)" style="display:none;"></textarea>
    </div>`
}

async function loadContactTaskSection(container, contactId){
  const listEl = container.querySelector('.task-list-inline')
  if(!listEl) return
  try{
    const res = await fetch(`/api/contacts/${contactId}/tasks`)
    const json = await res.json()
    const tasks = json.tasks || []
    if(!tasks.length){
      listEl.innerHTML = '<div class="muted" style="font-size:13px;margin-bottom:6px;">No tasks yet.</div>'
    } else {
      listEl.innerHTML = tasks.map(t => taskItemHtml(t, false)).join('')
      bindTaskItems(listEl, ()=>{ loadContactTaskSection(container, contactId); loadTaskBadge() })
    }
  }catch(e){ listEl.innerHTML = '<div class="muted">Could not load tasks.</div>' }
}

function bindContactTaskForm(container, contactId){
  const addBtn = container.querySelector('.task-inline-add')
  const titleInput = container.querySelector('.task-inline-input')
  const notesEl = container.querySelector('.task-inline-notes')
  if(!addBtn) return

  // Show notes textarea when the title has something typed
  if(titleInput && notesEl){
    titleInput.addEventListener('input', ()=>{
      notesEl.style.display = titleInput.value.trim() ? '' : 'none'
    })
  }

  addBtn.addEventListener('click', async ()=>{
    const dateInput = container.querySelector('.task-inline-date')
    const title = (titleInput.value || '').trim()
    if(!title){ toast('Enter a task title.', 'error'); return }
    const due_date = dateInput.value || null
    const notes = (notesEl ? notesEl.value : '').trim() || null
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({title, due_date, notes, contact_id: contactId})
    })
    if(!res.ok){ toast('Could not save task.', 'error'); return }
    titleInput.value = ''
    dateInput.value = ''
    if(notesEl){ notesEl.value = ''; notesEl.style.display = 'none' }
    loadContactTaskSection(container, contactId)
    loadTaskBadge()
    toast('Task added')
  })
}

// searchSeq guards against races between overlapping calls (e.g. a slower
// earlier fetch resolving after a faster, later one and overwriting it).
let searchSeq = 0
async function search(){
  const mySeq = ++searchSeq
  const out = el('results')
  out.innerHTML = '<div>Loading…</div>'
  if(state.view === 'organizations') fetchSectionStats(); else fetchStats()
  const params = new URLSearchParams({page: state.page, limit: state.limit})
  if(state.q) params.set('q', state.q)
  if(state.tags.length) params.set('tag', state.tags.join(','))
  if(state.counties.length) params.set('county', state.counties.join(','))
  if(state.view !== 'organizations' && state.followup) params.set('followup', state.followup)
  if(state.view !== 'organizations' && state.favoritesOnly) params.set('favorites_only', '1')
  if(state.view !== 'organizations' && state.incompleteOnly) params.set('incomplete_only', '1')
  if(state.showDeleted) params.set('show_deleted', '1')
  try{
    if(state.view === 'organizations'){
      const res = await fetch(API.sections + '?' + params.toString())
      const j = await res.json()
      if(mySeq !== searchSeq) return
      out.innerHTML = ''
      state.total = j.total || 0
      if(!j.organizations || j.organizations.length === 0){ out.innerHTML = '<div>No organizations found</div>'; renderPagination(state.total); return }
      if(state.layout === 'list'){
        out.className = 'results-list-wrap'
        const list = document.createElement('div')
        list.className = 'results-list'
        const header = document.createElement('div')
        header.className = 'list-header'
        header.innerHTML = '<span></span><span>Organization</span><span>Contacts</span><span>Notes</span><span></span><span></span>'
        list.appendChild(header)
        j.organizations.forEach(item => list.appendChild(renderOrgRow(item)))
        out.appendChild(list)
      } else {
        out.className = 'results-grid'
        j.organizations.forEach(item => out.appendChild(renderOrgCard(item)))
      }
      renderPagination(state.total)
    } else {
      const res = await fetch(API.contacts + '?' + params.toString())
      const j = await res.json()
      if(mySeq !== searchSeq) return
      out.innerHTML = ''
      state.total = j.total || 0
      if(!j.contacts || j.contacts.length===0){ out.innerHTML = '<div>No results</div>'; renderPagination(state.total); return }
      if(state.layout === 'list'){
        out.className = 'results-list-wrap'
        const list = document.createElement('div')
        list.className = 'results-list'
        const header = document.createElement('div')
        header.className = 'list-header'
        header.innerHTML = '<span></span><span>Name</span><span>Organization</span><span>Title</span><span>Tag</span><span></span>'
        list.appendChild(header)
        j.contacts.forEach(c => list.appendChild(renderRow(c)))
        out.appendChild(list)
      } else {
        out.className = 'results-grid'
        j.contacts.forEach(c => out.appendChild(renderCard(c)))
      }
      renderPagination(state.total)
    }
  }catch(e){ if(mySeq===searchSeq) out.innerHTML = '<div>Error loading results</div>'; console.error(e) }
}

function renderPagination(total){
  const pagesContainer = el('pages')
  pagesContainer.innerHTML = ''
  const pages = Math.max(1, Math.ceil(total / state.limit))
  const start = Math.max(1, state.page - 2)
  const end = Math.min(pages, start + 4)
  for(let p=start;p<=end;p++){
    const b = document.createElement('button')
    b.className = 'page-number'
    b.textContent = p
    if(p===state.page) b.style.fontWeight='700'
    b.addEventListener('click', ()=>{ state.page = p; search() })
    pagesContainer.appendChild(b)
  }
}

async function openProfile(id, defaults={}){
  try{
    let c = {id:null, first_name:'', last_name:'', organization:'', title:'', email:'', phone_office:'', phone_cell:'', county:'', lists:[], notes:'', tag:'', ...defaults}
    if(id){
      const res = await fetch(`/api/contacts/${id}`)
      c = await res.json()
    }
    const body = el('modalBody')
    body.innerHTML = `
      <h2 id="modalTitle">${id? 'Edit Contact' : 'New Contact'}</h2>
      <form id="contactForm">
        <input type="hidden" id="contactId" value="${c.id||''}" />
        <label>First name<br><input id="cf_first" value="${c.first_name||''}" /></label>
        <label>Last name<br><input id="cf_last" value="${c.last_name||''}" /></label>
        <label>Organization<br><input id="cf_org" value="${c.organization||''}" /></label>
        <label>Title<br><input id="cf_title" value="${c.title||''}" /></label>
        <label>Email<br><input id="cf_email" value="${c.email||''}" /></label>
        <label>Office Phone<br><input id="cf_office" value="${c.phone_office||''}" /></label>
        <label>Cell Phone<br><input id="cf_cell" value="${c.phone_cell||''}" /></label>
        <label>Tag<br><input id="cf_tag" value="${c.tag||''}" /></label>
        <label>Lists (comma separated)<br><input id="cf_lists" value="${(c.lists||[]).join(', ')}" /></label>
        <label>County<br><input id="cf_county" value="${c.county||''}" /></label>
        <label>Notes<br><textarea id="cf_notes">${c.notes||''}</textarea></label>
        <div id="duplicateWarning" class="flag flag-warn" style="display:none;margin-top:10px;"></div>
        <div style="margin-top:10px">
          <button id="saveContactBtn" type="button" class="btn btn-primary"><i class="fas fa-check"></i> Save</button>
          <button id="addAnywayBtn" type="button" class="btn" style="display:none;">Add Anyway</button>
          <button id="closeModalBtn" type="button" class="btn">Close</button>
        </div>
      </form>
    `
    const modal = el('profileModal')
    if(modal){ modal.style.display = '' }
    el('closeModalBtn').addEventListener('click', closeModal)
    el('saveContactBtn').addEventListener('click', ()=> saveContact(false))
    el('addAnywayBtn').addEventListener('click', ()=> saveContact(true))
  }catch(e){console.error(e)}
}

async function saveContact(force){
  const id = el('contactId').value
  const payload = {
    first_name: el('cf_first').value.trim(),
    last_name: el('cf_last').value.trim(),
    organization: el('cf_org').value.trim(),
    title: el('cf_title').value.trim(),
    email: el('cf_email').value.trim(),
    phone_office: el('cf_office').value.trim(),
    phone_cell: el('cf_cell').value.trim(),
    tag: el('cf_tag').value.trim(),
    lists: (el('cf_lists').value||'').split(',').map(s=>s.trim()).filter(Boolean),
    county: el('cf_county').value.trim(),
    notes: el('cf_notes').value.trim(),
  }
  if(!id && force) payload.force_create = true
  try{
    let res
    if(id){
      res = await fetch('/api/contacts/'+id, {method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)})
    } else {
      res = await fetch('/api/contacts', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)})
    }
    const j = await res.json()
    if(!res.ok){
      if(j.warning === 'possible_duplicate'){
        const warn = el('duplicateWarning')
        warn.textContent = j.message || 'A similar contact already exists.'
        warn.style.display = ''
        el('addAnywayBtn').style.display = ''
        return
      }
      const msg = j.error === 'email exists' ? 'That email is already used by another contact.' : (j.error || 'Save failed')
      toast(msg, 'error')
      return
    }
    closeModal()
    fetchTagOptions()
    state.page = 1
    search()
    if(j && j.id) showContactDetail(j.id)
    toast('Saved')
  }catch(e){toast('Save failed', 'error'); console.error(e)}
}

// Contact detail panel & edit modal — Kadin Lee-Smith
function closeModal(){ const m = el('profileModal'); if(m) m.style.display = 'none' }

async function restoreContact(id, cardEl){
  const r = await fetch(`/api/contacts/${id}/restore`, {method:'POST'})
  const d = await r.json()
  if(d.restored) cardEl.remove()
}

async function purgeContact(id, cardEl){
  if(!confirm('Permanently delete this contact? This cannot be undone.')) return
  const r = await fetch(`/api/contacts/${id}/purge`, {method:'DELETE'})
  const d = await r.json()
  if(d.purged) cardEl.remove()
}

// Switches between the People grid (Contact rows) and the Organizations
// grid (OutreachOrg rows, cross-referenced with Contacts). The category
// filter is reset on an actual view change since People/Organization
// categories are different namespaces -- carrying one over would silently
// filter against the wrong field.
function switchView(view, userInitiated){
  const changed = state.view !== view
  state.view = view
  state.showDeleted = (view === 'deleted')
  if(changed){
    state.page = 1
    state.tags = []
  }
  const peopleBtn = el('viewPeopleBtn'); const orgBtn = el('viewOrgBtn'); const delBtn = el('viewDeletedBtn')
  if(peopleBtn) peopleBtn.classList.toggle('active', view === 'people')
  if(orgBtn) orgBtn.classList.toggle('active', view === 'organizations')
  if(delBtn) delBtn.classList.toggle('active', view === 'deleted')
  // Follow-up status is tracked per-Contact, not per-Organization, so the
  // filter doesn't apply (but isn't reset) when browsing Organizations.
  document.querySelectorAll('input[name=followupRadio]').forEach(r => { r.disabled = (view === 'organizations') })
  const favoritesOnlyCheckbox = el('favoritesOnlyCheckbox')
  if(favoritesOnlyCheckbox) favoritesOnlyCheckbox.disabled = (view === 'organizations')
  const si = el('searchInput')
  if(si) si.placeholder = view === 'people'
    ? 'Search by Name, Organization, Title, or Email...'
    : 'Search by Organization or Category...'
  if(userInitiated && changed){
    history.pushState({page: view === 'organizations' ? 'search_roles' : 'search'}, '', view === 'organizations' ? '#search_roles' : '#search')
  }
  fetchTagOptions()
  search()
}

function bind(){
  el('searchBtn').addEventListener('click', ()=>{ state.q = el('searchInput').value.trim(); state.page = 1; search() })
  el('searchInput').addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ state.q = el('searchInput').value.trim(); state.page = 1; search() } })

  const viewPeopleBtn = el('viewPeopleBtn')
  const viewOrgBtn = el('viewOrgBtn')
  if(viewPeopleBtn) viewPeopleBtn.addEventListener('click', ()=> switchView('people', true))
  if(viewOrgBtn) viewOrgBtn.addEventListener('click', ()=> switchView('organizations', true))
  const viewDeletedBtn = el('viewDeletedBtn')
  if(viewDeletedBtn) viewDeletedBtn.addEventListener('click', ()=> switchView('deleted', true))

  const layoutGridBtn = el('layoutGridBtn')
  const layoutListBtn = el('layoutListBtn')
  if(layoutGridBtn) layoutGridBtn.addEventListener('click', () => {
    state.layout = 'grid'
    layoutGridBtn.classList.add('active')
    layoutListBtn.classList.remove('active')
    search()
  })
  if(layoutListBtn) layoutListBtn.addEventListener('click', () => {
    state.layout = 'list'
    layoutListBtn.classList.add('active')
    layoutGridBtn.classList.remove('active')
    search()
  })

  document.querySelectorAll('input[name=followupRadio]').forEach(r => {
    r.addEventListener('change', ()=>{ if(r.checked) state.followup = r.value })
  })

  const favoritesOnlyCheckbox = el('favoritesOnlyCheckbox')
  if(favoritesOnlyCheckbox) favoritesOnlyCheckbox.addEventListener('change', ()=>{
    state.favoritesOnly = favoritesOnlyCheckbox.checked
  })

  const applyFiltersBtn = el('applyFiltersBtn')
  if(applyFiltersBtn) applyFiltersBtn.addEventListener('click', ()=>{ state.page = 1; search() })

  const incompleteCard = el('statIncompleteCard')
  if(incompleteCard) incompleteCard.addEventListener('click', ()=>{
    state.incompleteOnly = !state.incompleteOnly
    incompleteCard.style.outline = state.incompleteOnly ? '2px solid var(--amber, #f59e0b)' : ''
    el('statIncompleteLabel').textContent = state.incompleteOnly ? 'Need Review (filtered)' : 'Need Review'
    state.page = 1
    search()
  })

  // keyboard shortcuts: Ctrl+K and '/' -- but not while typing in a field,
  // otherwise '/' could never be typed into notes, lists, etc.
  window.addEventListener('keydown', (e)=>{
    const typingInField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName)
    if(e.ctrlKey && e.key.toLowerCase()==='k'){
      e.preventDefault(); el('searchInput').focus(); return
    }
    if(e.key === '/' && !typingInField){
      e.preventDefault(); el('searchInput').focus()
    }
  })
  el('prevPage').addEventListener('click', ()=>{ if(state.page>1){ state.page--; search() } })
  el('nextPage').addEventListener('click', ()=>{
    const maxPage = Math.max(1, Math.ceil((state.total||0)/state.limit))
    if(state.page < maxPage){ state.page++; search() }
  })
  el('closeModal').addEventListener('click', closeModal)
  const addBtn = el('addContactBtn')
  if(addBtn) addBtn.addEventListener('click', ()=>{ openProfile(null) })
  const backBtn = el('backHomeBtn')
  if(backBtn) backBtn.addEventListener('click', ()=>{ showHome(true) })
  bindExportMenu()
  bindToolsMenu()
  bindDraftEmail()
  bindSendCampaign()
  bindPipeline()
  bindCreateFlyer()
  bindCountyFilter()
  bindTagFilter()
  bindAdminMenu()
  bindTasksPanel()
}

// The Admin nav dropdown is a native <details>/<summary> (no JS needed to
// toggle it open/closed), but it doesn't close itself on an outside click
// the way the other header menus do -- this adds just that.
function bindAdminMenu(){
  const menu = document.querySelector('.admin-menu')
  if(!menu) return
  document.addEventListener('click', (e)=>{
    if(!menu.contains(e.target)) menu.removeAttribute('open')
  })
}

function currentExportParams(){
  const params = new URLSearchParams()
  if(state.q) params.set('q', state.q)
  if(state.tags.length){
    if(state.view === 'organizations') params.set('org_tag', state.tags.join(','))
    else params.set('tag', state.tags.join(','))
  }
  if(state.counties.length) params.set('county', state.counties.join(','))
  if(state.view !== 'organizations' && state.followup) params.set('followup', state.followup)
  if(state.view !== 'organizations' && state.favoritesOnly) params.set('favorites_only', '1')
  return params
}

// Draft Email and Create Flyer/Post are both AI-generation tools, distinct
// from filtering/exporting -- grouped under one toggle to cut down on
// separate buttons in the toolbar. The buttons keep their own ids/click
// handlers (bindDraftEmail/bindCreateFlyer elsewhere), this just opens
// and closes the menu they live in.
function bindToolsMenu(){
  const btn = el('toolsMenuBtn')
  const menu = el('toolsMenu')
  if(!btn || !menu) return
  btn.addEventListener('click', (e)=>{
    e.stopPropagation()
    const opening = menu.style.display === 'none'
    closeOtherFilterMenus('toolsMenu')
    menu.style.display = opening ? '' : 'none'
  })
  menu.addEventListener('click', (e)=>{
    if(e.target.closest('.export-menu-item')) menu.style.display = 'none'
  })
  document.addEventListener('click', ()=>{ menu.style.display = 'none' })
}

function bindExportMenu(){
  const btn = el('exportMenuBtn')
  const menu = el('exportMenu')
  if(!btn || !menu) return
  btn.addEventListener('click', (e)=>{
    e.stopPropagation()
    const opening = menu.style.display === 'none'
    closeOtherFilterMenus('exportMenu')
    menu.style.display = opening ? '' : 'none'
  })
  document.addEventListener('click', ()=>{ menu.style.display = 'none' })

  const copyBtn = el('exportCopyEmails')
  if(copyBtn) copyBtn.addEventListener('click', async ()=>{
    menu.style.display = 'none'
    try{
      const res = await fetch('/api/export/emails?' + currentExportParams().toString())
      const j = await res.json()
      if(!j.emails || j.emails.length === 0){ toast('No emails found for the current filter.', 'error'); return }
      await navigator.clipboard.writeText(j.joined)
      toast(`Copied ${j.count} email address${j.count===1?'':'es'} to clipboard`)
    }catch(e){ toast('Could not copy emails', 'error'); console.error(e) }
  })

  const csvBtn = el('exportCsvBtn')
  if(csvBtn) csvBtn.addEventListener('click', ()=>{
    menu.style.display = 'none'
    window.location.href = '/api/export?' + currentExportParams().toString()
  })

  const docxBtn = el('exportDocxBtn')
  if(docxBtn) docxBtn.addEventListener('click', ()=>{
    menu.style.display = 'none'
    window.location.href = '/api/export/docx?' + currentExportParams().toString()
  })
}

function bindDraftEmail(){
  const btn = el('draftEmailBtn')
  const modal = el('draftEmailModal')
  if(!btn || !modal) return

  const describeAudience = ()=>{
    const parts = []
    if(state.tags.length){
      const noun = state.view === 'organizations' ? (state.tags.length===1?'organization category':'organization categories') : (state.tags.length===1?'tag':'tags')
      parts.push(`${noun} "${state.tags.join(', ')}"`)
    }
    if(state.counties.length) parts.push(`count${state.counties.length===1?'y':'ies'} "${state.counties.join(', ')}"`)
    if(state.q) parts.push(`search "${state.q}"`)
    if(state.view !== 'organizations' && state.followup){
      parts.push(state.followup === 'never' ? 'never contacted' : `no contact in ${state.followup}+ days`)
    }
    if(state.view !== 'organizations' && state.favoritesOnly) parts.push('favorites only')
    el('draftEmailAudience').textContent = parts.length
      ? 'Drafting for the current filter: ' + parts.join(', ')
      : 'Drafting for all contacts (no filter applied).'
  }

  let caseStudiesLoaded = false
  const loadCaseStudyOptions = async ()=>{
    if(caseStudiesLoaded) return
    const sel = el('draftEmailCaseStudy')
    if(!sel) return
    try{
      const res = await fetch('/api/case-studies')
      const j = await res.json()
      ;(j.case_studies || []).forEach(cs=>{
        const opt = document.createElement('option')
        opt.value = cs.id
        opt.textContent = cs.sector ? `${cs.title} (${cs.sector})` : cs.title
        sel.appendChild(opt)
      })
      caseStudiesLoaded = true
    }catch(e){ console.error(e) }
  }

  btn.addEventListener('click', ()=>{
    describeAudience()
    el('draftEmailPrompt').value = ''
    el('draftEmailOutput').style.display = 'none'
    el('draftEmailOutput').value = ''
    el('draftEmailCopyBtn').style.display = 'none'
    el('draftEmailStatus').textContent = ''
    const csSelect = el('draftEmailCaseStudy')
    if(csSelect) csSelect.value = ''
    loadCaseStudyOptions()
    modal.style.display = ''
    el('draftEmailPrompt').focus()
  })

  el('closeDraftEmailModal').addEventListener('click', ()=>{ modal.style.display = 'none' })

  el('draftEmailGenerateBtn').addEventListener('click', async ()=>{
    const prompt = el('draftEmailPrompt').value.trim()
    if(!prompt){ el('draftEmailStatus').textContent = 'Describe the email you want to draft.'; return }
    const genBtn = el('draftEmailGenerateBtn')
    genBtn.disabled = true
    el('draftEmailStatus').textContent = 'Drafting…'
    el('draftEmailOutput').style.display = 'none'
    el('draftEmailCopyBtn').style.display = 'none'
    if(el('draftEmailOpenBuilderBtn')) el('draftEmailOpenBuilderBtn').style.display = 'none'
    try{
      const res = await fetch('/api/draft-email', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          prompt,
          q: state.q,
          county: state.counties.join(','),
          tag: state.view === 'organizations' ? undefined : state.tags.join(','),
          org_tag: state.view === 'organizations' ? state.tags.join(',') : undefined,
          followup: state.view === 'organizations' ? undefined : (state.followup || undefined),
          favorites_only: state.view === 'organizations' ? undefined : (state.favoritesOnly || undefined),
          case_study_id: el('draftEmailCaseStudy') ? (el('draftEmailCaseStudy').value || undefined) : undefined,
        })
      })
      const j = await res.json()
      if(!res.ok){ el('draftEmailStatus').textContent = j.error || 'Could not draft email.'; return }
      el('draftEmailOutput').value = j.draft || ''
      el('draftEmailOutput').style.display = ''
      el('draftEmailCopyBtn').style.display = ''
      if(el('draftEmailOpenBuilderBtn')) el('draftEmailOpenBuilderBtn').style.display = ''
      el('draftEmailStatus').textContent = `Drafted for ${j.recipient_count} recipient${j.recipient_count===1?'':'s'}.`
    }catch(e){
      el('draftEmailStatus').textContent = 'Could not reach the server.'
      console.error(e)
    }finally{
      genBtn.disabled = false
    }
  })

  el('draftEmailCopyBtn').addEventListener('click', async ()=>{
    try{
      await navigator.clipboard.writeText(el('draftEmailOutput').value)
      el('draftEmailStatus').textContent = 'Copied to clipboard.'
    }catch(e){ el('draftEmailStatus').textContent = 'Could not copy.' }
  })

  if(el('draftEmailOpenBuilderBtn')){
    el('draftEmailOpenBuilderBtn').addEventListener('click', async ()=>{
      const raw = el('draftEmailOutput').value.trim()
      if(!raw) return
      const lines = raw.split('\n')
      let subject = ''
      let bodyStart = 0
      const subjectLine = lines.find((l, i) => { bodyStart = i; return l.toLowerCase().startsWith('subject:') })
      if(subjectLine){ subject = subjectLine.replace(/^subject:\s*/i, '').trim(); bodyStart++ }
      while(bodyStart < lines.length && lines[bodyStart].trim() === '') bodyStart++
      const bodyText = lines.slice(bodyStart).join('\n').trim()
      const bodyHtml = bodyText.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g,'<br>')}</p>`).join('')
      el('draftEmailOpenBuilderBtn').disabled = true
      el('draftEmailStatus').textContent = 'Opening in Email Builder…'
      try{
        const res = await fetch('/api/email-templates', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            name: subject || 'AI Draft',
            subject,
            blocks: [{ id: 'body', type: 'richtext', html: bodyHtml }]
          })
        })
        const t = await res.json()
        if(!res.ok){ el('draftEmailStatus').textContent = t.error || 'Could not create template.'; return }
        window.location.href = `/email-builder/${t.id}`
      }catch(e){
        el('draftEmailStatus').textContent = 'Could not open Email Builder.'
      }finally{
        el('draftEmailOpenBuilderBtn').disabled = false
      }
    })
  }
}

function bindSendCampaign(){
  const openBtn = el('sendCampaignBtn')
  const modal   = el('campaignModal')
  if(!openBtn || !modal) return

  function currentFilterParams(){
    const p = new URLSearchParams()
    if(state.q) p.set('q', state.q)
    if(state.tags.length) p.set('tag', state.tags.join(','))
    if(state.counties.length) p.set('county', state.counties.join(','))
    if(state.followup) p.set('followup', state.followup)
    if(state.favoritesOnly) p.set('favorites_only', 'true')
    return p
  }

  async function loadCampaignPreview(){
    const aud = el('campaignAudience')
    if(!aud) return
    aud.textContent = 'Counting recipients…'
    try{
      const res = await fetch('/api/campaign/preview?' + currentFilterParams())
      const json = await res.json()
      const n = json.recipient_count || 0
      const snd = el('campaignSendBtn')
      if(n === 0){
        aud.textContent = 'No contacts with email addresses match the current filter.'
        if(snd) snd.textContent = 'Send (0 recipients)'
      } else {
        const sample = (json.sample || []).join(', ')
        aud.textContent = `Will send to ${n} contact${n===1?'':'s'}${sample ? ' - e.g. ' + sample : ''}.`
        if(snd) snd.textContent = `Send to ${n} contact${n===1?'':'s'}`
      }
    }catch(e){ if(el('campaignAudience')) el('campaignAudience').textContent = 'Could not count recipients.' }
  }

  openBtn.addEventListener('click', async ()=>{
    // Reset to step 1
    const s1 = el('campaignStep1'); const s2 = el('campaignStep2')
    if(s1) s1.style.display = ''
    if(s2) s2.style.display = 'none'
    const p = el('campaignPrompt'); if(p) p.value = ''
    const gs = el('campaignGenStatus'); if(gs) gs.textContent = ''
    const ss = el('campaignSendStatus'); if(ss) ss.textContent = ''
    modal.style.display = ''
    loadCampaignPreview()
    // Populate case study dropdown (same as draft email)
    try{
      const r = await fetch('/api/case-studies')
      const cs = (await r.json()).case_studies || []
      const sel = el('campaignCaseStudy')
      if(sel){
        sel.innerHTML = '<option value="">None</option>'
        cs.forEach(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.title; sel.appendChild(o) })
      }
    }catch(e){}
  })

  el('closeCampaignModal').addEventListener('click', ()=>{ modal.style.display = 'none' })
  modal.addEventListener('click', e=>{ if(e.target===modal) modal.style.display='none' })

  el('campaignGenerateBtn').addEventListener('click', async ()=>{
    const prompt = (el('campaignPrompt').value || '').trim()
    if(!prompt){ toast('Describe what the email is about.', 'error'); return }
    const gs = el('campaignGenStatus'); gs.textContent = 'Generating draft…'
    el('campaignGenerateBtn').disabled = true
    try{
      const params = Object.fromEntries(currentFilterParams())
      const res = await fetch('/api/draft-email', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          prompt,
          case_study_id: el('campaignCaseStudy').value || null,
          ...params,
        })
      })
      const json = await res.json()
      if(!res.ok){ gs.textContent = json.error || 'Could not generate draft.'; return }

      // Parse "Subject: ..." line from draft
      const draft = json.draft || ''
      const lines = draft.split('\n')
      let subject = '', bodyLines = []
      let pastSubject = false
      for(const line of lines){
        if(!pastSubject && line.toLowerCase().startsWith('subject:')){
          subject = line.replace(/^subject:\s*/i, '').trim()
          pastSubject = true
        } else if(pastSubject || subject){
          bodyLines.push(line)
        } else {
          bodyLines.push(line)
        }
      }
      const body = bodyLines.join('\n').replace(/^\n+/, '')

      el('campaignSubject').value = subject
      el('campaignBody').value = body
      el('campaignStep1').style.display = 'none'
      el('campaignStep2').style.display = ''
      gs.textContent = ''
    }catch(e){ gs.textContent = 'Error generating draft.' }
    finally{ el('campaignGenerateBtn').disabled = false }
  })

  el('campaignBackBtn').addEventListener('click', ()=>{
    el('campaignStep1').style.display = ''
    el('campaignStep2').style.display = 'none'
    el('campaignSendStatus').textContent = ''
  })

  el('campaignSendBtn').addEventListener('click', async ()=>{
    const subject = (el('campaignSubject').value || '').trim()
    const body    = (el('campaignBody').value || '').trim()
    if(!subject){ toast('Add a subject line before sending.', 'error'); return }
    if(!body){ toast('The email body is empty.', 'error'); return }
    const ss = el('campaignSendStatus')
    ss.textContent = 'Sending…'
    el('campaignSendBtn').disabled = true
    try{
      const params = Object.fromEntries(currentFilterParams())
      const res = await fetch('/api/campaign/send', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({subject, body, ...params})
      })
      const json = await res.json()
      if(!res.ok){ ss.textContent = json.error || 'Send failed.'; return }
      modal.style.display = 'none'
      toast(`Campaign sent: ${json.sent} delivered, ${json.failed} failed.`)
    }catch(e){ ss.textContent = 'Send failed - check your connection.' }
    finally{ el('campaignSendBtn').disabled = false }
  })
}

// Pipeline kanban board — Kadin Lee-Smith
const PIPELINE_STAGES = ['Lead', 'Engaged', 'Proposal', 'Client', 'Inactive']

async function movePipelineContact(contactId, stage){
  const res = await fetch(`/api/pipeline/${contactId}`, {
    method: 'PATCH',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({pipeline_stage: stage})
  })
  if(!res.ok){ toast('Could not update stage', 'error'); return false }
  return true
}

function pipelineStageOpts(current){
  return ['', ...PIPELINE_STAGES].map(s =>
    `<option value="${s}" ${s===current?'selected':''}>${s||'- Remove -'}</option>`
  ).join('')
}

function pipelineListRowHtml(c){
  return `<div class="pipeline-list-row" data-id="${c.id}">
    <div class="pipeline-list-info">
      <div class="pipeline-list-name">${c.name}</div>
      ${c.organization ? `<div class="pipeline-list-org">${c.organization}</div>` : ''}
    </div>
    <select class="pipeline-list-stage-select" data-id="${c.id}">
      ${pipelineStageOpts(c.pipeline_stage)}
    </select>
    <button class="pipeline-list-remove" data-id="${c.id}" title="Remove from pipeline">✕</button>
  </div>`
}

let _pipelineData = {contacts: {}}
let _pipelineStageFilter = ''

function renderPipelineList(){
  const list = el('pipelineList')
  if(!list) return
  let rows = []
  if(_pipelineStageFilter){
    rows = _pipelineData.contacts[_pipelineStageFilter] || []
  } else {
    PIPELINE_STAGES.forEach(s => { rows = rows.concat(_pipelineData.contacts[s] || []) })
  }
  if(!rows.length){
    list.innerHTML = '<div class="pipeline-empty">No contacts in this stage yet.<br>Search above to add one.</div>'
    return
  }
  list.innerHTML = rows.map(pipelineListRowHtml).join('')
  list.querySelectorAll('.pipeline-list-stage-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const id = parseInt(sel.dataset.id)
      const ok = await movePipelineContact(id, sel.value)
      if(ok) await loadPipelineData()
    })
  })
  list.querySelectorAll('.pipeline-list-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await movePipelineContact(parseInt(btn.dataset.id), '')
      if(ok) await loadPipelineData()
    })
  })
}

async function loadPipelineData(){
  const list = el('pipelineList')
  if(list) list.innerHTML = '<div class="pipeline-loading">Loading…</div>'
  const res = await fetch('/api/pipeline')
  _pipelineData = await res.json()
  // Update tab counts
  document.querySelectorAll('.pipeline-tab').forEach(tab => {
    const stage = tab.dataset.stage
    const count = stage
      ? (_pipelineData.contacts[stage] || []).length
      : PIPELINE_STAGES.reduce((n, s) => n + (_pipelineData.contacts[s] || []).length, 0)
    const label = stage || 'All'
    tab.textContent = `${label} (${count})`
  })
  renderPipelineList()
}

function pipelineStageSectionHtml(currentStage){
  const opts = ['', ...PIPELINE_STAGES].map(s =>
    `<option value="${s}" ${s===currentStage?'selected':''}>${s||'- Not in pipeline -'}</option>`
  ).join('')
  return `<div class="detail-section pipeline-stage-section">
    <h4 class="detail-section-title"><i class="fas fa-kanban"></i> Pipeline Stage</h4>
    <select id="pipelineStageSelect" class="pipeline-stage-select">${opts}</select>
  </div>`
}

let _pipelineSearchTimer = null

function bindPipeline(){
  const openBtn = el('pipelineBtn')
  const modal   = el('pipelineModal')
  if(!openBtn || !modal) return

  openBtn.addEventListener('click', ()=>{
    modal.style.display = ''
    _pipelineStageFilter = ''
    document.querySelectorAll('.pipeline-tab').forEach(t => t.classList.toggle('active', t.dataset.stage === ''))
    el('pipelineSearchInput').value = ''
    el('pipelineSearchResults').style.display = 'none'
    loadPipelineData()
  })

  el('closePipelineModal').addEventListener('click', ()=>{ modal.style.display = 'none' })
  modal.addEventListener('click', e=>{ if(e.target===modal) modal.style.display='none' })

  // Stage tabs
  document.querySelectorAll('.pipeline-tab').forEach(tab => {
    tab.addEventListener('click', ()=>{
      document.querySelectorAll('.pipeline-tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      _pipelineStageFilter = tab.dataset.stage
      renderPipelineList()
    })
  })

  // Search to add/find contacts
  const searchInput = el('pipelineSearchInput')
  const searchResults = el('pipelineSearchResults')

  searchInput.addEventListener('input', ()=>{
    clearTimeout(_pipelineSearchTimer)
    const q = searchInput.value.trim()
    if(!q){ searchResults.style.display = 'none'; return }
    _pipelineSearchTimer = setTimeout(async ()=>{
      const res = await fetch(`/api/contacts?q=${encodeURIComponent(q)}&per_page=8`)
      const data = await res.json()
      const contacts = data.contacts || []
      if(!contacts.length){ searchResults.style.display = 'none'; return }
      searchResults.innerHTML = contacts.map(c => {
        const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.organization || '(no name)'
        return `<div class="pipeline-search-result" data-id="${c.id}">
          <div>
            <div class="pipeline-search-result-name">${name}</div>
            ${c.organization ? `<div class="pipeline-search-result-org">${c.organization}</div>` : ''}
          </div>
          <select class="pipeline-search-result-select" data-id="${c.id}" data-name="${name}">
            ${pipelineStageOpts(c.pipeline_stage || '')}
          </select>
        </div>`
      }).join('')
      searchResults.style.display = ''

      searchResults.querySelectorAll('.pipeline-search-result-select').forEach(sel => {
        sel.addEventListener('change', async ()=>{
          const ok = await movePipelineContact(parseInt(sel.dataset.id), sel.value)
          if(ok){
            toast(sel.value ? `${sel.dataset.name} → ${sel.value}` : `Removed from pipeline`)
            await loadPipelineData()
          }
        })
      })
    }, 250)
  })

  // Close search results when clicking outside
  document.addEventListener('click', e=>{
    if(!searchInput.contains(e.target) && !searchResults.contains(e.target)){
      searchResults.style.display = 'none'
    }
  })
}

function bindCreateFlyer(){
  const btn = el('createFlyerBtn')
  const modal = el('createFlyerModal')
  if(!btn || !modal) return

  // Style tile selection
  function initFlyerStyleTiles(){
    const tiles = document.querySelectorAll('.flyer-style-tile')
    tiles.forEach(tile => {
      tile.addEventListener('click', ()=>{
        tiles.forEach(t => t.classList.remove('selected'))
        tile.classList.add('selected')
        el('flyerBgStyle').value = tile.dataset.style
      })
    })
    if(tiles.length) tiles[0].classList.add('selected')
  }
  initFlyerStyleTiles()

  // Color tile selection — updates hidden input and reloads style previews
  function initFlyerColorTiles(){
    const tiles = document.querySelectorAll('.flyer-color-tile')
    tiles.forEach(tile => {
      tile.addEventListener('click', ()=>{
        tiles.forEach(t => t.classList.remove('selected'))
        tile.classList.add('selected')
        const color = tile.dataset.color
        el('flyerColorScheme').value = color
        // Reload style preview thumbnails with the new color
        const ts = Date.now()
        document.querySelectorAll('.flyer-style-tile img').forEach(img => {
          img.src = `/api/flyer-bg-preview?style=${img.dataset.style}&color=${color}&t=${ts}`
        })
      })
    })
    if(tiles.length) tiles[0].classList.add('selected')
  }
  initFlyerColorTiles()

  btn.addEventListener('click', ()=>{
    el('createFlyerPrompt').value = ''
    el('createFlyerOutput').style.display = 'none'
    el('createFlyerOutput').src = ''
    el('createFlyerDownloadBtn').style.display = 'none'
    if(el('createFlyerOpenBuilderBtn')) el('createFlyerOpenBuilderBtn').style.display = 'none'
    el('createFlyerStatus').textContent = ''
    modal.style.display = ''
    el('createFlyerPrompt').focus()
  })

  el('closeCreateFlyerModal').addEventListener('click', ()=>{ modal.style.display = 'none' })

  el('createFlyerGenerateBtn').addEventListener('click', async ()=>{
    const prompt = el('createFlyerPrompt').value.trim()
    if(!prompt){ el('createFlyerStatus').textContent = 'Describe what the post or flyer is about.'; return }
    const format = document.querySelector('input[name="flyerFormat"]:checked').value
    const color_scheme = el('flyerColorScheme') ? el('flyerColorScheme').value : 'maroon'
    const bg_style = el('flyerBgStyle') ? el('flyerBgStyle').value : 'diagonal'
    const logo_position = el('flyerLogoPosition') ? el('flyerLogoPosition').value : 'top-left'
    const text_layout = el('flyerTextLayout') ? el('flyerTextLayout').value : 'bottom-banner'
    const genBtn = el('createFlyerGenerateBtn')
    genBtn.disabled = true
    el('createFlyerStatus').textContent = 'Generating…'
    el('createFlyerOutput').style.display = 'none'
    el('createFlyerDownloadBtn').style.display = 'none'
    if(el('createFlyerOpenBuilderBtn')) el('createFlyerOpenBuilderBtn').style.display = 'none'
    try{
      const res = await fetch('/api/generate-flyer', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ prompt, format, color_scheme, bg_style, logo_position, text_layout })
      })
      const j = await res.json()
      if(!res.ok){ el('createFlyerStatus').textContent = j.error || 'Could not generate the image.'; return }
      window._lastFlyerResult = j
      el('createFlyerOutput').src = j.image
      el('createFlyerOutput').style.display = ''
      el('createFlyerDownloadBtn').href = j.image
      el('createFlyerDownloadBtn').style.display = ''
      if(el('createFlyerOpenBuilderBtn')) el('createFlyerOpenBuilderBtn').style.display = ''
      el('createFlyerStatus').textContent = `Headline: "${j.headline}"`
    }catch(e){
      el('createFlyerStatus').textContent = 'Could not reach the server.'
      console.error(e)
    }finally{
      genBtn.disabled = false
    }
  })

  if(el('createFlyerOpenBuilderBtn')){
    el('createFlyerOpenBuilderBtn').addEventListener('click', async ()=>{
      if(!window._lastFlyerResult) return
      const { raw_background, headline, body, format: genFmt } = window._lastFlyerResult
      const prompt = el('createFlyerPrompt').value.trim()
      // Map generate-flyer format names to flyer builder format names
      const builderFormat = genFmt === 'portrait' ? 'flyer' : 'square'
      // Canvas display dims for element positioning
      const dims = { flyer: {w:408,h:528}, square: {w:540,h:540} }
      const {w, h} = dims[builderFormat] || dims['square']
      el('createFlyerOpenBuilderBtn').disabled = true
      el('createFlyerStatus').textContent = 'Opening in Flyer Builder…'
      try{
        // Upload the raw background (no baked-in text/logo)
        const res = await fetch(raw_background)
        const blob = await res.blob()
        const fd = new FormData()
        fd.append('file', blob, 'ai-bg.png')
        const assetRes = await fetch('/api/flyer-assets', { method: 'POST', body: fd })
        if(!assetRes.ok){ el('createFlyerStatus').textContent = 'Could not upload image.'; return }
        const asset = await assetRes.json()
        // Build editable elements: logo + headline + body text
        const uid = () => Math.random().toString(36).slice(2,9)
        const elements = [
          { id: uid(), type: 'logo', x: 20, y: 20, width: Math.round(w*0.35), height: Math.round(w*0.12), opacity: 100 },
          { id: uid(), type: 'heading', x: 20, y: Math.round(h*0.72), width: w-40, height: Math.round(h*0.14), text: headline || 'Heading', fontSize: builderFormat==='flyer'?28:36, color: '#ffffff', bold: true, align: 'left', opacity: 100 },
          ...(body ? [{ id: uid(), type: 'text', x: 20, y: Math.round(h*0.86), width: w-40, height: Math.round(h*0.1), text: body, fontSize: builderFormat==='flyer'?14:16, color: '#f0f0f0', bold: false, align: 'left', opacity: 100 }] : []),
        ]
        const tplRes = await fetch('/api/flyer-templates', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ name: prompt || 'AI Flyer', format: builderFormat, elements, background: '#000000', bg_asset_id: asset.id })
        })
        if(!tplRes.ok){ el('createFlyerStatus').textContent = 'Could not create flyer.'; return }
        const tpl = await tplRes.json()
        window.location.href = `/flyer-builder/${tpl.id}`
      }catch(e){
        el('createFlyerStatus').textContent = 'Could not open Flyer Builder.'
        console.error(e)
      }finally{
        el('createFlyerOpenBuilderBtn').disabled = false
      }
    })
  }
}

window.addEventListener('load', async ()=>{
  bind();
  loadTaskBadge();
  await fetchCounties();
  if(window.location.hash === '#search' || window.location.hash === '#search_roles'){
    const view = window.location.hash === '#search_roles' ? 'organizations' : 'people'
    showSearch(false, true, view)
  } else {
    showHome(false)
  }
})

function showHome(push=true){
  const hero = el('hero')
  const headerHidden = document.querySelectorAll('.header-hidden')
  const results = el('results')
  const pagination = document.querySelector('.pagination')
  const detail = el('contactDetail')
  const appMain = el('appMain')
  const mainContent = el('mainContent')
  if(hero) hero.style.display = ''
  headerHidden.forEach(n=> { n.classList.add('header-hidden'); n.style.display = 'none' })
  if(results) results.style.display = 'none'
  if(detail) detail.style.display = 'none'
  if(pagination) pagination.style.display = 'none'
  if(mainContent) mainContent.style.display = 'none'
  if(appMain) appMain.classList.remove('has-toolbar')
  if(push) history.pushState({page:'home'}, '', '/')
}

// One unified search screen for both People and Organizations -- `view`
// just determines which dataset is fetched/rendered into the same grid.
function showSearch(push=true, focus=true, view='people'){
  const hero = el('hero')
  const headerHidden = document.querySelectorAll('.header-hidden')
  const results = el('results')
  const pagination = document.querySelector('.pagination')
  const detail = el('contactDetail')
  const appMain = el('appMain')
  const mainContent = el('mainContent')
  if(hero) hero.style.display = 'none'
  headerHidden.forEach(n=> { n.classList.remove('header-hidden'); n.style.display = '' })
  if(mainContent) mainContent.style.display = ''
  if(results) results.style.display = ''
  if(pagination) pagination.style.display = ''
  if(detail) detail.style.display = 'none'
  if(appMain) appMain.classList.add('has-toolbar')
  switchView(view, false)
  if(push) history.pushState({page: view === 'organizations' ? 'search_roles' : 'search'}, '', view === 'organizations' ? '#search_roles' : '#search')
  if(focus){ const si = el('searchInput'); if(si) si.focus() }
}

window.addEventListener('popstate', ()=>{
  const hash = window.location.hash
  if(hash === '#search_roles'){ showSearch(false,false,'organizations') }
  else if(hash === '#search'){ showSearch(false,false,'people') }
  else showHome(false)
})

// Hash-based navigation & DOMContentLoaded init — Kadin Lee-Smith
// Support hash-based navigation fallback (used by inline hero buttons)
window.addEventListener('hashchange', ()=>{
  if(window.location.hash === '#search' || window.location.hash === '#search_roles'){
    const view = window.location.hash === '#search_roles' ? 'organizations' : 'people'
    showSearch(false,false,view)
  }
})

// Attach hero button handler immediately so it works without relying on DOMContentLoaded.
// People vs Organizations is now just the in-page toggle, not a separate entry point.
{
  const e = el('homeEnter'); if(e) e.addEventListener('click', ()=> { showSearch(true, true, 'people') })
}
