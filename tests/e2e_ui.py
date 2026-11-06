# اختبار واجهة end-to-end (يتطلب python + playwright). شغّل الخادم أولًا: SMARTZ_DATA=/tmp/sz PORT=3113 HOST=127.0.0.1 npm start
import base64, json, cv2, numpy as np
from playwright.sync_api import sync_playwright
U='http://127.0.0.1:3113/'; errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1280,'height':900})
    pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: errs.append(m.text) if m.type=='error' else None)
    def go(address):
        pg.goto(address); pg.wait_for_selector('[data-activity=events]'); pg.click('[data-activity=events]')
    go(U); pg.fill('#co','محل الأفراح'); pg.fill('#u','owner'); pg.fill('#p','password123'); pg.click('#go'); pg.wait_for_selector('nav')
    go(U+'#settings'); pg.click('[data-t=company]'); pg.fill('[data-k=vat_number]','300000000000003'); pg.fill('[data-k=cr_number]','1234567890'); pg.fill('[data-k=street]','شارع الاختبار'); pg.fill('[data-k=building_number]','1234'); pg.fill('[data-k=district]','حي الاختبار'); pg.fill('[data-k=city]','الرياض'); pg.fill('[data-k=postal_code]','12345'); pg.click('#save-company'); pg.wait_for_selector('#msg.ok')
    go(U+'#new'); pg.wait_for_selector('#ln'); pg.fill('#ln .d','تنسيق كوشة'); pg.fill('#ln .u','2000'); pg.fill('#ln .q','2')
    pg.click('#issue'); pg.wait_for_selector('#confirm-issue')
    with pg.context.expect_page() as np_: pg.click('#confirm-issue')
    inv=np_.value; inv.wait_for_selector('#qr svg')
    el=inv.locator('#qr'); el.screenshot(path='/tmp/qr_el.png')
    img=cv2.imread('/tmp/qr_el.png'); img=cv2.copyMakeBorder(img,40,40,40,40,cv2.BORDER_CONSTANT,value=(255,255,255)); img=cv2.resize(img,None,fx=3,fy=3,interpolation=cv2.INTER_NEAREST)
    val,_,_=cv2.QRCodeDetector().detectAndDecode(img)
    raw=base64.b64decode(val) if val else b''; i=0; f={}
    while i<len(raw): f[raw[i]]=raw[i+2:i+2+raw[i+1]].decode(); i+=2+raw[i+1]
    print('QR المطبوع في الفاتورة يُفك إلى:',f)
    inv.screenshot(path='/tmp/ui_invoice.png')
    go(U+'#invoices'); pg.wait_for_selector('[data-cn]'); pg.click('[data-cn]'); pg.wait_for_selector('#dlg[open]')
    pg.fill('#dlg [data-l]','1'); pg.fill('#rs','إرجاع جزئي')
    with pg.context.expect_page() as cp: pg.click('#ok')
    cp.value.wait_for_load_state(); print('إشعار دائن:', 'A-000002' in cp.value.content())
    go(U+'#reports'); pg.wait_for_selector('#go'); pg.click('#go'); pg.wait_for_selector('#vr table'); print('الضريبة:', pg.inner_text('#vr p')[:100])
    pg.screenshot(path='/tmp/ui_reports.png')
    go(U+'#settings'); pg.click('[data-t=invoice]'); pg.wait_for_timeout(900); pg.screenshot(path='/tmp/ui_settings.png')
    pg.set_viewport_size({'width':390,'height':800}); pg.goto(U+'#dashboard'); pg.wait_for_timeout(400); pg.screenshot(path='/tmp/ui_mobile.png')
    b.close()
print('أخطاء المتصفح:',errs)
