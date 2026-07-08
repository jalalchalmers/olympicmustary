/**
 * BizFlow — Google Apps Script Backend v1.4
 * ===========================================
 * HOW TO DEPLOY:
 * 1. script.google.com → open your project
 * 2. Select ALL existing code (Ctrl+A) → Delete → paste THIS entire file
 * 3. Save (Ctrl+S) — should save with no error
 * 4. Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy
 *
 * v1.4: clean consolidated build. Includes FIFO layers (Step 0/1/2),
 *       full saveConfig (passwords + biz + permissions), all once.
 */

const SPREADSHEET_ID = '1AJwVyJxa0LdUqpyGexV70d5lyWWe5tie6asSy5VzzEQ';

const SHEETS = {
  config:    'Config',
  parties:   'Parties',
  products:  'Products',
  purchases: 'Purchases',
  sales:     'Sales',
  stock:     'Stock',
  ledger:    'Ledger',
  payments:  'Payments',
  priceHistory: 'PriceHistory',
  expenses:  'Expenses',
};

/* ════════════════════════════════════════ ENTRY POINTS ═══════════════ */

function doGet(e) {
  let action = 'ping', params = {}, callback = null;
  try {
    if (e && e.parameter) {
      params   = e.parameter;
      action   = e.parameter.action   || 'ping';
      callback = e.parameter.callback || null;
    }
  } catch(err) {}
  let result;
  try { result = handleAction(action, params); }
  catch(err) { result = { error: err.message }; }
  return respondJsonp(result, callback);
}

function doPost(e) {
  let result;
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return respond({ error: 'No POST data received' });
    }
    const data   = JSON.parse(e.postData.contents);
    const action = data.action || '';
    result = handleAction(action, data);
  } catch(err) { result = { error: err.message }; }
  return respond(result);
}

function handleAction(action, data) {
  switch(action) {
    case 'ping':          return { status:'ok', message:'BizFlow v1.4 running ✓', time: new Date().toISOString() };

    case 'getConfig':     return getConfig();
    case 'getParties':    return getSheet(SHEETS.parties);
    case 'getProducts':   return getSheet(SHEETS.products);
    case 'getOrders':     return getAllOrders();
    case 'getSales':      return getSheet(SHEETS.sales);
    case 'getPurchases':  return getSheet(SHEETS.purchases);
    case 'getStock':      return getSheet(SHEETS.stock);
    case 'getLedger':     return getLedger(data.partyId);
    case 'stats':         return getStats();

    case 'saveConfig':    return saveConfig(data);

    case 'saveParty':     return saveRow(SHEETS.parties,   data);
    case 'deleteParty':   return deleteRow(SHEETS.parties,  data.id);

    case 'saveProduct':   return saveRow(SHEETS.products,  data);
    case 'deleteProduct': return deleteRow(SHEETS.products, data.id);

    case 'saveOrder':     return saveOrder(data);
    case 'deleteOrder':   return deleteOrderRow(data.orderId, data.actor||'');

    case 'getPayments':   return getSheet(SHEETS.payments);
    case 'savePayment':   return savePayment(data);
    case 'deletePayment': return deletePayment(data.id);

    case 'getPriceHistory':     return getPriceHistory();
    case 'savePriceRevision':   return savePriceRevision(data.data || data);
    case 'savePriceCorrection': return savePriceCorrection(data.data || data);

    case 'getExpenses':   return getSheet(SHEETS.expenses);
    case 'saveExpense':   return saveRow(SHEETS.expenses,  data);
    case 'deleteExpense': return deleteRow(SHEETS.expenses, data.id);

    // ── FIFO STOCK LAYERS ──
    case 'getLayers':      return getLayers(data.productId||'');
    case 'getStockValue':  return getStockValue();
    case 'rebuildLayers':  return rebuildLayersFromOrders();
    case 'salesPriceLockStatus': return salesPriceLockStatus(data.productId||'');
    case 'getRevaluation':       return getRevaluation();
    case 'getOldStockReport':    return getOldStockReport();


    default: return { error: 'Unknown action: ' + action };
  }
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function respondJsonp(obj, callback) {
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + JSON.stringify(obj) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return respond(obj);
}

/* ════════════════════════════════════════ SPREADSHEET HELPERS ════════ */

function getSpreadsheet() { return SpreadsheetApp.openById(SPREADSHEET_ID); }

function getOrCreateSheet(name, headers) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length) {
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length)
        .setBackground('#4f46e5').setFontColor('#ffffff').setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function sheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(h => String(h).trim());
  return data.slice(1)
    .filter(row => row.some(cell => cell !== '' && cell !== null && cell !== undefined))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = (row[i] !== null && row[i] !== undefined) ? String(row[i]) : '';
      });
      return obj;
    });
}

function getSheet(name) {
  const sheet = getSpreadsheet().getSheetByName(name);
  if (!sheet) return [];
  return sheetToObjects(sheet);
}

/* ════════════════════════════════════════ CONFIG ════════════════════ */

function getConfig() {
  const sheet = getSpreadsheet().getSheetByName(SHEETS.config);
  if (!sheet) return {};
  const rows = sheet.getDataRange().getValues();
  const cfg  = {};
  rows.forEach(row => { if (row[0]) cfg[String(row[0]).trim()] = String(row[1] || ''); });
  return cfg;
}

function saveConfig(data) {
  const sheet = getOrCreateSheet(SHEETS.config, ['key', 'value', 'updatedAt']);
  const rows  = sheet.getDataRange().getValues();

  function upsert(key, value) {
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === key) {
        sheet.getRange(i + 1, 2, 1, 2).setValues([[value, new Date()]]);
        rows[i][1] = value;
        return;
      }
    }
    sheet.appendRow([key, value, new Date()]);
    rows.push([key, value, new Date()]);
  }

  if (data.key === 'passwords') {
    if (data.pw_super)  upsert('pw_super',  data.pw_super);
    if (data.pw_admin)  upsert('pw_admin',  data.pw_admin);
    if (data.pw_viewer) upsert('pw_viewer', data.pw_viewer);
  }
  if (data.key === 'biz') {
    if (data.biz_name    !== undefined) upsert('biz_name',    data.biz_name);
    if (data.biz_phone   !== undefined) upsert('biz_phone',   data.biz_phone);
    if (data.biz_address !== undefined) upsert('biz_address', data.biz_address);
    if (data.depo_text   !== undefined) upsert('depo_text',   data.depo_text);
  }
  if (data.key === 'permissions') {
    // delete permissions
    if (data.del_sales     !== undefined) upsert('del_sales',     data.del_sales);
    if (data.del_purchases !== undefined) upsert('del_purchases', data.del_purchases);
    if (data.del_products  !== undefined) upsert('del_products',  data.del_products);
    if (data.del_parties   !== undefined) upsert('del_parties',   data.del_parties);
    if (data.del_payments  !== undefined) upsert('del_payments',  data.del_payments);
    if (data.del_cashflow  !== undefined) upsert('del_cashflow',  data.del_cashflow);
    // edit permissions
    if (data.edit_orders   !== undefined) upsert('edit_orders',   data.edit_orders);
    // price-list access
    if (data.perm_pricelist!== undefined) upsert('perm_pricelist',data.perm_pricelist);
    // legacy (kept so old clients don't break): mirror sales/purchase into del_orders
    if (data.del_sales !== undefined || data.del_purchases !== undefined) {
      var anyOrderDel = (data.del_sales==='off' && data.del_purchases==='off') ? 'off' : 'on';
      upsert('del_orders', anyOrderDel);
    }
  }
  return { status: 'ok' };
}

