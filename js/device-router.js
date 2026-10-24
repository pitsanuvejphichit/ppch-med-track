/**
 * PPCH MedTrack — Device Router
 * ตรวจจับอัตโนมัติว่าเปิดด้วยมือถือหรือคอม แล้วพาไปหน้าที่ออกแบบเฉพาะอุปกรณ์นั้น
 *   admin.html  <->  admin-m.html
 *   eval.html   <->  eval-m.html
 * บังคับเวอร์ชันได้ด้วย ?view=desktop หรือ ?view=mobile (ไม่ใช้ localStorage)
 * ต้องโหลดใน <head> ก่อน CSS/สคริปต์อื่น เพื่อสลับหน้าก่อนเรนเดอร์ (ไม่กระพริบ)
 */
(function () {
  var PAIRS = {
    'admin.html': 'admin-m.html',
    'eval.html': 'eval-m.html'
  };

  function isMobileDevice() {
    var ua = navigator.userAgent || '';
    if (/iPhone|iPod|Android.+Mobile|Windows Phone|IEMobile|Opera Mini|BlackBerry|webOS/i.test(ua)) return true;
    // Android ที่ไม่มีคำว่า Mobile = แท็บเล็ต → ใช้หน้าคอม
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    var shortSide = Math.min(window.screen.width || 0, window.screen.height || 0);
    return !!(coarse && shortSide > 0 && shortSide < 600);
  }

  try {
    var path = window.location.pathname;
    var file = path.substring(path.lastIndexOf('/') + 1) || 'index.html';
    var dir = path.substring(0, path.lastIndexOf('/') + 1);
    var params = new URLSearchParams(window.location.search);
    var forced = params.get('view'); // 'desktop' | 'mobile' | null

    var wantMobile = forced === 'mobile' ? true : forced === 'desktop' ? false : isMobileDevice();

    var target = null;
    if (wantMobile && PAIRS[file]) {
      target = PAIRS[file];
    } else if (!wantMobile) {
      for (var desk in PAIRS) {
        if (PAIRS[desk] === file) { target = desk; break; }
      }
    }

    window.PPCH_DEVICE = { isMobile: wantMobile, forced: forced };

    if (target) {
      window.location.replace(dir + target + window.location.search + window.location.hash);
    }
  } catch (e) {
    console.warn('Device router error:', e);
  }
})();
