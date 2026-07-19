/* ═══════════════════════════════════════════════════
   hFlow — Shared Utilities v1.2
   KEY CHANGE: API.fetch() now uses JSONP to bypass CORS.
   GitHub Pages cannot do GET to Apps Script due to CORS.
   All data fetching goes through script tags which works fine.
═══════════════════════════════════════════════════ */

const BF = {
  version:  '1.2.0',
  appName:  'hFlow',
  // Hardcoded Web App URL — so any new browser connects automatically.
  // Super admin can still override it in Settings if redeployed.
  sheetUrl: localStorage.getItem('bf_sheet_url') || 'https://script.google.com/macros/s/AKfycbxsEntAKVTsaWOA6QBhpUdsCx5r5cSCSbRPKbrNk3PV0umv94efsKTEJH5Z3iToj71hOQ/exec',
  roles: {
    super:  localStorage.getItem('bf_pw_super')  || 'super123',
    admin:  localStorage.getItem('bf_pw_admin')  || 'admin123',
    viewer: localStorage.getItem('bf_pw_viewer') || 'view123',
  },
  session: JSON.parse(sessionStorage.getItem('bf_session') || 'null'),
};

/* ════════════════════════════════════════
   AUTH
════════════════════════════════════════ */
const Auth = {
  login(password) {
    if (password === BF.roles.super) {
      const s = { role: 'super', loginTime: Date.now() };
      sessionStorage.setItem('bf_session', JSON.stringify(s));
      BF.session = s;
      return 'super';
    }
    if (password === BF.roles.admin) {
      const s = { role: 'admin', loginTime: Date.now() };
      sessionStorage.setItem('bf_session', JSON.stringify(s));
      BF.session = s;
      return 'admin';
    }
    if (password === BF.roles.viewer) {
      const s = { role: 'viewer', loginTime: Date.now() };
      sessionStorage.setItem('bf_session', JSON.stringify(s));
      BF.session = s;
      return 'viewer';
    }
    return null;
  },
  logout() {
    sessionStorage.removeItem('bf_session');
    BF.session = null;
    window.location.href = 'index.html';
  },
  require(page) {
    if (!BF.session) {
      window.location.href = 'index.html?redirect=' + encodeURIComponent(page);
      return false;
    }
    return true;
  },
  isSuper()  { return BF.session && BF.session.role === 'super'; },
  /* Viewer write-block: call at the top of every save/edit/delete entry point.
     Returns true when the action must be BLOCKED (and shows the toast). */
  guardWrite() {
    if (BF.session && BF.session.role === 'viewer') {
      if (typeof toast === 'function') toast('ভিউয়ার অ্যাকাউন্ট — শুধুমাত্র দেখার অনুমতি আছে', 'error');
      return true;
    }
    return false;
  },
  isViewer() { return BF.session && BF.session.role === 'viewer'; },
};