/* ════════════════════════════════════════ GENERIC UPSERT ════════════ */

function saveRow(sheetName, data) {
  const headers = getSheetHeaders(sheetName);
  const sheet   = getOrCreateSheet(sheetName, headers);
  const rows    = sheet.getDataRange().getValues();
  const hdrs    = rows[0].map(h => String(h).trim());
  const idCol   = hdrs.indexOf('id');

  if (idCol > -1 && data.id) {
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][idCol]) === String(data.id)) {
        const newRow = hdrs.map(h => (data[h] !== undefined ? data[h] : ''));
        sheet.getRange(i + 1, 1, 1, hdrs.length).setValues([newRow]);
        return { status: 'updated' };
      }
    }
  }
  const newRow = headers.map(h => (data[h] !== undefined ? data[h] : ''));
  sheet.appendRow(newRow);
  return { status: 'inserted' };
}

function deleteRow(sheetName, id) {
  const sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return { status: 'not found' };
  const rows  = sheet.getDataRange().getValues();
  const idCol = rows[0].map(h => String(h)).indexOf('id');
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][idCol]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { status: 'deleted' };
    }
  }
  return { status: 'not found' };
}

/* ════════════════════════════════════════ PAYMENTS ══════════════════ */

function savePayment(data) {
  const headers = getSheetHeaders(SHEETS.payments);
  const sheet   = getOrCreateSheet(SHEETS.payments, headers);
  const rows    = sheet.getDataRange().getValues();
  const hdrs    = rows[0].map(h => String(h).trim());
  const idCol   = hdrs.indexOf('id');

  if (idCol > -1 && data.id) {
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][idCol]) === String(data.id)) {
        const newRow = hdrs.map(h => (data[h] !== undefined ? data[h] : ''));
        sheet.getRange(i + 1, 1, 1, hdrs.length).setValues([newRow]);
        updateLedgerVoucher(data);
        return { status: 'updated' };
      }
    }
  }
  const newRow = headers.map(h => (data[h] !== undefined ? data[h] : ''));
  sheet.appendRow(newRow);
  updateLedgerVoucher(data);
  return { status: 'inserted' };
}

function deletePayment(id) {
  const sheet = getSpreadsheet().getSheetByName(SHEETS.payments);
  if (!sheet) return { status: 'not found' };
  const rows  = sheet.getDataRange().getValues();
  const idCol = rows[0].map(h => String(h)).indexOf('id');
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][idCol]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { status: 'deleted' };
    }
  }
  return { status: 'not found' };
}

/* ════════════════════════════════════════ ORDERS ════════════════════ */

function saveOrder(data) {
  const sheetName = data.orderType === 'purchase' ? SHEETS.purchases : SHEETS.sales;
  const headers   = getSheetHeaders(sheetName);
  const sheet     = getOrCreateSheet(sheetName, headers);
  const rows      = sheet.getDataRange().getValues();
  const hdrs      = rows[0].map(h => String(h).trim());
  const oIdCol    = hdrs.indexOf('orderId');

  if (oIdCol > -1) {
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][oIdCol]) === String(data.orderId)) {
        // capture the OLD version before overwriting, for the adjustment log
        var oldItems = String(rows[i][hdrs.indexOf('items')]||'');
        var oldOrder = { orderId:data.orderId, orderType:data.orderType, date:data.date, items:oldItems };
        const newRow = hdrs.map(h => (data[h] !== undefined ? data[h] : ''));
        sheet.getRange(i + 1, 1, 1, hdrs.length).setValues([newRow]);
        updateLedger(data);
        rebuildLayersFromOrders();          // edit changes history → rebuild layers
        rebuildStockSheet_();               // rebuild passive stock record
        // adjustment log: old version removed, new version added
        logOrderAdjustments_(oldOrder, 'edit-old', -1, data.actor||'');
        logOrderAdjustments_(data,     'edit-new', +1, data.actor||'');
        return { status: 'updated' };
      }
    }
  }

  // For a NEW sale: compute the old/new price blend BEFORE layers are consumed
  // (old-stock count must be read while it's still on the shelf).
  var blendNote = '';
  if (data.orderType === 'sales') {
    var bl = computeSaleBlend_(data);
    if (bl.adjusted) {
      data.items = JSON.stringify(bl.items);
      data.grandTotal = bl.grandTotal;
      data.subtotal   = bl.subtotal;
      data.totalDue   = bl.grandTotal;
      blendNote = bl.note;
      if (blendNote) {
        data.notes = (data.notes ? (data.notes + ' | ') : '') + blendNote;
      }
    }
  }

  // FIFO: for a NEW sale, check/apply layers BEFORE writing the row.
  var fifo = fifoApplyOrder_(data, false);
  if (!fifo.ok) {
    return { status: 'blocked', reason: 'oversell', shortages: fifo.shortages };
  }

  const newRow = headers.map(h => (data[h] !== undefined ? data[h] : ''));
  sheet.appendRow(newRow);
  rebuildStockSheet_();               // rebuild passive stock record (new order)
  updateLedger(data);
  return { status: 'inserted', salesAutoUpdated: (fifo.salesAutoUpdated || []), blendNote: blendNote };
}

