/**
 * PPCH Laboratory Tracking System (LAB Suite)
 * Dedicated Supabase PostgreSQL Client (Primary DB) + GAS Background Sync (Sheets Backup)
 * STRICT POLICY: 100% Isolated from Medical Equipment DB & ZERO localStorage for business data
 */

(function (window) {
  'use strict';

  var SUPABASE_URL = 'https://jauxlzjmhtnncrwrloyr.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphdXhsemptaHRubmNyd3Jsb3lyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NDUxMDksImV4cCI6MjEwNzAyMTEwOX0.IFKN8_nv0U_UKNgeP4A-gcZ3u_EjDQhhvcyyW9P-Yw0';
  var LAB_GAS_URL = 'https://script.google.com/macros/s/AKfycbz8oIgnJWUcji2DaPI8CSBrPd22BFjL9A9Ui9mhamLCkRV7FVYGNWBKYJvZbjq31KE36g/exec';

  var FORM_SPECS = {
    'lab_057': { code: 'FM-PPCH-LAB-057', targetTemp: '24.0 - 28.0 °C', type: 'temp_room', cat: 'ห้องปฏิบัติการ' },
    'lab_060': { code: 'FM-PPCH-LAB-060', targetTemp: '≤ -18.0 °C', type: 'temp_freezer', cat: 'ตู้แช่แข็ง' },
    'lab_061': { code: 'FM-PPCH-LAB-061', targetTemp: '37.0 ± 0.5 °C', type: 'temp_waterbath', cat: 'Water bath' },
    'lab_062': { code: 'FM-PPCH-LAB-062', targetTemp: '2.0 - 8.0 °C', type: 'temp_refrigerator', cat: 'ตู้เย็น' },
    'lab_049': { code: 'FM-PPCH-LAB-049', targetCheck: 'ทำความสะอาดภายนอก & ตรวจเช็คประจำวัน', cat: 'Cobas h232' },
    'lab_091': { code: 'FM-PPCH-LAB-091', targetCheck: 'แรงดันคอลัมน์น้ำ (0.5-1.0 in.wg) / UV / แอลกอฮอล์', cat: 'ตู้ชีวนิรภัย' },
    'lab_099': { code: 'FM-PPCH-LAB-099', targetCheck: 'Conc Wash, Electrode, Cuvette & Special Wash', cat: 'Chemistry Mindray' },
    'lab_019': { code: 'FM-PPCH-LAB-019', targetCheck: 'สำรองไฟต่อเนื่อง ≥ 15 นาที', cat: 'UPS สำรองไฟ' }
  };

  function supabaseFetch(path, options) {
    options = options || {};
    var headers = Object.assign({
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }, options.headers || {});

    var fullUrl = SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/' + path.replace(/^\/+/, '');
    return fetch(fullUrl, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error('Supabase error (' + res.status + '): ' + t);
        });
      }
      var cType = res.headers.get('content-type') || '';
      if (cType.indexOf('application/json') !== -1) {
        return res.json();
      }
      return null;
    });
  }

  var PPCH_LAB_API = {
    getGasEndpoint: function () {
      return LAB_GAS_URL;
    },

    // 1. Fetch Complete LAB Overview from Supabase (Sub-100ms)
    fetchLabOverview: function (callback) {
      supabaseFetch('lab_items?select=*&order=sort_order.asc')
        .then(function (items) {
          if (!items || !items.length) {
            if (callback) callback({ success: false, message: 'No items returned', data: null });
            return;
          }

          var forms = {};
          for (var fk in FORM_SPECS) {
            forms[fk] = { spec: FORM_SPECS[fk], items: {} };
          }

          var readyCount = 0;
          var abnormalCount = 0;
          var pendingCount = 0;

          items.forEach(function (it) {
            var st = it.status || 'pending';
            if (st === 'ready') readyCount++;
            else if (st === 'abnormal') abnormalCount++;
            else pendingCount++;

            if (forms[it.form_key]) {
              forms[it.form_key].items[it.id] = {
                id: it.id,
                name: it.name,
                status: st,
                lastTemp: it.last_temp !== null ? parseFloat(it.last_temp) : null,
                lastHumidity: null,
                runtimeMin: it.last_runtime_min,
                loadDevice: it.load_device,
                evaluatedAt: it.last_evaluated_at,
                evaluatedBy: it.last_evaluated_by,
                evaluatedShift: it.last_shift,
                evaluatedDate: it.last_date
              };
            }
          });

          var responseData = {
            summary: {
              totalItems: items.length,
              readyCount: readyCount,
              abnormalCount: abnormalCount,
              pendingCount: pendingCount
            },
            forms: forms
          };

          if (callback) {
            callback({ success: true, data: responseData, rawItems: items });
          }
        })
        .catch(function (err) {
          console.warn('Supabase fetchLabOverview failed:', err);
          if (callback) callback({ success: false, error: err.message, data: null });
        });
    },

    // 2. Submit LAB Evaluation (Direct Write to Supabase + Background Sync to Google Sheets)
    submitLabEvaluation: function (evalData, callback) {
      var evalId = evalData.id || ('LAB-EV-' + Date.now());
      var isPass = (evalData.status === 'ready');
      var nowIso = new Date().toISOString();

      var formattedStaffId = (evalData.staffId || '').trim();
      if (formattedStaffId) {
        var numOnly = formattedStaffId.replace(/\D/g, '');
        formattedStaffId = numOnly.padStart(6, '0');
      }

      // Strictly normalize date to CE Year (YYYY-MM-DD)
      var cleanDate = evalData.date || '';
      if (cleanDate && cleanDate.match(/^(\d{4})-/)) {
        var yr = parseInt(cleanDate.slice(0, 4), 10);
        if (yr > 2500) {
          cleanDate = (yr - 543) + cleanDate.slice(4);
        }
      }

      var evalRow = {
        id: evalId,
        item_id: evalData.itemId,
        form_code: evalData.formCode,
        form_key: evalData.formKey,
        item_name: evalData.itemName,
        date: cleanDate,
        time: evalData.time,
        shift: evalData.shift || null,
        temperature: evalData.temperature !== null && evalData.temperature !== undefined ? parseFloat(evalData.temperature) : null,
        humidity: null, // No humidity tracking required for LAB
        runtime_minutes: evalData.runtimeMinutes !== null && evalData.runtimeMinutes !== undefined ? parseInt(evalData.runtimeMinutes, 10) : null,
        checklist_results: evalData.checklistResults || [],
        status: isPass ? 'ready' : 'abnormal',
        staff_id: formattedStaffId,
        staff_name: evalData.staffName,
        note: evalData.note || '',
        sheet_synced: false
      };

      var itemUpdate = {
        status: evalRow.status,
        last_temp: evalRow.temperature,
        last_humidity: null,
        last_runtime_min: evalRow.runtime_minutes,
        last_evaluated_at: evalRow.time,
        last_evaluated_by: evalRow.staff_name + (formattedStaffId ? ' (' + formattedStaffId + ')' : ''),
        last_shift: evalRow.shift,
        last_date: evalRow.date,
        updated_at: nowIso
      };

      // 1. Parallel write to Supabase (Record evaluation + update checkpoint state)
      var pInsert = supabaseFetch('lab_evaluations', {
        method: 'POST',
        body: evalRow
      });

      var pUpdateItem = supabaseFetch('lab_items?id=eq.' + encodeURIComponent(evalData.itemId), {
        method: 'PATCH',
        body: itemUpdate
      });

      Promise.all([pInsert, pUpdateItem])
        .then(function (results) {
          if (callback) {
            callback({ success: true, id: evalId, data: evalRow });
          }

          // 2. Background Sync to Google Sheets (Non-blocking)
          var gasPayload = {
            action: 'submitLabEntry',
            formKey: evalData.formKey,
            itemId: evalData.itemId,
            itemName: evalData.itemName,
            pointName: evalData.itemName,
            temp: evalRow.temperature,
            temperature: evalRow.temperature,
            humidity: null,
            result: evalRow.status,
            runtimeMinutes: evalRow.runtime_minutes,
            staffId: formattedStaffId,
            staffName: evalData.staffName,
            evaluatedBy: itemUpdate.last_evaluated_by,
            note: evalData.note || '',
            date: evalRow.date,
            time: evalData.time,
            timestamp: nowIso
          };

          fetch(LAB_GAS_URL + '?action=submitLabEntry', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(gasPayload)
          })
          .then(function (res) { return res.json(); })
          .then(function (json) {
            if (json && json.status === 'success') {
              supabaseFetch('lab_evaluations?id=eq.' + encodeURIComponent(evalId), {
                method: 'PATCH',
                body: { sheet_synced: true, sheet_synced_at: new Date().toISOString() }
              }).catch(function () {});
            }
          })
          .catch(function (err) {
            console.warn('Background GAS sync pending:', err);
          });
        })
        .catch(function (err) {
          console.error('Supabase write error:', err);
          if (callback) callback({ success: false, error: err.message });
        });
    },

    // 3. Fetch Monthly History for Item from Supabase (Sub-100ms)
    fetchMonthlyHistory: function (itemId, year, month, callback) {
      var cleanYear = (year > 2500) ? (year - 543) : year;
      var beYear = cleanYear + 543;
      var monthStr = String(month).padStart(2, '0');
      var startDateCE = cleanYear + '-' + monthStr + '-01';
      var endDateCE = cleanYear + '-' + monthStr + '-31';
      var startDateBE = beYear + '-' + monthStr + '-01';
      var endDateBE = beYear + '-' + monthStr + '-31';

      // Query CE range + BE range (just in case legacy rows exist)
      var query = 'lab_evaluations?item_id=eq.' + encodeURIComponent(itemId) +
        '&or=(and(date.gte.' + startDateCE + ',date.lte.' + endDateCE + '),and(date.gte.' + startDateBE + ',date.lte.' + endDateBE + '))' +
        '&order=date.asc,time.asc';

      supabaseFetch(query)
        .then(function (rows) {
          var matrix = { morning: {}, afternoon: {}, evening: {} };
          (rows || []).forEach(function (r) {
            var parts = (r.date || '').split('-');
            var dayNum = parseInt(parts[2], 10);
            var shift = r.shift || 'morning';
            if (!matrix[shift]) matrix[shift] = {};
            matrix[shift][dayNum] = {
              temp: r.temperature !== null ? parseFloat(r.temperature) : null,
              hum: null,
              staffId: r.staff_id,
              staffName: r.staff_name,
              staff: r.staff_name + (r.staff_id ? ' (' + r.staff_id + ')' : ''),
              time: r.time,
              status: r.status,
              note: r.note || ''
            };
          });

          if (callback) {
            callback({ success: true, data: matrix, rawRows: rows });
          }
        })
        .catch(function (err) {
          console.warn('Supabase fetchMonthlyHistory failed:', err);
          if (callback) callback({ success: false, error: err.message, data: null });
        });
    }
  };

  window.PPCH_LAB_API = PPCH_LAB_API;
})(window);