/* ════════════════════════════════════════
   API
   Fetch data via JSONP (bypasses CORS entirely)
   Post data via no-cors mode (fire and forget)
════════════════════════════════════════ */
const API = {

  /* ── WRITE — no-cors POST (fire and forget) ── */
  async post(payload) {
  if (!BF.sheetUrl) throw new Error('Sheet URL সেট নেই। Settings-এ গিয়ে URL দিন।');
  await fetch(BF.sheetUrl, {
    method:  'POST',
    mode:    'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  return true;
},

  /* ── READ — JSONP via <script> tag (bypasses CORS entirely) ── */
  fetch(action, extraData = {}) {
    return new Promise((resolve, reject) => {
      if (!BF.sheetUrl) { reject(new Error('Sheet URL সেট নেই।')); return; }

      // Unique callback name
      const cbName = '_bfcb_' + Date.now() + '_' + Math.floor(Math.random() * 9999);

      // Timeout after 15 seconds
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout — Apps Script সাড়া দিচ্ছে না'));
      }, 15000);

      function cleanup() {
        clearTimeout(timer);
        delete window[cbName];
        const el = document.getElementById(cbName);
        if (el) el.remove();
      }

      // Register global callback
      window[cbName] = function(data) {
        cleanup();
        resolve(data);
      };

      // Build URL with all params
      const url = new URL(BF.sheetUrl);
      url.searchParams.set('action',   action);
      url.searchParams.set('callback', cbName);
      Object.entries(extraData).forEach(([k, v]) => url.searchParams.set(k, String(v)));

      // Inject <script> tag — this follows redirects and ignores CORS
      const script  = document.createElement('script');
      script.id     = cbName;
      script.src    = url.toString();
      script.onerror = () => {
        cleanup();
        reject(new Error('Script load failed'));
      };
      document.head.appendChild(script);
    });
  },

  /* ── SYNC ALL DATA from Sheet after login ── */
  async syncAllData(onProgress) {
    if (!BF.sheetUrl) return false;
    try {
      onProgress && onProgress('কনফিগ লোড হচ্ছে…');
      const config = await API.fetch('getConfig');
      if (config && !config.error) {
        if (config.pw_super) { localStorage.setItem('bf_pw_super', config.pw_super); BF.roles.super = config.pw_super; }
        if (config.pw_admin) { localStorage.setItem('bf_pw_admin', config.pw_admin); BF.roles.admin = config.pw_admin; }
         if (config.pw_viewer) { localStorage.setItem('bf_pw_viewer', config.pw_viewer); BF.roles.viewer = config.pw_viewer; }
        if (config.biz_name)    localStorage.setItem('bf_biz_name',    config.biz_name);
        if (config.biz_phone)   localStorage.setItem('bf_biz_phone',   config.biz_phone);
        if (config.biz_address) localStorage.setItem('bf_biz_address', config.biz_address);
      }

      onProgress && onProgress('পার্টি লিস্ট লোড হচ্ছে…');
      const parties = await API.fetch('getParties');
      if (Array.isArray(parties)) localStorage.setItem('bf_parties', JSON.stringify(parties));

      onProgress && onProgress('পণ্য তালিকা লোড হচ্ছে…');
      const products = await API.fetch('getProducts');
      if (Array.isArray(products)) {
        localStorage.setItem('bf_products', JSON.stringify(
          products.map(p => ({ ...p, hasOffer: p.hasOffer === 'true' || p.hasOffer === true }))
        ));
      }

      onProgress && onProgress('অর্ডার লোড হচ্ছে…');
      const orders = await API.fetch('getOrders');
      if (Array.isArray(orders)) localStorage.setItem('bf_orders', JSON.stringify(orders));

      if (Array.isArray(parties))  localStorage.setItem('bf_count_parties',  parties.length);
      if (Array.isArray(products)) localStorage.setItem('bf_count_products', products.length);
      if (Array.isArray(orders))   localStorage.setItem('bf_count_sales',    orders.filter(o => o.orderType === 'sales').length);
      localStorage.setItem('bf_last_sync', new Date().toISOString());

      return true;
    } catch(e) {
      console.warn('Sync failed:', e.message);
      return false;
    }
  },
};

/* ════════════════════════════════════════
   TOAST NOTIFICATION
════════════════════════════════════════ */
function toast(msg, type = '') {
  let t = document.getElementById('bf-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'bf-toast';
    t.style.cssText = [
      'position:fixed', 'bottom:24px', 'left:50%',
      'transform:translateX(-50%) translateY(20px)',
      'background:#1a1a2e', 'color:#fff', 'padding:12px 26px',
      'border-radius:30px', 'font-size:14px', 'font-weight:500',
      'opacity:0', 'pointer-events:none', 'transition:all .3s',
      'z-index:9999', 'white-space:nowrap', "font-family:'Inter',sans-serif"
    ].join(';');
    document.body.appendChild(t);
  }
  const colors = { success: '#059669', error: '#dc2626', info: '#4f46e5' };
  t.style.background = colors[type] || '#1a1a2e';
  t.textContent = msg;
  t.style.opacity   = '1';
  t.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.style.opacity   = '0';
    t.style.transform = 'translateX(-50%) translateY(20px)';
  }, 3400);
}

/* ════════════════════════════════════════
   FORMAT HELPERS
════════════════════════════════════════ */
const fmt = {
  currency:  n  => '৳' + parseFloat(n || 0).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  date:      d  => d ? new Date(d).toLocaleDateString('en-BD') : '—',
  dateInput: () => new Date().toISOString().split('T')[0],
  /* Robust DD-MM-YYYY for display. Handles ISO strings, plain YYYY-MM-DD,
     and the long "Sun May 24 2026 …" Date-serialized strings from Sheets. */
  dmy: d => {
    if (!d) return '';
    const s = String(d);
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[3] + '-' + m[2] + '-' + m[1];
    const t = new Date(s);
    if (isNaN(t.getTime())) return s;
    const p = n => String(n).padStart(2, '0');
    return p(t.getDate()) + '-' + p(t.getMonth() + 1) + '-' + t.getFullYear();
  },
};

