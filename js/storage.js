/**
 * PPCH Medical Equipment Tracking & Evaluation System
 * Pure In-Memory Runtime State & Data Manager (Database-Driven, ZERO LocalStorage)
 */

(function (window) {
  // Purge any legacy localStorage keys to ensure complete absence of local machine caching
  try {
    if (window.PPCH_CONFIG && window.PPCH_CONFIG.storageKey) {
      localStorage.removeItem(window.PPCH_CONFIG.storageKey);
    }
    localStorage.removeItem('ppch_medical_equipment_data_v2');
    localStorage.removeItem('ppch_med_track_v1');
    localStorage.removeItem('ppch_med_gas_url');
  } catch (e) {}

  // Pure in-memory state for current browser session (Populated directly from Google Sheets API)
  var inMemoryData = {
    departments: (window.PPCH_CONFIG && window.PPCH_CONFIG.departments) ? JSON.parse(JSON.stringify(window.PPCH_CONFIG.departments)) : [],
    equipment: (window.PPCH_CONFIG && window.PPCH_CONFIG.initialEquipment) ? JSON.parse(JSON.stringify(window.PPCH_CONFIG.initialEquipment)) : [],
    evaluations: [],
    transfers: [],
    repairs: []
  };

  function notifyUpdated() {
    window.dispatchEvent(new CustomEvent('ppch:data-updated', { detail: inMemoryData }));
  }

  window.PPCH_STORE = {
    // Initialize or refresh live data directly from Google Apps Script / Google Sheets
    initFromCloud: function (cloudData) {
      if (!cloudData) return inMemoryData;

      if (Array.isArray(cloudData.equipment) && cloudData.equipment.length > 0) {
        inMemoryData.equipment = cloudData.equipment;
      }
      if (Array.isArray(cloudData.evaluations)) {
        inMemoryData.evaluations = cloudData.evaluations;

        // Group latest evaluation per device
        var latestEvalMap = {};
        cloudData.evaluations.forEach(function (ev) {
          if (!ev || !ev.evaluatedAt) return;
          var k1 = ev.deviceId;
          var k2 = ev.deviceAsset;
          if (k1 && (!latestEvalMap[k1] || ev.evaluatedAt > latestEvalMap[k1].evaluatedAt)) {
            latestEvalMap[k1] = ev;
          }
          if (k2 && (!latestEvalMap[k2] || ev.evaluatedAt > latestEvalMap[k2].evaluatedAt)) {
            latestEvalMap[k2] = ev;
          }
        });

        // Update equipment status based on backend equipment status AND latest evaluation
        inMemoryData.equipment.forEach(function (item) {
          var latestEv = latestEvalMap[item.id] || latestEvalMap[item.assetCode];
          if (latestEv) {
            if (!item.lastEvaluatedAt || latestEv.evaluatedAt >= item.lastEvaluatedAt) {
              item.lastEvaluatedAt = latestEv.evaluatedAt;
              item.lastEvaluatedBy = latestEv.evaluatedBy;
            }
            if (item.status === 'ready' || latestEv.result === 'normal') {
              item.status = 'ready';
              item.repairStatus = 'ready';
              item.abnormalReason = '';
              item.allowUse = false;
            } else if (latestEv.result === 'abnormal') {
              if (item.allowUse || item.status === 'conditional_ready') {
                item.status = 'conditional_ready';
                item.allowUse = true;
              } else {
                item.status = 'abnormal';
              }
              item.repairStatus = item.repairStatus || 'reported';
              item.abnormalReason = latestEv.abnormalNote || item.abnormalReason || 'พบข้อบกพร่องจากการตรวจเช็ค';
              item.repairReportedAt = item.repairReportedAt || latestEv.evaluatedAt;
              item.repairReportedBy = item.repairReportedBy || latestEv.evaluatedBy;
            }
          }
        });
      } else {
        inMemoryData.evaluations = [];
      }
      if (Array.isArray(cloudData.transfers)) {
        inMemoryData.transfers = cloudData.transfers;
      } else {
        inMemoryData.transfers = [];
      }
      if (Array.isArray(cloudData.departments) && cloudData.departments.length > 0) {
        inMemoryData.departments = cloudData.departments;
        if (window.PPCH_CONFIG) {
          window.PPCH_CONFIG.departments = cloudData.departments;
        }
      }

      notifyUpdated();
      return inMemoryData;
    },

    syncCloudEvaluations: function (cloudEvals) {
      if (!Array.isArray(cloudEvals)) return inMemoryData.evaluations;
      inMemoryData.evaluations = cloudEvals;

      var latestEvalMap = {};
      cloudEvals.forEach(function (ev) {
        if (!ev || !ev.evaluatedAt) return;
        var k1 = ev.deviceId;
        var k2 = ev.deviceAsset;
        if (k1 && (!latestEvalMap[k1] || ev.evaluatedAt > latestEvalMap[k1].evaluatedAt)) {
          latestEvalMap[k1] = ev;
        }
        if (k2 && (!latestEvalMap[k2] || ev.evaluatedAt > latestEvalMap[k2].evaluatedAt)) {
          latestEvalMap[k2] = ev;
        }
      });

      inMemoryData.equipment.forEach(function (eq) {
        var latestEv = latestEvalMap[eq.id] || latestEvalMap[eq.assetCode];
        if (latestEv) {
          if (!eq.lastEvaluatedAt || latestEv.evaluatedAt >= eq.lastEvaluatedAt) {
            eq.lastEvaluatedAt = latestEv.evaluatedAt;
            eq.lastEvaluatedBy = latestEv.evaluatedBy;
          }
          if (eq.status === 'ready' || latestEv.result === 'normal') {
            eq.status = 'ready';
            eq.repairStatus = 'ready';
            eq.abnormalReason = '';
            eq.allowUse = false;
          } else if (latestEv.result === 'abnormal') {
            if (eq.allowUse || eq.status === 'conditional_ready') {
              eq.status = 'conditional_ready';
              eq.allowUse = true;
            } else {
              eq.status = 'abnormal';
            }
            eq.repairStatus = eq.repairStatus || 'reported';
            eq.abnormalReason = latestEv.abnormalNote || eq.abnormalReason || 'พบข้อบกพร่องจากการตรวจเช็ค';
            eq.repairReportedAt = eq.repairReportedAt || latestEv.evaluatedAt;
            eq.repairReportedBy = eq.repairReportedBy || latestEv.evaluatedBy;
          }
        }
      });

      notifyUpdated();
      return inMemoryData.evaluations;
    },

    getAll: function () {
      return inMemoryData;
    },

    getEquipment: function () {
      return inMemoryData.equipment || [];
    },

    getEvaluations: function () {
      return inMemoryData.evaluations || [];
    },

    getTransfers: function () {
      return inMemoryData.transfers || [];
    },

    getEquipmentById: function (id) {
      var list = inMemoryData.equipment || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id || list[i].assetCode === id) {
          return list[i];
        }
      }
      return null;
    },

    getDepartments: function () {
      return (inMemoryData.departments && inMemoryData.departments.length > 0)
        ? inMemoryData.departments
        : ((window.PPCH_CONFIG && window.PPCH_CONFIG.departments) || []);
    },

    getDepartmentName: function (deptId) {
      var depts = this.getDepartments();
      for (var i = 0; i < depts.length; i++) {
        if (depts[i].id === deptId) return depts[i].name;
      }
      return deptId || '-';
    },

    addDepartment: function (dept) {
      if (!inMemoryData.departments) inMemoryData.departments = [];
      var exists = inMemoryData.departments.some(function (d) { return d.id === dept.id; });
      if (!exists) {
        inMemoryData.departments.push(dept);
        if (window.PPCH_CONFIG) window.PPCH_CONFIG.departments = inMemoryData.departments;
        notifyUpdated();
      }
      return inMemoryData.departments;
    },

    updateDepartment: function (id, deptData) {
      if (!inMemoryData.departments) inMemoryData.departments = [];
      for (var i = 0; i < inMemoryData.departments.length; i++) {
        if (inMemoryData.departments[i].id === id) {
          if (deptData.name) inMemoryData.departments[i].name = deptData.name;
          break;
        }
      }
      if (window.PPCH_CONFIG) window.PPCH_CONFIG.departments = inMemoryData.departments;
      notifyUpdated();
      return inMemoryData.departments;
    },

    deleteDepartment: function (id) {
      if (!inMemoryData.departments) return;
      inMemoryData.departments = inMemoryData.departments.filter(function (d) { return d.id !== id; });
      if (window.PPCH_CONFIG) window.PPCH_CONFIG.departments = inMemoryData.departments;
      notifyUpdated();
      return inMemoryData.departments;
    },

    addEquipment: function (item) {
      if (!inMemoryData.equipment) inMemoryData.equipment = [];
      inMemoryData.equipment.unshift(item);
      notifyUpdated();
      return inMemoryData.equipment;
    },

    updateEquipment: function (id, itemData) {
      if (!inMemoryData.equipment) return;
      for (var i = 0; i < inMemoryData.equipment.length; i++) {
        if (inMemoryData.equipment[i].id === id) {
          Object.assign(inMemoryData.equipment[i], itemData);
          break;
        }
      }
      notifyUpdated();
      return inMemoryData.equipment;
    },

    deleteEquipment: function (id) {
      if (!inMemoryData.equipment) return;
      inMemoryData.equipment = inMemoryData.equipment.filter(function (eq) { return eq.id !== id; });
      notifyUpdated();
      return inMemoryData.equipment;
    },

    getFormById: function (formId) {
      var forms = (window.PPCH_CONFIG && window.PPCH_CONFIG.forms) || [];
      for (var i = 0; i < forms.length; i++) {
        if (forms[i].id === formId) return forms[i];
      }
      return null;
    },

    // Record an Evaluation in memory (for immediate session responsiveness)
    recordEvaluation: function (evalPayload) {
      return this.submitEvaluation(evalPayload);
    },

    submitEvaluation: function (evalPayload) {
      var eq = null;
      var eqIndex = -1;

      for (var i = 0; i < inMemoryData.equipment.length; i++) {
        if (inMemoryData.equipment[i].id === evalPayload.deviceId || inMemoryData.equipment[i].assetCode === evalPayload.deviceAsset) {
          eq = inMemoryData.equipment[i];
          eqIndex = i;
          break;
        }
      }

      var nowStr = evalPayload.evaluatedAt || new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16).replace('T', ' ');

      if (eq) {
        eq.lastEvaluatedAt = nowStr;
        eq.lastEvaluatedStatus = evalPayload.result;
        eq.lastEvaluatedBy = evalPayload.evaluatedBy;
        eq.currentDept = evalPayload.department || eq.currentDept;

        if (evalPayload.result === 'abnormal') {
          eq.status = 'abnormal';
          eq.abnormalReason = evalPayload.abnormalNote || 'พบข้อบกพร่องจากการตรวจเช็ค';
          eq.repairStatus = 'reported';
          eq.repairReportedAt = nowStr;
          eq.repairReportedBy = evalPayload.evaluatedBy;
        } else {
          eq.status = 'ready';
          eq.abnormalReason = '';
          eq.repairStatus = 'ready';
        }

        if (evalPayload.upsBattery && evalPayload.upsBattery.tested) {
          eq.lastBatteryTestedAt = nowStr;
          eq.lastBatteryRuntime = evalPayload.upsBattery.runtimeFormatted;
          eq.lastBatteryStatus = evalPayload.upsBattery.status || 'normal';
        }

        inMemoryData.equipment[eqIndex] = eq;
      }

      var evalRecord = {
        id: evalPayload.id || ('EV-' + Date.now()),
        deviceId: eq ? eq.id : evalPayload.deviceId,
        deviceAsset: eq ? eq.assetCode : evalPayload.deviceAsset,
        deviceName: eq ? eq.name : evalPayload.deviceName,
        formId: evalPayload.formId,
        department: eq ? eq.currentDept : evalPayload.department,
        evaluatedBy: evalPayload.evaluatedBy,
        evaluatedAt: nowStr,
        result: evalPayload.result,
        abnormalNote: evalPayload.abnormalNote || '',
        checklist: evalPayload.checklist || {},
        upsBattery: evalPayload.upsBattery || null
      };

      inMemoryData.evaluations.unshift(evalRecord);
      notifyUpdated();
      return { success: true, record: evalRecord, equipment: eq };
    },

    assignDepartment: function (deviceId, toDeptId) {
      var eq = this.getEquipmentById(deviceId);
      if (!eq) throw new Error('ไม่พบเครื่องมือแพทย์รหัส ' + deviceId);
      eq.currentDept = toDeptId;
      notifyUpdated();
      return { success: true, equipment: eq };
    },

    transferEquipment: function (deviceId, toDeptId, transferredBy, reason) {
      var eq = null;
      for (var i = 0; i < inMemoryData.equipment.length; i++) {
        if (inMemoryData.equipment[i].id === deviceId) {
          eq = inMemoryData.equipment[i];
          break;
        }
      }
      if (!eq) throw new Error('ไม่พบเครื่องมือแพทย์รหัส ' + deviceId);

      var oldDept = eq.currentDept;
      var nowStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16).replace('T', ' ');
      eq.currentDept = toDeptId;

      var transferLog = {
        id: 'TR-' + Date.now(),
        deviceId: eq.id,
        deviceAsset: eq.assetCode,
        deviceName: eq.name,
        fromDept: oldDept,
        toDept: toDeptId,
        transferredBy: transferredBy || 'ไม่ระบุ',
        transferredAt: nowStr,
        reason: reason || 'ย้ายไปใช้งานที่แผนกใหม่'
      };

      inMemoryData.transfers.unshift(transferLog);
      notifyUpdated();
      return { success: true, transfer: transferLog, equipment: eq };
    },

    acknowledgeDefect: function (deviceId, ackBy) {
      var eq = null;
      for (var i = 0; i < inMemoryData.equipment.length; i++) {
        if (inMemoryData.equipment[i].id === deviceId) {
          eq = inMemoryData.equipment[i];
          break;
        }
      }
      if (!eq) throw new Error('ไม่พบเครื่องมือแพทย์รหัส: ' + deviceId);

      var nowStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16).replace('T', ' ');
      eq.status = 'in_progress';
      eq.repairStatus = 'in_progress';
      eq.repairAcknowledgedBy = ackBy || 'อาภากร บุญเกตกูล';
      eq.repairAcknowledgedAt = nowStr;

      notifyUpdated();
      return { success: true, equipment: eq };
    },

    // Allow continued conditional use even if defective
    allowUseEquipment: function (deviceId, officerName, reason, allowAt) {
      var eq = null;
      for (var i = 0; i < inMemoryData.equipment.length; i++) {
        if (inMemoryData.equipment[i].id === deviceId) {
          eq = inMemoryData.equipment[i];
          break;
        }
      }
      if (!eq) throw new Error('ไม่พบเครื่องมือแพทย์รหัส: ' + deviceId);

      var nowStr = allowAt || new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16).replace('T', ' ');
      eq.status = 'conditional_ready';
      eq.allowUse = true;
      eq.allowUseBy = officerName || 'เจ้าหน้าที่';
      eq.allowUseAt = nowStr;
      eq.allowUseReason = reason ? reason.trim() : '';

      notifyUpdated();
      return { success: true, equipment: eq };
    },

    revokeAllowUse: function (deviceId) {
      var eq = null;
      for (var i = 0; i < inMemoryData.equipment.length; i++) {
        if (inMemoryData.equipment[i].id === deviceId) {
          eq = inMemoryData.equipment[i];
          break;
        }
      }
      if (!eq) throw new Error('ไม่พบเครื่องมือแพทย์รหัส: ' + deviceId);

      eq.status = 'abnormal';
      eq.allowUse = false;
      eq.allowUseBy = '';
      eq.allowUseAt = '';
      eq.allowUseReason = '';

      notifyUpdated();
      return { success: true, equipment: eq };
    },

    resolveDefect: function (deviceId, techName, actionTaken, resolvedDt, testNote) {
      var eq = null;
      for (var i = 0; i < inMemoryData.equipment.length; i++) {
        if (inMemoryData.equipment[i].id === deviceId) {
          eq = inMemoryData.equipment[i];
          break;
        }
      }
      if (!eq) throw new Error('ไม่พบเครื่องมือแพทย์รหัส: ' + deviceId);

      var nowStr = resolvedDt || new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16).replace('T', ' ');
      var defectLog = {
        id: 'FIX-' + Date.now(),
        deviceId: eq.id,
        deviceAsset: eq.assetCode,
        deviceName: eq.name,
        department: eq.currentDept,
        defectReason: eq.abnormalReason || 'ตรวจพบข้อบกพร่อง',
        reportedAt: eq.repairReportedAt || eq.lastEvaluatedAt || '-',
        reportedBy: eq.repairReportedBy || eq.lastEvaluatedBy || '-',
        acknowledgedBy: eq.repairAcknowledgedBy || '-',
        resolvedAt: nowStr,
        resolvedBy: techName || 'อาภากร บุญเกตกูล',
        actionTaken: actionTaken || 'ดำเนินการแก้ไขและทดสอบระบบเรียบร้อย',
        testResultNote: testNote || ''
      };

      eq.status = 'ready';
      eq.repairStatus = 'ready';
      eq.abnormalReason = '';
      eq.allowUse = false;
      eq.allowUseBy = '';
      eq.allowUseAt = '';
      eq.allowUseReason = '';
      eq.lastEvaluatedAt = nowStr;
      eq.lastEvaluatedBy = techName;
      eq.lastEvaluatedStatus = 'normal';

      var resEval = {
        id: 'EV-' + Date.now(),
        deviceId: eq.id,
        deviceAsset: eq.assetCode,
        deviceName: eq.name,
        formId: eq.formId,
        department: eq.currentDept,
        evaluatedBy: techName + ' (ซ่อมเสร็จ: ' + actionTaken + ')',
        evaluatedAt: nowStr,
        result: 'normal',
        abnormalNote: 'แก้ไขเรียบร้อย: ' + actionTaken + (testNote ? ' | ' + testNote : ''),
        checklist: {},
        isRepairResolution: true
      };

      inMemoryData.evaluations.unshift(resEval);
      inMemoryData.repairs.unshift(defectLog);
      notifyUpdated();
      return { success: true, equipment: eq, repairRecord: defectLog, resolutionEval: resEval };
    },

    getDefectiveEquipment: function () {
      return (inMemoryData.equipment || []).filter(function (eq) {
        return eq.status === 'abnormal' || eq.status === 'in_progress' || eq.status === 'conditional_ready' || eq.repairStatus === 'reported' || eq.repairStatus === 'in_progress';
      });
    },

    getRepairs: function () {
      return inMemoryData.repairs || [];
    },

    isBatteryMandatoryDate: function (dateObjOrStr) {
      var d = dateObjOrStr ? new Date(dateObjOrStr) : new Date();
      var day = d.getDate();
      return day === 1 || day === 16;
    },

    getBatteryEvaluations: function (cycleFilter) {
      var list = (inMemoryData.evaluations || []).filter(function (ev) {
        return ev.upsBattery && ev.upsBattery.tested;
      });
      if (cycleFilter && cycleFilter !== 'all') {
        list = list.filter(function (ev) {
          return (ev.upsBattery && ev.upsBattery.cycleDate === cycleFilter) || 
                 (ev.evaluatedAt && ev.evaluatedAt.indexOf(cycleFilter) === 0);
        });
      }
      return list;
    }
  };
})(window);
