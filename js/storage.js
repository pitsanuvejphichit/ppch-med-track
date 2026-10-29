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
    localStorage.removeItem('ppch_custom_forms_v1');
    localStorage.removeItem('ppch_medical_equipment_data_v2');
    localStorage.removeItem('ppch_med_track_v1');
    localStorage.removeItem('ppch_med_gas_url');
  } catch (e) {}

  // Pure In-Memory Custom Forms (Strict Rule 4: ZERO localStorage for system business data)
  function loadLocalCustomForms() {
    return [];
  }

  function saveLocalCustomForms(forms) {
    // Pure In-Memory: Persistent storage is handled directly via Supabase PostgreSQL & Google Sheets
  }

  // Pure in-memory state for current browser session (Populated directly from Google Sheets / Supabase)
  var inMemoryData = {
    departments: (window.PPCH_CONFIG && window.PPCH_CONFIG.departments) ? JSON.parse(JSON.stringify(window.PPCH_CONFIG.departments)) : [],
    equipment: (window.PPCH_CONFIG && window.PPCH_CONFIG.initialEquipment) ? JSON.parse(JSON.stringify(window.PPCH_CONFIG.initialEquipment)) : [],
    customForms: loadLocalCustomForms(),
    evaluations: [],
    transfers: [],
    repairs: [],
    employees: []
  };

  function notifyUpdated() {
    window.dispatchEvent(new CustomEvent('ppch:data-updated', { detail: inMemoryData }));
  }

  function isRepairResolutionLog(ev) {
    if (!ev) return false;
    return !!(ev.isRepairResolution ||
      (ev.evaluatedBy && ev.evaluatedBy.indexOf('ซ่อมเสร็จ') !== -1) ||
      (ev.abnormalNote && ev.abnormalNote.indexOf('แก้ไขเรียบร้อย') === 0));
  }

  function hasConditionalItems(ev) {
    if (!ev) return false;
    if (ev.keepConditional) return true;
    if (ev.abnormalNote && ev.abnormalNote.indexOf('[ตรวจเช็คประจำวันผ่าน - คงสถานะผ่อนผันรอซ่อม]') !== -1) return true;
    var chk = ev.checklist || {};
    if (typeof chk === 'string') {
      try { chk = JSON.parse(chk); } catch (e) { chk = {}; }
    }
    return Object.keys(chk).some(function (k) { return chk[k] === 'conditional'; });
  }

  function isNewerEvaluation(newEv, oldEv) {
    if (!oldEv) return true;
    if (!newEv) return false;
    var atNew = String(newEv.evaluatedAt || '');
    var atOld = String(oldEv.evaluatedAt || '');
    if (atNew > atOld) return true;
    if (atNew < atOld) return false;

    var isResNew = isRepairResolutionLog(newEv);
    var isResOld = isRepairResolutionLog(oldEv);
    if (!isResNew && isResOld) return true;
    if (isResNew && !isResOld) return false;

    var idNew = String(newEv.id || '');
    var idOld = String(oldEv.id || '');
    if (idNew > idOld) return true;
    if (idNew < idOld) return false;

    if (newEv.result === 'normal' && oldEv.result === 'abnormal') return true;
    return false;
  }

  window.PPCH_STORE = {
    isRepairResolutionLog: isRepairResolutionLog,
    hasConditionalItems: hasConditionalItems,

    getActiveDefectInfo: function (deviceId) {
      var eq = this.getEquipmentById(deviceId);
      if (!eq) return null;

      var allRepairs = inMemoryData.repairs || [];
      var latestResolvedAt = '';
      allRepairs.forEach(function (rep) {
        var matchDev = (rep.device_id === eq.id || rep.device_asset === eq.assetCode || rep.deviceId === eq.id || rep.deviceAsset === eq.assetCode);
        if (matchDev) {
          var rAt = String(rep.resolved_at || rep.resolvedAt || '');
          if (rAt && rAt > latestResolvedAt) {
            latestResolvedAt = rAt;
          }
        }
      });

      var devEvals = (inMemoryData.evaluations || []).filter(function (ev) {
        if (!ev || isRepairResolutionLog(ev)) return false;
        var matchDev = (ev.deviceId === eq.id || ev.deviceAsset === eq.assetCode);
        return matchDev && ev.result === 'abnormal' && (!latestResolvedAt || String(ev.evaluatedAt || '') > latestResolvedAt);
      });

      devEvals.sort(function (a, b) {
        return String(b.evaluatedAt || '').localeCompare(String(a.evaluatedAt || ''));
      });

      var latestAbnormalEv = devEvals.length > 0 ? devEvals[0] : null;
      var failedIndices = [];
      var form = this.getFormById(eq.formId);
      var formItems = (form && Array.isArray(form.items)) ? form.items : [];

      if (latestAbnormalEv) {
        var chk = latestAbnormalEv.checklist || {};
        if (typeof chk === 'string') {
          try { chk = JSON.parse(chk); } catch (e) { chk = {}; }
        }
        formItems.forEach(function (qItem, idx) {
          var qText = (typeof qItem === 'string') ? qItem : (qItem.text || qItem.title || qItem.label || '');
          var val = undefined;
          if (chk[idx] !== undefined) val = chk[idx];
          else if (chk[String(idx)] !== undefined) val = chk[String(idx)];
          else if (chk[idx + 1] !== undefined) val = chk[idx + 1];
          else if (chk[String(idx + 1)] !== undefined) val = chk[String(idx + 1)];
          else if (qText && chk[qText] !== undefined) val = chk[qText];

          if (val === 'fail' || val === 'abnormal' || val === false || val === 0 || val === 'ไม่ผ่าน' || val === 'conditional') {
            failedIndices.push(idx);
          }
        });

        if (failedIndices.length === 0) {
          Object.keys(chk).forEach(function (k) {
            var v = chk[k];
            if (v === 'fail' || v === 'abnormal' || v === false || v === 0 || v === 'ไม่ผ่าน' || v === 'conditional') {
              var num = parseInt(String(k).replace(/\D/g, ''), 10);
              if (!isNaN(num)) {
                var zeroIdx = (chk['0'] !== undefined || chk[0] !== undefined) ? num : (num > 0 ? num - 1 : 0);
                if (failedIndices.indexOf(zeroIdx) === -1) failedIndices.push(zeroIdx);
              }
            }
          });
        }
      }

      if (failedIndices.length === 0 && (eq.status === 'conditional_ready' || eq.allowUse || eq.status === 'abnormal' || eq.status === 'in_progress')) {
        var reasonLower = String(eq.abnormalReason || (latestAbnormalEv && latestAbnormalEv.abnormalNote) || '').toLowerCase();
        if (reasonLower && formItems.length > 0) {
          formItems.forEach(function (qItem, idx) {
            var qText = String((typeof qItem === 'string') ? qItem : (qItem.text || '')).toLowerCase();
            if (qText && (reasonLower.indexOf(qText.slice(0, 12)) !== -1 || qText.indexOf(reasonLower.slice(0, 12)) !== -1)) {
              if (failedIndices.indexOf(idx) === -1) failedIndices.push(idx);
            }
          });
        }
      }

      return {
        evalRecord: latestAbnormalEv,
        failedIndices: failedIndices,
        abnormalReason: eq.abnormalReason || (latestAbnormalEv ? latestAbnormalEv.abnormalNote : '') || 'ตรวจพบข้อบกพร่อง',
        reportedAt: eq.repairReportedAt || (latestAbnormalEv ? latestAbnormalEv.evaluatedAt : ''),
        reportedBy: eq.repairReportedBy || (latestAbnormalEv ? latestAbnormalEv.evaluatedBy : '')
      };
    },

    getRecentRepairedDefectInfo: function (deviceId) {
      var eq = this.getEquipmentById(deviceId);
      if (!eq) return null;

      var allRepairs = inMemoryData.repairs || [];
      var matchingRepairs = allRepairs.filter(function (rep) {
        var matchDev = (rep.device_id === eq.id || rep.device_asset === eq.assetCode || rep.deviceId === eq.id || rep.deviceAsset === eq.assetCode);
        var rAt = rep.resolved_at || rep.resolvedAt;
        return matchDev && !!rAt;
      });

      if (matchingRepairs.length === 0) return null;

      matchingRepairs.sort(function (a, b) {
        var tA = String(a.resolved_at || a.resolvedAt || '');
        var tB = String(b.resolved_at || b.resolvedAt || '');
        return tB.localeCompare(tA);
      });

      var latestRepair = matchingRepairs[0];
      var resolvedAt = latestRepair.resolved_at || latestRepair.resolvedAt;
      var resolvedBy = latestRepair.resolved_by || latestRepair.resolvedBy || 'เจ้าหน้าที่เครื่องมือแพทย์';
      var actionTaken = latestRepair.action_taken || latestRepair.actionTaken || 'ดำเนินการแก้ไขและทดสอบระบบเรียบร้อย';
      var defectReason = latestRepair.defect_reason || latestRepair.defectReason || '';
      var testNote = latestRepair.test_note || latestRepair.testResultNote || '';

      // Check if there has been an evaluation AFTER this repair
      var evalsAfterRepair = (inMemoryData.evaluations || []).filter(function (ev) {
        if (!ev || isRepairResolutionLog(ev)) return false;
        var matchDev = (ev.deviceId === eq.id || ev.deviceAsset === eq.assetCode);
        return matchDev && String(ev.evaluatedAt || '') > String(resolvedAt);
      });

      evalsAfterRepair.sort(function (a, b) {
        return String(b.evaluatedAt || '').localeCompare(String(a.evaluatedAt || ''));
      });

      var isAwaitingPostRepairCheck = (evalsAfterRepair.length === 0);

      var repairTimeMs = new Date(String(resolvedAt).replace(' ', 'T')).getTime();
      var nowMs = Date.now();
      var isWithin48Hours = !isNaN(repairTimeMs) && ((nowMs - repairTimeMs) < 48 * 3600 * 1000);

      if (!isAwaitingPostRepairCheck && !isWithin48Hours) {
        return null;
      }

      var failedIndices = [];
      if (Array.isArray(latestRepair.repairedIndices) && latestRepair.repairedIndices.length > 0) {
        failedIndices = latestRepair.repairedIndices.slice();
      }

      if (failedIndices.length === 0) {
        var evalsBeforeRepair = (inMemoryData.evaluations || []).filter(function (ev) {
          if (!ev || isRepairResolutionLog(ev)) return false;
          var matchDev = (ev.deviceId === eq.id || ev.deviceAsset === eq.assetCode);
          return matchDev && ev.result === 'abnormal' && String(ev.evaluatedAt || '') <= String(resolvedAt);
        });

        evalsBeforeRepair.sort(function (a, b) {
          return String(b.evaluatedAt || '').localeCompare(String(a.evaluatedAt || ''));
        });

        var abnormalEv = evalsBeforeRepair.length > 0 ? evalsBeforeRepair[0] : null;
        var form = this.getFormById(eq.formId);
        var formItems = (form && Array.isArray(form.items)) ? form.items : [];

        if (abnormalEv) {
          var chk = abnormalEv.checklist || {};
          if (typeof chk === 'string') {
            try { chk = JSON.parse(chk); } catch (e) { chk = {}; }
          }
          formItems.forEach(function (qItem, idx) {
            var qText = (typeof qItem === 'string') ? qItem : (qItem.text || qItem.title || qItem.label || '');
            var val = undefined;
            if (chk[idx] !== undefined) val = chk[idx];
            else if (chk[String(idx)] !== undefined) val = chk[String(idx)];
            else if (chk[idx + 1] !== undefined) val = chk[idx + 1];
            else if (chk[String(idx + 1)] !== undefined) val = chk[String(idx + 1)];
            else if (qText && chk[qText] !== undefined) val = chk[qText];

            if (val === 'fail' || val === 'abnormal' || val === false || val === 0 || val === 'ไม่ผ่าน' || val === 'conditional') {
              if (failedIndices.indexOf(idx) === -1) failedIndices.push(idx);
            }
          });

          if (failedIndices.length === 0) {
            Object.keys(chk).forEach(function (k) {
              var v = chk[k];
              if (v === 'fail' || v === 'abnormal' || v === false || v === 0 || v === 'ไม่ผ่าน' || v === 'conditional') {
                var num = parseInt(String(k).replace(/\D/g, ''), 10);
                if (!isNaN(num)) {
                  var zeroIdx = (chk['0'] !== undefined || chk[0] !== undefined) ? num : (num > 0 ? num - 1 : 0);
                  if (failedIndices.indexOf(zeroIdx) === -1) failedIndices.push(zeroIdx);
                }
              }
            });
          }
        }

        var reasonText = String(defectReason || (abnormalEv && abnormalEv.abnormalNote) || '').toLowerCase();
        if (reasonText && formItems.length > 0) {
          formItems.forEach(function (qItem, idx) {
            var qText = String((typeof qItem === 'string') ? qItem : (qItem.text || '')).toLowerCase();
            var itemNoPattern = new RegExp('(ข้อ|หัวข้อ|ข้อที่)\\s*' + (idx + 1) + '(\\D|$)', 'i');
            if (itemNoPattern.test(reasonText)) {
              if (failedIndices.indexOf(idx) === -1) failedIndices.push(idx);
            } else if (qText && qText.length >= 6 && (reasonText.indexOf(qText.slice(0, 14)) !== -1 || qText.indexOf(reasonText.slice(0, 14)) !== -1)) {
              if (failedIndices.indexOf(idx) === -1) failedIndices.push(idx);
            }
          });
        }
      }

      return {
        isRecentlyRepaired: true,
        isAwaitingPostRepairCheck: isAwaitingPostRepairCheck,
        repairedAt: resolvedAt,
        repairedBy: resolvedBy,
        actionTaken: actionTaken,
        defectReason: defectReason,
        testNote: testNote,
        failedIndices: failedIndices,
        repairRecord: latestRepair
      };
    },

    // Initialize or refresh live data directly from Google Apps Script / Google Sheets
    initFromCloud: function (cloudData) {
      if (!cloudData) return inMemoryData;

      if (Array.isArray(cloudData.equipment) && cloudData.equipment.length > 0) {
        inMemoryData.equipment = cloudData.equipment;
      }
      if (Array.isArray(cloudData.transfers)) {
        inMemoryData.transfers = cloudData.transfers;
      } else {
        inMemoryData.transfers = [];
      }
      if (Array.isArray(cloudData.repairs)) {
        inMemoryData.repairs = cloudData.repairs;
      } else {
        inMemoryData.repairs = [];
      }
      if (Array.isArray(cloudData.employees)) {
        inMemoryData.employees = cloudData.employees;
      }
      if (Array.isArray(cloudData.departments) && cloudData.departments.length > 0) {
        inMemoryData.departments = cloudData.departments;
        if (window.PPCH_CONFIG) {
          window.PPCH_CONFIG.departments = cloudData.departments;
        }
      }

      if (Array.isArray(cloudData.evaluations)) {
        inMemoryData.evaluations = cloudData.evaluations;

        // Group latest REAL daily evaluation and latest abnormal evaluation per device
        var latestEvalMap = {};
        var latestAbnormalMap = {};
        cloudData.evaluations.forEach(function (ev) {
          if (!ev || !ev.evaluatedAt) return;
          if (isRepairResolutionLog(ev)) return; // Ignore fake repair logs!
          var k1 = ev.deviceId;
          var k2 = ev.deviceAsset;
          if (k1 && isNewerEvaluation(ev, latestEvalMap[k1])) {
            latestEvalMap[k1] = ev;
          }
          if (k2 && isNewerEvaluation(ev, latestEvalMap[k2])) {
            latestEvalMap[k2] = ev;
          }
          if (ev.result === 'abnormal') {
            if (k1 && isNewerEvaluation(ev, latestAbnormalMap[k1])) {
              latestAbnormalMap[k1] = ev;
            }
            if (k2 && isNewerEvaluation(ev, latestAbnormalMap[k2])) {
              latestAbnormalMap[k2] = ev;
            }
          }
        });

        // Update equipment status based on backend equipment status, repairs, and latest evaluation
        inMemoryData.equipment.forEach(function (item) {
          var latestEv = latestEvalMap[item.id] || latestEvalMap[item.assetCode];
          var latestAbn = latestAbnormalMap[item.id] || latestAbnormalMap[item.assetCode];

          if (latestEv) {
            item.lastEvaluatedAt = latestEv.evaluatedAt;
            item.lastEvaluatedBy = latestEv.evaluatedBy;
          }

          var refDefectEv = latestAbn || latestEv;
          var isResolvedInRepairs = false;
          if (refDefectEv) {
            isResolvedInRepairs = (inMemoryData.repairs || []).some(function (rep) {
              var matchDev = (rep.device_id === item.id || rep.device_asset === item.assetCode || rep.deviceId === item.id || rep.deviceAsset === item.assetCode);
              var matchReport = (rep.reported_at === refDefectEv.evaluatedAt || rep.reportedAt === refDefectEv.evaluatedAt);
              var isAfterReport = (rep.resolved_at && rep.resolved_at >= refDefectEv.evaluatedAt) || (rep.resolvedAt && rep.resolvedAt >= refDefectEv.evaluatedAt);
              return matchDev && (matchReport || isAfterReport);
            });
          }

          var isBackendReady = (item.status === 'ready' && (item.repairStatus === 'ready' || !item.repairStatus));

          if (isBackendReady || isResolvedInRepairs) {
            if (!latestAbn || isResolvedInRepairs || isBackendReady) {
              item.status = 'ready';
              item.repairStatus = 'ready';
              item.abnormalReason = '';
              item.allowUse = false;
            }
          } else if (latestEv && latestEv.result === 'normal') {
            if (hasConditionalItems(latestEv) || item.status === 'conditional_ready' || item.allowUse) {
              item.status = 'conditional_ready';
              item.allowUse = true;
              if (latestAbn && !item.abnormalReason) {
                item.abnormalReason = latestAbn.abnormalNote || 'พบข้อบกพร่องจากการตรวจเช็ค';
              }
            } else if (item.status !== 'in_progress' && item.status !== 'abnormal') {
              item.status = 'ready';
              item.repairStatus = 'ready';
              item.abnormalReason = '';
              item.allowUse = false;
            }
          } else if (latestAbn) {
            if (item.allowUse || item.status === 'conditional_ready') {
              item.status = 'conditional_ready';
              item.allowUse = true;
            } else if (item.status === 'in_progress' || item.repairStatus === 'in_progress') {
              item.status = 'in_progress';
              item.repairStatus = 'in_progress';
            } else {
              item.status = 'abnormal';
              item.repairStatus = 'reported';
            }
            item.abnormalReason = item.abnormalReason || latestAbn.abnormalNote || 'พบข้อบกพร่องจากการตรวจเช็ค';
            item.repairReportedAt = item.repairReportedAt || latestAbn.evaluatedAt;
            item.repairReportedBy = item.repairReportedBy || latestAbn.evaluatedBy;
          }
        });
      } else {
        inMemoryData.evaluations = [];
      }
      if (Array.isArray(cloudData.customForms)) {
        var cloudMap = {};
        cloudData.customForms.forEach(function (cf) {
          if (cf && cf.id) {
            cloudMap[cf.id] = {
              id: cf.id,
              name: cf.name,
              shortName: cf.shortName || cf.short_name || cf.name,
              category: cf.category || 'เครื่องมือแพทย์ทั่วไป',
              frequency: cf.frequency || 'daily',
              riskLevel: cf.riskLevel || cf.risk_level || 'high',
              items: cf.items || []
            };
          }
        });
        (inMemoryData.customForms || []).forEach(function (lf) {
          if (lf && lf.id && !cloudMap[lf.id]) {
            cloudMap[lf.id] = lf;
          }
        });
        var mergedList = [];
        for (var cid in cloudMap) {
          mergedList.push(cloudMap[cid]);
        }
        inMemoryData.customForms = mergedList;
        saveLocalCustomForms(inMemoryData.customForms);
      }

      notifyUpdated();
      return inMemoryData;
    },

    syncCloudEvaluations: function (cloudEvals) {
      if (!Array.isArray(cloudEvals)) return inMemoryData.evaluations;
      inMemoryData.evaluations = cloudEvals;

      var latestEvalMap = {};
      var latestAbnormalMap = {};
      cloudEvals.forEach(function (ev) {
        if (!ev || !ev.evaluatedAt) return;
        if (isRepairResolutionLog(ev)) return; // Ignore fake repair logs
        var k1 = ev.deviceId;
        var k2 = ev.deviceAsset;
        if (k1 && isNewerEvaluation(ev, latestEvalMap[k1])) {
          latestEvalMap[k1] = ev;
        }
        if (k2 && isNewerEvaluation(ev, latestEvalMap[k2])) {
          latestEvalMap[k2] = ev;
        }
        if (ev.result === 'abnormal') {
          if (k1 && isNewerEvaluation(ev, latestAbnormalMap[k1])) {
            latestAbnormalMap[k1] = ev;
          }
          if (k2 && isNewerEvaluation(ev, latestAbnormalMap[k2])) {
            latestAbnormalMap[k2] = ev;
          }
        }
      });

      inMemoryData.equipment.forEach(function (eq) {
        var latestEv = latestEvalMap[eq.id] || latestEvalMap[eq.assetCode];
        var latestAbn = latestAbnormalMap[eq.id] || latestAbnormalMap[eq.assetCode];
        if (latestEv) {
          eq.lastEvaluatedAt = latestEv.evaluatedAt;
          eq.lastEvaluatedBy = latestEv.evaluatedBy;
        }

        var refDefectEv = latestAbn || latestEv;
        var isResolvedInRepairs = false;
        if (refDefectEv) {
          isResolvedInRepairs = (inMemoryData.repairs || []).some(function (rep) {
            var matchDev = (rep.device_id === eq.id || rep.device_asset === eq.assetCode || rep.deviceId === eq.id || rep.deviceAsset === eq.assetCode);
            var matchReport = (rep.reported_at === refDefectEv.evaluatedAt || rep.reportedAt === refDefectEv.evaluatedAt);
            var isAfterReport = (rep.resolved_at && rep.resolved_at >= refDefectEv.evaluatedAt) || (rep.resolvedAt && rep.resolvedAt >= refDefectEv.evaluatedAt);
            return matchDev && (matchReport || isAfterReport);
          });
        }
        var isBackendReady = (eq.status === 'ready' && (eq.repairStatus === 'ready' || !eq.repairStatus));

        if (isBackendReady || isResolvedInRepairs) {
          eq.status = 'ready';
          eq.repairStatus = 'ready';
          eq.abnormalReason = '';
          eq.allowUse = false;
        } else if (latestEv && latestEv.result === 'normal') {
          if (hasConditionalItems(latestEv) || eq.status === 'conditional_ready' || eq.allowUse) {
            eq.status = 'conditional_ready';
            eq.allowUse = true;
            if (latestAbn && !eq.abnormalReason) {
              eq.abnormalReason = latestAbn.abnormalNote || 'พบข้อบกพร่องจากการตรวจเช็ค';
            }
          } else if (eq.status !== 'in_progress' && eq.status !== 'abnormal') {
            eq.status = 'ready';
            eq.repairStatus = 'ready';
            eq.abnormalReason = '';
            eq.allowUse = false;
          }
        } else if (latestAbn) {
          if (eq.allowUse || eq.status === 'conditional_ready') {
            eq.status = 'conditional_ready';
            eq.allowUse = true;
          } else if (eq.status === 'in_progress' || eq.repairStatus === 'in_progress') {
            eq.status = 'in_progress';
            eq.repairStatus = 'in_progress';
          } else {
            eq.status = 'abnormal';
            eq.repairStatus = 'reported';
          }
          eq.abnormalReason = eq.abnormalReason || latestAbn.abnormalNote || 'พบข้อบกพร่องจากการตรวจเช็ค';
          eq.repairReportedAt = eq.repairReportedAt || latestAbn.evaluatedAt;
          eq.repairReportedBy = eq.repairReportedBy || latestAbn.evaluatedBy;
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

    getForms: function () {
      var standard = (window.PPCH_CONFIG && window.PPCH_CONFIG.forms) ? window.PPCH_CONFIG.forms : [];
      var custom = inMemoryData.customForms || [];
      var formMap = {};
      standard.forEach(function (f) { if (f && f.id) formMap[f.id] = f; });
      custom.forEach(function (f) { if (f && f.id) formMap[f.id] = f; });
      var list = [];
      for (var k in formMap) {
        list.push(formMap[k]);
      }
      return list;
    },

    getFormById: function (formId) {
      var all = this.getForms();
      for (var i = 0; i < all.length; i++) {
        if (all[i].id === formId) return all[i];
      }
      return null;
    },

    saveCustomForm: function (formObj) {
      if (!formObj || !formObj.id) return false;
      if (!inMemoryData.customForms) inMemoryData.customForms = [];
      var idx = inMemoryData.customForms.findIndex(function (f) { return f.id === formObj.id; });
      if (idx >= 0) {
        inMemoryData.customForms[idx] = formObj;
      } else {
        inMemoryData.customForms.push(formObj);
      }
      saveLocalCustomForms(inMemoryData.customForms);
      if (window.PPCH_CONFIG && window.PPCH_CONFIG.forms) {
        var cIdx = window.PPCH_CONFIG.forms.findIndex(function (f) { return f.id === formObj.id; });
        if (cIdx >= 0) window.PPCH_CONFIG.forms[cIdx] = formObj;
        else window.PPCH_CONFIG.forms.push(formObj);
      }
      notifyUpdated();
      return true;
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
      var isKeepConditional = !!(evalPayload.keepConditional || hasConditionalItems(evalPayload));

      if (eq) {
        eq.lastEvaluatedAt = nowStr;
        eq.lastEvaluatedStatus = evalPayload.result;
        eq.lastEvaluatedBy = evalPayload.evaluatedBy;
        if (evalPayload.department) {
          eq.currentDept = evalPayload.department;
          eq.homeDept = evalPayload.department;
        }

        if (evalPayload.result === 'abnormal') {
          eq.status = 'abnormal';
          eq.allowUse = false;
          eq.abnormalReason = evalPayload.abnormalNote || 'พบข้อบกพร่องจากการตรวจเช็ค';
          eq.repairStatus = 'reported';
          eq.repairReportedAt = nowStr;
          eq.repairReportedBy = evalPayload.evaluatedBy;
        } else if (isKeepConditional || eq.status === 'conditional_ready' || eq.allowUse) {
          eq.status = 'conditional_ready';
          eq.allowUse = true;
        } else {
          eq.status = 'ready';
          eq.abnormalReason = '';
          eq.repairStatus = 'ready';
          eq.allowUse = false;
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
        keepConditional: isKeepConditional
      };

      inMemoryData.evaluations.unshift(evalRecord);
      notifyUpdated();
      return { success: true, record: evalRecord, equipment: eq };
    },

    assignDepartment: function (deviceId, toDeptId) {
      var eq = this.getEquipmentById(deviceId);
      if (!eq) throw new Error('ไม่พบเครื่องมือแพทย์รหัส ' + deviceId);
      eq.currentDept = toDeptId;
      eq.homeDept = toDeptId;
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
      eq.homeDept = toDeptId;

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

      // Capture failed indices before resetting equipment status
      var activeDefect = this.getActiveDefectInfo(deviceId);
      var repairedIndices = (activeDefect && Array.isArray(activeDefect.failedIndices)) ? activeDefect.failedIndices.slice() : [];

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
        testResultNote: testNote || '',
        repairedIndices: repairedIndices
      };

      // Unlock ONLY equipment readiness status — DO NOT create a fake daily evaluation or overwrite lastEvaluatedAt
      eq.status = 'ready';
      eq.repairStatus = 'ready';
      eq.abnormalReason = '';
      eq.allowUse = false;
      eq.allowUseBy = '';
      eq.allowUseAt = '';
      eq.allowUseReason = '';
      eq.lastRepairedAt = nowStr;
      eq.lastRepairedAction = actionTaken || 'ดำเนินการแก้ไขและทดสอบระบบเรียบร้อย';
      eq.lastRepairedIndices = repairedIndices;

      inMemoryData.repairs.unshift(defectLog);
      notifyUpdated();
      return { success: true, equipment: eq, repairRecord: defectLog };
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
    },

    getEmployees: function () {
      return inMemoryData.employees || [];
    },

    getActiveEmployees: function () {
      return (inMemoryData.employees || []).filter(function (e) {
        return e.isActive !== false;
      });
    },

    getEmployeeById: function (empId) {
      if (!empId) return null;
      var cleanId = String(empId).trim().padStart(6, '0');
      var list = inMemoryData.employees || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].empId === cleanId) return list[i];
      }
      return null;
    },

    saveEmployeeInMemory: function (emp) {
      if (!emp || !emp.empId) return;
      var cleanId = String(emp.empId).trim().padStart(6, '0');
      emp.empId = cleanId;
      var list = inMemoryData.employees || [];
      var found = false;
      for (var i = 0; i < list.length; i++) {
        if (list[i].empId === cleanId) {
          Object.assign(list[i], emp);
          found = true;
          break;
        }
      }
      if (!found) {
        list.push(emp);
      }
      notifyUpdated();
      return emp;
    },

    deleteEmployeeInMemory: function (empId) {
      var cleanId = String(empId).trim().padStart(6, '0');
      inMemoryData.employees = (inMemoryData.employees || []).filter(function (e) {
        return e.empId !== cleanId;
      });
      notifyUpdated();
    }
  };
})(window);
