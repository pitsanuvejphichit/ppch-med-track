/**
 * PPCH Medical Equipment Tracking & Evaluation System
 * High-Speed Cloud API Client powered by Supabase (Primary PostgreSQL)
 * with Automatic Background Sync to Google Sheets (Reporting & Backup)
 */

(function (window) {
  var supabaseInstance = null;

  function getSupabaseConfig() {
    var cfg = window.PPCH_CONFIG || {};
    return {
      url: (cfg.supabaseUrl || '').trim(),
      anonKey: (cfg.supabaseAnonKey || '').trim(),
      gasUrl: (cfg.defaultGasUrl || '').trim()
    };
  }

  function getSupabaseClient() {
    if (supabaseInstance) return supabaseInstance;
    var conf = getSupabaseConfig();
    if (window.supabase && conf.url && conf.anonKey) {
      try {
        supabaseInstance = window.supabase.createClient(conf.url, conf.anonKey, {
          auth: { persistSession: false, autoRefreshToken: false }
        });
      } catch (e) {
        console.warn('Supabase client init error:', e);
      }
    }
    return supabaseInstance;
  }

  // Direct REST API fetcher (fallback / zero external library dependency)
  function supabaseFetch(path, options) {
    var conf = getSupabaseConfig();
    if (!conf.url || !conf.anonKey) {
      return Promise.reject(new Error('Supabase configuration is missing'));
    }

    options = options || {};
    var headers = Object.assign({
      'apikey': conf.anonKey,
      'Authorization': 'Bearer ' + conf.anonKey,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }, options.headers || {});

    var fullUrl = conf.url.replace(/\/+$/, '') + '/rest/v1/' + path.replace(/^\/+/, '');
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

  // Row mappings (Postgres snake_case <-> App camelCase)
  function mapEquipmentFromDb(r) {
    return {
      id: r.id,
      assetCode: r.asset_code || '',
      name: r.name || '',
      formId: r.form_id || '',
      model: r.model || '',
      serialNo: r.serial_no || '',
      frequency: r.frequency || 'daily',
      homeDept: r.home_dept || '',
      currentDept: r.current_dept || '',
      status: r.status || 'ready',
      repairStatus: r.repair_status || 'ready',
      repairReportedAt: r.repair_reported_at || '',
      repairReportedBy: r.repair_reported_by || '',
      repairAcknowledgedAt: r.repair_acknowledged_at || '',
      repairAcknowledgedBy: r.repair_acknowledged_by || '',
      abnormalReason: r.abnormal_reason || '',
      lastEvaluatedAt: r.last_evaluated_at || '',
      lastEvaluatedBy: r.last_evaluated_by || ''
    };
  }

  function mapEvaluationFromDb(r) {
    var answersObj = r.answers || {};
    if (typeof answersObj === 'string') {
      try { answersObj = JSON.parse(answersObj); } catch (e) { answersObj = {}; }
    }
    return {
      id: r.id,
      deviceId: r.device_id,
      deviceAsset: r.device_asset,
      deviceName: r.device_name,
      department: r.department,
      formId: r.form_id,
      evaluatedAt: r.evaluated_at,
      evaluatedBy: r.evaluated_by,
      result: r.result,
      abnormalNote: r.abnormal_note || '',
      checklist: answersObj,
      upsBattery: {
        tested: !!r.ups_tested,
        runtimeFormatted: r.ups_duration || ''
      },
      sheetSynced: !!r.sheet_synced
    };
  }

  function mapRepairFromDb(r) {
    return {
      id: r.id,
      deviceId: r.device_id,
      deviceAsset: r.device_asset,
      deviceName: r.device_name,
      department: r.department,
      defectReason: r.defect_reason || '',
      reportedAt: r.reported_at || '',
      reportedBy: r.reported_by || '',
      acknowledgedAt: r.acknowledged_at || '',
      acknowledgedBy: r.acknowledged_by || '',
      resolvedAt: r.resolved_at || '',
      resolvedBy: r.resolved_by || '',
      actionTaken: r.action_taken || '',
      testResultNote: r.test_note || '',
      sheetSynced: !!r.sheet_synced
    };
  }

  function mapTransferFromDb(r) {
    return {
      id: r.id,
      deviceId: r.device_id,
      deviceAsset: r.device_asset,
      deviceName: r.device_name,
      fromDept: r.from_dept,
      toDept: r.to_dept,
      transferredBy: r.transferred_by,
      transferredAt: r.transferred_at,
      reason: r.reason || '',
      sheetSynced: !!r.sheet_synced
    };
  }

  var PPCH_API = {
    isConfigured: function () {
      var conf = getSupabaseConfig();
      return !!(conf.url && conf.anonKey);
    },

    getGasEndpoint: function () {
      return getSupabaseConfig().gasUrl;
    },

    // 1. Fetch Full Overview (Parallel PostgREST requests - sub-100ms)
    fetchOverview: function (callback) {
      var self = this;
      if (!this.isConfigured()) {
        if (callback) callback({ success: false, message: 'Supabase credentials not configured', data: null });
        return;
      }

      var pEquipment = supabaseFetch('equipment?select=*&order=asset_code.asc');
      var pEvaluations = supabaseFetch('evaluations?select=*&order=evaluated_at.desc&limit=500');
      var pRepairs = supabaseFetch('repairs?select=*&order=created_at.desc&limit=200');
      var pTransfers = supabaseFetch('transfers?select=*&order=created_at.desc&limit=200');

      Promise.all([pEquipment, pEvaluations, pRepairs, pTransfers])
        .then(function (results) {
          var eqList = (results[0] || []).map(mapEquipmentFromDb);
          var evList = (results[1] || []).map(mapEvaluationFromDb);
          var repList = (results[2] || []).map(mapRepairFromDb);
          var trfList = (results[3] || []).map(mapTransferFromDb);

          var responseData = {
            equipment: eqList,
            evaluations: evList,
            repairs: repList,
            transfers: trfList
          };

          if (callback) {
            callback({
              success: true,
              data: responseData,
              serverTime: new Date().toISOString()
            });
          }
        })
        .catch(function (err) {
          console.warn('Supabase fetchOverview failed, attempting GAS fallback:', err);
          self.fetchOverviewFromGasFallback(callback);
        });
    },

    // Fallback if Supabase is momentarily unreachable
    fetchOverviewFromGasFallback: function (callback) {
      var gasUrl = this.getGasEndpoint();
      if (!gasUrl) {
        if (callback) callback({ success: false, message: 'Cannot connect to database', data: null });
        return;
      }
      var cbName = 'ppch_fallback_cb_' + Date.now();
      var script = document.createElement('script');
      script.src = gasUrl + (gasUrl.indexOf('?') === -1 ? '?' : '&') + 'action=getOverview&callback=' + cbName;
      window[cbName] = function (data) {
        delete window[cbName];
        if (script.parentNode) script.parentNode.removeChild(script);
        if (callback && data && data.status === 'success') {
          callback({ success: true, data: data.data, serverTime: data.serverTime });
        }
      };
      document.body.appendChild(script);
    },

    // 2. Submit Evaluation (Direct write to Supabase + Background push to Google Sheets)
    submitEvaluation: function (record, callback) {
      var evalId = record.id || ('EV-' + Date.now());
      var isAbnormal = record.result === 'abnormal';

      var evalRow = {
        id: evalId,
        device_id: record.deviceId,
        device_asset: record.deviceAsset,
        device_name: record.deviceName,
        department: record.department,
        form_id: record.formId,
        evaluated_at: record.evaluatedAt,
        evaluated_by: record.evaluatedBy,
        result: record.result,
        abnormal_note: record.abnormalNote || '',
        answers: record.checklist || {},
        ups_tested: record.upsBattery ? !!record.upsBattery.tested : false,
        ups_duration: record.upsBattery ? (record.upsBattery.runtimeFormatted || '') : '',
        sheet_synced: false
      };

      var eqUpdate = {
        status: isAbnormal ? 'abnormal' : 'ready',
        repair_status: isAbnormal ? 'reported' : 'ready',
        last_evaluated_at: record.evaluatedAt,
        last_evaluated_by: record.evaluatedBy,
        updated_at: new Date().toISOString()
      };

      if (isAbnormal) {
        eqUpdate.repair_reported_at = record.evaluatedAt;
        eqUpdate.repair_reported_by = record.evaluatedBy;
        eqUpdate.abnormal_reason = record.abnormalNote || 'พบข้อบกพร่องจากการตรวจเช็ค';
      } else {
        eqUpdate.abnormal_reason = '';
      }

      var pInsertEval = supabaseFetch('evaluations', { method: 'POST', body: evalRow });
      var pUpdateEq = supabaseFetch('equipment?id=eq.' + encodeURIComponent(record.deviceId), {
        method: 'PATCH',
        body: eqUpdate
      });

      Promise.all([pInsertEval, pUpdateEq])
        .then(function () {
          // Immediately confirm to user UI (Instant <100ms response!)
          if (callback) callback({ success: true, id: evalId, message: 'บันทึกขึ้น Supabase สำเร็จ' });

          // Background Google Sheets Synchronization
          var gasPayload = {
            action: 'submitEvaluation',
            id: evalId,
            evaluatedAt: record.evaluatedAt,
            formId: record.formId,
            deviceId: record.deviceId,
            deviceAsset: record.deviceAsset,
            deviceName: record.deviceName,
            department: record.department,
            evaluatedBy: record.evaluatedBy,
            result: record.result,
            abnormalNote: record.abnormalNote || '',
            checklist: record.checklist || {},
            upsBatteryRuntime: record.upsBattery ? record.upsBattery.runtimeFormatted : '',
            upsBatteryTested: record.upsBattery ? record.upsBattery.tested : false,
            upsBatteryCycle: record.upsBattery ? record.upsBattery.cycleDate : ''
          };

          PPCH_API.postToGas(gasPayload, function (gasRes) {
            if (gasRes && gasRes.success) {
              supabaseFetch('evaluations?id=eq.' + encodeURIComponent(evalId), {
                method: 'PATCH',
                body: { sheet_synced: true, sheet_synced_at: new Date().toISOString() }
              }).catch(function (e) { console.warn('Mark sync error:', e); });
            }
          });
        })
        .catch(function (err) {
          console.error('Supabase submitEvaluation error:', err);
          if (callback) callback({ success: false, message: err.message });
        });
    },

    // 3. Acknowledge Defect (Update Supabase equipment)
    acknowledgeDefect: function (deviceId, ackBy, callback) {
      var nowStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16).replace('T', ' ');
      var eqUpdate = {
        status: 'in_progress',
        repair_status: 'in_progress',
        repair_acknowledged_by: ackBy || 'อาภากร บุญเกตกูล',
        repair_acknowledged_at: nowStr,
        updated_at: new Date().toISOString()
      };

      supabaseFetch('equipment?id=eq.' + encodeURIComponent(deviceId), {
        method: 'PATCH',
        body: eqUpdate
      }).then(function () {
        if (callback) callback({ success: true, message: 'รับทราบงานซ่อมในระบบ Supabase เรียบร้อย' });
        // Background notification to GAS if configured
        PPCH_API.postToGas({
          action: 'acknowledgeDefect',
          deviceId: deviceId,
          officerName: ackBy,
          acknowledgedAt: nowStr
        });
      }).catch(function (err) {
        console.error('Supabase acknowledgeDefect error:', err);
        if (callback) callback({ success: false, message: err.message });
      });
    },

    // 4. Resolve Defect (Insert into repairs + Set equipment status = 'ready' + Background push to Sheets)
    resolveDefect: function (deviceId, techName, actionTaken, resolvedDt, testNote, callback) {
      var nowStr = resolvedDt || new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16).replace('T', ' ');
      var repairId = 'FIX-' + Date.now();

      // Retrieve device information from memory
      var eq = window.PPCH_STORE ? window.PPCH_STORE.getEquipmentById(deviceId) : null;
      var deviceAsset = eq ? eq.assetCode : '';
      var deviceName = eq ? eq.name : '';
      var dept = eq ? eq.currentDept : '';
      var defectReason = eq ? (eq.abnormalReason || 'ตรวจพบข้อบกพร่อง') : 'ตรวจพบข้อบกพร่อง';
      var reportedAt = eq ? (eq.repairReportedAt || eq.lastEvaluatedAt || '-') : '-';
      var reportedBy = eq ? (eq.repairReportedBy || eq.lastEvaluatedBy || '-') : '-';
      var acknowledgedBy = eq ? (eq.repairAcknowledgedBy || '-') : '-';

      var repairRow = {
        id: repairId,
        device_id: deviceId,
        device_asset: deviceAsset,
        device_name: deviceName,
        department: dept,
        defect_reason: defectReason,
        reported_at: reportedAt,
        reported_by: reportedBy,
        acknowledged_at: eq ? eq.repairAcknowledgedAt : null,
        acknowledged_by: acknowledgedBy,
        resolved_at: nowStr,
        resolved_by: techName || 'อาภากร บุญเกตกูล',
        action_taken: actionTaken || 'ดำเนินการแก้ไขและทดสอบระบบเรียบร้อย',
        test_note: testNote || '',
        sheet_synced: false
      };

      var eqUpdate = {
        status: 'ready',
        repair_status: 'ready',
        abnormal_reason: '',
        last_evaluated_at: nowStr,
        last_evaluated_by: techName || 'อาภากร บุญเกตกูล',
        updated_at: new Date().toISOString()
      };

      var pInsertRepair = supabaseFetch('repairs', { method: 'POST', body: repairRow });
      var pUpdateEq = supabaseFetch('equipment?id=eq.' + encodeURIComponent(deviceId), {
        method: 'PATCH',
        body: eqUpdate
      });

      Promise.all([pInsertRepair, pUpdateEq])
        .then(function () {
          if (callback) callback({ success: true, message: 'บันทึกการแก้ไขใน Supabase สำเร็จ ปลดล็อกเครื่องพร้อมใช้งาน' });

          // Background Google Sheets Synchronization: Post evaluation with 'normal' result to clear defect in Sheets
          var gasPayload = {
            action: 'submitEvaluation',
            id: repairId,
            deviceId: deviceId,
            deviceAsset: deviceAsset,
            deviceName: deviceName,
            formId: eq ? eq.formId : '',
            department: dept,
            evaluatedBy: (techName || 'อาภากร บุญเกตกูล') + ' (ซ่อมเสร็จ: ' + actionTaken + ')',
            evaluatedAt: nowStr,
            result: 'normal',
            abnormalNote: 'แก้ไขเรียบร้อย: ' + actionTaken + (testNote ? ' | ' + testNote : '')
          };

          PPCH_API.postToGas(gasPayload, function (gasRes) {
            if (gasRes && gasRes.success) {
              supabaseFetch('repairs?id=eq.' + encodeURIComponent(repairId), {
                method: 'PATCH',
                body: { sheet_synced: true, sheet_synced_at: new Date().toISOString() }
              }).catch(function (e) { console.warn('Mark sync repair error:', e); });
            }
          });
        })
        .catch(function (err) {
          console.error('Supabase resolveDefect error:', err);
          if (callback) callback({ success: false, message: err.message });
        });
    },

    // 5. Transfer Equipment (Insert into transfers + Update equipment current_dept + Background push to Sheets)
    transferEquipment: function (transferData, callback) {
      var transferId = 'TR-' + Date.now();
      var nowStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16).replace('T', ' ');

      var trfRow = {
        id: transferId,
        device_id: transferData.deviceId,
        device_asset: transferData.deviceAsset,
        device_name: transferData.deviceName,
        from_dept: transferData.fromDept,
        to_dept: transferData.toDept,
        transferred_by: transferData.transferredBy || 'ไม่ระบุ',
        transferred_at: nowStr,
        reason: transferData.reason || 'ย้ายไปใช้งานที่แผนกใหม่',
        sheet_synced: false
      };

      var eqUpdate = {
        current_dept: transferData.toDept,
        updated_at: new Date().toISOString()
      };

      var pInsertTrf = supabaseFetch('transfers', { method: 'POST', body: trfRow });
      var pUpdateEq = supabaseFetch('equipment?id=eq.' + encodeURIComponent(transferData.deviceId), {
        method: 'PATCH',
        body: eqUpdate
      });

      Promise.all([pInsertTrf, pUpdateEq])
        .then(function () {
          if (callback) callback({ success: true, message: 'บันทึกการโอนย้ายใน Supabase สำเร็จ' });

          // Background Google Sheets Synchronization
          var gasPayload = {
            action: 'transferEquipment',
            deviceId: transferData.deviceId,
            deviceAsset: transferData.deviceAsset,
            deviceName: transferData.deviceName,
            fromDept: transferData.fromDept,
            toDept: transferData.toDept,
            transferredBy: transferData.transferredBy || 'ไม่ระบุ',
            reason: transferData.reason || ''
          };

          PPCH_API.postToGas(gasPayload, function (gasRes) {
            if (gasRes && gasRes.success) {
              supabaseFetch('transfers?id=eq.' + encodeURIComponent(transferId), {
                method: 'PATCH',
                body: { sheet_synced: true, sheet_synced_at: new Date().toISOString() }
              }).catch(function (e) { console.warn('Mark sync transfer error:', e); });
            }
          });
        })
        .catch(function (err) {
          console.error('Supabase transferEquipment error:', err);
          if (callback) callback({ success: false, message: err.message });
        });
    },

    // 6. Supabase Real-time Subscription
    initRealtime: function (onChangeCallback) {
      var client = getSupabaseClient();
      if (!client) return null;

      try {
        var channel = client
          .channel('public-db-changes')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'equipment' }, function () {
            if (onChangeCallback) onChangeCallback('equipment');
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'evaluations' }, function () {
            if (onChangeCallback) onChangeCallback('evaluations');
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'repairs' }, function () {
            if (onChangeCallback) onChangeCallback('repairs');
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'transfers' }, function () {
            if (onChangeCallback) onChangeCallback('transfers');
          })
          .subscribe();

        return channel;
      } catch (err) {
        console.warn('Realtime subscription error:', err);
        return null;
      }
    },

    // 7. Background Google Apps Script Fire-and-Forget
    postToGas: function (payload, callback) {
      var gasUrl = this.getGasEndpoint();
      if (!gasUrl) {
        if (callback) callback({ success: false, message: 'No GAS URL configured' });
        return;
      }

      fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        mode: 'no-cors'
      }).then(function () {
        if (callback) callback({ success: true, message: 'ส่งข้อมูลลง Google Sheets สำเร็จ' });
      }).catch(function (err) {
        console.warn('GAS Post Error:', err);
        if (callback) callback({ success: false, message: err.toString() });
      });
    },

    // 8. Test LINE Alert via GAS
    testLineAlert: function (callback) {
      var gasUrl = this.getGasEndpoint();
      if (!gasUrl) {
        if (callback) callback({ success: false, message: 'ยังไม่ได้ระบุ Web App URL ของ Google Apps Script' });
        return;
      }
      this.postToGas({ action: 'testLine' }, function (res) {
        if (callback) callback(res);
      });
    }
  };

  window.PPCH_API = PPCH_API;
})(window);
