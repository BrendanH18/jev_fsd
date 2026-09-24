// Offscreen screenshot of a URL with WKWebView (WebGL renders through Metal).
//
//   swift scripts/shot.swift URL OUT.png [wait_seconds] [post_js] [pre_js] [settle_seconds] [timeout_seconds]
//
// Timeline: load -> settle (default 3 s) -> run pre_js -> wait -> run post_js -> snapshot.
// Page errors, unhandled rejections, console.error and console.log are forwarded to stdout.

import Cocoa
import WebKit

let args = CommandLine.arguments
guard args.count >= 3, let url = URL(string: args[1]) else {
    print("usage: shot.swift URL OUT.png [wait] [post_js] [pre_js] [settle]"); exit(2)
}
let out = args[2]
let wait = args.count > 3 ? Double(args[3]) ?? 4.0 : 4.0
let postJS = args.count > 4 ? args[4] : ""
let preJS = args.count > 5 ? args[5] : ""
let settle = args.count > 6 ? Double(args[6]) ?? 3.0 : 3.0
let timeout = args.count > 7 ? Double(args[7]) ?? 0 : 0

class Handler: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    var onLoad: (() -> Void)?
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        print("[page] \(m.body)")
    }
    func webView(_ w: WKWebView, didFinish n: WKNavigation!) { onLoad?() }
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) {
        print("[nav] failed: \(e.localizedDescription)"); exit(1)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let config = WKWebViewConfiguration()
let handler = Handler()
let hook = """
(function(){
  const send = (kind, msg) => { try { window.webkit.messageHandlers.log.postMessage(kind + ': ' + msg); } catch (e) {} };
  window.addEventListener('error', (e) => send('error', (e.message || '') + ' @ ' + (e.filename || '') + ':' + (e.lineno || '')));
  window.addEventListener('unhandledrejection', (e) => send('rejection', String(e.reason && (e.reason.message + ' ' + e.reason.stack || e.reason))));
  const orig = console.error.bind(console); console.error = (...a) => { send('console.error', a.map(String).join(' ')); orig(...a); };
  const origLog = console.log.bind(console); console.log = (...a) => { send('log', a.map(String).join(' ')); origLog(...a); };
})();
"""
config.userContentController.addUserScript(WKUserScript(source: hook, injectionTime: .atDocumentStart, forMainFrameOnly: true))
config.userContentController.add(handler, name: "log")
config.preferences.setValue(true, forKey: "developerExtrasEnabled")
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1440, height: 900), configuration: config)
web.navigationDelegate = handler
let window = NSWindow(contentRect: web.frame, styleMask: [.borderless], backing: .buffered, defer: false)
window.contentView = web
window.orderBack(nil)

func runJS(_ js: String, label: String, then: @escaping () -> Void) {
    if js.isEmpty { then(); return }
    // wrap so promises and objects come back as strings
    let wrapped = "return (async () => { try { const r = await (async () => { \(js) })(); return typeof r === 'string' ? r : JSON.stringify(r); } catch (e) { return 'JS ERROR: ' + (e.message || e) + ' ' + (e.stack || ''); } })()"
    web.callAsyncJavaScript(wrapped, arguments: [:], in: nil, in: .page) { result in
        switch result {
        case .success(let value): print("[\(label)] \(value ?? "")")
        case .failure(let error): print("[\(label)] error: \(error.localizedDescription)")
        }
        then()
    }
}

func snapshot() {
    web.takeSnapshot(with: nil) { image, error in
        guard let image = image, let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) else {
            print("snapshot failed: \(String(describing: error))"); exit(1)
        }
        try? png.write(to: URL(fileURLWithPath: out))
        print("saved \(out)")
        exit(0)
    }
}

handler.onLoad = {
    DispatchQueue.main.asyncAfter(deadline: .now() + settle) {
        runJS(preJS, label: "pre") {
            DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
                runJS(postJS, label: "post") { snapshot() }
            }
        }
    }
}
web.load(URLRequest(url: url))
DispatchQueue.main.asyncAfter(deadline: .now() + max(timeout, settle + wait + 30)) { print("timed out"); exit(1) }
app.run()