/* ════════════════════════════════════════
   DUE DISPLAY — unified sign convention
   Convention: positive balance = outstanding in the party's natural
   direction (customer → they owe Mustary; supplier → Mustary owes them).
   This helper renders it identically everywhere:
     পাবো (Mustary will receive) → green
     দেবো (Mustary must pay)     → red
════════════════════════════════════════ */
/* Merge server orders into cache WITHOUT erasing local unsynced saves.
   Server copy wins for any orderId it has; local entries still marked
   ⏳/📴 (not yet on the server) are preserved so a pending 29-line invoice
   can never be silently wiped by a background sync. */
function mergeOrdersIntoCache(serverList) {
  if (!Array.isArray(serverList)) return;
  let local = [];
  try { local = JSON.parse(localStorage.getItem('bf_orders') || '[]'); } catch (e) {}
  const serverIds = new Set(serverList.map(o => String(o.orderId)));
  const keep = local.filter(o =>
    (o._sync === 'sent' || o._sync === 'local') && !serverIds.has(String(o.orderId)));
  localStorage.setItem('bf_orders', JSON.stringify([...keep, ...serverList]));
}

/* ════════════════════════════════════════
   SEARCHABLE DROPDOWN — generic enhancer
   Wraps any <select> with a type-to-filter box. The select stays hidden as
   the source of truth; choosing fires its normal 'change' event. Options are
   read fresh each time the list opens, so later repopulation is safe.
   Usage: makeSearchable(selectEl, 'placeholder'); bfpSync(selectEl) after
   programmatic repopulation/selection to refresh the visible text.
════════════════════════════════════════ */
(function injectBfpCss(){
  if (document.getElementById('bfp-css')) return;
  const st = document.createElement('style');
  st.id = 'bfp-css';
  st.textContent = `
    .bfp-wrap{position:relative}
    .bfp-wrap>select{display:none!important}
    .bfp-input{width:100%;border:1.5px solid var(--border,#d1d5db);border-radius:8px;padding:10px 12px;font-family:inherit;font-size:14px;outline:none;background:#fff}
    .bfp-input:focus{border-color:var(--accent,#4f46e5)}
    .bfp-list{display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;min-width:220px;z-index:90;background:#fff;border:1.5px solid var(--border,#d1d5db);border-radius:10px;box-shadow:0 12px 34px rgba(0,0,0,.16);max-height:250px;overflow:auto}
    .bfp-list.open{display:block}
    .bfp-item{padding:9px 12px;font-size:13px;cursor:pointer;border-bottom:1px solid #f3f4f6}
    .bfp-item:last-child{border-bottom:none}
    .bfp-item:hover,.bfp-item.hl{background:var(--accent-bg,#eef2ff)}
    .bfp-none{color:#9ca3af;cursor:default}
    @media(max-width:768px){.bfp-input{font-size:16px;min-height:44px}}
  `;
  document.head.appendChild(st);
})();

function makeSearchable(sel, placeholder) {
  if (!sel || sel._bfp) return;
  const wrap = document.createElement('div');
  wrap.className = 'bfp-wrap';
  sel.parentNode.insertBefore(wrap, sel);
  const input = document.createElement('input');
  input.type = 'text'; input.className = 'bfp-input';
  input.placeholder = placeholder || '🔍 খুঁজুন…';
  input.autocomplete = 'off';
  const list = document.createElement('div');
  list.className = 'bfp-list';
  wrap.appendChild(input); wrap.appendChild(list); wrap.appendChild(sel);

  const optsOf = () => [...sel.options].filter(o => o.value)
    .map(o => ({ id: o.value, label: o.textContent.trim() }));
  let visible = [], hl = -1;
  const paint = () => { [...list.children].forEach((el,i)=>el.classList.toggle('hl',i===hl));
    if (hl>-1 && list.children[hl]) list.children[hl].scrollIntoView({block:'nearest'}); };
  const render = q => {
    q = (q||'').trim().toLowerCase();
    visible = optsOf().filter(p => !q || p.label.toLowerCase().includes(q)).slice(0,80);
    hl = visible.length ? 0 : -1;
    list.innerHTML = visible.length
      ? visible.map((p,i)=>`<div class="bfp-item${i===0?' hl':''}" data-id="${p.id}">${p.label}</div>`).join('')
      : '<div class="bfp-item bfp-none">কিছু পাওয়া যায়নি</div>';
    list.classList.add('open');
  };
  const sync = () => {
    const o = sel.options[sel.selectedIndex];
    input.value = (o && o.value) ? o.textContent.trim() : '';
  };
  const choose = id => {
    sel.value = id; list.classList.remove('open'); sync();
    sel.dispatchEvent(new Event('change'));
  };
  input.addEventListener('focus', () => { input.select(); render(''); });
  input.addEventListener('input', () => render(input.value));
  input.addEventListener('keydown', e => {
    if (!list.classList.contains('open')) return;
    if (e.key==='ArrowDown'){ e.preventDefault(); if(visible.length){hl=Math.min(hl+1,visible.length-1);paint();} }
    else if (e.key==='ArrowUp'){ e.preventDefault(); if(visible.length){hl=Math.max(hl-1,0);paint();} }
    else if (e.key==='Enter'){ e.preventDefault(); if(hl>-1&&visible[hl])choose(visible[hl].id); }
    else if (e.key==='Escape'){ list.classList.remove('open'); }
  });
  list.addEventListener('mousedown', e => {
    const it = e.target.closest('.bfp-item');
    if (it && it.dataset.id){ e.preventDefault(); choose(it.dataset.id); }
  });
  input.addEventListener('blur', () => setTimeout(()=>{ list.classList.remove('open'); sync(); },150));
  sel.addEventListener('change', sync);
  sel._bfp = { sync };
  sync();
}
function bfpSync(sel){ if (sel && sel._bfp) sel._bfp.sync(); }

