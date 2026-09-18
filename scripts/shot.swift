// Offscreen screenshot of a URL with WKWebView (WebGL works because it renders through Metal).
//
//   swift scripts/shot.swift http://127.0.0.1:8322/ out.png [wait_seconds] [js-to-run-before-shot]
//
// Prints console messages from the page (window.onerror and console.error are forwarded).

import Cocoa
import WebKit

let args = CommandLine.arguments
guard args.count >= 3, let url = URL(string: args[1]) else {
    print("usage: shot.swift URL OUT.png [wait] [js]"); exit(2)
}
let out = args[2]
let wait = args.count > 3 ? Double(args[3]) ?? 4.0 : 4.0
let preJS = args.count > 4 ? args[4] : ""

class Handler: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        print("[page] \(m.body)")
    }
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
  window.addEventListener('unhandledrejection', (e) => send('rejection', String(e.reason && (e.reason.stack || e.reason))));
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
web.load(URLRequest(url: url))

DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
    let finish = {
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
    if preJS.isEmpty { finish() } else {
        web.evaluateJavaScript(preJS) { result, error in
            if let error = error { print("[js] error: \(error.localizedDescription)") }
            if let result = result { print("[js] \(result)") }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { finish() }
        }
    }
}
app.run()
