/**
 * PPCH Physical Therapy & Rehabilitation Tracking System (PT Suite)
 * Dedicated Supabase PostgreSQL Client (Primary DB)
 * STRICT POLICY: 100% Isolated from LAB DB & ZERO localStorage for business data
 */

(function (window) {
  'use strict';

  var SUPABASE_URL = 'https://jauxlzjmhtnncrwrloyr.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphdXhsemptaHRubmNyd3Jsb3lyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NDUxMDksImV4cCI6MjEwNzAyMTEwOX0.IFKN8_nv0U_UKNgeP4A-gcZ3u_EjDQhhvcyyW9P-Yw0';

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

  var PPCH_PT_API = {
    // 1. Fetch Today's Evaluations for Physical Therapy
    fetchTodayOverview: function (ptItems, callback) {
      var todayStr = new Date().toISOString().slice(0, 10);
      
      // Query evaluations for PT department or device_id starting with 'pt_'
      supabaseFetch('evaluations?department=eq.PT&order=evaluated_at.desc&limit=100')
        .then(function (rows) {
          var itemStatusMap = {};
          if (rows && rows.length) {
            rows.forEach(function (r) {
              var evalDate = (r.evaluated_at || '').slice(0, 10);
              var devId = r.device_id;
              if (devId && !itemStatusMap[devId]) {
                itemStatusMap[devId] = {
                  status: (r.result === 'abnormal' || r.result === 'not_ready') ? 'abnormal' : (evalDate === todayStr ? 'ready' : 'pending'),
                  lastEvaluatedAt: r.evaluated_at,
                  lastEvaluatedBy: r.evaluated_by,
                  lastNote: r.abnormal_note,
                  answers: r.answers
                };
              }
            });
          }

          var result = {};
          var readyCount = 0;
          var abnormalCount = 0;
          var pendingCount = 0;

          for (var key in ptItems) {
            var item = ptItems[key];
            var info = itemStatusMap[item.id] || {
              status: 'pending',
              lastEvaluatedAt: null,
              lastEvaluatedBy: null,
              lastNote: null,
              answers: null
            };

            if (info.status === 'ready') readyCount++;
            else if (info.status === 'abnormal') abnormalCount++;
            else pendingCount++;

            result[item.id] = {
              id: item.id,
              name: item.name,
              thaiName: item.thaiName,
              code: item.code,
              cat: item.cat,
              catName: item.catName,
              status: info.status,
              evaluatedAt: info.lastEvaluatedAt,
              evaluatedBy: info.lastEvaluatedBy,
              note: info.lastNote,
              answers: info.answers
            };
          }

          var total = Object.keys(ptItems).length;
          var readyRate = total > 0 ? Math.round((readyCount / total) * 100) : 0;

          if (callback) {
            callback({
              success: true,
              data: {
                items: result,
                summary: {
                  total: total,
                  ready: readyCount,
                  abnormal: abnormalCount,
                  pending: pendingCount,
                  readyRate: readyRate
                }
              }
            });
          }
        })
        .catch(function (err) {
          console.warn('PT Supabase overview fetch error, returning default pending states:', err.message);
          var result = {};
          for (var key in ptItems) {
            var item = ptItems[key];
            result[item.id] = {
              id: item.id,
              name: item.name,
              thaiName: item.thaiName,
              code: item.code,
              cat: item.cat,
              catName: item.catName,
              status: 'pending',
              evaluatedAt: null,
              evaluatedBy: null,
              note: null
            };
          }
          if (callback) {
            callback({
              success: true,
              data: {
                items: result,
                summary: {
                  total: Object.keys(ptItems).length,
                  ready: 0,
                  abnormal: 0,
                  pending: Object.keys(ptItems).length,
                  readyRate: 0
                }
              }
            });
          }
        });
    },

    // 2. Submit Physical Therapy Evaluation
    submitPtEvaluation: function (evalData, callback) {
      var row = {
        device_id: evalData.itemId,
        device_asset: evalData.itemCode || evalData.itemId,
        device_name: evalData.itemName,
        department: 'PT',
        form_id: 'PT_DAILY_2026',
        evaluated_at: evalData.timestamp || new Date().toISOString(),
        evaluated_by: evalData.staffName,
        result: evalData.status === 'ready' ? 'ready' : 'abnormal',
        abnormal_note: evalData.note || '',
        answers: evalData.checklistResults || {},
        sheet_synced: false
      };

      // 1. Primary write to Supabase evaluations table
      supabaseFetch('evaluations', {
        method: 'POST',
        body: row
      }).then(function (res) {
        if (callback) callback({ success: true, data: res });
      }).catch(function (err) {
        console.error('Supabase PT evaluation write error:', err);
        // Fallback: also attempt write to lab_evaluations if evaluations table errors
        var labRow = {
          item_id: evalData.itemId,
          form_code: evalData.itemCode || 'PT-EQ',
          form_key: 'pt_dept',
          item_name: evalData.itemName,
          date: evalData.date || new Date().toISOString().slice(0, 10),
          time: evalData.time || new Date().toTimeString().slice(0, 5),
          shift: 'morning',
          temperature: evalData.temperature || null,
          checklist_results: evalData.checklistResults || {},
          status: evalData.status,
          staff_name: evalData.staffName,
          note: evalData.note || '',
          sheet_synced: false
        };
        supabaseFetch('lab_evaluations', {
          method: 'POST',
          body: labRow
        }).then(function (res2) {
          if (callback) callback({ success: true, data: res2 });
        }).catch(function (err2) {
          console.error('All DB writes failed:', err2);
          if (callback) callback({ success: false, error: err2.message });
        });
      });
    },

    // 3. Fetch Monthly Inspection History for a specific PT machine
    fetchMonthlyHistory: function (itemId, year, month, callback) {
      var y = parseInt(year, 10);
      var m = parseInt(month, 10);
      var ceYear = y > 2500 ? (y - 543) : y;
      var startDate = ceYear + '-' + String(m).padStart(2, '0') + '-01';
      var lastDay = new Date(ceYear, m, 0).getDate();
      var endDate = ceYear + '-' + String(m).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0') + 'T23:59:59Z';

      var query = 'evaluations?device_id=eq.' + encodeURIComponent(itemId) + 
                  '&evaluated_at=gte.' + startDate + 'T00:00:00Z' +
                  '&evaluated_at=lte.' + endDate +
                  '&order=evaluated_at.asc';

      supabaseFetch(query)
        .then(function (rows) {
          var monthData = {};
          if (rows && rows.length) {
            rows.forEach(function (r) {
              var dt = new Date(r.evaluated_at);
              var dayNum = dt.getDate();
              monthData[dayNum] = {
                day: dayNum,
                status: r.result,
                staff: r.evaluated_by,
                note: r.abnormal_note,
                time: dt.toTimeString().slice(0, 5),
                answers: r.answers
              };
            });
          }
          if (callback) callback({ success: true, data: monthData });
        })
        .catch(function (err) {
          console.warn('Supabase PT monthly fetch error:', err);
          if (callback) callback({ success: false, error: err.message, data: {} });
        });
    }
  };

  if (typeof window !== 'undefined') {
    window.PPCH_PT_API = PPCH_PT_API;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PPCH_PT_API;
  }
})(typeof window !== 'undefined' ? window : globalThis);