function getAllOrders() {
  const sales     = getSheet(SHEETS.sales).map(o    => ({ ...o, orderType: 'sales' }));
  const purchases = getSheet(SHEETS.purchases).map(o => ({ ...o, orderType: 'purchase' }));
  return [...sales, ...purchases]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function deleteOrderRow(orderId, actor) {
  var deletedOrder = null;
  [SHEETS.sales, SHEETS.purchases].forEach(name => {
    const sheet = getSpreadsheet().getSheetByName(name);
    if (!sheet) return;
    const rows   = sheet.getDataRange().getValues();
    const hdrs   = rows[0].map(h => String(h));
    const oIdCol = hdrs.indexOf('orderId');
    const itCol  = hdrs.indexOf('items');
    const dtCol  = hdrs.indexOf('date');
    for (let i = rows.length - 1; i >= 1; i--) {
      if (String(rows[i][oIdCol]) === String(orderId)) {
        deletedOrder = {
          orderId: orderId,
          orderType: (name===SHEETS.purchases?'purchase':'sales'),
          date: dtCol>-1?rows[i][dtCol]:'',
          items: itCol>-1?String(rows[i][itCol]||''):''
        };
        sheet.deleteRow(i + 1);
        break;
      }
    }
  });
  var rb = rebuildLayersFromOrders();   // deletion changes history → rebuild + reconcile
  rebuildStockSheet_();                 // rebuild passive stock record
  if (deletedOrder) logOrderAdjustments_(deletedOrder, 'delete', -1, actor||'');
  return { status: 'deleted', salesReview: (rb.salesReview||[]), salesSynced: (rb.salesSynced||[]) };
}

/* ════════════════════════════════════════ STOCK ════════════════════ */

/* ────────────────────────────────────────────────────────────────────
   Stock sheet — rebuilt from orders on every save/edit/delete.
   Passive record (not used for calculations); tracks per product:
     paidIn, freeIn, totalIn, paidOut, freeOut, totalOut,
     balancePaid, balanceFree, balanceTotal, lastUpdated.
   ──────────────────────────────────────────────────────────────────── */
function rebuildStockSheet_() {
  var headers = ['productId','productName','paidIn','freeIn','totalIn',
                 'paidOut','freeOut','totalOut',
                 'balancePaid','balanceFree','balanceTotal','lastUpdated'];
  var sheet = getOrCreateSheet(SHEETS.stock, headers);
  // ensure header matches (in case old 6-col sheet exists)
  var existing = sheet.getDataRange().getValues();
  if (existing.length && String(existing[0][2]) !== 'paidIn') {
    sheet.clear();
    sheet.appendRow(headers);
    sheet.getRange(1,1,1,headers.length).setBackground('#4f46e5').setFontColor('#fff').setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() > 1) {
    sheet.getRange(2,1,sheet.getLastRow()-1,sheet.getLastColumn()).clearContent();
  }

  var purch = getSheet(SHEETS.purchases);
  var sales = getSheet(SHEETS.sales);
  var acc = {}; // productId → tallies

  function tally(orders, isPurchase){
    orders.forEach(function(o){
      var items=[]; try{ items=JSON.parse(o.items||'[]'); }catch(e){ return; }
      items.forEach(function(it){
        var pid=it.productId; if(!pid) return;
        var paid = parseFloat(it.qtyPieces!==undefined?it.qtyPieces:it.qty)||0;
        var free = parseFloat(it.freePieces)||0;
        var tot  = parseFloat(it.totalPieces)||(paid+free);
        if(!acc[pid]) acc[pid]={name:it.productName||pid,paidIn:0,freeIn:0,totalIn:0,paidOut:0,freeOut:0,totalOut:0};
        if(it.productName) acc[pid].name=it.productName;
        if(isPurchase){ acc[pid].paidIn+=paid; acc[pid].freeIn+=free; acc[pid].totalIn+=tot; }
        else          { acc[pid].paidOut+=paid; acc[pid].freeOut+=free; acc[pid].totalOut+=tot; }
      });
    });
  }
  tally(purch,true);
  tally(sales,false);

  var now=new Date();
  var batch=[];
  Object.keys(acc).forEach(function(pid){
    var a=acc[pid];
    batch.push([pid,a.name,a.paidIn,a.freeIn,a.totalIn,a.paidOut,a.freeOut,a.totalOut,
      a.paidIn-a.paidOut, a.freeIn-a.freeOut, a.totalIn-a.totalOut, now]);
  });
  if(batch.length) sheet.getRange(sheet.getLastRow()+1,1,batch.length,batch[0].length).setValues(batch);
  return { products: batch.length };
}

/* Append an adjustment log row (edit / delete / other) to StockAdjustments. */
function logStockAdjustment_(entry) {
  var headers=['timestamp','date','productId','productName','orderId','type',
               'paidDelta','freeDelta','totalDelta','note','user'];
  var sh=getOrCreateSheet('StockAdjustments', headers);
  sh.appendRow([
    new Date(), entry.date||'', entry.productId||'', entry.productName||'',
    entry.orderId||'', entry.type||'', entry.paidDelta||0, entry.freeDelta||0,
    entry.totalDelta||0, entry.note||'', entry.user||''
  ]);
}

/* Log every line of an order as an adjustment (used on edit/delete).
   sign = -1 for removal (delete / old version of an edit), +1 for addition. */
function logOrderAdjustments_(order, type, sign, user) {
  var items=[]; try{ items=JSON.parse(order.items||'[]'); }catch(e){ return; }
  items.forEach(function(it){
    if(!it.productId) return;
    var paid=parseFloat(it.qtyPieces!==undefined?it.qtyPieces:it.qty)||0;
    var free=parseFloat(it.freePieces)||0;
    var tot =parseFloat(it.totalPieces)||(paid+free);
    var dir = (order.orderType==='purchase') ? 1 : -1;   // purchase adds stock, sale removes
    logStockAdjustment_({
      date: order.date, productId: it.productId, productName: it.productName,
      orderId: order.orderId, type: type,
      paidDelta:  sign*dir*paid,
      freeDelta:  sign*dir*free,
      totalDelta: sign*dir*tot,
      note: type+' '+(order.orderType||'')+' '+(order.orderId||''),
      user: user||''
    });
  });
}



/* ════════════════════════════════════════ LEDGER ═══════════════════ */

function updateLedger(order) {
  const sheet = getOrCreateSheet(SHEETS.ledger,
    ['id','date','partyId','partyName','type','description','debit','credit','balance','reference']);
  const allRows = sheet.getDataRange().getValues();
  let lastBal = 0;
  for (let i = allRows.length - 1; i >= 1; i--) {
    if (String(allRows[i][2]) === String(order.partyId)) {
      lastBal = parseFloat(allRows[i][8]) || 0;
      break;
    }
  }
  const amount  = parseFloat(order.grandTotal) || 0;
  const isPurch = order.orderType === 'purchase';
  const debit   = isPurch  ? amount : 0;
  const credit  = !isPurch ? amount : 0;
  const balance = lastBal + debit - credit;

  sheet.appendRow([
    'L' + Date.now(), order.date, order.partyId, order.partyName, order.orderType,
    (isPurch ? 'ক্রয়' : 'বিক্রয়') + ' — ' + order.orderId,
    debit, credit, balance, order.orderId
  ]);
}

function updateLedgerVoucher(v) {
  const sheet = getOrCreateSheet(SHEETS.ledger,
    ['id','date','partyId','partyName','type','description','debit','credit','balance','reference']);
  const allRows = sheet.getDataRange().getValues();
  let lastBal = 0;
  for (let i = allRows.length - 1; i >= 1; i--) {
    if (String(allRows[i][2]) === String(v.partyId)) {
      lastBal = parseFloat(allRows[i][8]) || 0;
      break;
    }
  }
  const amt = parseFloat(v.amount) || 0;
  let debit = 0, credit = 0;
  if (v.vtype === 'adjust' && v.direction === 'debit') debit = amt;
  else credit = amt;
  const balance = lastBal + debit - credit;
  const label = v.vtype === 'receipt' ? 'রিসিট'
              : v.vtype === 'payment' ? 'পেমেন্ট' : 'সমন্বয়';

  sheet.appendRow([
    'L' + Date.now(), v.date, v.partyId, v.partyName, 'voucher',
    label + ' — ' + v.vno, debit, credit, balance, v.vno
  ]);
}

function getLedger(partyId) {
  const sheet = getSpreadsheet().getSheetByName(SHEETS.ledger);
  if (!sheet) return [];
  const all = sheetToObjects(sheet);
  return partyId ? all.filter(r => r.partyId === partyId) : all;
}

/* ════════════════════════════════════════ STATS ════════════════════ */

function getStats() {
  const ss = getSpreadsheet();
  const count = name => {
    const sh = ss.getSheetByName(name);
    return sh ? Math.max(0, sh.getLastRow() - 1) : 0;
  };
  const stockSh = ss.getSheetByName(SHEETS.stock);
  const stockItems = stockSh
    ? sheetToObjects(stockSh).filter(r => parseFloat(r.balance || 0) > 0).length : 0;
  return {
    parties: count(SHEETS.parties), products: count(SHEETS.products),
    sales: count(SHEETS.sales), purchases: count(SHEETS.purchases), stock: stockItems,
  };
}

/* ════════════════════════════════════════ PRICE HISTORY ════════════ */

function getPriceHistorySheet_() {
  const ss = getSpreadsheet();
  let sh = ss.getSheetByName(SHEETS.priceHistory);
  if (!sh) {
    sh = ss.insertSheet(SHEETS.priceHistory);
    const headers = ['revisionId','effectiveDate','type','productId','code','name',
                     'price','offerSize','freeQty','hasOffer','note','superseded','createdAt','side'];
    sh.appendRow(headers);
    sh.getRange(1,1,1,headers.length)
      .setBackground('#7c3aed').setFontColor('#ffffff').setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function getPriceHistory() {
  const ss = getSpreadsheet();
  const sh = ss.getSheetByName(SHEETS.priceHistory);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues();
  if (rows.length < 2) return [];
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    out.push({
      revisionId:String(r[0]), effectiveDate:String(r[1]), type:String(r[2]),
      productId:String(r[3]), code:String(r[4]), name:String(r[5]),
      price:String(r[6]), offerSize:String(r[7]), freeQty:String(r[8]),
      hasOffer:String(r[9]), note:String(r[10]), superseded:String(r[11]), createdAt:String(r[12]),
      side:String(r[13]||'purchase')   // old rows had no side → treat as purchase
    });
  }
  return out;
}

function savePriceRevision(d) {
  const sh = getPriceHistorySheet_();
  const createdAt = new Date().toISOString();
  const batch = [];
  (d.rows || []).forEach(function(p){
    batch.push([
      d.revisionId, d.effectiveDate, d.type || 'new-change',
      p.productId, p.code, p.name,
      p.price, p.offerSize, p.freeQty, String(p.hasOffer),
      d.note || '', '', createdAt, d.side || 'purchase'
    ]);
  });
  if (batch.length) sh.getRange(sh.getLastRow()+1, 1, batch.length, batch[0].length).setValues(batch);

  // Rule B: for a PURCHASE-side change, any product with ZERO stock gets its
  // sales price auto-synced to the new purchase price (no old stock to protect).
  var synced = [];
  if ((d.side || 'purchase') === 'purchase') {
    (d.rows || []).forEach(function(p){
      if (availablePieces_(p.productId) <= 0) {
        var r = syncSalesToPurchase_(p.productId);
        if (r.changed) synced.push(p.productId);
      }
    });
  }
  return { status: 'inserted', rows: batch.length, revisionId: d.revisionId, salesSynced: synced };
}

function savePriceCorrection(d) {
  const sh = getPriceHistorySheet_();
  const side = d.side || 'purchase';
  const rows = sh.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    var rowSide = String(rows[i][13]||'purchase');
    if (String(rows[i][3]) === String(d.productId) && String(rows[i][11]) !== 'yes' && rowSide === side) {
      sh.getRange(i+1, 12).setValue('yes');
      break;
    }
  }
  const createdAt = new Date().toISOString();
  sh.appendRow([
    d.revisionId || ('C'+Date.now()), d.effectiveDate, 'correction',
    d.productId, d.code, d.name,
    d.price, d.offerSize, d.freeQty, String(d.hasOffer),
    d.note || '', '', createdAt, side
  ]);
  // Rule B: purchase-side correction on a zero-stock product → sync sales.
  var didSync = false;
  if (side === 'purchase' && availablePieces_(d.productId) <= 0) {
    var r = syncSalesToPurchase_(d.productId);
    didSync = r.changed;
  }
  return { status: 'corrected', productId: d.productId, salesSynced: didSync };
}

/* ════════════════════════════════════════ HEADERS ══════════════════ */

function getSheetHeaders(name) {
  const orderCols = [
    'id','orderId','orderType','date','cartonMode','partyId','partyName','partyPhone','partyAddress',
    'items','subtotal','discount','grandTotal','prevDue','totalDue',
    'cash','bankDeposit','mobile',
    'salary','ta','da','damage','othersDeduction','totalDeductions',
    'totalPaid','balance','paymentMode','notes','status','savedAt'
  ];
  const map = {
    [SHEETS.parties]:   ['id','name','type','phone','email','address','area','balance','notes','updated'],
    [SHEETS.products]:  ['id','code','name','cartonSize','cartonPrice','price','hasOffer','offerSize','freeQty','salesPrice','salesHasOffer','salesOfferSize','salesFreeQty','effectivePrice','notForSale','status','notes','updated'],
    [SHEETS.purchases]: orderCols,
    [SHEETS.sales]:     orderCols,
    [SHEETS.payments]:  ['id','vno','vtype','date','partyId','partyName','partyPhone','cash','bank','mobile','salary','ta','da','damage','other','amount','direction','note','savedAt'],
    [SHEETS.expenses]:  ['id','date','type','category','amount','note','savedAt'],
  };
  return map[name] || [];
}

/* ════════════════════════════════════════════════════════════════════
   FIFO STOCK LAYERS engine (Step 0 + Step 1 + Step 2)
   ════════════════════════════════════════════════════════════════════ */

var STOCK_LAYERS_SHEET = 'StockLayers';

/* MASTER SWITCH — keep false until opening stock is fixed; then set true. */
var FIFO_BLOCK_OVERSELL = true;

function getLayersSheet_() {
  var ss = getSpreadsheet();
  var sh = ss.getSheetByName(STOCK_LAYERS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(STOCK_LAYERS_SHEET);
    var headers = ['layerId','productId','code','name','date','rate',
                   'qtyReceived','qtyRemaining','status','sourceOrderId','createdAt'];
    sh.appendRow(headers);
    sh.getRange(1,1,1,headers.length)
      .setBackground('#0f766e').setFontColor('#ffffff').setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function getLayers(productId) {
  var ss = getSpreadsheet();
  var sh = ss.getSheetByName(STOCK_LAYERS_SHEET);
  if (!sh) return [];
  var rows = sh.getDataRange().getValues();
  if (rows.length < 2) return [];
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0]) continue;
    if (productId && String(r[1]) !== String(productId)) continue;
    out.push({
      layerId:String(r[0]), productId:String(r[1]), code:String(r[2]), name:String(r[3]),
      date:String(r[4]), rate:parseFloat(r[5])||0,
      qtyReceived:parseFloat(r[6])||0, qtyRemaining:parseFloat(r[7])||0,
      status:String(r[8]||'open'), sourceOrderId:String(r[9]||''), createdAt:String(r[10]||'')
    });
  }
  return out;
}

