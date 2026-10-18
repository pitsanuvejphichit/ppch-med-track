/**
 * PPCH Physical Therapy & Rehabilitation Tracking System (PT Suite)
 * Dedicated Supabase PostgreSQL Client (Primary DB)
 * Full Integration with PPCH Medical Equipment Hub
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
    // 1. Fetch Today's Overview for 11 PT Machines
    fetchTodayOverview: function (callback) {
      var todayStr = new Date().toISOString().slice(0, 10);

      var pEquipment = supabaseFetch('equipment?home_dept=eq.REHAB&order=id.asc').catch(function () { return []; });
      var pEvaluations = supabaseFetch('evaluations?department=eq.REHAB&order=evaluated_at.desc&limit=100').catch(function () { return []; });

      Promise.all([pEquipment, pEvaluations])
        .then(function (results) {
          var eqList = results[0] || [];
          var evalList = results[1] || [];

          // Map recent evaluations
          var evalMap = {};
          evalList.forEach(function (ev) {
            var devId = ev.device_id;
            if (devId && !evalMap[devId]) {
              evalMap[devId] = ev;
            }
          });

          var items = [];
          var readyCount = 0;
          var abnormalCount = 0;
          var pendingCount = 0;

          eqList.forEach(function (eq) {
            var recentEv = evalMap[eq.id];
            var isEvaluatedToday = false;
            if (recentEv && recentEv.evaluated_at) {
              isEvaluatedToday = (recentEv.evaluated_at.slice(0, 10) === todayStr);
            }

            var currentStatus = 'pending';
            if (eq.status === 'conditional_ready') {
              currentStatus = 'conditional_ready';
              abnormalCount++;
            } else if (eq.status === 'in_progress' || eq.repair_status === 'in_progress') {
              currentStatus = 'in_progress';
              abnormalCount++;
            } else if (eq.status === 'abnormal' || (recentEv && recentEv.result === 'abnormal')) {
              currentStatus = 'abnormal';
              abnormalCount++;
            } else if (isEvaluatedToday && (eq.status === 'ready' || recentEv.result === 'ready')) {
              currentStatus = 'ready';
              readyCount++;
            } else {
              currentStatus = 'pending';
              pendingCount++;
            }

            items.push({
              id: eq.id,
              code: eq.asset_code || eq.id,
              name: eq.name,
              formId: eq.form_id,
              status: currentStatus,
              isConditional: (eq.status === 'conditional_ready'),
              repairStatus: eq.repair_status || 'ready',
              repairAcknowledgedBy: eq.repair_acknowledged_by || '',
              abnormalReason: eq.abnormal_reason || (recentEv ? recentEv.abnormal_note : ''),
              evaluatedAt: recentEv ? recentEv.evaluated_at : eq.last_evaluated_at,
              evaluatedBy: recentEv ? recentEv.evaluated_by : eq.last_evaluated_by,
              answers: recentEv ? recentEv.answers : null
            });
          });

          var total = items.length;
          var readyRate = total > 0 ? Math.round((readyCount / total) * 100) : 0;

          if (callback) {
            callback(null, {
              items: items,
              summary: {
                total: total,
                ready: readyCount,
                abnormal: abnormalCount,
                pending: pendingCount,
                readyRate: readyRate
              }
            });
          }
        })
        .catch(function (err) {
          console.error('fetchTodayOverview error:', err);
          if (callback) callback(err, null);
        });
    },

    // 2. Submit Physical Therapy Evaluation
    submitPtEvaluation: function (evalData, callback) {
      var evalId = 'EV-PT-' + Date.now();
      var isAbnormal = (evalData.result === 'abnormal');

      var evalRow = {
        id: evalId,
        device_id: evalData.deviceId,
        device_asset: evalData.deviceAsset || evalData.deviceId,
        device_name: evalData.deviceName,
        department: 'REHAB',
        form_id: evalData.formId || 'pt_dept',
        evaluated_at: evalData.evaluatedAt || new Date().toISOString(),
        evaluated_by: evalData.evaluatedBy || 'เจ้าหน้าที่กายภาพ',
        result: isAbnormal ? 'abnormal' : 'ready',
        abnormal_note: evalData.abnormalNote || '',
        answers: evalData.answers || {},
        sheet_synced: false
      };

      var eqUpdate = {
        status: isAbnormal ? 'abnormal' : 'ready',
        repair_status: isAbnormal ? 'reported' : 'ready',
        last_evaluated_at: evalData.evaluatedAt,
        last_evaluated_by: evalData.evaluatedBy,
        updated_at: new Date().toISOString()
      };

      if (isAbnormal) {
        eqUpdate.repair_reported_at = evalData.evaluatedAt;
        eqUpdate.repair_reported_by = evalData.evaluatedBy;
        eqUpdate.abnormal_reason = evalData.abnormalNote || 'พบข้อบกพร่องจากการตรวจเช็ค';
      } else {
        eqUpdate.abnormal_reason = '';
      }

      var pInsertEval = supabaseFetch('evaluations', { method: 'POST', body: evalRow });
      var pUpdateEq = supabaseFetch('equipment?id=eq.' + encodeURIComponent(evalData.deviceId), {
        method: 'PATCH',
        body: eqUpdate
      });

      var promises = [pInsertEval, pUpdateEq];

      // If abnormal, also create an alert ticket in the repairs table
      if (isAbnormal) {
        var repairRow = {
          id: 'FIX-PT-' + Date.now(),
          device_id: evalData.deviceId,
          device_asset: evalData.deviceAsset || evalData.deviceId,
          device_name: evalData.deviceName,
          department: 'REHAB',
          defect_reason: evalData.abnormalNote || 'พบข้อบกพร่องจากการตรวจเช็คประจำวัน',
          reported_at: evalData.evaluatedAt,
          reported_by: evalData.evaluatedBy,
          sheet_synced: false
        };
        promises.push(supabaseFetch('repairs', { method: 'POST', body: repairRow }));
      }

      Promise.all(promises)
        .then(function (results) {
          if (callback) callback(null, { success: true, data: results[0] });
        })
        .catch(function (err) {
          console.error('submitPtEvaluation error:', err);
          if (callback) callback(err, null);
        });
    },

    // 3. Fetch Defective PT Equipment & Repairs
    fetchDefectiveList: function (callback) {
      var pEq = supabaseFetch('equipment?home_dept=eq.REHAB&order=id.asc').catch(function () { return []; });
      var pRepairs = supabaseFetch('repairs?department=eq.REHAB&order=reported_at.desc&limit=50').catch(function () { return []; });

      Promise.all([pEq, pRepairs])
        .then(function (res) {
          var allPtEq = res[0] || [];
          var defectiveEquipment = allPtEq.filter(function (eq) {
            return eq.status === 'abnormal' || eq.status === 'in_progress' || eq.status === 'conditional_ready' || eq.repair_status === 'reported' || eq.repair_status === 'in_progress';
          });
          var repairHistory = (res[1] || []).filter(function (r) { return !!r.resolved_at; });
          var activeRepairs = (res[1] || []).filter(function (r) { return !r.resolved_at; });

          if (callback) {
            callback(null, {
              defectiveList: defectiveEquipment,
              activeRepairs: activeRepairs,
              repairHistory: repairHistory
            });
          }
        })
        .catch(function (err) {
          console.error('fetchDefectiveList error:', err);
          if (callback) callback(err, null);
        });
    },

    // 4. Acknowledge Repair
    acknowledgeRepair: function (deviceId, staffName, callback) {
      var nowStr = new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
      var eqUpdate = {
        repair_status: 'in_progress',
        status: 'in_progress',
        repair_acknowledged_at: nowStr,
        repair_acknowledged_by: staffName,
        updated_at: new Date().toISOString()
      };

      var pEq = supabaseFetch('equipment?id=eq.' + encodeURIComponent(deviceId), {
        method: 'PATCH',
        body: eqUpdate
      });

      var pRepair = supabaseFetch('repairs?device_id=eq.' + encodeURIComponent(deviceId) + '&resolved_at=is.null', {
        method: 'PATCH',
        body: {
          acknowledged_at: nowStr,
          acknowledged_by: staffName
        }
      });

      Promise.all([pEq, pRepair])
        .then(function () {
          if (callback) callback(null, { success: true });
        })
        .catch(function (err) {
          console.error('acknowledgeRepair error:', err);
          if (callback) callback(err, null);
        });
    },

    // 5. Resolve Repair (ส่งคืนความพร้อมใช้งาน)
    resolveRepair: function (deviceId, staffName, actionTaken, testNote, callback) {
      var nowStr = new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
      var eqUpdate = {
        status: 'ready',
        repair_status: 'ready',
        abnormal_reason: '',
        updated_at: new Date().toISOString()
      };

      var pEq = supabaseFetch('equipment?id=eq.' + encodeURIComponent(deviceId), {
        method: 'PATCH',
        body: eqUpdate
      });

      var pRepair = supabaseFetch('repairs?device_id=eq.' + encodeURIComponent(deviceId) + '&resolved_at=is.null', {
        method: 'PATCH',
        body: {
          resolved_at: nowStr,
          resolved_by: staffName,
          action_taken: actionTaken,
          test_note: testNote
        }
      });

      Promise.all([pEq, pRepair])
        .then(function () {
          if (callback) callback(null, { success: true });
        })
        .catch(function (err) {
          console.error('resolveRepair error:', err);
          if (callback) callback(err, null);
        });
    },

    // 6. Fetch Device Evaluation History
    fetchDeviceHistory: function (deviceId, monthStr, callback) {
      var query = 'evaluations?device_id=eq.' + encodeURIComponent(deviceId) + '&order=evaluated_at.desc';
      if (monthStr) {
        query += '&evaluated_at=gte.' + monthStr + '-01T00:00:00Z&evaluated_at=lte.' + monthStr + '-31T23:59:59Z';
      }

      supabaseFetch(query)
        .then(function (rows) {
          if (callback) callback(null, rows || []);
        })
        .catch(function (err) {
          console.error('fetchDeviceHistory error:', err);
          if (callback) callback(err, null);
        });
    }
  };

  window.PPCH_PT_API = PPCH_PT_API;
})(window);
