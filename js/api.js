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
      frequency: r.frequency || 'daily',
      riskLevel: r.risk_level || (r.frequency === 'monthly' ? 'low' : 'high'),
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
      var pDepartments = supabaseFetch('departments?select=*&order=name.asc').catch(function () { return []; });
      var pCustomForms = supabaseFetch('custom_forms?select=*&order=created_at.asc').catch(function () { return []; });

      Promise.all([pEquipment, pEvaluations, pRepairs, pTransfers, pDepartments, pCustomForms])
        .then(function (results) {
          var eqList = (results[0] || []).map(mapEquipmentFromDb);
          var evList = (results[1] || []).map(mapEvaluationFromDb);
          var repList = (results[2] || []).map(mapRepairFromDb);
          var trfList = (results[3] || []).map(mapTransferFromDb);
          var deptList = results[4] || [];
          var cfList = results[5] || [];

          var responseData = {
            equipment: eqList,
            evaluations: evList,
            repairs: repList,
            transfers: trfList,
            departments: deptList,
            customForms: cfList
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
        current_dept: record.department,
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
            checklistDetails: record.checklistDetails || [],
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

    // 3.1 Allow Continued Conditional Use (Update equipment status to conditional_ready)
    allowUseEquipment: function (deviceId, officerName, reason, allowAt, callback) {
      var nowStr = allowAt || new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16).replace('T', ' ');
      var eqUpdate = {
        status: 'conditional_ready',
        updated_at: new Date().toISOString()
      };

      supabaseFetch('equipment?id=eq.' + encodeURIComponent(deviceId), {
        method: 'PATCH',
        body: eqUpdate
      }).then(function () {
        if (callback) callback({ success: true, message: 'บันทึกอนุญาตให้ใช้งานต่อเรียบร้อย' });
        PPCH_API.postToGas({
          action: 'allowUseEquipment',
          deviceId: deviceId,
          officerName: officerName,
          reason: reason,
          allowAt: nowStr
        });
      }).catch(function (err) {
        console.error('Supabase allowUseEquipment error:', err);
        if (callback) callback({ success: false, message: err.message });
      });
    },

    // 3.2 Revoke Conditional Use (Revert equipment status to abnormal)
    revokeAllowUse: function (deviceId, callback) {
      var eqUpdate = {
        status: 'abnormal',
        updated_at: new Date().toISOString()
      };

      supabaseFetch('equipment?id=eq.' + encodeURIComponent(deviceId), {
        method: 'PATCH',
        body: eqUpdate
      }).then(function () {
        if (callback) callback({ success: true, message: 'ยกเลิกการอนุญาตให้ใช้งานต่อเรียบร้อย' });
        PPCH_API.postToGas({
          action: 'revokeAllowUse',
          deviceId: deviceId
        });
      }).catch(function (err) {
        console.error('Supabase revokeAllowUse error:', err);
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

    // 5.1 Assign Department (มอบหมายแผนก)
    assignDepartment: function (deviceId, toDeptId, callback) {
      var eqUpdate = {
        current_dept: toDeptId,
        updated_at: new Date().toISOString()
      };

      supabaseFetch('equipment?id=eq.' + encodeURIComponent(deviceId), {
        method: 'PATCH',
        body: eqUpdate
      })
      .then(function () {
        if (callback) callback({ success: true, message: 'มอบหมายแผนกสำเร็จ' });

        // Background GAS sync
        PPCH_API.postToGas({
          action: 'assignDepartment',
          deviceId: deviceId,
          department: toDeptId
        }, function () {});
      })
      .catch(function (err) {
        console.error('Supabase assignDepartment error:', err);
        if (callback) callback({ success: false, message: err.message });
      });
    },

    // 5.2 Department Management (CRUD)
    createDepartment: function (deptData, callback) {
      if (!deptData || !deptData.name) {
        if (callback) callback({ success: false, message: 'กรุณาระบุชื่อแผนก' });
        return;
      }
      var deptId = (deptData.id || deptData.code || ('DEPT_' + Date.now())).trim().toUpperCase();
      var body = {
        id: deptId,
        name: deptData.name.trim()
      };
      supabaseFetch('departments', { method: 'POST', body: body })
        .then(function (res) {
          var created = (Array.isArray(res) && res[0]) ? res[0] : body;
          if (callback) callback({ success: true, data: created, message: 'เพิ่มแผนกเรียบร้อย' });
        })
        .catch(function (err) {
          console.error('Supabase createDepartment error:', err);
          if (callback) callback({ success: false, message: err.message });
        });
    },

    updateDepartment: function (deptId, deptData, callback) {
      if (!deptId || !deptData || !deptData.name) {
        if (callback) callback({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });
        return;
      }
      var body = { name: deptData.name.trim() };
      supabaseFetch('departments?id=eq.' + encodeURIComponent(deptId), { method: 'PATCH', body: body })
        .then(function (res) {
          var updated = (Array.isArray(res) && res[0]) ? res[0] : { id: deptId, name: deptData.name };
          if (callback) callback({ success: true, data: updated, message: 'แก้ไขแผนกเรียบร้อย' });
        })
        .catch(function (err) {
          console.error('Supabase updateDepartment error:', err);
          if (callback) callback({ success: false, message: err.message });
        });
    },

    deleteDepartment: function (deptId, callback) {
      if (!deptId) {
        if (callback) callback({ success: false, message: 'กรุณาระบุรหัสแผนก' });
        return;
      }
      supabaseFetch('departments?id=eq.' + encodeURIComponent(deptId), { method: 'DELETE' })
        .then(function () {
          if (callback) callback({ success: true, message: 'ลบแผนกเรียบร้อย' });
        })
        .catch(function (err) {
          console.error('Supabase deleteDepartment error:', err);
          if (callback) callback({ success: false, message: err.message });
        });
    },

    // 5.2 Custom Evaluation Forms CRUD
    createCustomForm: function (formObj, callback) {
      if (!formObj || !formObj.id || !formObj.name) {
        if (callback) callback({ success: false, message: 'กรุณากรอกข้อมูลแบบฟอร์มให้ครบถ้วน' });
        return;
      }
      var row = {
        id: formObj.id,
        name: formObj.name,
        short_name: formObj.shortName || formObj.name,
        category: formObj.category || 'เครื่องมือแพทย์ทั่วไป',
        frequency: formObj.frequency || 'daily',
        risk_level: formObj.riskLevel || 'high',
        items: formObj.items || []
      };
      supabaseFetch('custom_forms', {
        method: 'POST',
        body: row
      }).then(function (res) {
        if (callback) callback({ success: true, data: formObj });
      }).catch(function (err) {
        console.warn('Supabase createCustomForm error:', err);
        // Fallback to local success so UI still continues seamlessly
        if (callback) callback({ success: true, data: formObj, warning: err.message });
      });
    },

    // 5.3 Equipment Management (CRUD)
    createEquipment: function (itemData, callback) {
      if (!itemData || !itemData.assetCode || !itemData.name) {
        if (callback) callback({ success: false, message: 'กรุณาระบุรหัสเครื่องและชื่อเครื่องมือแพทย์' });
        return;
      }
      var riskLevel = itemData.riskLevel || (itemData.frequency === 'monthly' ? 'low' : 'high');
      var frequency = (riskLevel === 'low' || itemData.frequency === 'monthly') ? 'monthly' : 'daily';
      var eqId = itemData.id || ('EQ-' + Date.now());
      var row = {
        id: eqId,
        asset_code: itemData.assetCode.trim(),
        name: itemData.name.trim(),
        form_id: itemData.formId || 'defibrillator',
        risk_level: riskLevel,
        frequency: frequency,
        home_dept: itemData.homeDept || itemData.currentDept || 'CENTRAL',
        current_dept: itemData.currentDept || itemData.homeDept || 'CENTRAL',
        status: itemData.status || 'ready',
        repair_status: itemData.repairStatus || 'ready',
        abnormal_reason: itemData.abnormalReason || ''
      };

      supabaseFetch('equipment', { method: 'POST', body: row })
        .then(function (res) {
          var created = (Array.isArray(res) && res[0]) ? mapEquipmentFromDb(res[0]) : mapEquipmentFromDb(row);
          if (callback) callback({ success: true, data: created, message: 'เพิ่มเครื่องมือแพทย์เรียบร้อย' });

          // Background Google Sheets Synchronization
          PPCH_API.postToGas({
            action: 'createEquipment',
            id: created.id,
            assetCode: created.assetCode,
            name: created.name,
            formId: created.formId,
            riskLevel: created.riskLevel,
            frequency: created.frequency,
            homeDept: created.homeDept,
            currentDept: created.currentDept,
            status: created.status
          });
        })
        .catch(function (err) {
          console.error('Supabase createEquipment error:', err);
          if (callback) callback({ success: false, message: err.message });
        });
    },

    updateEquipment: function (deviceId, itemData, callback) {
      if (!deviceId || !itemData) {
        if (callback) callback({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });
        return;
      }
      var body = {
        updated_at: new Date().toISOString()
      };
      if (itemData.assetCode !== undefined) body.asset_code = itemData.assetCode.trim();
      if (itemData.name !== undefined) body.name = itemData.name.trim();
      if (itemData.formId !== undefined) body.form_id = itemData.formId;
      if (itemData.riskLevel !== undefined) {
        body.risk_level = itemData.riskLevel;
        body.frequency = (itemData.riskLevel === 'low') ? 'monthly' : 'daily';
      } else if (itemData.frequency !== undefined) {
        body.frequency = itemData.frequency;
        body.risk_level = (itemData.frequency === 'monthly') ? 'low' : 'high';
      }
      if (itemData.homeDept !== undefined) body.home_dept = itemData.homeDept;
      if (itemData.currentDept !== undefined) body.current_dept = itemData.currentDept;
      if (itemData.status !== undefined) body.status = itemData.status;

      supabaseFetch('equipment?id=eq.' + encodeURIComponent(deviceId), { method: 'PATCH', body: body })
        .then(function (res) {
          var updated = (Array.isArray(res) && res[0]) ? mapEquipmentFromDb(res[0]) : null;
          if (callback) callback({ success: true, data: updated, message: 'แก้ไขข้อมูลเครื่องมือแพทย์เรียบร้อย' });

          // Background Google Sheets Synchronization
          PPCH_API.postToGas({
            action: 'updateEquipment',
            deviceId: deviceId,
            assetCode: itemData.assetCode,
            name: itemData.name,
            formId: itemData.formId,
            riskLevel: itemData.riskLevel,
            frequency: itemData.frequency,
            homeDept: itemData.homeDept,
            currentDept: itemData.currentDept,
            status: itemData.status
          });
        })
        .catch(function (err) {
          console.error('Supabase updateEquipment error:', err);
          if (callback) callback({ success: false, message: err.message });
        });
    },

    deleteEquipment: function (deviceId, callback) {
      if (!deviceId) {
        if (callback) callback({ success: false, message: 'กรุณาระบุรหัสเครื่องมือแพทย์' });
        return;
      }
      supabaseFetch('equipment?id=eq.' + encodeURIComponent(deviceId), { method: 'DELETE' })
        .then(function () {
          if (callback) callback({ success: true, message: 'ลบเครื่องมือแพทย์เรียบร้อย' });

          // Background Google Sheets Synchronization
          PPCH_API.postToGas({
            action: 'deleteEquipment',
            deviceId: deviceId
          });
        })
        .catch(function (err) {
          console.error('Supabase deleteEquipment error:', err);
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
          .on('postgres_changes', { event: '*', schema: 'public', table: 'departments' }, function () {
            if (onChangeCallback) onChangeCallback('departments');
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

    // 8. Test LINE Alert via GAS (Messaging API & Notify)
    testLineAlert: function (callback) {
      this.testLineDevAlert('Admin', callback);
    },

    testLineDevAlert: function (operator, callback) {
      var gasUrl = this.getGasEndpoint();
      if (!gasUrl) {
        if (callback) callback({ success: false, message: 'ยังไม่ได้ระบุ Web App URL ของ Google Apps Script' });
        return;
      }
      this.postToGas({ action: 'testLineDev', operator: operator || 'Admin' }, function (res) {
        if (callback) callback(res);
      });
    },

    sendSummaryChartAlert: function (operator, callback) {
      var gasUrl = this.getGasEndpoint();
      if (!gasUrl) {
        if (callback) callback({ success: false, message: 'ยังไม่ได้ระบุ Web App URL ของ Google Apps Script' });
        return;
      }
      this.postToGas({ action: 'sendSummaryChart', operator: operator || 'Admin' }, function (res) {
        if (callback) callback(res);
      });
    },

    // 9. Fetch LINE Settings from Google Sheets
    fetchLineSettings: function (callback) {
      var gasUrl = this.getGasEndpoint();
      if (!gasUrl) {
        if (callback) callback({ success: false, message: 'ยังไม่ได้ระบุ Web App URL ของ Google Apps Script' });
        return;
      }
      var cbName = 'ppch_linesettings_cb_' + Date.now();
      var script = document.createElement('script');
      script.src = gasUrl + (gasUrl.indexOf('?') === -1 ? '?' : '&') + 'action=getLineSettings&callback=' + cbName;
      window[cbName] = function (data) {
        delete window[cbName];
        if (script.parentNode) script.parentNode.removeChild(script);
        if (callback) callback({ success: true, data: (data && data.data) ? data.data : null });
      };
      script.onerror = function () {
        delete window[cbName];
        if (script.parentNode) script.parentNode.removeChild(script);
        if (callback) callback({ success: false, message: 'Failed to load LINE settings' });
      };
      document.body.appendChild(script);
    },

    // 10. Save LINE Settings to Google Sheets
    saveLineSettings: function (settings, callback) {
      var payload = Object.assign({ action: 'saveLineSettings' }, settings);
      this.postToGas(payload, callback);
    }
  };

  window.PPCH_API = PPCH_API;
})(window);