function getStockValue() {
  var layers = getLayers('');
  var byProduct = {};
  var totalPieces = 0, totalValue = 0;
  layers.forEach(function(L){
    if (L.status === 'closed') return;
    totalPieces += L.qtyRemaining;
    totalValue  += L.qtyRemaining * L.rate;
    if (!byProduct[L.productId]) byProduct[L.productId] = { pieces:0, value:0, code:L.code, name:L.name };
    byProduct[L.productId].pieces += L.qtyRemaining;
    byProduct[L.productId].value  += L.qtyRemaining * L.rate;
  });
  return { totalPieces: totalPieces, totalValue: totalValue, byProduct: byProduct };
}

/* ────────────────────────────────────────────────────────────────────
   Revaluation report (Stage 6).
   Per product with open stock:
     - pieces  = current open pieces (FIFO)
     - costVal = Σ(layer qtyRemaining × layer rate)   [what it cost]
     - saleRate= current SALES effective price          [what it's worth now]
     - saleVal = pieces × saleRate
     - reval   = saleVal − costVal                       [the revaluation]
   Returns rows + totals. saleRate uses the live sales effective price
   (salesPrice × salesOfferSize/(salesOfferSize+salesFreeQty)).
   ──────────────────────────────────────────────────────────────────── */
function getRevaluation() {
  var sv = getStockValue();
  var prods = getSheet(SHEETS.products);
  var byId = {};
  prods.forEach(function(p){ byId[p.id] = p; });

  function salesEff(p){
    if (!p) return 0;
    var salesSet = (p.salesPrice!==undefined && p.salesPrice!=='' && p.salesPrice!==null);
    var base, os, fq;
    if (salesSet) {
      base = parseFloat(p.salesPrice)||0;
      var has = (p.salesHasOffer===true || p.salesHasOffer==='true');
      os = has ? parseFloat(p.salesOfferSize)||0 : 0;
      fq = has ? parseFloat(p.salesFreeQty)||0   : 0;
    } else {
      // fall back to purchase price AND its offer
      base = parseFloat(p.price)||0;
      var phas = (p.hasOffer===true || p.hasOffer==='true');
      os = phas ? parseFloat(p.offerSize)||0 : 0;
      fq = phas ? parseFloat(p.freeQty)||0   : 0;
    }
    return (os>0 && (os+fq)>0) ? base*os/(os+fq) : base;
  }

  var rows = [];
  var tCost = 0, tSale = 0;
  Object.keys(sv.byProduct).forEach(function(pid){
    var bp = sv.byProduct[pid];
    if (bp.pieces <= 0) return;
    var p = byId[pid];
    var costRate = bp.pieces>0 ? bp.value/bp.pieces : 0;
    var saleRate = salesEff(p);
    var saleVal  = bp.pieces * saleRate;
    tCost += bp.value; tSale += saleVal;
    rows.push({
      productId:pid, code:bp.code, name:bp.name,
      pieces:bp.pieces, costRate:costRate, costVal:bp.value,
      saleRate:saleRate, saleVal:saleVal, reval:(saleVal - bp.value)
    });
  });
  rows.sort(function(a,b){ return String(a.code).localeCompare(String(b.code), undefined, {numeric:true}); });
  return { rows:rows, totalCost:tCost, totalSale:tSale, totalReval:(tSale - tCost) };
}

