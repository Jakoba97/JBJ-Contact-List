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
  contactOrganizations: '/api/contact-organizations',
  groups: '/api/groups',
}

let state = { page: 1, limit: 25, q: '', tags: [], counties: [], organizations: [], followup: '', favoritesOnly: false, total: 0, view: 'people', selectedKey: null, showDeleted: false }

// Tracks which row is currently highlighted (Gmail-style) as its detail
// modal is open -- purely visual, the modal itself is closed with its own X.
function selectCard(key, cardEl, openFn){
  state.selectedKey = key
  document.querySelectorAll('.card.selected, .contacts-table tr.selected').forEach(c=>c.classList.remove('selected'))
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
  ;['exportMenu', 'toolsMenu', 'filterMenu'].forEach(id => {
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

function updateOrgFilterLabel(){
  const label = el('orgFilterLabel')
  if(!label) return
  label.textContent = state.organizations.length ? `(${state.organizations.length} selected)` : ''
}

// Organization filter only applies to the People view -- Organizations view
// already lists one row per organization, so filtering by organization
// there would just be a text search, not a category filter.
async function fetchContactOrganizations(){
  const menu = el('orgFilterMenu')
  if(!menu) return
  try{
    const res = await fetch(API.contactOrganizations)
    const names = await res.json()
    if(!names.length){
      menu.innerHTML = '<div class="filter-menu-empty">No organizations on file yet.</div>'
      updateOrgFilterLabel()
      return
    }
    menu.innerHTML = names.map(name => `
      <label class="filter-option">
        <input type="checkbox" value="${name}" ${state.organizations.includes(name) ? 'checked' : ''}>
        <span>${name}</span>
      </label>
    `).join('')
    menu.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', ()=>{
        if(cb.checked){
          if(!state.organizations.includes(cb.value)) state.organizations.push(cb.value)
        } else {
          state.organizations = state.organizations.filter(o => o !== cb.value)
        }
        updateOrgFilterLabel()
      })
    })
    updateOrgFilterLabel()
  }catch(e){console.warn(e)}
}

function activeFilterCount(){
  return state.tags.length + state.counties.length + state.organizations.length
    + (state.followup ? 1 : 0) + (state.favoritesOnly ? 1 : 0)
}

function updateFilterCountBadge(){
  const badge = el('filterCountBadge')
  if(!badge) return
  const count = activeFilterCount()
  badge.textContent = count
  badge.style.display = count ? '' : 'none'
}

function bindFilterMenu(){
  const btn = el('filterMenuBtn')
  const menu = el('filterMenu')
  if(!btn || !menu) return
  btn.addEventListener('click', (e)=>{
    e.stopPropagation()
    const opening = menu.style.display === 'none'
    closeOtherFilterMenus('filterMenu')
    menu.style.display = opening ? '' : 'none'
  })
  menu.addEventListener('click', (e)=> e.stopPropagation())
  document.addEventListener('click', ()=>{ menu.style.display = 'none' })

  const applyBtn = el('applyFiltersBtn')
  if(applyBtn) applyBtn.addEventListener('click', ()=>{
    updateFilterCountBadge()
    menu.style.display = 'none'
    state.page = 1
    search()
  })

  const clearBtn = el('clearFiltersBtn')
  if(clearBtn) clearBtn.addEventListener('click', ()=>{
    state.tags = []; state.counties = []; state.organizations = []; state.followup = ''; state.favoritesOnly = false
    const favCb = el('favoritesOnlyCheckbox'); if(favCb) favCb.checked = false
    const allRadio = document.querySelector('input[name=followupRadio][value=""]'); if(allRadio) allRadio.checked = true
    fetchTagOptions(); fetchCounties(); fetchContactOrganizations()
    updateFilterCountBadge()
    state.page = 1
    search()
  })
}

