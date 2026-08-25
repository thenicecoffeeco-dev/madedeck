(function () {
  'use strict';
  const channel = window.matchMedia?.('(display-mode: standalone)').matches ? 'desktop' : 'web';
  const dismissed = new Set(JSON.parse(localStorage.getItem('md.dismissed.messages') || '[]'));
  let timer;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    })[character]);
  }
  function safeUrl(value) {
    try {
      const parsed = new URL(String(value || ''), window.location.origin);
      return ['http:','https:'].includes(parsed.protocol) ? parsed.href : '';
    } catch (_) { return ''; }
  }

  function saveDismissed() { localStorage.setItem('md.dismissed.messages', JSON.stringify([...dismissed].slice(-200))); }
  function countdown(target) {
    const remaining = new Date(target).getTime() - Date.now();
    if (remaining <= 0) return 'Starting now';
    const seconds = Math.floor(remaining / 1000), days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600), minutes = Math.floor((seconds % 3600) / 60);
    return days ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m`;
  }
  async function receipt(key, event) {
    try { await fetch(`/api/system-messages/${key}/receipt`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ event, channel }) }); } catch (_) {}
  }
  function shell() {
    let root = document.getElementById('mdSystemMessages');
    if (root) return root;
    root = document.createElement('div'); root.id = 'mdSystemMessages';
    root.innerHTML = '<div class="md-system-banners"></div><div class="md-system-toasts"></div><div class="md-system-modal" hidden></div><button class="md-system-inbox" hidden type="button" aria-label="System messages">● <span>0</span></button>';
    document.body.prepend(root);
    const style = document.createElement('style');
    style.textContent = '.md-system-banners{position:relative;z-index:90}.md-system-message{--msg:#2563eb;background:#eef5ff;border-bottom:1px solid #cfe0ff;color:#132238;padding:10px 18px;display:flex;gap:12px;align-items:center;justify-content:center;font:600 13px/1.4 system-ui}.md-system-message.warning{--msg:#b45309;background:#fff7e8;border-color:#f5d7a6}.md-system-message.critical{--msg:#b42318;background:#fff0ef;border-color:#fac5c1}.md-system-message.success{--msg:#067647;background:#ecfdf3;border-color:#abefc6}.md-system-message b{font-weight:900}.md-system-message a{color:var(--msg);font-weight:850}.md-system-message button{border:0;background:transparent;font-weight:900}.md-system-countdown{padding:3px 7px;border-radius:999px;background:rgba(255,255,255,.72);font-variant-numeric:tabular-nums}.md-system-toasts{position:fixed;right:18px;top:92px;width:min(390px,calc(100vw - 36px));z-index:110;display:grid;gap:9px}.md-system-toasts .md-system-message{border:1px solid #dce4ee;border-radius:13px;box-shadow:0 18px 50px rgba(15,23,42,.18);justify-content:flex-start}.md-system-modal{position:fixed;inset:0;background:rgba(15,23,42,.62);z-index:120;display:grid;place-items:center;padding:20px}.md-system-modal[hidden]{display:none}.md-system-modal .md-system-card{width:min(560px,100%);background:#fff;border-radius:20px;padding:24px;box-shadow:0 30px 100px rgba(0,0,0,.3)}.md-system-inbox{position:fixed;right:18px;bottom:82px;z-index:100;border:0;border-radius:999px;background:#111827;color:#fff;padding:10px 13px;font-weight:900}.md-system-inbox span{margin-left:5px}';
    document.head.appendChild(style); return root;
  }
  function messageNode(message) {
    const node = document.createElement('div'); node.className = `md-system-message ${message.severity}`;
    const count = message.countdown_at ? `<span class="md-system-countdown" data-target="${message.countdown_at}">${countdown(message.countdown_at)}</span>` : '';
    const href = safeUrl(message.action_url);
    const action = href ? `<a href="${escapeHtml(href)}">${escapeHtml(message.action_label || 'Learn more')}</a>` : '';
    const control = message.requires_acknowledgment ? '<button type="button" data-ack>Acknowledge</button>' : (message.dismissible ? '<button type="button" aria-label="Dismiss">×</button>' : '');
    node.innerHTML = `<div><b>${escapeHtml(message.title)}</b> <span>${escapeHtml(message.body)}</span> ${count} ${action}</div>${control}`;
    node.querySelector('button')?.addEventListener('click', event => { dismissed.add(message.message_key); saveDismissed(); node.remove(); receipt(message.message_key,event.currentTarget.hasAttribute('data-ack')?'acknowledged':'dismissed'); });
    receipt(message.message_key,'seen'); return node;
  }
  function render(data) {
    const root = shell(), messages = data.messages.filter(message => !dismissed.has(message.message_key));
    const banners = root.querySelector('.md-system-banners'), toasts = root.querySelector('.md-system-toasts');
    banners.innerHTML = ''; toasts.innerHTML = '';
    messages.filter(message => message.presentation === 'banner').forEach(message => banners.appendChild(messageNode(message)));
    messages.filter(message => message.presentation === 'toast').slice(0,3).forEach(message => toasts.appendChild(messageNode(message)));
    const modalMessage = messages.find(message => ['modal','fullscreen'].includes(message.presentation));
    const modal = root.querySelector('.md-system-modal');
    if (modalMessage) { const href=safeUrl(modalMessage.action_url),control=modalMessage.requires_acknowledgment?'<button type="button" data-ack>Acknowledge</button>':(modalMessage.dismissible?'<button type="button">Close</button>':''); modal.hidden = false; modal.innerHTML = `<div class="md-system-card"><div class="md-system-message ${modalMessage.severity}"><div><h2>${escapeHtml(modalMessage.title)}</h2><p>${escapeHtml(modalMessage.body)}</p>${modalMessage.countdown_at ? `<div class="md-system-countdown" data-target="${modalMessage.countdown_at}">${countdown(modalMessage.countdown_at)}</div>` : ''}${href ? `<p><a href="${escapeHtml(href)}">${escapeHtml(modalMessage.action_label || 'Continue')}</a></p>` : ''}${control}</div></div>`; modal.querySelector('button')?.addEventListener('click',event=>{ dismissed.add(modalMessage.message_key); saveDismissed(); modal.hidden=true; receipt(modalMessage.message_key,event.currentTarget.hasAttribute('data-ack')?'acknowledged':'dismissed'); }); receipt(modalMessage.message_key,'seen'); } else modal.hidden = true;
    const inboxCount = messages.filter(message => message.presentation === 'inbox').length;
    const inbox = root.querySelector('.md-system-inbox'); inbox.hidden = !inboxCount; inbox.querySelector('span').textContent = inboxCount;
  }
  async function refresh() { try { const response = await fetch(`/api/system-messages/feed?channel=${channel}`, { cache:'no-store' }); if (response.ok) render(await response.json()); } catch (_) {} }
  function start() { clearInterval(timer); refresh(); timer = setInterval(refresh, 60000); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
}());