/* ────────────────────────────────────────────────────────────────────
   Old-price stock report.
   Lists ONLY products that currently hold stock whose cost rate differs
   from the current PURCHASE effective price (i.e. old-price stock that is
   keeping the sales price locked). Per product:
     oldPieces, oldRate (weighted avg of old layers), currentRate, oldValue.
   ──────────────────────────────────────────────────────────────────── */
function getOldStockReport() {
  var prods = getSheet(SHEETS.products);
  var byId = {};
  prods.forEach(function(p){ byId[p.id] = p; });

  var layers = getLayers('');
  // group open layers by product
  var byProduct = {};
  layers.forEach(function(L){
    if (L.status === 'closed' || L.qtyRemaining <= 0) return;
    if (!byProduct[L.productId]) byProduct[L.productId] = [];
    byProduct[L.productId].push(L);
  });

  var rows = [];
  var totalOldPieces = 0, totalOldValue = 0, totalCurrentValue = 0;
  Object.keys(byProduct).forEach(function(pid){
    var curRate = purchaseEffPrice_(pid);
    var oldPieces = 0, oldValue = 0;
    byProduct[pid].forEach(function(L){
      if (Math.abs(L.rate - curRate) > 0.0000001) {   // old-price layer
        oldPieces += L.qtyRemaining;
        oldValue  += L.qtyRemaining * L.rate;
      }
    });
    if (oldPieces <= 0) return;                        // no old stock → skip
    var p = byId[pid] || {};
    var oldRate = oldPieces>0 ? oldValue/oldPieces : 0;
    var currentValue = oldPieces * curRate;            // same stock valued at current rate
    totalOldPieces += oldPieces; totalOldValue += oldValue; totalCurrentValue += currentValue;
    rows.push({
      productId:pid, code:p.code||'', name:p.name||'',
      cartonSize: parseFloat(p.cartonSize)||0,
      oldPieces: oldPieces, oldRate: oldRate,
      currentRate: curRate, oldValue: oldValue, currentValue: currentValue
    });
  });
  rows.sort(function(a,b){ return String(a.code).localeCompare(String(b.code), undefined, {numeric:true}); });
  return { rows:rows, totalOldPieces:totalOldPieces, totalOldValue:totalOldValue, totalCurrentValue:totalCurrentValue };
}

function layerRateForItem_(it) {
  var qtyPieces   = parseFloat(it.qtyPieces!==undefined?it.qtyPieces:it.qty)||0;
  var freePieces  = parseFloat(it.freePieces)||0;
  var totalPieces = parseFloat(it.totalPieces)||(qtyPieces+freePieces);
  var usedPrice   = parseFloat(it.usedPrice!==undefined?it.usedPrice:it.price)||0;
  if (totalPieces <= 0) return usedPrice;
  return (qtyPieces * usedPrice) / totalPieces;
}

function ratesEqual_(a, b) { return Math.abs(a - b) < 0.0000001; }

function availablePieces_(productId) {
  var layers = getLayers(productId);
  var sum = 0;
  layers.forEach(function(L){ if (L.status !== 'closed') sum += L.qtyRemaining; });
  return sum;
}

