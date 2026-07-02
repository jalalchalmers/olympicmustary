/* ═══════════════════════════════════════════════════
   BizFlow — Shared Utilities v1.2
   KEY CHANGE: API.fetch() now uses JSONP to bypass CORS.
   GitHub Pages cannot do GET to Apps Script due to CORS.
   All data fetching goes through script tags which works fine.
═══════════════════════════════════════════════════ */

const BF = {
  version:  '1.2.0',
  appName:  'BizFlow',
  // Hardcoded Web App URL — so any new browser connects automatically.
  // Super admin can still override it in Settings if redeployed.
  sheetUrl: localStorage.getItem('bf_sheet_url') || 'https://script.google.com/macros/s/AKfycbylNeShDTAY4olr9hrY2SuZqB_icVcs4A0TAM8FaOk9VE3FTjCcUgOrOYbDUxnk2ZuP/exec',
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
};

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