async function fetchStats(){
  try{
    const res = await fetch(API.stats)
    const json = await res.json()
    el('statTotal').textContent = (json.total ?? 0).toLocaleString()
    if(el('statOrgs')) el('statOrgs').textContent = (json.organizations ?? 0).toLocaleString()
    if(el('statGroups')) el('statGroups').textContent = (json.groups ?? 0).toLocaleString()
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

// Single-line-per-contact table row -- Name/Organization/Title/Phone/Email,
// plus a toggleable favorite star. Clicking the name opens the full detail
// modal (contact info, tags, and the outreach activity log).
function renderContactTableRow(c){
  const key = 'contact:'+c.id
  const tr = document.createElement('tr')
  tr.className = state.selectedKey === key ? 'selected' : ''
  const phone = c.phone_office || c.phone_cell || ''
  tr.innerHTML = `
    <td class="col-star">
      <button class="favorite-btn${c.is_favorite? ' is-favorite':''}" title="${c.is_favorite? 'Unstar' : 'Star this contact'}" aria-pressed="${c.is_favorite? 'true':'false'}">
        <i class="${c.is_favorite? 'fas':'far'} fa-star"></i>
      </button>
    </td>
    <td><a href="#" class="contact-name-link">${c.first_name||''} ${c.last_name||''}</a></td>
    <td>${c.organization || '<span class="muted">-</span>'}</td>
    <td>${c.title || '<span class="muted">-</span>'}</td>
    <td>${phone || '<span class="muted">-</span>'}</td>
    <td>${c.email ? `<a href="mailto:${c.email}">${c.email}</a>` : '<span class="muted">-</span>'}</td>
    ${state.showDeleted ? `<td class="col-actions">
      <button class="btn btn-sm restore-btn"><i class="fas fa-rotate-left"></i> Restore</button>
      <button class="btn btn-sm btn-danger purge-btn"><i class="fas fa-trash"></i> Delete Forever</button>
    </td>` : ''}
  `
  tr.addEventListener('click', (ev)=>{
    if(ev.target && ev.target.closest('.contact-name-link')) ev.preventDefault()
    if(ev.target && ev.target.closest('.favorite-btn, .restore-btn, .purge-btn')) return
    if(!state.showDeleted) selectCard(key, tr, ()=> showContactDetail(c))
  })
  const favoriteBtn = tr.querySelector('.favorite-btn')
  if(favoriteBtn) favoriteBtn.addEventListener('click', (e)=>{ e.stopPropagation(); toggleFavorite(c, favoriteBtn) })
  const restoreBtn = tr.querySelector('.restore-btn')
  if(restoreBtn) restoreBtn.addEventListener('click', (e)=>{ e.stopPropagation(); restoreContact(c.id, tr) })
  const purgeBtn = tr.querySelector('.purge-btn')
  if(purgeBtn) purgeBtn.addEventListener('click', (e)=>{ e.stopPropagation(); purgeContact(c.id, tr) })
  return tr
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
    const row = btnEl.closest('.card, tr')
    if(state.favoritesOnly && !next && row) row.remove()
  }catch(e){ toast('Could not reach the server.', 'error'); console.error(e) }
}

async function deleteContact(c){
  const name = `${c.first_name||''} ${c.last_name||''}`.trim() || c.email || 'this contact'
  if(!confirm(`Delete ${name}? This also removes their logged outreach history and cannot be undone.`)) return
  try{
    const res = await fetch(`/api/contacts/${c.id}`, { method: 'DELETE' })
    if(!res.ok){ toast('Could not delete this contact.', 'error'); return }
    state.selectedKey = null
    closeModal()
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

function renderGroupCard(g){
  const div = document.createElement('div')
  const key = 'group:'+g.id
  div.className = 'card' + (state.selectedKey === key ? ' selected' : '')
  div.tabIndex = 0
  div.innerHTML = `
    <div class="card-top">
      <div class="avatar md"><i class="fas fa-layer-group"></i></div>
      <div>
        <h3>${g.name||''}</h3>
        <div class="meta">${g.contact_count||0} contact${g.contact_count===1?'':'s'}</div>
      </div>
    </div>
    ${g.description ? `<div class="category">${g.description}</div>` : '<div class="muted">No description</div>'}
    <div class="card-actions" style="margin-top:8px;display:flex;gap:8px;">
      <button class="btn btn-sm view-btn"><i class="fas fa-eye"></i> View</button>
    </div>
  `
  div.addEventListener('click', ()=>{ selectCard(key, div, ()=> showGroupDetail(g.id)) })
  return div
}

async function showContactDetail(contact){
  try{
    let c = contact
    if(typeof contact === 'number' || typeof contact === 'string'){
      const res = await fetch('/api/contacts/' + encodeURIComponent(contact))
      c = await res.json()
    }
    const panel = el('modalBody')
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
          <div class="detail-row"><strong>Tag:</strong> ${c.tag ? pillHtml(c.tag,'small') : '<span class="muted">No tag assigned</span>'}</div>
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
          ${activitySectionHtml()}
        </div>
      </div>
    `
    const modal = el('profileModal')
    if(modal) modal.style.display = ''
    panel.scrollTop = 0
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
    const activityContainer = panel.querySelector('.activity-section')
    loadActivitySection(activityContainer, 'contact', c.id)
    bindActivityForm(activityContainer, 'contact', c.id)
  }catch(e){ console.error(e) }
}

// Org-level detail: full contact list (each clickable into their own detail
// or edit), notes, last-touched date, and the shared outreach-activity log.
function showOrgDetail(item){
  const panel = el('modalBody')
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
  const modal = el('profileModal')
  if(modal) modal.style.display = ''
  const addBtn = el('detailAddContactBtn')
  if(addBtn) addBtn.addEventListener('click', ()=> openProfile(null, {organization: item.organization, tag: item.tag||''}))
  panel.querySelectorAll('.view-person-btn').forEach(b=> b.addEventListener('click', ()=> showContactDetail(parseInt(b.dataset.id,10))))
  panel.querySelectorAll('.edit-person-btn').forEach(b=> b.addEventListener('click', ()=> openProfile(parseInt(b.dataset.id,10))))
  const activityContainer = panel.querySelector('.activity-section')
  loadActivitySection(activityContainer, 'org', item.organization)
  bindActivityForm(activityContainer, 'org', item.organization)
}

// Groups: a hand-picked list of contacts with a name + description.
// Membership is managed right in the detail view -- search-and-add plus a
// remove button per member -- rather than through the contact's own record.
async function showGroupDetail(groupId){
  try{
    const res = await fetch(`/api/groups/${groupId}`)
    if(!res.ok){ toast('Could not load group.', 'error'); return }
    const g = await res.json()
    const panel = el('modalBody')
    if(!panel) return
    const members = g.contacts || []
    const membersHtml = members.length
      ? `<div class="org-contact-list">${members.map(c=>`
          <div class="org-contact-item">
            <div class="org-contact-info">
              <div class="avatar sm">${initials(c.first_name, c.last_name)}</div>
              <div class="org-contact-text">
                <div class="pc-name">${(c.first_name||'')+' '+(c.last_name||'')}</div>
                <div class="pc-meta">${c.title||''}${c.organization? ' • '+c.organization : ''}</div>
              </div>
            </div>
            <div class="org-contact-actions">
              <button class="btn btn-sm view-person-btn" data-id="${c.id}"><i class="fas fa-eye"></i> View</button>
              <button class="btn btn-sm btn-danger remove-member-btn" data-id="${c.id}"><i class="fas fa-xmark"></i> Remove</button>
            </div>
          </div>
        `).join('')}</div>`
      : '<div class="muted">No contacts in this group yet.</div>'
    panel.innerHTML = `
      <div class="detail-card">
        <div class="detail-photo photo-placeholder"><i class="fas fa-layer-group"></i></div>
        <div class="detail-main">
          <h2>${g.name||''}</h2>
          <div class="detail-sub">${g.contact_count||0} contact${g.contact_count===1?'':'s'}</div>
          <div class="detail-notes">${g.description ? `<div class="notes">${g.description.replace(/\n/g,'<br>')}</div>` : '<span class="muted">No description</span>'}</div>
          <div class="detail-flags" style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <button id="groupEditBtn" class="btn"><i class="fas fa-pen"></i> Edit</button>
            <button id="groupDeleteBtn" class="btn" style="color:#9b1c1c;"><i class="fas fa-trash"></i> Delete Group</button>
            ${window.CAN_EXPORT ? `
            <div class="export-wrap">
              <button id="groupExportMenuBtn" class="btn"><i class="fas fa-download"></i> Export <i class="fas fa-chevron-down" style="font-size:11px;"></i></button>
              <div id="groupExportMenu" class="export-menu" style="display:none;">
                <button id="groupExportCopyEmails" class="export-menu-item"><i class="fas fa-envelope"></i> Copy Emails (for mass email)</button>
                <button id="groupExportCsvBtn" class="export-menu-item"><i class="fas fa-file-csv"></i> Download CSV</button>
                <button id="groupExportDocxBtn" class="export-menu-item"><i class="fas fa-file-word"></i> Download Word Doc</button>
              </div>
            </div>` : ''}
          </div>
          <h4 class="detail-section-title" style="margin-top:14px;"><i class="fas fa-users"></i> Members</h4>
          ${membersHtml}
          <div class="group-add-member" style="margin-top:10px;position:relative;">
            <input id="groupAddContactInput" type="text" placeholder="Search contacts to add…" autocomplete="off" style="width:100%;box-sizing:border-box;padding:9px 12px;border-radius:8px;border:1px solid rgba(148,153,156,0.4);font-family:inherit;font-size:14px;" />
            <div id="groupAddContactResults" class="pipeline-search-results" style="display:none;"></div>
          </div>
        </div>
      </div>
    `
    const modal = el('profileModal')
    if(modal) modal.style.display = ''
    panel.scrollTop = 0
    el('groupEditBtn').addEventListener('click', ()=> openGroupForm(g.id))
    el('groupDeleteBtn').addEventListener('click', ()=> deleteGroup(g))
    panel.querySelectorAll('.view-person-btn').forEach(b=> b.addEventListener('click', ()=> showContactDetail(parseInt(b.dataset.id,10))))
    panel.querySelectorAll('.remove-member-btn').forEach(b=> b.addEventListener('click', async ()=>{
      await fetch(`/api/groups/${g.id}/contacts/${b.dataset.id}`, {method:'DELETE'})
      showGroupDetail(g.id)
      if(state.view === 'groups') search()
    }))
    bindGroupAddContactPicker(g.id)
    bindGroupExportMenu(g.id)
  }catch(e){ console.error(e); toast('Could not load group.', 'error') }
}

function bindGroupExportMenu(groupId){
  const btn = el('groupExportMenuBtn')
  const menu = el('groupExportMenu')
  if(!btn || !menu) return
  btn.addEventListener('click', (e)=>{
    e.stopPropagation()
    const opening = menu.style.display === 'none'
    menu.style.display = opening ? '' : 'none'
  })
  menu.addEventListener('click', (e)=> e.stopPropagation())
  document.addEventListener('click', ()=>{ menu.style.display = 'none' })

  const copyBtn = el('groupExportCopyEmails')
  if(copyBtn) copyBtn.addEventListener('click', async ()=>{
    menu.style.display = 'none'
    try{
      const res = await fetch(`/api/export/emails?group_id=${groupId}`)
      const j = await res.json()
      if(!j.emails || j.emails.length === 0){ toast('No emails found in this group.', 'error'); return }
      await navigator.clipboard.writeText(j.joined)
      toast(`Copied ${j.count} email address${j.count===1?'':'es'} to clipboard`)
    }catch(e){ toast('Could not copy emails', 'error'); console.error(e) }
  })

  const csvBtn = el('groupExportCsvBtn')
  if(csvBtn) csvBtn.addEventListener('click', ()=>{
    menu.style.display = 'none'
    window.location.href = `/api/export?group_id=${groupId}`
  })

  const docxBtn = el('groupExportDocxBtn')
  if(docxBtn) docxBtn.addEventListener('click', ()=>{
    menu.style.display = 'none'
    window.location.href = `/api/export/docx?group_id=${groupId}`
  })
}

function bindGroupAddContactPicker(groupId){
  const input = el('groupAddContactInput')
  const results = el('groupAddContactResults')
  if(!input || !results) return
  let timer = null
  input.addEventListener('input', ()=>{
    clearTimeout(timer)
    const q = input.value.trim()
    if(!q){ results.style.display = 'none'; results.innerHTML = ''; return }
    timer = setTimeout(async ()=>{
      try{
        const res = await fetch(`/api/contacts?q=${encodeURIComponent(q)}&limit=8`)
        const j = await res.json()
        const contacts = j.contacts || []
        if(!contacts.length){
          results.innerHTML = '<div class="filter-menu-empty">No matching contacts.</div>'
          results.style.display = ''
          return
        }
        results.innerHTML = contacts.map(c => `
          <div class="pipeline-search-result" data-id="${c.id}" style="cursor:pointer;">
            <div class="pipeline-search-result-name">${c.first_name||''} ${c.last_name||''}</div>
            ${c.organization ? `<div class="pipeline-search-result-org">${c.organization}</div>` : ''}
          </div>
        `).join('')
        results.style.display = ''
        results.querySelectorAll('.pipeline-search-result').forEach(row => {
          row.addEventListener('click', async ()=>{
            await fetch(`/api/groups/${groupId}/contacts`, {
              method: 'POST', headers: {'Content-Type':'application/json'},
              body: JSON.stringify({contact_id: parseInt(row.dataset.id, 10)})
            })
            input.value = ''
            results.style.display = 'none'
            showGroupDetail(groupId)
            if(state.view === 'groups') search()
          })
        })
      }catch(e){ console.error(e) }
    }, 250)
  })
}

async function deleteGroup(g){
  if(!confirm(`Delete the group "${g.name}"? This does not delete the contacts in it.`)) return
  try{
    const res = await fetch(`/api/groups/${g.id}`, {method:'DELETE'})
    if(!res.ok){ toast('Could not delete group.', 'error'); return }
    closeModal()
    toast('Group deleted')
    state.page = 1
    search()
  }catch(e){ toast('Could not reach the server.', 'error'); console.error(e) }
}

async function openGroupForm(id){
  let g = {id: null, name: '', description: ''}
  if(id){
    const res = await fetch(`/api/groups/${id}`)
    g = await res.json()
  }
  const body = el('modalBody')
  body.innerHTML = `
    <h2>${id? 'Edit Group' : 'New Group'}</h2>
    <form id="groupForm" class="modal-form">
      <label>Group name<br><input id="gf_name" value="${g.name||''}" /></label>
      <label>Description<br><textarea id="gf_description" rows="3">${g.description||''}</textarea></label>
      <div id="groupFormError" class="flag flag-warn" style="display:none;margin-top:10px;"></div>
      <div style="margin-top:10px">
        <button id="saveGroupBtn" type="button" class="btn btn-primary"><i class="fas fa-check"></i> Save</button>
        <button id="closeGroupModalBtn" type="button" class="btn">Close</button>
      </div>
    </form>
  `
  const modal = el('profileModal')
  if(modal) modal.style.display = ''
  el('closeGroupModalBtn').addEventListener('click', closeModal)
  el('saveGroupBtn').addEventListener('click', async ()=>{
    const name = el('gf_name').value.trim()
    const description = el('gf_description').value.trim()
    const errEl = el('groupFormError')
    errEl.style.display = 'none'
    if(!name){ errEl.textContent = 'Group name is required.'; errEl.style.display = ''; return }
    try{
      const res = await fetch(id ? `/api/groups/${id}` : '/api/groups', {
        method: id ? 'PUT' : 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name, description}),
      })
      const j = await res.json()
      if(!res.ok){ errEl.textContent = j.error || 'Could not save group.'; errEl.style.display = ''; return }
      state.page = 1
      search()
      showGroupDetail(j.id)
      toast('Saved')
    }catch(e){ errEl.textContent = 'Could not reach the server.'; errEl.style.display = ''; console.error(e) }
  })
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
  fetchStats()
  const params = new URLSearchParams({page: state.page, limit: state.limit})
  if(state.q) params.set('q', state.q)
  if(state.tags.length) params.set('tag', state.tags.join(','))
  if(state.counties.length) params.set('county', state.counties.join(','))
  if(state.view !== 'organizations' && state.organizations.length) params.set('organization', state.organizations.join(','))
  if(state.view !== 'organizations' && state.followup) params.set('followup', state.followup)
  if(state.view !== 'organizations' && state.favoritesOnly) params.set('favorites_only', '1')
  if(state.showDeleted) params.set('show_deleted', '1')
  try{
    if(state.view === 'groups'){
      const res = await fetch(API.groups + '?' + params.toString())
      const j = await res.json()
      if(mySeq !== searchSeq) return
      out.innerHTML = ''
      state.total = j.total || 0
      if(!j.groups || j.groups.length === 0){ out.innerHTML = '<div>No groups yet. Click "New Group" to create one.</div>'; renderPagination(state.total); return }
      out.className = 'results-grid'
      j.groups.forEach(g => out.appendChild(renderGroupCard(g)))
      renderPagination(state.total)
    } else if(state.view === 'organizations'){
      const res = await fetch(API.sections + '?' + params.toString())
      const j = await res.json()
      if(mySeq !== searchSeq) return
      out.innerHTML = ''
      state.total = j.total || 0
      if(!j.organizations || j.organizations.length === 0){ out.innerHTML = '<div>No organizations found</div>'; renderPagination(state.total); return }
      out.className = 'results-grid'
      j.organizations.forEach(item => out.appendChild(renderOrgCard(item)))
      renderPagination(state.total)
    } else {
      const res = await fetch(API.contacts + '?' + params.toString())
      const j = await res.json()
      if(mySeq !== searchSeq) return
      out.innerHTML = ''
      state.total = j.total || 0
      if(!j.contacts || j.contacts.length===0){ out.innerHTML = '<div>No results</div>'; renderPagination(state.total); return }
      out.className = 'contacts-table-wrap'
      const table = document.createElement('table')
      table.className = 'contacts-table'
      table.innerHTML = `
        <thead>
          <tr>
            <th class="col-star"></th>
            <th>Name</th>
            <th>Organization</th>
            <th>Title</th>
            <th>Phone</th>
            <th>Email</th>
            ${state.showDeleted ? '<th>Actions</th>' : ''}
          </tr>
        </thead>
        <tbody></tbody>
      `
      const tbody = table.querySelector('tbody')
      j.contacts.forEach(c => tbody.appendChild(renderContactTableRow(c)))
      out.appendChild(table)
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
    fetchTagOptions()
    fetchContactOrganizations()
    state.page = 1
    search()
    if(j && j.id) showContactDetail(j.id); else closeModal()
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
  const peopleBtn = el('viewPeopleBtn'); const orgBtn = el('viewOrgBtn'); const groupsBtn = el('viewGroupsBtn'); const delBtn = el('viewDeletedBtn')
  if(peopleBtn) peopleBtn.classList.toggle('active', view === 'people')
  if(orgBtn) orgBtn.classList.toggle('active', view === 'organizations')
  if(groupsBtn) groupsBtn.classList.toggle('active', view === 'groups')
  if(delBtn) delBtn.classList.toggle('active', view === 'deleted')
  // Follow-up status is tracked per-Contact, not per-Organization, so the
  // filter doesn't apply (but isn't reset) when browsing Organizations.
  document.querySelectorAll('input[name=followupRadio]').forEach(r => { r.disabled = (view === 'organizations') })
  const favoritesOnlyCheckbox = el('favoritesOnlyCheckbox')
  if(favoritesOnlyCheckbox) favoritesOnlyCheckbox.disabled = (view === 'organizations')
  const orgFilterSection = el('orgFilterSection')
  if(orgFilterSection) orgFilterSection.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.disabled = (view === 'organizations') })
  // Filters/Export/Trash don't apply to Groups (it's not a filtered contact
  // list) -- New Group only makes sense there.
  const filterWrap = el('filterMenuWrap'); const exportWrap = el('exportMenuWrap'); const newGroupBtn = el('newGroupBtn')
  if(filterWrap) filterWrap.style.display = (view === 'groups') ? 'none' : ''
  if(exportWrap) exportWrap.style.display = (view === 'groups') ? 'none' : ''
  if(delBtn) delBtn.style.display = (view === 'groups') ? 'none' : ''
  if(newGroupBtn) newGroupBtn.style.display = (view === 'groups') ? '' : 'none'
  const si = el('searchInput')
  if(si) si.placeholder = view === 'people' ? 'Search by Name, Organization, Title, or Email...'
    : view === 'groups' ? 'Search by group name or description...'
    : 'Search by Organization or Category...'
  if(userInitiated && changed){
    const hash = view === 'organizations' ? '#search_roles' : view === 'groups' ? '#groups' : '#search'
    history.pushState({page: hash.slice(1)}, '', hash)
  }
  if(view !== 'groups') fetchTagOptions()
  search()
}

function bind(){
  el('searchBtn').addEventListener('click', ()=>{ state.q = el('searchInput').value.trim(); state.page = 1; search() })
  el('searchInput').addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ state.q = el('searchInput').value.trim(); state.page = 1; search() } })

  const viewPeopleBtn = el('viewPeopleBtn')
  const viewOrgBtn = el('viewOrgBtn')
  const viewGroupsBtn = el('viewGroupsBtn')
  if(viewPeopleBtn) viewPeopleBtn.addEventListener('click', ()=> switchView('people', true))
  if(viewOrgBtn) viewOrgBtn.addEventListener('click', ()=> switchView('organizations', true))
  if(viewGroupsBtn) viewGroupsBtn.addEventListener('click', ()=> switchView('groups', true))
  const viewDeletedBtn = el('viewDeletedBtn')
  if(viewDeletedBtn) viewDeletedBtn.addEventListener('click', ()=> switchView('deleted', true))
  const newGroupBtn = el('newGroupBtn')
  if(newGroupBtn) newGroupBtn.addEventListener('click', ()=> openGroupForm(null))

  document.querySelectorAll('input[name=followupRadio]').forEach(r => {
    r.addEventListener('change', ()=>{ if(r.checked) state.followup = r.value })
  })

  const favoritesOnlyCheckbox = el('favoritesOnlyCheckbox')
  if(favoritesOnlyCheckbox) favoritesOnlyCheckbox.addEventListener('change', ()=>{
    state.favoritesOnly = favoritesOnlyCheckbox.checked
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
  const addGroupBtn = el('addGroupBtn')
  if(addGroupBtn) addGroupBtn.addEventListener('click', ()=>{ openGroupForm(null) })
  const backBtn = el('backHomeBtn')
  if(backBtn) backBtn.addEventListener('click', ()=>{ showHome(true) })
  bindExportMenu()
  bindToolsMenu()
  bindDraftEmail()
  bindPipeline()
  bindCreateFlyer()
  bindFilterMenu()
  bindAdminMenu()
  bindTasksPanel()
  bindAddOrg()
}

function bindAddOrg(){
  const btn = el('addOrgBtn')
  const modal = el('addOrgModal')
  if(!btn || !modal) return

  let tagsLoaded = false
  const loadTagOptions = async ()=>{
    if(tagsLoaded) return
    const list = el('addOrgTagOptions')
    if(!list) return
    try{
      const res = await fetch(API.sectionCategories)
      const tags = await res.json()
      ;(tags || []).forEach(tag=>{
        const opt = document.createElement('option')
        opt.value = tag
        list.appendChild(opt)
      })
      tagsLoaded = true
    }catch(e){ console.error(e) }
  }

  btn.addEventListener('click', ()=>{
    el('addOrgName').value = ''
    el('addOrgTag').value = ''
    el('addOrgNotes').value = ''
    el('addOrgStatus').style.display = 'none'
    loadTagOptions()
    modal.style.display = ''
    el('addOrgName').focus()
  })

  el('closeAddOrgModal').addEventListener('click', ()=>{ modal.style.display = 'none' })
  el('closeAddOrgBtn').addEventListener('click', ()=>{ modal.style.display = 'none' })

  el('addOrgSaveBtn').addEventListener('click', async ()=>{
    const organization = el('addOrgName').value.trim()
    const tag = el('addOrgTag').value.trim()
    const notes = el('addOrgNotes').value.trim()
    const statusEl = el('addOrgStatus')
    statusEl.style.display = 'none'
    if(!organization){ statusEl.textContent = 'Organization name is required.'; statusEl.style.display = ''; return }
    const saveBtn = el('addOrgSaveBtn')
    saveBtn.disabled = true
    try{
      const res = await fetch(API.sections, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ organization, tag, notes })
      })
      const j = await res.json()
      if(!res.ok){ statusEl.textContent = j.error || 'Could not add organization.'; statusEl.style.display = ''; return }
      toast('Organization added.')
      modal.style.display = 'none'
      if(state.view === 'organizations') search()
    }catch(e){
      statusEl.textContent = 'Could not reach the server.'
      statusEl.style.display = ''
      console.error(e)
    }finally{
      saveBtn.disabled = false
    }
  })
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
    try{
      const res = await fetch('/api/generate-flyer', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ prompt, format, color_scheme, bg_style, logo_position, text_layout })
      })
      const j = await res.json()
      if(!res.ok){ el('createFlyerStatus').textContent = j.error || 'Could not generate the image.'; return }
      el('createFlyerOutput').src = j.image
      el('createFlyerOutput').style.display = ''
      el('createFlyerDownloadBtn').href = j.image
      el('createFlyerDownloadBtn').style.display = ''
      el('createFlyerStatus').textContent = `Headline: "${j.headline}"`
    }catch(e){
      el('createFlyerStatus').textContent = 'Could not reach the server.'
      console.error(e)
    }finally{
      genBtn.disabled = false
    }
  })
}

window.addEventListener('load', async ()=>{
  bind();
  loadTaskBadge();
  await fetchCounties();
  await fetchContactOrganizations();
  if(['#search', '#search_roles', '#groups'].includes(window.location.hash)){
    const view = window.location.hash === '#search_roles' ? 'organizations'
      : window.location.hash === '#groups' ? 'groups' : 'people'
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
  const appMain = el('appMain')
  const mainContent = el('mainContent')
  if(hero) hero.style.display = ''
  headerHidden.forEach(n=> { n.classList.add('header-hidden'); n.style.display = 'none' })
  if(results) results.style.display = 'none'
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
  const appMain = el('appMain')
  const mainContent = el('mainContent')
  if(hero) hero.style.display = 'none'
  headerHidden.forEach(n=> { n.classList.remove('header-hidden'); n.style.display = '' })
  if(mainContent) mainContent.style.display = ''
  if(results) results.style.display = ''
  if(pagination) pagination.style.display = ''
  if(appMain) appMain.classList.add('has-toolbar')
  switchView(view, false)
  if(push){
    const hash = view === 'organizations' ? '#search_roles' : view === 'groups' ? '#groups' : '#search'
    history.pushState({page: hash.slice(1)}, '', hash)
  }
  if(focus){ const si = el('searchInput'); if(si) si.focus() }
}

window.addEventListener('popstate', ()=>{
  const hash = window.location.hash
  if(hash === '#search_roles'){ showSearch(false,false,'organizations') }
  else if(hash === '#groups'){ showSearch(false,false,'groups') }
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