/* ────────────────────────────────────────────────────────────────────
   Rule B & C-step-4 — auto-sync a product's SALES price fields.
   syncSalesToPurchase_(productId): set sales = purchase (used when stock is 0).
   Returns {status, changed} — changed=true if values actually differed.
   These run server-side so they're atomic and reliable.
   ──────────────────────────────────────────────────────────────────── */
function getProductRow_(productId) {
  var sheet = getSpreadsheet().getSheetByName(SHEETS.products);
  if (!sheet) return null;
  var rows = sheet.getDataRange().getValues();
  var hdrs = rows[0].map(function(h){ return String(h).trim(); });
  var idCol = hdrs.indexOf('id');
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][idCol]) === String(productId)) {
      return { sheet:sheet, rowIndex:i+1, hdrs:hdrs, values:rows[i] };
    }
  }
  return null;
}

function syncSalesToPurchase_(productId) {
  var p = getProductRow_(productId);
  if (!p) return { status:'not-found', changed:false };
  var col = function(name){ return p.hdrs.indexOf(name); };
  var price   = p.values[col('price')];
  var hasOff  = p.values[col('hasOffer')];
  var offSize = p.values[col('offerSize')];
  var freeQty = p.values[col('freeQty')];

  var curSales = p.values[col('salesPrice')];
  var changed = String(curSales) !== String(price);

  if (col('salesPrice')>-1)     p.sheet.getRange(p.rowIndex, col('salesPrice')+1).setValue(price);
  if (col('salesHasOffer')>-1)  p.sheet.getRange(p.rowIndex, col('salesHasOffer')+1).setValue(hasOff);
  if (col('salesOfferSize')>-1) p.sheet.getRange(p.rowIndex, col('salesOfferSize')+1).setValue(offSize);
  if (col('salesFreeQty')>-1)   p.sheet.getRange(p.rowIndex, col('salesFreeQty')+1).setValue(freeQty);
  return { status:'synced', changed:changed };
}

/* ────────────────────────────────────────────────────────────────────
   Rule C — sales-price lock status for a product.
   Returns:
     { totalStock, locked, remainingOld, canUnlock, reason }
   Logic:
     - totalStock = open pieces (all layers)
     - If totalStock == 0  → not locked (Rule D: free to update).
     - Else there is stock. The sales price is locked WHILE old-rate stock
       remains. "Old-rate stock" = layers at the OLDEST rate that are still open.
       We locate the newest open layer's rate; if EVERY open layer shares that
       one rate, then no old stock remains → canUnlock (Rule C step 4).
       If open layers span more than one rate → old (cheaper) stock still on
       shelf → locked, remainingOld = pieces in the older-rate open layers.
   ──────────────────────────────────────────────────────────────────── */
/* current PURCHASE effective price for a product (what new stock would cost today) */
function purchaseEffPrice_(productId) {
  var p = getProductRow_(productId);
  if (!p) return 0;
  var col = function(n){ return p.hdrs.indexOf(n); };
  var price = parseFloat(p.values[col('price')])||0;
  var has   = String(p.values[col('hasOffer')])==='true' || p.values[col('hasOffer')]===true;
  var os    = has ? parseFloat(p.values[col('offerSize')])||0 : 0;
  var fq    = has ? parseFloat(p.values[col('freeQty')])||0   : 0;
  return (os>0 && (os+fq)>0) ? price*os/(os+fq) : price;
}

/* current SALES effective price for a product (the price currently invoiced) */
function salesEffPrice_(productId) {
  var p = getProductRow_(productId);
  if (!p) return 0;
  var col = function(n){ return p.hdrs.indexOf(n); };
  var salesSet = String(p.values[col('salesPrice')]) !== '' && p.values[col('salesPrice')] !== null && p.values[col('salesPrice')] !== undefined;
  var base, has, os, fq;
  if (salesSet) {
    base = parseFloat(p.values[col('salesPrice')])||0;
    has  = String(p.values[col('salesHasOffer')])==='true' || p.values[col('salesHasOffer')]===true;
    os   = has ? parseFloat(p.values[col('salesOfferSize')])||0 : 0;
    fq   = has ? parseFloat(p.values[col('salesFreeQty')])||0   : 0;
  } else {
    base = parseFloat(p.values[col('price')])||0;
    has  = String(p.values[col('hasOffer')])==='true' || p.values[col('hasOffer')]===true;
    os   = has ? parseFloat(p.values[col('offerSize')])||0 : 0;
    fq   = has ? parseFloat(p.values[col('freeQty')])||0   : 0;
  }
  return (os>0 && (os+fq)>0) ? base*os/(os+fq) : base;
}

/* how many OLD-price pieces remain (rate ≠ current purchase effective price) */
function oldStockPieces_(productId) {
  var layers = getLayers(productId).filter(function(L){ return L.status!=='closed' && L.qtyRemaining>0; });
  var curRate = purchaseEffPrice_(productId);
  var old = 0;
  layers.forEach(function(L){ if (Math.abs(L.rate - curRate) > 0.0000001) old += L.qtyRemaining; });
  return old;
}

/* ────────────────────────────────────────────────────────────────────
   Blended sale pricing (transition case).
   For each sale line where the quantity EXCEEDS the remaining OLD-price
   pieces, the amount blends: oldQ×oldSalesEff + newQ×newPurchaseEff.
   - oldSalesEff  = current sales effective price (the locked/old price)
   - newEff       = current purchase effective price (the new price)
   The line keeps ONE row; its price stays the OLD sales price for display,
   but its amount is the blend, and a breakdown note is produced.
   Returns { adjusted, items, subtotal, grandTotal, note }.
   Works in PIECES internally; carton conversion via product carton size.
   ──────────────────────────────────────────────────────────────────── */
function computeSaleBlend_(data) {
  var items = [];
  try { items = JSON.parse(data.items || '[]'); } catch(e) { return { adjusted:false }; }
  var adjusted = false;
  var notes = [];
  var prodById = {};
  getSheet(SHEETS.products).forEach(function(p){ prodById[p.id] = p; });

  items.forEach(function(it){
    var pid = it.productId; if (!pid) return;
    var totPieces = parseFloat(it.totalPieces) ||
                    ((parseFloat(it.qtyPieces||it.qty)||0) + (parseFloat(it.freePieces)||0));
    if (totPieces <= 0) return;

    var oldPieces = oldStockPieces_(pid);
    if (oldPieces <= 0) return;                 // no old stock → normal pricing
    if (totPieces <= oldPieces) return;         // fully within old stock → all old price

    // transition: split pieces
    var newPieces = totPieces - oldPieces;
    var oldEff = salesEffPrice_(pid);           // old (locked) sales price
    var newEff = purchaseEffPrice_(pid);        // new (current) price
    var blendAmount = oldPieces*oldEff + newPieces*newEff;

    // per-piece original amount used only for reference
    it.amount = Math.round(blendAmount * 100) / 100;
    adjusted = true;

    // build a human note in cartons where possible
    var p = prodById[pid] || {};
    var csz = parseFloat(p.cartonSize)||0;
    function q(pcs){ return (csz>0) ? (Math.floor(pcs/csz)+' ctn'+(pcs%csz?('+'+(pcs%csz)+' pcs'):'')) : (pcs+' pcs'); }
    notes.push((it.code||it.productName||pid)+': '+q(oldPieces)+'×৳'+oldEff.toFixed(2)+' + '+q(newPieces)+'×৳'+newEff.toFixed(2)+' = ৳'+it.amount.toFixed(2));
  });

  if (!adjusted) return { adjusted:false };
  var subtotal = items.reduce(function(s,it){ return s + (parseFloat(it.amount)||0); }, 0);
  var discount = parseFloat(data.discount)||0;
  var grand = subtotal - discount;
  return {
    adjusted:true, items:items,
    subtotal: Math.round(subtotal*100)/100,
    grandTotal: Math.round(grand*100)/100,
    note: 'মিশ্র মূল্য — ' + notes.join(' ; ')
  };
}