/* ════════════════════════════════════════
   CANONICAL PARTY-DUE FORMULA — single source of truth
   Used by dashboard, ledger, payments, and orders pages so they can NEVER
   disagree. (Code.gs keeps a mirrored server-side copy in rebuildLedgerSheet_ —
   any semantic change must be applied there too.)
   Convention: positive = outstanding in the party's natural direction.
════════════════════════════════════════ */
/* Total voucher adjustment for a party (positive = reduces due). */
function voucherAdjCalc(partyId, vouchers, excludeId) {
  let adj = 0;
  (vouchers || []).forEach(v => {
    if (excludeId && v.id === excludeId) return;
    const amt = parseFloat(v.amount || 0);
    const isP = v.partyId === partyId, isC = v.counterpartyId === partyId;
    if (!isP && !isC) return;
    if (v.vtype === 'dual') { adj += (v.direction === 'debit' ? -amt : amt); return; }  // both sides
    if (!isP) return;
    if (v.vtype === 'receipt' || v.vtype === 'payment') adj += amt;
    else if (v.vtype === 'adjust') adj += (v.direction === 'debit' ? -amt : amt);
  });
  return adj;
}
/* Current due: opening + Σ(order grandTotal − totalPaid) − voucher adjustments. */
function partyDueCalc(partyId, opening, orders, vouchers, excludeVoucherId) {
  let bal = parseFloat(opening) || 0;
  (orders || []).forEach(o => {
    if (o.partyId !== partyId) return;
    bal += (parseFloat(o.grandTotal) || 0) - (parseFloat(o.totalPaid) || 0);
  });
  return bal - voucherAdjCalc(partyId, vouchers, excludeVoucherId);
}

function dueChip(balance, partyType) {
  const b = parseFloat(balance) || 0;
  if (Math.abs(b) < 0.005) return '<span style="font-weight:600;color:var(--ink3)">৳0.00</span>';
  const sup = (partyType === 'supplier');
  const receivable = sup ? (b < 0) : (b > 0);   // is Mustary the one who will receive?
  const label = receivable ? 'পাবো' : 'দেবো';
  const color = receivable ? 'var(--success)' : 'var(--danger)';
  return '<span style="font-weight:700;color:' + color + '">' + label + ' ' + fmt.currency(Math.abs(b)) + '</span>';
}

/* ════════════════════════════════════════
   SPINNER BUTTON
════════════════════════════════════════ */
function spinBtn(btn, loading) {
  if (loading) {
    btn.dataset.orig = btn.innerHTML;
    btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:bf-spin .6s linear infinite;vertical-align:middle"></span>';
    btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.orig || btn.innerHTML;
    btn.disabled  = false;
  }
}

/* ════════════════════════════════════════
   FULL-SCREEN LOADER
════════════════════════════════════════ */
function showLoader(msg) {
  let el = document.getElementById('bf-loader');
  if (!el) {
    el = document.createElement('div');
    el.id = 'bf-loader';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.75);z-index:9998;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px';
    el.innerHTML = `
      <div style="width:44px;height:44px;border:3px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;animation:bf-spin .7s linear infinite"></div>
      <div id="bf-loader-msg" style="color:#fff;font-size:14px;font-weight:500;font-family:'Inter',sans-serif"></div>`;
    document.body.appendChild(el);
  }
  document.getElementById('bf-loader-msg').textContent = msg || 'লোড হচ্ছে…';
  el.style.display = 'flex';
}

function hideLoader() {
  const el = document.getElementById('bf-loader');
  if (el) el.style.display = 'none';
}

/* ── Inject global keyframe ── */
(function() {
  const s = document.createElement('style');
  s.textContent = '@keyframes bf-spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(s);
})();