function salesPriceLockStatus(productId) {
  var layers = getLayers(productId).filter(function(L){ return L.status !== 'closed' && L.qtyRemaining > 0; });
  var totalStock = 0;
  layers.forEach(function(L){ totalStock += L.qtyRemaining; });

  if (totalStock <= 0) {
    return { totalStock:0, locked:false, remainingOld:0, canUnlock:true, reason:'no-stock' };
  }

  // "Old stock" = any layer whose cost rate differs from the CURRENT purchase
  // effective price. The sales price may unlock only when ALL remaining stock is
  // at the current purchase rate — otherwise cheaper/older stock is still on shelf.
  var curRate = purchaseEffPrice_(productId);
  var remainingOld = 0;
  layers.forEach(function(L){
    if (Math.abs(L.rate - curRate) > 0.0000001) remainingOld += L.qtyRemaining;
  });

  if (remainingOld <= 0) {
    // all stock at the current purchase rate → no old stock → free to update
    return { totalStock:totalStock, locked:false, remainingOld:0, canUnlock:true, reason:'all-current-rate' };
  }
  // old-rate stock still on shelf → locked
  return { totalStock:totalStock, locked:true, remainingOld:remainingOld, canUnlock:false, reason:'old-stock-remains' };
}

function checkSaleStock_(data) {
  var items = [];
  try { items = JSON.parse(data.items || '[]'); } catch(e) { return { ok:true }; }
  var need = {}, nameById = {};
  items.forEach(function(it){
    if (!it.productId) return;
    var tp = parseFloat(it.totalPieces) ||
             ((parseFloat(it.qtyPieces||it.qty)||0) + (parseFloat(it.freePieces)||0));
    if (tp <= 0) return;
    need[it.productId] = (need[it.productId] || 0) + tp;
    nameById[it.productId] = it.productName || it.code || it.productId;
  });
  var shortages = [];
  Object.keys(need).forEach(function(pid){
    var have = availablePieces_(pid);
    if (need[pid] > have) shortages.push({ productId:pid, name:nameById[pid], need:need[pid], have:have });
  });
  return shortages.length ? { ok:false, shortages:shortages } : { ok:true };
}

function applyPurchaseToLayers_(data) {
  var items = [];
  try { items = JSON.parse(data.items || '[]'); } catch(e) { return; }
  var sh = getLayersSheet_();
  items.forEach(function(it){
    var pid = it.productId; if (!pid) return;
    var tp = parseFloat(it.totalPieces) ||
             ((parseFloat(it.qtyPieces||it.qty)||0) + (parseFloat(it.freePieces)||0));
    if (tp <= 0) return;
    var rate = layerRateForItem_(it);
    var rows = sh.getDataRange().getValues();
    var newestRow = -1;
    for (var i = rows.length - 1; i >= 1; i--) {
      if (String(rows[i][1]) === String(pid) && String(rows[i][8]||'open') !== 'closed') { newestRow = i; break; }
    }
    if (newestRow > -1 && ratesEqual_(parseFloat(rows[newestRow][5])||0, rate)) {
      var newReceived  = (parseFloat(rows[newestRow][6])||0) + tp;
      var newRemaining = (parseFloat(rows[newestRow][7])||0) + tp;
      sh.getRange(newestRow+1, 7, 1, 2).setValues([[newReceived, newRemaining]]);
    } else {
      sh.appendRow(['L'+Date.now()+'_'+Math.floor(Math.random()*100000),
        pid, it.code||'', it.productName||'', data.date, rate,
        tp, tp, 'open', data.orderId||'', new Date().toISOString()]);
    }
  });
}

function applySaleToLayers_(data) {
  var items = [];
  try { items = JSON.parse(data.items || '[]'); } catch(e) { return; }
  var sh = getLayersSheet_();
  items.forEach(function(it){
    var pid = it.productId; if (!pid) return;
    var need = parseFloat(it.totalPieces) ||
               ((parseFloat(it.qtyPieces||it.qty)||0) + (parseFloat(it.freePieces)||0));
    if (need <= 0) return;
    var rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length && need > 0; i++) {
      if (String(rows[i][1]) !== String(pid)) continue;
      if (String(rows[i][8]||'open') === 'closed') continue;
      var remaining = parseFloat(rows[i][7])||0;
      if (remaining <= 0) continue;
      var take = Math.min(remaining, need);
      var left = remaining - take;
      need -= take;
      var status = left <= 0 ? 'closed' : 'open';
      sh.getRange(i+1, 8, 1, 2).setValues([[left, status]]);
    }
    if (need > 0) {
      sh.appendRow(['L'+Date.now()+'_'+Math.floor(Math.random()*100000),
        pid, it.code||'', it.productName||'', data.date, 0,
        -need, -need, 'open', data.orderId||'', new Date().toISOString()]);
    }
  });
}

function fifoApplyOrder_(data, isUpdate) {
  if (isUpdate) return { ok:true, rebuild:true };
  if (data.orderType === 'purchase') {
    applyPurchaseToLayers_(data);
    var pRecon = reconcileSalesPrices_();   // new stock may change lock state
    return { ok:true, salesAutoUpdated: pRecon.synced.map(function(x){return x.productId;}), salesReview: pRecon.review };
  } else {
    if (FIFO_BLOCK_OVERSELL) {
      var chk = checkSaleStock_(data);
      if (!chk.ok) return { ok:false, shortages:chk.shortages };
    }
    applySaleToLayers_(data);
    var autoSynced = autoUpdateSalesAfterSale_(data);   // Rule C step 4
    return { ok:true, salesAutoUpdated: autoSynced };
  }
}

/* Rule C step 4 — after a sale, for each product whose OLD-rate layers are now
   depleted (only newest-rate stock remains), auto-update the product's SALES
   price to that newest layer rate. Returns list of updated productIds. */
function autoUpdateSalesAfterSale_(data) {
  var items = [];
  try { items = JSON.parse(data.items || '[]'); } catch(e) { return []; }
  var seen = {}, updated = [];
  items.forEach(function(it){
    var pid = it.productId;
    if (!pid || seen[pid]) return;
    seen[pid] = true;
    // Use the authoritative lock status: only unlock when ALL remaining stock is
    // at the CURRENT purchase rate (no old-rate stock left). This correctly keeps
    // the price locked when old single-rate stock remains but no new stock arrived.
    var st = salesPriceLockStatus(pid);
    if (!st.canUnlock) return;                      // old stock still on shelf → keep locked
    if (st.totalStock <= 0) return;                 // no stock → nothing to update now
    // old stock gone → sync sales to current purchase price
    var r = syncSalesToPurchase_(pid);
    if (r.changed) updated.push(pid);
  });
  return updated;
}

/* ────────────────────────────────────────────────────────────────────
   Global sales-price reconcile (self-healing).
   Re-evaluates EVERY product against its current layers + purchase price,
   using the authoritative salesPriceLockStatus. Closes the gaps where the
   sales price could go stale via deletes, order edits, rebuilds, or stock
   reaching zero by non-sale means.

   FORWARD (auto): if a product's old stock has cleared (canUnlock) and its
     sales price differs from the current purchase price → sync it.
   REVERSE (flag only): if old-price stock is present (locked) BUT the sales
     price currently equals the new/current purchase price (i.e. it was
     already advanced, and old stock has since returned) → we do NOT guess
     the old price; we FLAG it for human review.
   Returns { synced:[...], review:[...] }.
   ──────────────────────────────────────────────────────────────────── */
function reconcileSalesPrices_() {
  var prods = getSheet(SHEETS.products);
  var synced = [], review = [];
  prods.forEach(function(p){
    var pid = p.id; if (!pid) return;
    var st = salesPriceLockStatus(pid);

    if (st.totalStock <= 0) return;   // no stock → leave as-is (Rule B handles zero-stock on purchase edits)

    if (st.canUnlock) {
      // all stock at current purchase rate → sales should match purchase
      var r = syncSalesToPurchase_(pid);
      if (r.changed) synced.push({ productId:pid, code:p.code||'', name:p.name||'' });
    } else {
      // old-price stock present → sales SHOULD be locked at the old price.
      // If the stored sales price already equals the CURRENT purchase price,
      // that means old stock returned after the price had advanced → flag it.
      var salesEff = salesEffPrice_(pid);
      var purchEff = purchaseEffPrice_(pid);
      if (Math.abs(salesEff - purchEff) < 0.0000001) {
        review.push({ productId:pid, code:p.code||'', name:p.name||'', remainingOld:st.remainingOld });
      }
    }
  });
  return { synced:synced, review:review };
}

function rebuildLayersFromOrders() {
  var sh = getLayersSheet_();
  if (sh.getLastRow() > 1) sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).clearContent();

  var purch = getSheet(SHEETS.purchases).map(function(o){ o.orderType='purchase'; return o; });
  var sales = getSheet(SHEETS.sales).map(function(o){ o.orderType='sales'; return o; });
  var all = purch.concat(sales);

  all.sort(function(a,b){
    var d = orderMs_(a.date) - orderMs_(b.date);
    if (d) return d;
    var ta = a.orderType==='purchase' ? 0 : 1;
    var tb = b.orderType==='purchase' ? 0 : 1;
    if (ta !== tb) return ta - tb;
    return String(a.savedAt||'').localeCompare(String(b.savedAt||''));
  });

  var stacks = {};
  var warnings = [];

  all.forEach(function(o){
    var items = [];
    try { items = JSON.parse(o.items||'[]'); } catch(e) { return; }
    items.forEach(function(it){
      var pid = it.productId;
      if (!pid) return;
      var totalPieces = parseFloat(it.totalPieces)||((parseFloat(it.qtyPieces||it.qty)||0)+(parseFloat(it.freePieces)||0));
      if (totalPieces <= 0) return;
      if (!stacks[pid]) stacks[pid] = [];

      if (o.orderType === 'purchase') {
        var rate = layerRateForItem_(it);
        var stack = stacks[pid];
        var top = stack.length ? stack[stack.length-1] : null;
        if (top && top.status==='open' && ratesEqual_(top.rate, rate)) {
          top.qtyReceived  += totalPieces;
          top.qtyRemaining += totalPieces;
        } else {
          stack.push({
            layerId:'L'+Date.now()+'_'+Math.floor(Math.random()*100000),
            productId:pid, code:it.code||'', name:it.productName||'',
            date:o.date, rate:rate,
            qtyReceived:totalPieces, qtyRemaining:totalPieces,
            status:'open', sourceOrderId:o.orderId||'', createdAt:new Date().toISOString()
          });
        }
      } else {
        var need = totalPieces;
        var stack2 = stacks[pid] || [];
        for (var i=0; i<stack2.length && need>0; i++) {
          var L = stack2[i];
          if (L.status==='closed' || L.qtyRemaining<=0) continue;
          var take = Math.min(L.qtyRemaining, need);
          L.qtyRemaining -= take;
          need -= take;
          if (L.qtyRemaining <= 0) L.status = 'closed';
        }
        if (need > 0) {
          warnings.push('Oversold '+pid+' by '+need+' pcs on order '+(o.orderId||'?'));
          stack2.push({
            layerId:'L'+Date.now()+'_'+Math.floor(Math.random()*100000),
            productId:pid, code:it.code||'', name:it.productName||'',
            date:o.date, rate:0,
            qtyReceived:-need, qtyRemaining:-need,
            status:'open', sourceOrderId:o.orderId||'', createdAt:new Date().toISOString()
          });
          stacks[pid] = stack2;
        }
      }
    });
  });

  var batch = [];
  Object.keys(stacks).forEach(function(pid){
    stacks[pid].forEach(function(L){
      batch.push([L.layerId,L.productId,L.code,L.name,L.date,L.rate,
                  L.qtyReceived,L.qtyRemaining,L.status,L.sourceOrderId,L.createdAt]);
    });
  });
  if (batch.length) sh.getRange(sh.getLastRow()+1,1,batch.length,batch[0].length).setValues(batch);

  // Self-healing: after any rebuild (delete/edit/rebuild), reconcile sales prices.
  var recon = reconcileSalesPrices_();

  var val = getStockValue();
  return {
    status:'rebuilt', layersWritten: batch.length,
    openPieces: val.totalPieces, stockValue: val.totalValue, warnings: warnings,
    salesSynced: recon.synced, salesReview: recon.review
  };
}

function orderMs_(d) {
  if (!d) return 0;
  var s = String(d).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2]-1, +m[3]).getTime();
  var mo = s.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{4})/);
  if (mo) {
    var M = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
    return new Date(+mo[3], M[mo[1]], +mo[2]).getTime();
  }
  var t = new Date(s); return isNaN(t.getTime()) ? 0 : t.getTime();
}

/* one-time diagnostic wrapper — Run this to see backfill results in the log */
function checkFIFO() {
  var r = rebuildLayersFromOrders();
  Logger.log('Layers written: ' + r.layersWritten);
  Logger.log('Open pieces: ' + r.openPieces);
  Logger.log('Stock value: ' + r.stockValue);
  Logger.log('Warnings (' + r.warnings.length + '): ' + JSON.stringify(r.warnings));
}